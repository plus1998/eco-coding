import type { EcoDeviceKind } from "@eco/shared";
import { createRandomToken, sha256Hex } from "../auth/crypto";
import type { SqliteStore } from "../db/sqlite-store";
import type { DeviceBindingRecord, DeviceRecord } from "../types";

export interface DeviceServiceOptions {
  store: SqliteStore;
  now?: () => Date;
}

export interface RegisteredDevice {
  device: DeviceRecord;
  deviceSecret: string;
}

export class DeviceService {
  private readonly store: SqliteStore;
  private readonly clock: () => Date;

  constructor(options: DeviceServiceOptions) {
    this.store = options.store;
    this.clock = options.now ?? (() => new Date());
  }

  async registerDevice(input: {
    userId: string;
    kind: EcoDeviceKind;
    name: string;
  }): Promise<RegisteredDevice> {
    const name = input.name.trim();
    if (!name) {
      throw new Error("Device name is required.");
    }
    const deviceSecret = createRandomToken(48);
    const device = this.store.createDevice({
      id: createId("dev"),
      userId: input.userId,
      kind: input.kind,
      name,
      secretHash: await sha256Hex(deviceSecret),
      now: this.clock().toISOString(),
    });
    return { device, deviceSecret };
  }

  async authenticateDevice(input: { deviceId: string; deviceSecret: string }): Promise<DeviceRecord> {
    const device = this.store.findDeviceById(input.deviceId);
    if (!device || device.disabledAt) {
      throw new Error("Device credentials are invalid.");
    }
    const secretHash = await sha256Hex(input.deviceSecret);
    if (secretHash !== device.secretHash) {
      throw new Error("Device credentials are invalid.");
    }
    this.store.touchDevice(device.id, this.clock().toISOString());
    return device;
  }

  listDevices(userId: string, options: { includeDisabled?: boolean } = {}): DeviceRecord[] {
    return this.store.listDevicesForUser(userId, options);
  }

  disableDevice(input: { userId: string; deviceId: string }): DeviceRecord {
    const device = this.store.disableDevice(input.userId, input.deviceId, this.clock().toISOString());
    if (!device) {
      throw new Error("Device was not found.");
    }
    return device;
  }

  listBindings(userId: string, options: { includeRevoked?: boolean } = {}): DeviceBindingRecord[] {
    return this.store.listBindingsForUser(userId, options);
  }

  revokeBinding(input: { userId: string; bindingId: string }): DeviceBindingRecord {
    const binding = this.store.revokeBinding(input.userId, input.bindingId, this.clock().toISOString());
    if (!binding) {
      throw new Error("Binding was not found.");
    }
    return binding;
  }
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
