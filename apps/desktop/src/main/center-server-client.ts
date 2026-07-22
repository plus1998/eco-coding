import { ECO_RPC_METHODS } from "@eco/shared";
import {
  buildCenterServerWebSocketUrl,
  buildPairingQrPayload,
  type CenterServerAccountAuthResult,
  type CenterServerAccountView,
  type CenterServerConnectionStatus,
  type CenterServerCreatePairingResult,
  type CenterServerDeviceBindingView,
  type CenterServerDevicePresenceView,
  type CenterServerDeviceView,
  type CenterServerRegisterDesktopRequest,
  type CenterServerRegisterDesktopResult,
  type CenterServerRemoveConnectionOptions,
  type CenterServerRemoveConnectionResult,
  type CenterServerSettingsSnapshot,
  type CenterServerSignInRequest,
  type CenterServerSignUpRequest,
  type CenterServerTestConnectionRequest,
  type CenterServerTestConnectionResult,
  CENTER_SERVER_REAUTH_MESSAGE,
  CenterServerRemoveConnectionError,
  classifyCenterServerAuthError,
  centerServerAuthRecoveryMessage,
  isCenterServerAuthCredentialError,
  normalizeCenterServerHttpUrl,
} from "../shared/center-server";
import type {
  EventCenterEnvelope,
  EventCenterJsonRpcNotification,
  EventCenterJsonRpcResponse,
} from "../shared/event-center";
import { buildEventCenterJsonRpcFailure, EVENT_CENTER_JSON_RPC_ERROR } from "../shared/event-center";
import type { ThreadLiveEvent, ThreadRunProjectionSnapshot } from "../shared/ipc";
import type { CenterServerSettingsSecret, CenterServerStore } from "./center-server-store";
import {
  collectDesktopDeviceProfile,
  defaultDesktopDeviceName,
  desktopDeviceMetadata,
} from "./desktop-device-profile";
import type { DesktopEventCenter, DesktopEventCenterSink } from "./event-center";

type FetchLike = typeof fetch;

interface WebSocketLike {
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null;
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

type WebSocketConstructorLike = new (url: string) => WebSocketLike;

export interface CenterServerDesktopClientOptions {
  store: CenterServerStore;
  eventCenter: DesktopEventCenter;
  fetch?: FetchLike;
  webSocketConstructor?: WebSocketConstructorLike;
  now?: () => Date;
  reconnectDelayMs?: number;
  connectTimeoutMs?: number;
  mobileStreamingProjectionThrottleMs?: number;
  log?: (message: string) => void;
  onStatusChange?: (snapshot: CenterServerSettingsSnapshot) => void;
  resolveThreadProjection?: (threadId: string) => ThreadRunProjectionSnapshot | undefined;
}

interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
}

interface DeviceTokenResponse {
  device: CenterServerDeviceView;
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
  };
}

interface RegisterDesktopResponse extends DeviceTokenResponse {
  deviceSecret: string;
}

interface AccountAuthResponse {
  user: CenterServerAccountView;
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
  };
}

const WS_OPEN = 1;
const MAX_QUEUED_EVENTS = 100;
const KEEPALIVE_INTERVAL_MS = 25_000;
const MOBILE_STREAMING_PROJECTION_THROTTLE_MS = 1_000;

interface PendingMobileProjection {
  notification: EventCenterJsonRpcNotification;
  timer: ReturnType<typeof setTimeout>;
}

export class CenterServerDesktopClient implements DesktopEventCenterSink {
  private readonly store: CenterServerStore;
  private readonly eventCenter: DesktopEventCenter;
  private readonly fetchImpl: FetchLike;
  private readonly WebSocketCtor: WebSocketConstructorLike;
  private readonly now: () => Date;
  private readonly reconnectDelayMs: number;
  private readonly connectTimeoutMs: number;
  private readonly mobileStreamingProjectionThrottleMs: number;
  private readonly log: (message: string) => void;
  private readonly onStatusChange: ((snapshot: CenterServerSettingsSnapshot) => void) | undefined;
  private readonly resolveThreadProjection:
    | ((threadId: string) => ThreadRunProjectionSnapshot | undefined)
    | undefined;
  private readonly unsubscribe: () => void;
  private socket: WebSocketLike | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private keepaliveTimer: ReturnType<typeof setInterval> | undefined;
  private connectInFlight: Promise<void> | undefined;
  private intentionallyStopped = true;
  private status: CenterServerConnectionStatus = { state: "disabled" };
  private readonly queuedEvents: EventCenterJsonRpcNotification[] = [];
  private readonly pendingMobileProjections = new Map<string, PendingMobileProjection>();

