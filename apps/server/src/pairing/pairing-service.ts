import type { EcoDeviceCapability } from "@eco/shared";
import { createPairingCode, sha256Hex } from "../auth/crypto";
import type { SqliteStore } from "../db/sqlite-store";
import type { DeviceBindingRecord, PairingSessionRecord } from "../types";

export interface PairingServiceOptions {
  store: SqliteStore;
  pairingTtlSeconds: number;
  now?: () => Date;
}

export interface CreatedPairingSession {
  session: PairingSessionRecord;
  code: string;
  qrPayload: string;
}

export class PairingService {
  private readonly store: SqliteStore;
  private readonly pairingTtlSeconds: number;
  private readonly clock: () => Date;

  constructor(options: PairingServiceOptions) {
    this.store = options.store;
    this.pairingTtlSeconds = options.pairingTtlSeconds;
    this.clock = options.now ?? (() => new Date());
  }

  async createPairingSession(input: {
    userId: string;
    desktopDeviceId: string;
  }): Promise<CreatedPairingSession> {
    const desktop = this.store.findDeviceById(input.desktopDeviceId);
    if (!desktop || desktop.userId !== input.userId || desktop.kind !== "desktop" || desktop.disabledAt) {
      throw new Error("Desktop device is not active.");
    }
    const now = this.clock();
    const code = createPairingCode();
    const session = this.store.createPairingSession({
      id: createId("pair"),
      userId: input.userId,
      desktopDeviceId: input.desktopDeviceId,
      codeHash: await sha256Hex(code),
      expiresAt: new Date(now.getTime() + this.pairingTtlSeconds * 1000).toISOString(),
      now: now.toISOString(),
    });
    return {
      session,
      code,
      qrPayload: `eco://pair?code=${encodeURIComponent(code)}`,
    };
  }

  getPairingSession(input: { userId: string; pairingId: string }): PairingSessionRecord {
    const session = this.store.findPairingSessionById(input.pairingId);
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
    const mobile = this.store.findDeviceById(input.mobileDeviceId);
    if (!mobile || mobile.userId !== input.userId || mobile.kind !== "mobile" || mobile.disabledAt) {
      throw new Error("Mobile device is not active.");
    }
    const session = this.store.claimPairingSessionByCodeHash(await sha256Hex(input.code.trim().toUpperCase()), this.nowIso());
    if (!session || session.userId !== input.userId) {
      throw new Error("Pairing code is invalid or expired.");
    }
    const desktop = this.store.findDeviceById(session.desktopDeviceId);
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
