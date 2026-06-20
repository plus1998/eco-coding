import type { EcoDeviceCapability } from "@eco/shared";
import type { AuthService } from "../auth/auth-service";
import { createPairingCode, createRandomToken, sha256Hex } from "../auth/crypto";
import type { DeviceService } from "../devices/device-service";
import type { MongoStore } from "../db/mongo-store";
import type { DeviceBindingRecord, DeviceRecord, PairingSessionRecord, TokenBundle, UserRecord } from "../types";

export interface PairingServiceOptions {
  store: MongoStore;
  pairingTtlSeconds: number;
  devices: DeviceService;
  auth: AuthService;
  now?: () => Date;
}

export interface CreatedPairingSession {
  session: PairingSessionRecord;
  code: string;
  bootstrapToken: string;
  qrPayload: string;
}

export interface JoinPairingSessionResult {
  user: UserRecord;
  device: DeviceRecord;
  deviceSecret: string;
  tokens: TokenBundle;
  binding: DeviceBindingRecord;
  desktopDeviceId: string;
}

export class PairingService {
  private readonly store: MongoStore;
  private readonly pairingTtlSeconds: number;
  private readonly devices: DeviceService;
  private readonly auth: AuthService;
  private readonly clock: () => Date;

  constructor(options: PairingServiceOptions) {
    this.store = options.store;
    this.pairingTtlSeconds = options.pairingTtlSeconds;
    this.devices = options.devices;
    this.auth = options.auth;
    this.clock = options.now ?? (() => new Date());
  }

  async createPairingSession(input: {
    userId: string;
    desktopDeviceId: string;
  }): Promise<CreatedPairingSession> {
    const desktop = await this.store.findDeviceById(input.desktopDeviceId);
    if (!desktop || desktop.userId !== input.userId || desktop.kind !== "desktop" || desktop.disabledAt) {
      throw new Error("Desktop device is not active.");
    }
    const now = this.clock();
    const code = createPairingCode();
    const bootstrapToken = createRandomToken(48);
    const session = await this.store.createPairingSession({
      id: createId("pair"),
      userId: input.userId,
      desktopDeviceId: input.desktopDeviceId,
      codeHash: await sha256Hex(code),
      bootstrapTokenHash: await sha256Hex(bootstrapToken),
      expiresAt: new Date(now.getTime() + this.pairingTtlSeconds * 1000).toISOString(),
      now: now.toISOString(),
    });
    return {
      session,
      code,
      bootstrapToken,
      qrPayload: `eco://pair?code=${encodeURIComponent(code)}`,
    };
  }

  async getPairingSession(input: { userId: string; pairingId: string }): Promise<PairingSessionRecord> {
    const session = await this.store.findPairingSessionById(input.pairingId);
    if (!session || session.userId !== input.userId) {
      throw new Error("Pairing session was not found.");
    }
    return session;
  }

  async claimPairingSession(input: {
    userId: string;
    mobileDeviceId: string;
    code: string;
  }): Promise<DeviceBindingRecord> {
    const mobile = await this.store.findDeviceById(input.mobileDeviceId);
    if (!mobile || mobile.userId !== input.userId || mobile.kind !== "mobile" || mobile.disabledAt) {
      throw new Error("Mobile device is not active.");
    }
    const session = await this.store.claimPairingSessionByCodeHash(
      await sha256Hex(input.code.trim().toUpperCase()),
      this.nowIso(),
    );
    if (!session || session.userId !== input.userId) {
      throw new Error("Pairing code is invalid or expired.");
    }
    const desktop = await this.store.findDeviceById(session.desktopDeviceId);
    if (!desktop || desktop.userId !== input.userId || desktop.kind !== "desktop" || desktop.disabledAt) {
      throw new Error("Desktop device is not active.");
    }
    return this.store.createDeviceBinding({
      id: createId("bind"),
      userId: input.userId,
      desktopDeviceId: desktop.id,
      mobileDeviceId: mobile.id,
      capabilities: defaultBindingCapabilities(),
      now: this.nowIso(),
    });
  }

  async joinPairingSession(input: {
    code: string;
    token: string;
    deviceName?: string;
  }): Promise<JoinPairingSessionResult> {
    const normalizedCode = input.code.trim().toUpperCase();
    const token = input.token.trim();
    if (!normalizedCode || !token) {
      throw new Error("Pairing code and token are required.");
    }
    const session = await this.store.claimPairingSessionByCodeAndBootstrapTokenHash({
      codeHash: await sha256Hex(normalizedCode),
      bootstrapTokenHash: await sha256Hex(token),
      now: this.nowIso(),
    });
    if (!session) {
      throw new Error("Pairing code is invalid or expired.");
    }
    const desktop = await this.store.findDeviceById(session.desktopDeviceId);
    if (!desktop || desktop.userId !== session.userId || desktop.kind !== "desktop" || desktop.disabledAt) {
      throw new Error("Desktop device is not active.");
    }
    const user = await this.store.findUserById(session.userId);
    if (!user || user.disabledAt) {
      throw new Error("User account is not active.");
    }
    const registered = await this.devices.registerDevice({
      userId: session.userId,
      kind: "mobile",
      name: input.deviceName?.trim() || "Eco Mobile",
    });
    const tokens = await this.auth.issueDeviceTokenBundle(registered.device);
    const binding = await this.store.createDeviceBinding({
      id: createId("bind"),
      userId: session.userId,
      desktopDeviceId: desktop.id,
      mobileDeviceId: registered.device.id,
      capabilities: defaultBindingCapabilities(),
      now: this.nowIso(),
    });
    return {
      user,
      device: registered.device,
      deviceSecret: registered.deviceSecret,
      tokens,
      binding,
      desktopDeviceId: desktop.id,
    };
  }

  private nowIso(): string {
    return this.clock().toISOString();
  }
}

export function defaultBindingCapabilities(): EcoDeviceCapability[] {
  return ["events:read", "rpc:invoke", "approval:decide"];
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