  constructor(options: CenterServerDesktopClientOptions) {
    this.store = options.store;
    this.eventCenter = options.eventCenter;
    this.fetchImpl = options.fetch ?? fetch;
    this.WebSocketCtor = options.webSocketConstructor ?? resolveWebSocketConstructor();
    this.now = options.now ?? (() => new Date());
    this.reconnectDelayMs = options.reconnectDelayMs ?? 3_000;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 15_000;
    this.mobileStreamingProjectionThrottleMs =
      options.mobileStreamingProjectionThrottleMs ?? MOBILE_STREAMING_PROJECTION_THROTTLE_MS;
    this.log = options.log ?? (() => {});
    this.onStatusChange = options.onStatusChange;
    this.resolveThreadProjection = options.resolveThreadProjection;
    this.unsubscribe = this.eventCenter.subscribe(this);
  }

  publish(envelope: EventCenterEnvelope, notification: EventCenterJsonRpcNotification): void {
    const settings = this.store.getSettingsWithSecrets();
    if (!settings.enabled) {
      return;
    }

    const threadEvent = readThreadLiveEvent(envelope);
    if (threadEvent && isRemoteOnlyStreamDelta(threadEvent)) {
      return;
    }

    if (envelope.kind === "thread.projection" && threadEvent?.projection) {
      this.publishMobileProjection(envelope, notification, threadEvent);
      return;
    }

    const threadId = envelope.threadId ?? threadEvent?.threadId;
    if (threadId && shouldFlushProjectionBeforeEvent(envelope.kind, threadEvent)) {
      this.flushPendingMobileProjection(threadId);
    }
    this.sendOrQueue(notification);
  }

  getSnapshot(): CenterServerSettingsSnapshot {
    return this.store.getSettings(this.status);
  }

  async start(): Promise<void> {
    this.intentionallyStopped = false;
    await this.connect();
  }

  stop(): void {
    this.intentionallyStopped = true;
    this.clearPendingMobileProjections();
    this.clearReconnectTimer();
    this.clearKeepalive();
    this.socket?.close(1000, "Desktop center server client stopped.");
    this.socket = undefined;
    this.setStatus({ state: "disconnected" });
  }

  dispose(): void {
    this.stop();
    this.unsubscribe();
  }

  async reload(): Promise<void> {
    this.stop();
    const settings = this.store.getSettingsWithSecrets();
    if (!settings.enabled) {
      this.setStatus({ state: "disabled" });
      return;
    }
    this.intentionallyStopped = false;
    await this.connect();
  }

  async saveSettings(
    input: Parameters<CenterServerStore["saveSettings"]>[0],
  ): Promise<CenterServerSettingsSnapshot> {
    this.store.saveSettings(input);
    await this.reload();
    return this.getSnapshot();
  }

  async registerDesktop(
    request: CenterServerRegisterDesktopRequest,
  ): Promise<CenterServerRegisterDesktopResult> {
    const serverUrl = normalizeCenterServerHttpUrl(request.serverUrl);
    const profile = collectDesktopDeviceProfile();
    const deviceName = request.deviceName.trim() || defaultDesktopDeviceName(profile);
    const response = await this.requestJson<RegisterDesktopResponse>({
      serverUrl,
      path: "/v1/devices/register",
      method: "POST",
      bearerToken: request.userAccessToken,
      body: {
        kind: "desktop",
        name: deviceName,
        metadata: desktopDeviceMetadata(profile),
      },
    });
    return this.persistRegisteredDevice(serverUrl, response);
  }

