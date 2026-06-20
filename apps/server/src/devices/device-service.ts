import type { EcoDeviceKind } from "@eco/shared";
import { createRandomToken, sha256Hex } from "../auth/crypto";
import type { MongoStore } from "../db/mongo-store";
import type { DeviceBindingRecord, DeviceRecord } from "../types";

export interface DeviceServiceOptions {
  store: MongoStore;
  now?: () => Date;
}

export interface RegisteredDevice {
  device: DeviceRecord;
  deviceSecret: string;
}

export class DeviceService {
  private readonly store: MongoStore;
  private readonly clock: () => Date;

  constructor(options: DeviceServiceOptions) {
    this.store = options.store;
    this.clock = options.now ?? (() => new Date());
  }

  async registerDevice(input: {
    userId: string;
    kind: EcoDeviceKind;
    name: string;
    metadata?: Record<string, string>;
  }): Promise<RegisteredDevice> {
    const name = input.name.trim();
    if (!name) {
      throw new Error("Device name is required.");
    }
    const deviceSecret = createRandomToken(48);
    const device = await this.store.createDevice({
      id: createId("dev"),
      userId: input.userId,
      kind: input.kind,
      name,
      secretHash: await sha256Hex(deviceSecret),
      metadata: input.metadata,
      now: this.clock().toISOString(),
    });
    return { device, deviceSecret };
  }

  async authenticateDevice(input: { deviceId: string; deviceSecret: string }): Promise<DeviceRecord> {
    const device = await this.store.findDeviceById(input.deviceId);
    if (!device || device.disabledAt) {
      throw new Error("Device credentials are invalid.");
    }
    const secretHash = await sha256Hex(input.deviceSecret);
    if (secretHash !== device.secretHash) {
      throw new Error("Device credentials are invalid.");
    }
    await this.store.touchDevice(device.id, this.clock().toISOString());
    return device;
  }

  listDevices(userId: string, options: { includeDisabled?: boolean } = {}): Promise<DeviceRecord[]> {
    return this.store.listDevicesForUser(userId, options);
  }

  async disableDevice(input: { userId: string; deviceId: string }): Promise<DeviceRecord> {
    const device = await this.store.disableDevice(input.userId, input.deviceId, this.clock().toISOString());
    if (!device) {
      throw new Error("Device was not found.");
    }
    return device;
  }

  listBindings(userId: string, options: { includeRevoked?: boolean } = {}): Promise<DeviceBindingRecord[]> {
    return this.store.listBindingsForUser(userId, options);
  }

  async updateDeviceProfile(input: {
    userId: string;
    deviceId: string;
    name?: string;
    metadata?: Record<string, string>;
  }): Promise<DeviceRecord> {
    const device = await this.store.updateDeviceProfile(input);
    if (!device) {
      throw new Error("Device was not found.");
    }
    return device;
  }

  async revokeBinding(input: { userId: string; bindingId: string }): Promise<DeviceBindingRecord> {
    const binding = await this.store.revokeBinding(input.userId, input.bindingId, this.clock().toISOString());
    if (!binding) {
      throw new Error("Binding was not found.");
    }
    return binding;
  }
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
