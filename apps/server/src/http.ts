import type { EcoDeviceKind } from "@eco/shared";
import { AuthService } from "./auth/auth-service";
import type { ServerConfig } from "./config";
import { MongoStore } from "./db/mongo-store";
import { DeviceService } from "./devices/device-service";
import { PairingService } from "./pairing/pairing-service";
import { createRedisPresenceStore } from "./presence/presence-store";
import {
  buildRateLimitKey,
  HTTP_RATE_LIMITS,
  RateLimitExceededError,
  type RateLimiter,
  type RateLimitRule,
  RedisRateLimiter,
} from "./rate-limit";
import { RedisRpcBus, type RpcBus } from "./rpc/rpc-bus";
import { type OnlineDeviceSnapshot, RpcGateway, type RpcPeer } from "./rpc/rpc-gateway";
import type { AccessTokenClaims, DeviceAccessTokenClaims, DeviceBindingRecord, DeviceRecord } from "./types";
import { toPublicDevice, toPublicDeviceBinding, toPublicUser } from "./types";

const MAX_AUDIT_LOG_LIMIT = 500;

interface RpcSocketData {
  claims: DeviceAccessTokenClaims;
  sessionId: string;
}

export interface EcoServerDependencies {
  config: ServerConfig;
  store?: MongoStore;
  auth?: AuthService;
  devices?: DeviceService;
  pairing?: PairingService;
  rpc?: RpcGateway;
  rpcBus?: RpcBus;
  rateLimiter?: RateLimiter;
}

export async function startEcoServer(dependencies: EcoServerDependencies) {
  const store =
    dependencies.store ??
    (await MongoStore.connect({
      uri: dependencies.config.mongoUri,
      ...(dependencies.config.mongoDatabase ? { databaseName: dependencies.config.mongoDatabase } : {}),
    }));
  const devices = dependencies.devices ?? new DeviceService({ store });
  const auth =
    dependencies.auth ??
    new AuthService({
      store,
      tokenSecret: dependencies.config.tokenSecret,
      accessTokenTtlSeconds: dependencies.config.accessTokenTtlSeconds,
      refreshTokenTtlSeconds: dependencies.config.refreshTokenTtlSeconds,
    });
  const pairing =
    dependencies.pairing ??
    new PairingService({
      store,
      pairingTtlSeconds: dependencies.config.pairingTtlSeconds,
      devices,
      auth,
    });
  const presence = createRedisPresenceStore(dependencies.config.redisUrl, dependencies.config.redisPassword);
  const rpcBus =
    dependencies.rpcBus ??
    new RedisRpcBus({
      instanceId: dependencies.config.instanceId,
      redisUrl: dependencies.config.redisUrl,
      ...(dependencies.config.redisPassword ? { redisPassword: dependencies.config.redisPassword } : {}),
    });
  const rateLimiter =
    dependencies.rateLimiter ??
    new RedisRateLimiter({
      redisUrl: dependencies.config.redisUrl,
      ...(dependencies.config.redisPassword ? { redisPassword: dependencies.config.redisPassword } : {}),
    });
  const rpc =
    dependencies.rpc ??
    new RpcGateway({
      store,
      presence,
      instanceId: dependencies.config.instanceId,
      bus: rpcBus,
      rpcTimeoutMs: dependencies.config.rpcTimeoutMs,
    });
  await rpc.start();
  const peers = new Map<string, RpcPeer>();

  return Bun.serve<RpcSocketData>({
    hostname: dependencies.config.host,
    port: dependencies.config.port,
    async fetch(request, server) {
      const url = new URL(request.url);
      if (url.pathname === "/health" && request.method === "GET") {
        return json({ ok: true });
      }
      if (url.pathname === "/v1/rpc") {
        return handleWebSocketUpgrade({
          request,
          server,
          auth,
          url,
          rateLimiter,
        });
      }
      return handleEcoHttpRequest({
        request,
        url,
        auth,
        devices,
        pairing,
        rpc,
        store,
        rateLimiter,
      });
    },
    websocket: {
      async open(ws) {
        const peer: RpcPeer = {
          sessionId: ws.data.sessionId,
          userId: ws.data.claims.userId,
          deviceId: ws.data.claims.deviceId,
          deviceKind: ws.data.claims.deviceKind,
          capabilities: ws.data.claims.capabilities,
          send(message) {
            ws.send(JSON.stringify(message));
          },
          close(code, reason) {
            ws.close(code, reason);
          },
        };
        peers.set(peer.sessionId, peer);
        await rpc.connect(peer);
      },
      async message(ws, message) {
        const peer = peers.get(ws.data.sessionId);
        if (!peer) {
          ws.close(1011, "RPC peer was not registered.");
          return;
        }
        await rpc.handleMessage(peer, typeof message === "string" ? message : new Uint8Array(message));
      },
      async close(ws) {
        const peer = peers.get(ws.data.sessionId);
        if (!peer) {
          return;
        }
        peers.delete(peer.sessionId);
        await rpc.disconnect(peer);
      },
    },
  });
}