  async signUpAndRegisterDesktop(request: CenterServerSignUpRequest): Promise<CenterServerAccountAuthResult> {
    this.stop();
    const serverUrl = normalizeCenterServerHttpUrl(request.serverUrl);
    const auth = await this.requestJson<AccountAuthResponse>({
      serverUrl,
      path: "/v1/auth/register",
      method: "POST",
      body: {
        email: request.email.trim(),
        password: request.password,
        ...(request.displayName?.trim() ? { displayName: request.displayName.trim() } : {}),
      },
    });
    return this.registerDesktopWithUserAccessToken({
      serverUrl,
      deviceName: request.deviceName,
      user: auth.user,
      accessToken: auth.tokens.accessToken,
    });
  }

  async signInAndRegisterDesktop(request: CenterServerSignInRequest): Promise<CenterServerAccountAuthResult> {
    this.stop();
    const serverUrl = normalizeCenterServerHttpUrl(request.serverUrl);
    const auth = await this.requestJson<AccountAuthResponse>({
      serverUrl,
      path: "/v1/auth/login",
      method: "POST",
      body: {
        email: request.email.trim(),
        password: request.password,
      },
    });
    return this.registerDesktopWithUserAccessToken({
      serverUrl,
      deviceName: request.deviceName,
      user: auth.user,
      accessToken: auth.tokens.accessToken,
    });
  }

  private async registerDesktopWithUserAccessToken(input: {
    serverUrl: string;
    deviceName: string;
    user: CenterServerAccountView;
    accessToken: string;
  }): Promise<CenterServerAccountAuthResult> {
    const profile = collectDesktopDeviceProfile();
    const deviceName = input.deviceName.trim() || defaultDesktopDeviceName(profile);
    const response = await this.requestJson<RegisterDesktopResponse>({
      serverUrl: input.serverUrl,
      path: "/v1/devices/register",
      method: "POST",
      bearerToken: input.accessToken,
      body: {
        kind: "desktop",
        name: deviceName,
        metadata: desktopDeviceMetadata(profile),
      },
    });
    const registered = await this.persistRegisteredDevice(input.serverUrl, response);
    return {
      ...registered,
      user: input.user,
    };
  }

  private async persistRegisteredDevice(
    serverUrl: string,
    response: RegisterDesktopResponse,
  ): Promise<CenterServerRegisterDesktopResult> {
    this.store.saveSettings({
      enabled: true,
      serverUrl,
      deviceId: response.device.id,
      deviceName: response.device.name,
      deviceSecret: response.deviceSecret,
      accessToken: response.tokens.accessToken,
      refreshToken: response.tokens.refreshToken,
      accessTokenExpiresAt: response.tokens.expiresAt,
    });
    await this.reload();
    return {
      settings: this.store.getSettingsWithSecrets(),
      status: this.status,
      device: response.device,
    };
  }

  async createPairing(): Promise<CenterServerCreatePairingResult> {
    const settings = this.store.getSettingsWithSecrets();
    const accessToken = await this.ensureAccessToken(settings);
    const response = await this.requestJson<
      Omit<CenterServerCreatePairingResult, "qrPayload"> & {
        qrPayload: string;
      }
    >({
      serverUrl: settings.serverUrl,
      path: "/v1/pairing",
      method: "POST",
      bearerToken: accessToken,
      body: {},
    });
    return {
      ...response,
      qrPayload: buildPairingQrPayload({
        serverUrl: settings.serverUrl,
        code: response.code,
        bootstrapToken: response.bootstrapToken,
      }),
    };
  }

  async listBindings(): Promise<CenterServerDeviceBindingView[]> {
    const settings = this.store.getSettingsWithSecrets();
    const accessToken = await this.ensureAccessToken(settings);
    const response = await this.requestJson<{ bindings: CenterServerDeviceBindingView[] }>({
      serverUrl: settings.serverUrl,
      path: "/v1/bindings",
      method: "GET",
      bearerToken: accessToken,
    });
    return response.bindings;
  }

  async listPresence(): Promise<CenterServerDevicePresenceView[]> {
    const settings = this.store.getSettingsWithSecrets();
    const accessToken = await this.ensureAccessToken(settings);
    const response = await this.requestJson<{ devices: CenterServerDevicePresenceView[] }>({
      serverUrl: settings.serverUrl,
      path: "/v1/presence",
      method: "GET",
      bearerToken: accessToken,
    });
    return response.devices;
  }

