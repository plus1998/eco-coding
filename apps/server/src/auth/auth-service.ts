import type { EcoDeviceCapability } from "@eco/shared";
import type { MongoStore } from "../db/mongo-store";
import type { AccessTokenClaims, AccessTokenResult, DeviceRecord, TokenBundle, UserRecord } from "../types";
import {
  createRandomToken,
  hashPassword,
  sha256Hex,
  signAccessToken,
  verifyAccessToken,
  verifyPassword,
} from "./crypto";

export interface AuthServiceOptions {
  store: MongoStore;
  tokenSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  now?: () => Date;
}

export class AuthService {
  private readonly store: MongoStore;
  private readonly tokenSecret: string;
  private readonly accessTokenTtlSeconds: number;
  private readonly refreshTokenTtlSeconds: number;
  private readonly clock: () => Date;

  constructor(options: AuthServiceOptions) {
    this.store = options.store;
    this.tokenSecret = options.tokenSecret;
    this.accessTokenTtlSeconds = options.accessTokenTtlSeconds;
    this.refreshTokenTtlSeconds = options.refreshTokenTtlSeconds;
    this.clock = options.now ?? (() => new Date());
  }

  async registerUser(input: { email: string; password: string; displayName?: string }): Promise<UserRecord> {
    const email = normalizeEmail(input.email);
    assertPassword(input.password);
    if (await this.store.findUserByEmail(email)) {
      throw new Error("Email already registered.");
    }
    const passwordHash = await hashPassword(input.password);
    return this.store.createUser({
      id: createId("usr"),
      email,
      displayName: input.displayName?.trim() || null,
      passwordSalt: passwordHash.salt,
      passwordHash: passwordHash.hash,
      passwordIterations: passwordHash.iterations,
      now: this.nowIso(),
    });
  }

  async loginUser(input: { email: string; password: string }): Promise<UserRecord> {
    const user = await this.store.findUserByEmail(normalizeEmail(input.email));
    if (!user || user.disabledAt) {
      throw new Error("Invalid email or password.");
    }
    const passwordMatches = await verifyPassword(input.password, {
      salt: user.passwordSalt,
      hash: user.passwordHash,
      iterations: user.passwordIterations,
    });
    if (!passwordMatches) {
      throw new Error("Invalid email or password.");
    }
    return user;
  }

  async issueUserTokenBundle(user: UserRecord): Promise<TokenBundle> {
    return this.issueTokenBundle({
      user,
      device: null,
      capabilities: ["device:admin"],
    });
  }

  async issueDeviceTokenBundle(device: DeviceRecord): Promise<TokenBundle> {
    const user = await this.store.findUserById(device.userId);
    if (!user || user.disabledAt || device.disabledAt) {
      throw new Error("Device is not active.");
    }
    return this.issueTokenBundle({
      user,
      device,
      capabilities: defaultDeviceCapabilities(device.kind),
    });
  }

  async refreshAccessToken(refreshToken: string): Promise<AccessTokenResult> {
    const tokenHash = await sha256Hex(refreshToken);
    const record = await this.store.findRefreshTokenByHash(tokenHash);
    if (!record || record.revokedAt || Date.parse(record.expiresAt) <= this.clock().getTime()) {
      throw new Error("Refresh token is invalid or expired.");
    }
    const user = await this.store.findUserById(record.userId);
    if (!user || user.disabledAt) {
      throw new Error("Refresh token subject is not active.");
    }
    if (!record.deviceId) {
      return this.signAccessToken({
        subjectKind: "user",
        user,
        capabilities: ["device:admin"],
      });
    }
    const device = await this.store.findDeviceById(record.deviceId);
    if (!device || device.disabledAt) {
      throw new Error("Refresh token device is not active.");
    }
    return this.signAccessToken({
      subjectKind: "device",
      user,
      device,
      capabilities: defaultDeviceCapabilities(device.kind),
    });
  }

  async revokeRefreshToken(refreshToken: string): Promise<void> {
    const tokenHash = await sha256Hex(refreshToken);
    await this.store.revokeRefreshTokenByHash(tokenHash, this.nowIso());
  }

  async verifyBearerToken(token: string): Promise<AccessTokenClaims> {
    const claims = await verifyAccessToken(token, this.tokenSecret, this.clock().getTime());
    const user = await this.store.findUserById(claims.userId);
    if (!user || user.disabledAt) {
      throw new Error("Token user is not active.");
    }
    if (claims.subjectKind === "device") {
      const device = await this.store.findDeviceById(claims.deviceId);
      if (
        !device ||
        device.disabledAt ||
        device.userId !== claims.userId ||
        device.kind !== claims.deviceKind
      ) {
        throw new Error("Token device is not active.");
      }
    }
    return claims;
  }

  private async issueTokenBundle(input: {
    user: UserRecord;
    device: DeviceRecord | null;
    capabilities: EcoDeviceCapability[];
  }): Promise<TokenBundle> {
    const refreshToken = createRandomToken(48);
    const refreshTokenHash = await sha256Hex(refreshToken);
    const now = this.clock();
    const refreshExpiresAt = new Date(now.getTime() + this.refreshTokenTtlSeconds * 1000).toISOString();
    await this.store.createRefreshToken({
      id: createId("rft"),
      userId: input.user.id,
      deviceId: input.device?.id ?? null,
      tokenHash: refreshTokenHash,
      expiresAt: refreshExpiresAt,
      now: now.toISOString(),
    });
    const access = input.device
      ? await this.signAccessToken({
          subjectKind: "device",
          user: input.user,
          device: input.device,
          capabilities: input.capabilities,
        })
      : await this.signAccessToken({
          subjectKind: "user",
          user: input.user,
          capabilities: input.capabilities,
        });
    return {
      accessToken: access.accessToken,
      refreshToken,
      expiresAt: access.expiresAt,
    };
  }

  private async signAccessToken(input: {
    subjectKind: "user" | "device";
    user: UserRecord;
    device?: DeviceRecord;
    capabilities: EcoDeviceCapability[];
  }): Promise<AccessTokenResult> {
    const nowSeconds = Math.floor(this.clock().getTime() / 1000);
    const expiresAtSeconds = nowSeconds + this.accessTokenTtlSeconds;
    const baseClaims = {
      tokenType: "access" as const,
      tokenId: createId("act"),
      userId: input.user.id,
      capabilities: input.capabilities,
      issuedAt: nowSeconds,
      expiresAt: expiresAtSeconds,
    };
    const claims: AccessTokenClaims =
      input.subjectKind === "device"
        ? {
            ...baseClaims,
            subjectKind: "device",
            deviceId: requireDevice(input.device).id,
            deviceKind: requireDevice(input.device).kind,
          }
        : {
            ...baseClaims,
            subjectKind: "user",
          };
    return {
      accessToken: await signAccessToken(claims, this.tokenSecret),
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
    };
  }

  private nowIso(): string {
    return this.clock().toISOString();
  }
}

export function defaultDeviceCapabilities(kind: DeviceRecord["kind"]): EcoDeviceCapability[] {
  if (kind === "desktop") {
    return ["events:publish", "rpc:receive", "device:pair"];
  }
  return ["events:read", "rpc:invoke", "approval:decide"];
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error("Email is invalid.");
  }
  return normalized;
}

function assertPassword(password: string): void {
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function requireDevice(device: DeviceRecord | undefined): DeviceRecord {
  if (!device) {
    throw new Error("Device is required for device access tokens.");
  }
  return device;
}