export async function handleEcoHttpRequest(input: {
  request: Request;
  url: URL;
  auth: AuthService;
  devices: DeviceService;
  pairing: PairingService;
  rpc: RpcGateway;
  store: MongoStore;
  rateLimiter?: RateLimiter;
}): Promise<Response> {
  try {
    return await handleEcoHttpRoute(input);
  } catch (error) {
    const rateLimitResponse = toRateLimitResponse(error);
    if (rateLimitResponse) return rateLimitResponse;
    const message = error instanceof Error ? error.message : "Request failed.";
    return json({ error: message }, { status: classifyHttpError(message) });
  }
}

export async function handleEcoHttpRoute(input: {
  request: Request;
  url: URL;
  auth: AuthService;
  devices: DeviceService;
  pairing: PairingService;
  rpc: RpcGateway;
  store: MongoStore;
  rateLimiter?: RateLimiter;
}): Promise<Response> {
  const { request, url, auth, devices, pairing, rpc, store, rateLimiter } = input;
  const pathname = normalizeHttpPathname(url.pathname);
  if (request.method === "POST" && pathname === "/v1/auth/register") {
    const body = await readJsonObject(request);
    await consumeHttpRateLimit({
      rateLimiter,
      request,
      scope: "auth.register",
      rule: HTTP_RATE_LIMITS.authRegister,
      subjectParts: [readOptionalString(body, "email")],
    });
    const user = await auth.registerUser({
      email: requireString(body, "email"),
      password: requireString(body, "password"),
      ...(typeof body.displayName === "string" ? { displayName: body.displayName } : {}),
    });
    const tokens = await auth.issueUserTokenBundle(user);
    return json({ user: toPublicUser(user), tokens }, { status: 201 });
  }
  if (request.method === "GET" && pathname === "/v1/me") {
    const claims = await requireBearer(request, auth);
    const user = await store.findUserById(claims.userId);
    if (!user) {
      throw new Error("User was not found.");
    }
    const device = claims.subjectKind === "device" ? await store.findDeviceById(claims.deviceId) : undefined;
    return json({
      user: toPublicUser(user),
      ...(device ? { device: toPublicDevice(device) } : {}),
      capabilities: claims.capabilities,
    });
  }
  if (request.method === "POST" && pathname === "/v1/auth/login") {
    const body = await readJsonObject(request);
    await consumeHttpRateLimit({
      rateLimiter,
      request,
      scope: "auth.login",
      rule: HTTP_RATE_LIMITS.authLogin,
      subjectParts: [readOptionalString(body, "email")],
    });
    const user = await auth.loginUser({
      email: requireString(body, "email"),
      password: requireString(body, "password"),
    });
    const tokens = await auth.issueUserTokenBundle(user);
    return json({ user: toPublicUser(user), tokens });
  }
  if (request.method === "POST" && pathname === "/v1/auth/refresh") {
    const body = await readJsonObject(request);
    const refreshToken = requireString(body, "refreshToken");
    await consumeHttpRateLimit({
      rateLimiter,
      request,
      scope: "auth.refresh",
      rule: HTTP_RATE_LIMITS.authRefresh,
      subjectParts: [refreshToken],
    });
    const access = await auth.refreshAccessToken(refreshToken);
    return json(access);
  }
  if (request.method === "POST" && pathname === "/v1/auth/logout") {
    const body = await readJsonObject(request);
    await auth.revokeRefreshToken(requireString(body, "refreshToken"));
    return json({ ok: true });
  }
  if (request.method === "POST" && pathname === "/v1/devices/register") {
    const claims = await requireBearer(request, auth);
    assertCapability(claims, "device:admin");
    const body = await readJsonObject(request);
    const metadata = readOptionalDeviceMetadata(body.metadata);
    const registered = await devices.registerDevice({
      userId: claims.userId,
      kind: requireDeviceKind(body, "kind"),
      name: requireString(body, "name"),
      ...(metadata !== undefined ? { metadata } : {}),
    });
    const tokens = await auth.issueDeviceTokenBundle(registered.device);
    return json(
      {
        device: toPublicDevice(registered.device),
        deviceSecret: registered.deviceSecret,
        tokens,
      },
      { status: 201 },
    );
  }
  if (request.method === "GET" && pathname === "/v1/devices") {
    const claims = await requireBearer(request, auth);
    assertCapability(claims, "device:admin");
    const online = new Map(
      (await rpc.listOnlineDevices(claims.userId)).map((device) => [device.deviceId, device]),
    );
    const result = await devices.listDevices(claims.userId, {
      includeDisabled: readBooleanSearchParam(url, "includeDisabled"),
    });
    return json({
      devices: result.map((device) => {
        const onlineDevice = online.get(device.id);
        return {
          ...toPublicDevice(device),
          online: Boolean(onlineDevice),
          ...(onlineDevice
            ? {
                connectedAt: onlineDevice.connectedAt,
                lastSeenAt: onlineDevice.lastSeenAt,
              }
            : {}),
        };
      }),
    });
  }
  const deviceIdFromPath = matchPath(pathname, "/v1/devices/:deviceId")?.deviceId;
  if (request.method === "PATCH" && deviceIdFromPath) {
    const claims = await requireBearer(request, auth);
    assertCanUpdateDevice(claims, deviceIdFromPath);
    const body = await readJsonObject(request);
    const metadata = readOptionalDeviceMetadata(body.metadata);
    const device = await devices.updateDeviceProfile({
      userId: claims.userId,
      deviceId: deviceIdFromPath,
      ...(typeof body.name === "string" ? { name: requireString(body, "name") } : {}),
      ...(metadata !== undefined ? { metadata } : {}),
    });
    return json({ device: toPublicDevice(device) });
  }
  if (request.method === "DELETE" && deviceIdFromPath) {
    const claims = await requireBearer(request, auth);
    assertCanUpdateDevice(claims, deviceIdFromPath);
    const disabled = await devices.disableDevice({
      userId: claims.userId,
      deviceId: deviceIdFromPath,
    });
    await rpc.disconnectDevice(deviceIdFromPath, "Device was disabled.");
    await store.createAuditLog({
      id: createId("aud"),
      userId: claims.userId,
      action: "device.disable",
      status: "accepted",
      targetDeviceId: disabled.id,
      now: new Date().toISOString(),
    });
    return json({ device: toPublicDevice(disabled) });
  }
  if (request.method === "POST" && pathname === "/v1/devices/token") {
    const body = await readJsonObject(request);
    const deviceId = requireString(body, "deviceId");
    await consumeHttpRateLimit({
      rateLimiter,
      request,
      scope: "devices.token",
      rule: HTTP_RATE_LIMITS.deviceToken,
      subjectParts: [deviceId],
    });
    const device = await devices.authenticateDevice({
      deviceId,
      deviceSecret: requireString(body, "deviceSecret"),
    });
    const tokens = await auth.issueDeviceTokenBundle(device);
    return json({ device: toPublicDevice(device), tokens });
  }
  if (request.method === "POST" && pathname === "/v1/pairing") {
    const claims = await requireDeviceBearer(request, auth);
    if (claims.deviceKind !== "desktop") {
      throw new Error("Only desktop devices can create pairing sessions.");
    }
    assertCapability(claims, "device:pair");
    await consumeHttpRateLimit({
      rateLimiter,
      request,
      scope: "pairing.create",
      rule: HTTP_RATE_LIMITS.pairingCreate,
      subjectParts: [claims.userId, claims.deviceId],
    });
    const created = await pairing.createPairingSession({
      userId: claims.userId,
      desktopDeviceId: claims.deviceId,
    });
    return json({
      pairingId: created.session.id,
      code: created.code,
      bootstrapToken: created.bootstrapToken,
      qrPayload: created.qrPayload,
      expiresAt: created.session.expiresAt,
    });
  }
  if (request.method === "POST" && pathname === "/v1/pairing/join") {
    const body = await readJsonObject(request);
    const code = requireString(body, "code");
    await consumeHttpRateLimit({
      rateLimiter,
      request,
      scope: "pairing.join",
      rule: HTTP_RATE_LIMITS.pairingJoin,
      subjectParts: [code],
    });
    const metadata = readOptionalDeviceMetadata(body.metadata);
    const joined = await pairing.joinPairingSession({
      code,
      token: requireString(body, "token"),
      ...(typeof body.deviceName === "string" ? { deviceName: body.deviceName } : {}),
      ...(metadata !== undefined ? { metadata } : {}),
    });
    return json({
      user: toPublicUser(joined.user),
      device: toPublicDevice(joined.device),
      deviceSecret: joined.deviceSecret,
      tokens: joined.tokens,
      binding: toPublicDeviceBinding(joined.binding),
      desktopDeviceId: joined.desktopDeviceId,
    });
  }
  const pairingIdFromPath = matchPath(pathname, "/v1/pairing/:pairingId")?.pairingId;
  if (request.method === "GET" && pairingIdFromPath && pairingIdFromPath !== "join") {
    const claims = await requireBearer(request, auth);
    const session = await pairing.getPairingSession({
      userId: claims.userId,
      pairingId: pairingIdFromPath,
    });
    return json({
      pairingId: session.id,
      desktopDeviceId: session.desktopDeviceId,
      expiresAt: session.expiresAt,
      claimedAt: session.claimedAt,
      status: getPairingStatus(session.expiresAt, session.claimedAt),
    });
  }
  if (request.method === "POST" && pathname === "/v1/pairing/claim") {
    const claims = await requireDeviceBearer(request, auth);
    if (claims.deviceKind !== "mobile") {
      throw new Error("Only mobile devices can claim pairing sessions.");
    }
    const body = await readJsonObject(request);
    const code = requireString(body, "code");
    await consumeHttpRateLimit({
      rateLimiter,
      request,
      scope: "pairing.claim",
      rule: HTTP_RATE_LIMITS.pairingClaim,
      subjectParts: [claims.userId, claims.deviceId, code],
    });
    const binding = await pairing.claimPairingSession({
      userId: claims.userId,
      mobileDeviceId: claims.deviceId,
      code,
    });
    return json({ binding });
  }
  if (request.method === "GET" && pathname === "/v1/bindings") {
    const claims = await requireBearer(request, auth);
    return json({
      bindings: (
        await listBindingsVisibleToClaims(devices, claims, {
          includeRevoked: readBooleanSearchParam(url, "includeRevoked"),
        })
      ).map(toPublicDeviceBinding),
    });
  }
  const bindingIdFromPath = matchPath(pathname, "/v1/bindings/:bindingId")?.bindingId;
  if (request.method === "DELETE" && bindingIdFromPath) {
    const claims = await requireBearer(request, auth);
    const existingBinding = await store.findBindingById(claims.userId, bindingIdFromPath);
    if (!existingBinding) {
      throw new Error("Binding was not found.");
    }
    assertCanRevokeBinding(claims, existingBinding);
    const binding = await devices.revokeBinding({
      userId: claims.userId,
      bindingId: bindingIdFromPath,
    });
    await store.createAuditLog({
      id: createId("aud"),
      userId: claims.userId,
      action: "binding.revoke",
      status: "accepted",
      targetDeviceId: binding.mobileDeviceId,
      ...(claims.subjectKind === "device" ? { actorDeviceId: claims.deviceId } : {}),
      metadata: {
        bindingId: binding.id,
        desktopDeviceId: binding.desktopDeviceId,
      },
      now: new Date().toISOString(),
    });
    return json({ binding: toPublicDeviceBinding(binding) });
  }
  if (request.method === "GET" && pathname === "/v1/presence") {
    const claims = await requireBearer(request, auth);
    const online = new Map(
      (await rpc.listOnlineDevices(claims.userId)).map((device) => [device.deviceId, device]),
    );
    return json({
      devices: (await listDevicesVisibleToClaims(devices, claims)).map((device) =>
        toPublicDeviceWithPresence(device, online.get(device.id)),
      ),
    });
  }
  if (request.method === "GET" && pathname === "/v1/audit-logs") {
    const claims = await requireBearer(request, auth);
    assertCapability(claims, "device:admin");
    return json({
      auditLogs: await store.listAuditLogs({
        userId: claims.userId,
        limit: readLimit(url),
        order: "desc",
      }),
    });
  }
  return json({ error: "Route not found." }, { status: 404 });
}