  async revokeBinding(bindingId: string): Promise<CenterServerDeviceBindingView> {
    const settings = this.store.getSettingsWithSecrets();
    const accessToken = await this.ensureAccessToken(settings);
    const response = await this.requestJson<{ binding: CenterServerDeviceBindingView }>({
      serverUrl: settings.serverUrl,
      path: `/v1/bindings/${encodeURIComponent(bindingId)}`,
      method: "DELETE",
      bearerToken: accessToken,
    });
    return response.binding;
  }

  async syncDeviceProfile(): Promise<void> {
    const settings = this.store.getSettingsWithSecrets();
    if (!settings.deviceId) {
      return;
    }
    const accessToken = await this.ensureAccessToken(settings);
    await this.requestJson({
      serverUrl: settings.serverUrl,
      path: `/v1/devices/${encodeURIComponent(settings.deviceId)}`,
      method: "PATCH",
      bearerToken: accessToken,
      body: {
        metadata: desktopDeviceMetadata(collectDesktopDeviceProfile()),
      },
    });
  }

  async testConnection(
    request: CenterServerTestConnectionRequest,
  ): Promise<CenterServerTestConnectionResult> {
    try {
      const serverUrl = normalizeCenterServerHttpUrl(request.serverUrl);
      await this.requestJson({
        serverUrl,
        path: "/health",
        method: "GET",
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  async removeConnection(
    options: CenterServerRemoveConnectionOptions = {},
  ): Promise<CenterServerRemoveConnectionResult> {
    const forceLocal = options.forceLocal ?? false;
    const settings = this.store.getSettingsWithSecrets();
    let notice: string | undefined;
    this.stop();

    if (!forceLocal && settings.deviceId && settings.serverUrl) {
      try {
        const accessToken = await this.ensureAccessToken(settings);
        await this.requestJson({
          serverUrl: settings.serverUrl,
          path: `/v1/devices/${encodeURIComponent(settings.deviceId)}`,
          method: "DELETE",
          bearerToken: accessToken,
        });
      } catch (error) {
        const message = errorMessage(error);
        const recovery = classifyCenterServerAuthError(message);
        if (recovery === "device_inactive") {
          notice = centerServerAuthRecoveryMessage(recovery);
        } else {
          throw new CenterServerRemoveConnectionError(message, recovery);
        }
      }
    }

    this.store.clearConnection();
    this.setStatus({ state: "disabled" });
    const snapshot = this.getSnapshot();
    return notice ? { ...snapshot, notice } : snapshot;
  }

  private connect(): Promise<void> {
    if (this.connectInFlight) {
      return this.connectInFlight;
    }
    this.connectInFlight = this.connectOnce().finally(() => {
      this.connectInFlight = undefined;
    });
    return this.connectInFlight;
  }

  private async connectOnce(): Promise<void> {
    const settings = this.store.getSettingsWithSecrets();
    this.clearReconnectTimer();
    if (!settings.serverUrl.trim()) {
      const message = "Center server URL is required.";
      this.failConnection(message);
      throw new Error(message);
    }

    this.setStatus({ state: "connecting" });

    try {
      const accessToken = await this.ensureAccessToken(settings);
      if (this.intentionallyStopped) {
        throw new Error("Connection aborted.");
      }

      await new Promise<void>((resolve, reject) => {
        let opened = false;
        let settled = false;
        const settle = (error?: Error) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(connectTimeout);
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        };

        const socket = new this.WebSocketCtor(buildCenterServerWebSocketUrl(settings.serverUrl, accessToken));
        this.socket = socket;
        const connectTimeout = setTimeout(() => {
          if (!settled) {
            socket.close();
            settle(new Error("Connection timed out."));
          }
        }, this.connectTimeoutMs);

        socket.onopen = () => {
          opened = true;
          const connectedAt = this.now().toISOString();
          this.store.markConnected(connectedAt);
          this.setStatus({ state: "connected", connectedAt });
          this.flushQueuedEvents();
          this.startKeepalive();
          void this.syncDeviceProfile().catch((error) => {
            this.log(`[eco] center server profile sync failed: ${errorMessage(error)}\n`);
          });
          settle();
        };

        socket.onmessage = (event) => {
          void this.handleSocketMessage(event.data).catch((error) => {
            this.log(`[eco] center server message handling failed: ${errorMessage(error)}\n`);
          });
        };

        socket.onerror = () => {
          const message = "Center server WebSocket error.";
          if (!opened) {
            this.failConnection(message);
          }
          settle(new Error(message));
        };

        socket.onclose = (event) => {
          this.clearKeepalive();
          if (this.socket === socket) {
            this.socket = undefined;
          }

          if (!opened) {
            const reason = event.reason || `WebSocket closed${event.code ? ` (${event.code})` : ""}.`;
            this.failConnection(reason);
            settle(new Error(reason));
            return;
          }

          if (this.intentionallyStopped) {
            this.setStatus({ state: "disconnected", lastDisconnectedAt: this.now().toISOString() });
            return;
          }

          const reason = event.reason || `WebSocket closed${event.code ? ` (${event.code})` : ""}.`;
          this.failConnection(reason);
          this.scheduleReconnect();
        };
      });
    } catch (error) {
      const message = errorMessage(error);
      if (this.status.state === "connecting") {
        this.failConnection(message);
      }
      if (!this.intentionallyStopped && !isCenterServerAuthCredentialError(message)) {
        this.scheduleReconnect();
      }
    }
  }

  private async ensureAccessToken(settings: CenterServerSettingsSecret): Promise<string> {
    if (settings.accessToken && tokenStillValid(settings.accessTokenExpiresAt, this.now())) {
      return settings.accessToken;
    }
    if (settings.refreshToken) {
      try {
        const refreshed = await this.requestJson<TokenResponse>({
          serverUrl: settings.serverUrl,
          path: "/v1/auth/refresh",
          method: "POST",
          body: {
            refreshToken: settings.refreshToken,
          },
        });
        this.store.saveTokens({
          accessToken: refreshed.accessToken,
          ...(refreshed.refreshToken ? { refreshToken: refreshed.refreshToken } : {}),
          accessTokenExpiresAt: refreshed.expiresAt,
        });
        return refreshed.accessToken;
      } catch (error) {
        if (!settings.deviceId || !settings.deviceSecret || !isCenterServerAuthCredentialError(errorMessage(error))) {
          throw error;
        }
        this.store.clearRefreshToken();
        settings = this.store.getSettingsWithSecrets();
      }
    }
    if (settings.deviceId && settings.deviceSecret) {
      try {
        const tokenResponse = await this.requestJson<DeviceTokenResponse>({
          serverUrl: settings.serverUrl,
          path: "/v1/devices/token",
          method: "POST",
          body: {
            deviceId: settings.deviceId,
            deviceSecret: settings.deviceSecret,
          },
        });
        this.store.saveTokens({
          accessToken: tokenResponse.tokens.accessToken,
          refreshToken: tokenResponse.tokens.refreshToken,
          accessTokenExpiresAt: tokenResponse.tokens.expiresAt,
        });
        return tokenResponse.tokens.accessToken;
      } catch (error) {
        const message = errorMessage(error);
        if (isCenterServerAuthCredentialError(message)) {
          const recovery = classifyCenterServerAuthError(message);
          if (recovery === "relogin") {
            throw new Error(CENTER_SERVER_REAUTH_MESSAGE);
          }
          throw error instanceof Error ? error : new Error(message);
        }
        throw error;
      }
    }
    throw new Error(CENTER_SERVER_REAUTH_MESSAGE);
  }

  private async requestJson<TResult = unknown>(input: {
    serverUrl: string;
    path: string;
    method: "GET" | "POST" | "PATCH" | "DELETE";
    bearerToken?: string;
    body?: Record<string, unknown>;
  }): Promise<TResult> {
    const url = new URL(input.path, `${normalizeCenterServerHttpUrl(input.serverUrl)}/`);
    const headers = new Headers();
    if (input.body) {
      headers.set("content-type", "application/json");
    }
    if (input.bearerToken) {
      headers.set("authorization", `Bearer ${input.bearerToken}`);
    }
    const response = await this.fetchImpl(url, {
      method: input.method,
      headers,
      ...(input.body ? { body: JSON.stringify(input.body) } : {}),
    });
    const payload = (await response.json()) as unknown;
    if (!response.ok) {
      throw new Error(readResponseError(payload, response.status));
    }
    return payload as TResult;
  }

  private async handleSocketMessage(data: unknown): Promise<void> {
    let message: unknown = data;
    try {
      if (typeof data === "string") {
        message = JSON.parse(data) as unknown;
      } else if (data instanceof Uint8Array) {
        message = JSON.parse(new TextDecoder().decode(data)) as unknown;
      }
    } catch (error) {
      this.sendJsonRpcResponse(
        buildEventCenterJsonRpcFailure(
          null,
          EVENT_CENTER_JSON_RPC_ERROR.parseError,
          "Invalid JSON-RPC JSON payload.",
          errorMessage(error),
        ),
      );
      return;
    }
    if (this.handleServerNotification(message)) {
      return;
    }
    let response: EventCenterJsonRpcResponse | undefined;
    try {
      response = await this.eventCenter.handleJsonRpcMessage(message);
    } catch (error) {
      response = buildEventCenterJsonRpcFailure(
        null,
        EVENT_CENTER_JSON_RPC_ERROR.internalError,
        errorMessage(error),
      );
    }
    if (response) {
      this.sendJsonRpcResponse(response);
    }
  }

  private sendJsonRpcResponse(response: EventCenterJsonRpcResponse): void {
    if (this.socket?.readyState === WS_OPEN) {
      this.socket.send(JSON.stringify(response));
    }
  }

  private handleServerNotification(message: unknown): boolean {
    if (!isRecord(message) || message.method !== ECO_RPC_METHODS.event || "id" in message) {
      return false;
    }
    const params = message.params;
    if (!isRecord(params) || params.kind !== "presence.device") {
      return false;
    }
    this.notePresenceChanged();
    return true;
  }

  private notePresenceChanged(): void {
    this.status = {
      ...this.status,
      lastPresenceChangedAt: this.now().toISOString(),
    };
    this.onStatusChange?.(this.getSnapshot());
  }

  private flushQueuedEvents(): void {
    if (this.socket?.readyState !== WS_OPEN) {
      return;
    }
    while (this.queuedEvents.length > 0) {
      const event = this.queuedEvents.shift();
      if (event) {
        this.socket.send(JSON.stringify(event));
      }
    }
  }

  private publishMobileProjection(
    envelope: EventCenterEnvelope,
    notification: EventCenterJsonRpcNotification,
    event: ThreadLiveEvent,
  ): void {
    const threadId = envelope.threadId ?? event.threadId;
    const projection = event.projection;
    if (!threadId || !projection) {
      this.sendOrQueue(notification);
      return;
    }

    const pending = this.pendingMobileProjections.get(threadId);
    if (!isStreamingProjection(projection)) {
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingMobileProjections.delete(threadId);
        this.sendOrQueue(this.resolveProjectionNotification(threadId, notification));
      } else {
        this.sendOrQueue(notification);
      }
      return;
    }

    if (pending) {
      pending.notification = notification;
      return;
    }

    const entry: PendingMobileProjection = {
      notification,
      timer: setTimeout(() => {
        const latest = this.pendingMobileProjections.get(threadId);
        if (!latest) return;
        this.pendingMobileProjections.delete(threadId);
        this.sendOrQueue(this.resolveProjectionNotification(threadId, latest.notification));
      }, this.mobileStreamingProjectionThrottleMs),
    };
    this.pendingMobileProjections.set(threadId, entry);
  }

  private flushPendingMobileProjection(threadId: string): void {
    const pending = this.pendingMobileProjections.get(threadId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingMobileProjections.delete(threadId);
    this.sendOrQueue(this.resolveProjectionNotification(threadId, pending.notification));
  }

  private clearPendingMobileProjections(): void {
    for (const pending of this.pendingMobileProjections.values()) {
      clearTimeout(pending.timer);
    }
    this.pendingMobileProjections.clear();
  }

  private sendOrQueue(notification: EventCenterJsonRpcNotification): void {
    if (this.socket?.readyState === WS_OPEN) {
      this.socket.send(JSON.stringify(notification));
      return;
    }
    this.queuedEvents.push(notification);
    if (this.queuedEvents.length > MAX_QUEUED_EVENTS) {
      this.queuedEvents.shift();
    }
  }

  private resolveProjectionNotification(
    threadId: string,
    fallback: EventCenterJsonRpcNotification,
  ): EventCenterJsonRpcNotification {
    const projection = this.resolveThreadProjection?.(threadId);
    return projection ? replaceProjectionNotification(fallback, projection) : fallback;
  }

  private failConnection(message: string): void {
    this.log(`[eco] center server connection failed: ${message}\n`);
    this.store.markError(message);
    this.setStatus({
      state: "error",
      lastError: message,
      lastDisconnectedAt: this.now().toISOString(),
    });
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      void this.connect();
    }, this.reconnectDelayMs);
  }

  private startKeepalive(): void {
    this.clearKeepalive();
    this.keepaliveTimer = setInterval(() => {
      if (this.socket?.readyState !== WS_OPEN) {
        return;
      }
      this.socket.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: `ping_${this.now().getTime()}`,
          method: ECO_RPC_METHODS.ping,
          params: {},
        }),
      );
    }, KEEPALIVE_INTERVAL_MS);
  }

  private clearKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = undefined;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private setStatus(status: CenterServerConnectionStatus): void {
    this.status = status;
    this.onStatusChange?.(this.getSnapshot());
  }
}

function readThreadLiveEvent(envelope: EventCenterEnvelope): ThreadLiveEvent | undefined {
  if (!envelope.kind.startsWith("thread.")) {
    return undefined;
  }
  return isRecord(envelope.payload) ? (envelope.payload as unknown as ThreadLiveEvent) : undefined;
}

function isRemoteOnlyStreamDelta(event: ThreadLiveEvent): boolean {
  return (
    event.stream === true &&
    (event.type === "message.delta" || event.type === "thinking.delta")
  );
}

function shouldFlushProjectionBeforeEvent(
  kind: EventCenterEnvelope["kind"],
  event: ThreadLiveEvent | undefined,
): boolean {
  if (kind === "thread.stream") {
    return event?.stream === false;
  }
  return (
    kind === "thread.lifecycle" ||
    kind === "thread.plan" ||
    kind === "thread.clarification" ||
    kind === "thread.bash_approval" ||
    kind === "thread.follow_up" ||
    kind === "thread.todo"
  );
}

function isStreamingProjection(projection: ThreadRunProjectionSnapshot): boolean {
  return (
    projection.timeline.some(
      (item) => item.eventType === "message.delta" || item.eventType === "thinking.delta",
    ) ||
    projection.agents.some((agent) =>
      agent.timeline.some(
        (item) => item.eventType === "message.delta" || item.eventType === "thinking.delta",
      ),
    )
  );
}

function replaceProjectionNotification(
  notification: EventCenterJsonRpcNotification,
  projection: ThreadRunProjectionSnapshot,
): EventCenterJsonRpcNotification {
  const envelope = notification.params as EventCenterEnvelope<ThreadLiveEvent>;
  return {
    ...notification,
    params: {
      ...envelope,
      payload: {
        ...envelope.payload,
        projection,
      },
    },
  };
}

function resolveWebSocketConstructor(): WebSocketConstructorLike {
  const ctor = (globalThis as typeof globalThis & { WebSocket?: WebSocketConstructorLike }).WebSocket;
  if (!ctor) {
    throw new Error("WebSocket is not available in this runtime.");
  }
  return ctor;
}

function tokenStillValid(expiresAt: string | undefined, now: Date): boolean {
  if (!expiresAt) {
    return false;
  }
  return Date.parse(expiresAt) - now.getTime() > 30_000;
}

function readResponseError(payload: unknown, status: number): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) {
      return error;
    }
  }
  return `Center server request failed with HTTP ${status}.`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