async function handleWebSocketUpgrade(input: {
  request: Request;
  server: Bun.Server<RpcSocketData>;
  auth: AuthService;
  url: URL;
  rateLimiter?: RateLimiter;
}): Promise<Response> {
  try {
    await consumeHttpRateLimit({
      rateLimiter: input.rateLimiter,
      request: input.request,
      scope: "rpc.websocket",
      rule: HTTP_RATE_LIMITS.rpcWebSocket,
      subjectParts: [],
    });
  } catch (error) {
    const rateLimitResponse = toRateLimitResponse(error);
    if (rateLimitResponse) return rateLimitResponse;
    throw error;
  }
  const token = extractBearerToken(input.request) ?? input.url.searchParams.get("access_token");
  if (!token) {
    return json({ error: "Missing access token." }, { status: 401 });
  }
  let claims: AccessTokenClaims;
  try {
    claims = await input.auth.verifyBearerToken(token);
  } catch {
    return json({ error: "Invalid access token." }, { status: 401 });
  }
  if (claims.subjectKind !== "device") {
    return json({ error: "WebSocket requires a device access token." }, { status: 403 });
  }
  const upgraded = input.server.upgrade(input.request, {
    data: {
      claims,
      sessionId: `sess_${crypto.randomUUID()}`,
    },
  });
  return upgraded ? new Response(null) : json({ error: "WebSocket upgrade failed." }, { status: 400 });
}

async function requireBearer(request: Request, auth: AuthService): Promise<AccessTokenClaims> {
  const token = extractBearerToken(request);
  if (!token) {
    throw new Error("Missing bearer token.");
  }
  return auth.verifyBearerToken(token);
}

async function requireDeviceBearer(request: Request, auth: AuthService): Promise<DeviceAccessTokenClaims> {
  const claims = await requireBearer(request, auth);
  if (claims.subjectKind !== "device") {
    throw new Error("Device token is required.");
  }
  return claims;
}

function extractBearerToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return undefined;
  }
  const token = authorization.slice("Bearer ".length).trim();
  return token || undefined;
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const body = (await request.json()) as unknown;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Expected a JSON object body.");
  }
  return body as Record<string, unknown>;
}

function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} is required.`);
  }
  return value;
}

function readOptionalString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value.trim() : "";
}

function requireDeviceKind(body: Record<string, unknown>, key: string): EcoDeviceKind {
  const value = body[key];
  if (value !== "desktop" && value !== "mobile") {
    throw new Error(`${key} must be desktop or mobile.`);
  }
  return value;
}

function assertCapability(
  claims: AccessTokenClaims,
  capability: AccessTokenClaims["capabilities"][number],
): void {
  if (!claims.capabilities.includes(capability)) {
    throw new Error(`Missing capability ${capability}.`);
  }
}

function assertCanRevokeBinding(claims: AccessTokenClaims, binding: DeviceBindingRecord): void {
  if (claims.capabilities.includes("device:admin")) {
    return;
  }
  if (
    claims.subjectKind === "device" &&
    claims.deviceKind === "desktop" &&
    binding.desktopDeviceId === claims.deviceId
  ) {
    return;
  }
  throw new Error("Missing capability device:admin.");
}

function assertCanUpdateDevice(claims: AccessTokenClaims, deviceId: string): void {
  if (claims.capabilities.includes("device:admin")) {
    return;
  }
  if (claims.subjectKind === "device" && claims.deviceId === deviceId) {
    return;
  }
  throw new Error("Missing capability device:admin.");
}

function readOptionalDeviceMetadata(value: unknown): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("metadata must be an object.");
  }
  const metadata: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw === undefined || raw === null) {
      continue;
    }
    if (typeof raw !== "string") {
      throw new Error(`metadata.${key} must be a string.`);
    }
    const trimmed = raw.trim();
    if (!trimmed) {
      continue;
    }
    if (key !== "model" && key !== "ipAddress" && key !== "platform" && key !== "hostname") {
      throw new Error(`metadata.${key} is not supported.`);
    }
    metadata[key] = trimmed;
  }
  return metadata;
}

async function listBindingsVisibleToClaims(
  devices: DeviceService,
  claims: AccessTokenClaims,
  options: { includeRevoked?: boolean } = {},
): Promise<DeviceBindingRecord[]> {
  const bindings = await devices.listBindings(claims.userId, options);
  if (claims.capabilities.includes("device:admin")) {
    return bindings;
  }
  if (claims.subjectKind !== "device") {
    throw new Error("Missing capability device:admin.");
  }
  return bindings.filter((binding) =>
    claims.deviceKind === "mobile"
      ? binding.mobileDeviceId === claims.deviceId
      : binding.desktopDeviceId === claims.deviceId,
  );
}

async function listDevicesVisibleToClaims(
  devices: DeviceService,
  claims: AccessTokenClaims,
): Promise<DeviceRecord[]> {
  const allDevices = await devices.listDevices(claims.userId);
  if (claims.capabilities.includes("device:admin")) {
    return allDevices;
  }
  if (claims.subjectKind !== "device") {
    throw new Error("Missing capability device:admin.");
  }

  const visibleDeviceIds = new Set<string>([claims.deviceId]);
  for (const binding of await listBindingsVisibleToClaims(devices, claims)) {
    visibleDeviceIds.add(claims.deviceKind === "mobile" ? binding.desktopDeviceId : binding.mobileDeviceId);
  }
  return allDevices.filter((device) => visibleDeviceIds.has(device.id));
}

function toPublicDeviceWithPresence(device: DeviceRecord, onlineDevice?: OnlineDeviceSnapshot) {
  return {
    ...toPublicDevice(device),
    online: Boolean(onlineDevice),
    ...(onlineDevice
      ? {
          connectedAt: onlineDevice.connectedAt,
          lastSeenAt: onlineDevice.lastSeenAt,
        }
      : {}),
  };
}

function normalizeHttpPathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function readBooleanSearchParam(url: URL, key: string): boolean {
  const value = url.searchParams.get(key);
  return value === "1" || value === "true";
}

function readLimit(url: URL): number {
  const value = url.searchParams.get("limit");
  if (!value) {
    return 100;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("limit must be a positive integer.");
  }
  if (parsed > MAX_AUDIT_LOG_LIMIT) {
    throw new Error(`limit must be less than or equal to ${MAX_AUDIT_LOG_LIMIT}.`);
  }
  return parsed;
}

function matchPath(pathname: string, pattern: "/v1/devices/:deviceId"): { deviceId: string } | undefined;
function matchPath(pathname: string, pattern: "/v1/bindings/:bindingId"): { bindingId: string } | undefined;
function matchPath(pathname: string, pattern: "/v1/pairing/:pairingId"): { pairingId: string } | undefined;
function matchPath(pathname: string, pattern: string): Record<string, string> | undefined {
  const pathParts = pathname.split("/").filter(Boolean);
  const patternParts = pattern.split("/").filter(Boolean);
  if (pathParts.length !== patternParts.length) {
    return undefined;
  }
  const params: Record<string, string> = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const patternPart = patternParts[index];
    const pathPart = pathParts[index];
    if (!patternPart || !pathPart) {
      return undefined;
    }
    if (patternPart.startsWith(":")) {
      params[patternPart.slice(1)] = decodeURIComponent(pathPart);
      continue;
    }
    if (patternPart !== pathPart) {
      return undefined;
    }
  }
  return params;
}

function getPairingStatus(expiresAt: string, claimedAt: string | null): "pending" | "claimed" | "expired" {
  if (claimedAt) {
    return "claimed";
  }
  return Date.parse(expiresAt) <= Date.now() ? "expired" : "pending";
}

async function consumeHttpRateLimit(input: {
  rateLimiter: RateLimiter | undefined;
  request: Request;
  scope: string;
  rule: RateLimitRule;
  subjectParts: readonly string[];
}): Promise<void> {
  if (!input.rateLimiter) {
    return;
  }
  const key = await buildRateLimitKey(input.scope, [
    clientIdentity(input.request),
    ...input.subjectParts.map((part) => part.trim().toLowerCase()).filter(Boolean),
  ]);
  const decision = await input.rateLimiter.consume({ key, rule: input.rule });
  if (!decision.allowed) {
    throw new RateLimitExceededError("Too many requests. Please retry later.", decision.retryAfterSeconds);
  }
}

function clientIdentity(request: Request): string {
  const directHeader =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for");
  const forwardedIp = directHeader?.split(",")[0]?.trim();
  return forwardedIp || "unknown";
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), {
    ...init,
    headers,
  });
}

function toRateLimitResponse(error: unknown): Response | undefined {
  if (!(error instanceof RateLimitExceededError)) {
    return undefined;
  }
  return json(
    { error: error.message, retryAfterSeconds: error.retryAfterSeconds },
    {
      status: 429,
      headers: { "retry-after": String(error.retryAfterSeconds) },
    },
  );
}

function classifyHttpError(message: string): number {
  if (
    message.includes("Missing bearer") ||
    message.includes("Invalid access token") ||
    message.includes("Token user is not active") ||
    message.includes("Token device is not active")
  ) {
    return 401;
  }
  if (
    message.includes("not allowed") ||
    message.includes("Only ") ||
    message.includes("required") ||
    message.includes("Missing capability")
  ) {
    return 403;
  }
  if (message.includes("not found")) {
    return 404;
  }
  return 400;
}
