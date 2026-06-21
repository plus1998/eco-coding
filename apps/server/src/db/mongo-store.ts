import type { EcoDeviceCapability, EcoDeviceKind } from "@eco/shared";
import mongoose, { type Connection, type Model, Schema } from "mongoose";
import type {
  AuditLogInput,
  AuditLogRecord,
  DeviceBindingRecord,
  DeviceRecord,
  PairingSessionRecord,
  RefreshTokenRecord,
  UserRecord,
} from "../types";

interface UserDocument {
  _id: string;
  schemaVersion: number;
  email: string;
  displayName: string | null;
  passwordSalt: string;
  passwordHash: string;
  passwordIterations: number;
  createdAt: Date;
  disabledAt: Date | null;
}

interface DeviceDocument {
  _id: string;
  schemaVersion: number;
  userId: string;
  kind: EcoDeviceKind;
  name: string;
  secretHash: string;
  metadata?: Record<string, string>;
  createdAt: Date;
  lastSeenAt: Date | null;
  disabledAt: Date | null;
}

interface RefreshTokenDocument {
  _id: string;
  schemaVersion: number;
  userId: string;
  deviceId: string | null;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

interface PairingSessionDocument {
  _id: string;
  schemaVersion: number;
  userId: string;
  desktopDeviceId: string;
  codeHash: string;
  bootstrapTokenHash: string;
  expiresAt: Date;
  claimedAt: Date | null;
  createdAt: Date;
}

interface DeviceBindingDocument {
  _id: string;
  schemaVersion: number;
  userId: string;
  desktopDeviceId: string;
  mobileDeviceId: string;
  capabilities: EcoDeviceCapability[];
  createdAt: Date;
  revokedAt: Date | null;
}

interface AuditLogDocument {
  _id: string;
  schemaVersion: number;
  userId: string;
  action: string;
  status: AuditLogRecord["status"];
  actorDeviceId?: string;
  targetDeviceId?: string;
  rpcMethod?: string;
  channel?: string;
  errorCode?: number;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

interface MongoStoreModels {
  User: Model<UserDocument>;
  Device: Model<DeviceDocument>;
  RefreshToken: Model<RefreshTokenDocument>;
  PairingSession: Model<PairingSessionDocument>;
  DeviceBinding: Model<DeviceBindingDocument>;
  AuditLog: Model<AuditLogDocument>;
}

export interface MongoStoreConnectOptions {
  uri: string;
  databaseName?: string;
}

export interface MongoStoreOptions {
  connection: Connection;
}

const SCHEMA_VERSION = 1;

export class MongoStore {
  readonly connection: Connection;
  private readonly models: MongoStoreModels;

  static async connect(options: MongoStoreConnectOptions): Promise<MongoStore> {
    const connection = await mongoose
      .createConnection(options.uri, {
        ...(options.databaseName ? { dbName: options.databaseName } : {}),
        serverSelectionTimeoutMS: 10_000,
      })
      .asPromise();
    const store = new MongoStore({ connection });
    await store.ensureIndexes();
    return store;
  }

  constructor(options: MongoStoreOptions) {
    this.connection = options.connection;
    this.models = createModels(options.connection);
  }

  async ensureIndexes(): Promise<void> {
    await Promise.all(Object.values(this.models).map((model) => model.createIndexes()));
  }

  async close(): Promise<void> {
    await this.connection.close();
  }

  async dropDatabase(): Promise<void> {
    await this.connection.dropDatabase();
  }

  async createUser(input: {
    id: string;
    email: string;
    displayName: string | null;
    passwordSalt: string;
    passwordHash: string;
    passwordIterations: number;
    now: string;
  }): Promise<UserRecord> {
    const user = await this.models.User.create({
      _id: input.id,
      schemaVersion: SCHEMA_VERSION,
      email: input.email.toLowerCase(),
      displayName: input.displayName,
      passwordSalt: input.passwordSalt,
      passwordHash: input.passwordHash,
      passwordIterations: input.passwordIterations,
      createdAt: toDate(input.now),
      disabledAt: null,
    });
    return mapUser(user.toObject());
  }

  async findUserById(id: string): Promise<UserRecord | undefined> {
    const row = await this.models.User.findById(id).lean();
    return row ? mapUser(row as UserDocument) : undefined;
  }

  async findUserByEmail(email: string): Promise<UserRecord | undefined> {
    const row = await this.models.User.findOne({ email: email.toLowerCase() }).lean();
    return row ? mapUser(row as UserDocument) : undefined;
  }

  async createDevice(input: {
    id: string;
    userId: string;
    kind: EcoDeviceKind;
    name: string;
    secretHash: string;
    metadata?: Record<string, string>;
    now: string;
  }): Promise<DeviceRecord> {
    const device = await this.models.Device.create({
      _id: input.id,
      schemaVersion: SCHEMA_VERSION,
      userId: input.userId,
      kind: input.kind,
      name: input.name,
      secretHash: input.secretHash,
      metadata: input.metadata ?? {},
      createdAt: toDate(input.now),
      lastSeenAt: null,
      disabledAt: null,
    });
    return mapDevice(device.toObject());
  }

  async findDeviceById(id: string): Promise<DeviceRecord | undefined> {
    const row = await this.models.Device.findById(id).lean();
    return row ? mapDevice(row as DeviceDocument) : undefined;
  }

  async listDevicesForUser(
    userId: string,
    options: { includeDisabled?: boolean } = {},
  ): Promise<DeviceRecord[]> {
    const rows = await this.models.Device.find({
      userId,
      ...(options.includeDisabled ? {} : { disabledAt: null }),
    })
      .sort({ createdAt: 1, _id: 1 })
      .lean();
    return rows.map((row) => mapDevice(row as DeviceDocument));
  }

  async touchDevice(id: string, now: string): Promise<void> {
    await this.models.Device.updateOne({ _id: id }, { $set: { lastSeenAt: toDate(now) } });
  }

  async updateDeviceProfile(input: {
    userId: string;
    deviceId: string;
    name?: string;
    metadata?: Record<string, string>;
  }): Promise<DeviceRecord | undefined> {
    const existing = await this.findDeviceById(input.deviceId);
    if (!existing || existing.userId !== input.userId || existing.disabledAt) {
      return undefined;
    }
    const update: Partial<DeviceDocument> = {};
    if (input.name !== undefined) {
      update.name = input.name.trim();
    }
    if (input.metadata !== undefined) {
      update.metadata = {
        ...(existing.metadata ?? {}),
        ...input.metadata,
      };
    }
    if (Object.keys(update).length === 0) {
      return existing;
    }
    await this.models.Device.updateOne({ _id: input.deviceId, userId: input.userId }, { $set: update });
    return this.findDeviceById(input.deviceId);
  }

  async disableDevice(userId: string, deviceId: string, now: string): Promise<DeviceRecord | undefined> {
    const existing = await this.findDeviceById(deviceId);
    if (!existing || existing.userId !== userId) {
      return undefined;
    }
    const disabledAt = existing.disabledAt ? toDate(existing.disabledAt) : toDate(now);
    await this.models.Device.updateOne({ _id: deviceId, userId }, { $set: { disabledAt } });
    await this.models.RefreshToken.updateMany(
      { deviceId, revokedAt: null },
      { $set: { revokedAt: toDate(now) } },
    );
    await this.models.DeviceBinding.updateMany(
      {
        revokedAt: null,
        $or: [{ desktopDeviceId: deviceId }, { mobileDeviceId: deviceId }],
      },
      { $set: { revokedAt: toDate(now) } },
    );
    return this.findDeviceById(deviceId);
  }

  async createRefreshToken(input: {
    id: string;
    userId: string;
    deviceId: string | null;
    tokenHash: string;
    expiresAt: string;
    now: string;
  }): Promise<RefreshTokenRecord> {
    const token = await this.models.RefreshToken.create({
      _id: input.id,
      schemaVersion: SCHEMA_VERSION,
      userId: input.userId,
      deviceId: input.deviceId,
      tokenHash: input.tokenHash,
      expiresAt: toDate(input.expiresAt),
      revokedAt: null,
      createdAt: toDate(input.now),
    });
    return mapRefreshToken(token.toObject());
  }

  async findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenRecord | undefined> {
    const row = await this.models.RefreshToken.findOne({ tokenHash }).lean();
    return row ? mapRefreshToken(row as RefreshTokenDocument) : undefined;
  }

  async revokeRefreshToken(id: string, now: string): Promise<void> {
    await this.models.RefreshToken.updateOne(
      { _id: id, revokedAt: null },
      { $set: { revokedAt: toDate(now) } },
    );
  }

  async revokeRefreshTokenByHash(tokenHash: string, now: string): Promise<RefreshTokenRecord | undefined> {
    await this.models.RefreshToken.updateOne(
      { tokenHash, revokedAt: null },
      { $set: { revokedAt: toDate(now) } },
    );
    return this.findRefreshTokenByHash(tokenHash);
  }

  async createPairingSession(input: {
    id: string;
    userId: string;
    desktopDeviceId: string;
    codeHash: string;
    bootstrapTokenHash: string;
    expiresAt: string;
    now: string;
  }): Promise<PairingSessionRecord> {
    const session = await this.models.PairingSession.create({
      _id: input.id,
      schemaVersion: SCHEMA_VERSION,
      userId: input.userId,
      desktopDeviceId: input.desktopDeviceId,
      codeHash: input.codeHash,
      bootstrapTokenHash: input.bootstrapTokenHash,
      expiresAt: toDate(input.expiresAt),
      claimedAt: null,
      createdAt: toDate(input.now),
    });
    return mapPairingSession(session.toObject());
  }

  async findPairingSessionById(id: string): Promise<PairingSessionRecord | undefined> {
    const row = await this.models.PairingSession.findById(id).lean();
    return row ? mapPairingSession(row as PairingSessionDocument) : undefined;
  }

  async claimPairingSessionByCodeHash(
    codeHash: string,
    now: string,
  ): Promise<PairingSessionRecord | undefined> {
    const nowDate = toDate(now);
    const row = await this.models.PairingSession.findOneAndUpdate(
      {
        codeHash,
        claimedAt: null,
        expiresAt: { $gt: nowDate },
      },
      { $set: { claimedAt: nowDate } },
      { new: true },
    ).lean();
    return row ? mapPairingSession(row as PairingSessionDocument) : undefined;
  }

  async claimPairingSessionByCodeAndBootstrapTokenHash(input: {
    codeHash: string;
    bootstrapTokenHash: string;
    now: string;
  }): Promise<PairingSessionRecord | undefined> {
    const nowDate = toDate(input.now);
    const row = await this.models.PairingSession.findOneAndUpdate(
      {
        codeHash: input.codeHash,
        bootstrapTokenHash: input.bootstrapTokenHash,
        claimedAt: null,
        expiresAt: { $gt: nowDate },
      },
      { $set: { claimedAt: nowDate } },
      { new: true },
    ).lean();
    return row ? mapPairingSession(row as PairingSessionDocument) : undefined;
  }

  async createDeviceBinding(input: {
    id: string;
    userId: string;
    desktopDeviceId: string;
    mobileDeviceId: string;
    capabilities: EcoDeviceCapability[];
    now: string;
  }): Promise<DeviceBindingRecord> {
    const nowDate = toDate(input.now);
    const row = await this.models.DeviceBinding.findOneAndUpdate(
      {
        userId: input.userId,
        desktopDeviceId: input.desktopDeviceId,
        mobileDeviceId: input.mobileDeviceId,
      },
      {
        $set: {
          capabilities: input.capabilities,
          revokedAt: null,
        },
        $setOnInsert: {
          _id: input.id,
          schemaVersion: SCHEMA_VERSION,
          userId: input.userId,
          desktopDeviceId: input.desktopDeviceId,
          mobileDeviceId: input.mobileDeviceId,
          createdAt: nowDate,
        },
      },
      { upsert: true, new: true },
    ).lean();
    if (!row) {
      throw new Error("Created binding could not be loaded.");
    }
    return mapDeviceBinding(row as DeviceBindingDocument);
  }

  async findActiveBinding(
    userId: string,
    desktopDeviceId: string,
    mobileDeviceId: string,
  ): Promise<DeviceBindingRecord | undefined> {
    const row = await this.models.DeviceBinding.findOne({
      userId,
      desktopDeviceId,
      mobileDeviceId,
      revokedAt: null,
    }).lean();
    return row ? mapDeviceBinding(row as DeviceBindingDocument) : undefined;
  }

  async listActiveBindingsForDesktop(
    userId: string,
    desktopDeviceId: string,
  ): Promise<DeviceBindingRecord[]> {
    const rows = await this.models.DeviceBinding.find({
      userId,
      desktopDeviceId,
      revokedAt: null,
    })
      .sort({ createdAt: 1, _id: 1 })
      .lean();
    return rows.map((row) => mapDeviceBinding(row as DeviceBindingDocument));
  }

  async listActiveBindingsForMobile(userId: string, mobileDeviceId: string): Promise<DeviceBindingRecord[]> {
    const rows = await this.models.DeviceBinding.find({
      userId,
      mobileDeviceId,
      revokedAt: null,
    })
      .sort({ createdAt: 1, _id: 1 })
      .lean();
    return rows.map((row) => mapDeviceBinding(row as DeviceBindingDocument));
  }

  async listBindingsForUser(
    userId: string,
    options: { includeRevoked?: boolean } = {},
  ): Promise<DeviceBindingRecord[]> {
    const rows = await this.models.DeviceBinding.find({
      userId,
      ...(options.includeRevoked ? {} : { revokedAt: null }),
    })
      .sort({ createdAt: 1, _id: 1 })
      .lean();
    return rows.map((row) => mapDeviceBinding(row as DeviceBindingDocument));
  }

  async findBindingById(userId: string, bindingId: string): Promise<DeviceBindingRecord | undefined> {
    const row = await this.models.DeviceBinding.findOne({ _id: bindingId, userId }).lean();
    return row ? mapDeviceBinding(row as DeviceBindingDocument) : undefined;
  }

  async revokeBinding(
    userId: string,
    bindingId: string,
    now: string,
  ): Promise<DeviceBindingRecord | undefined> {
    const existing = await this.findBindingById(userId, bindingId);
    if (!existing) {
      return undefined;
    }
    const revokedAt = existing.revokedAt ? toDate(existing.revokedAt) : toDate(now);
    await this.models.DeviceBinding.updateOne({ _id: bindingId, userId }, { $set: { revokedAt } });
    return this.findBindingById(userId, bindingId);
  }

  async createAuditLog(input: AuditLogInput & { id: string; now: string }): Promise<AuditLogRecord> {
    const auditLog: AuditLogDocument = {
      _id: input.id,
      schemaVersion: SCHEMA_VERSION,
      userId: input.userId,
      action: input.action,
      status: input.status,
      createdAt: toDate(input.now),
    };
    if (input.actorDeviceId) {
      auditLog.actorDeviceId = input.actorDeviceId;
    }
    if (input.targetDeviceId) {
      auditLog.targetDeviceId = input.targetDeviceId;
    }
    if (input.rpcMethod) {
      auditLog.rpcMethod = input.rpcMethod;
    }
    if (input.channel) {
      auditLog.channel = input.channel;
    }
    if (input.errorCode !== undefined) {
      auditLog.errorCode = input.errorCode;
    }
    if (input.errorMessage) {
      auditLog.errorMessage = input.errorMessage;
    }
    if (input.metadata) {
      auditLog.metadata = input.metadata;
    }
    const log = await this.models.AuditLog.create(auditLog);
    return mapAuditLog(log.toObject());
  }

  async listAuditLogs(
    options: { userId?: string; limit?: number; order?: "asc" | "desc" } = {},
  ): Promise<AuditLogRecord[]> {
    const rows = await this.models.AuditLog.find({
      ...(options.userId ? { userId: options.userId } : {}),
    })
      .sort({ createdAt: options.order === "desc" ? -1 : 1, _id: options.order === "desc" ? -1 : 1 })
      .limit(options.limit ?? 100)
      .lean();
    return rows.map((row) => mapAuditLog(row as AuditLogDocument));
  }
}

function createModels(connection: Connection): MongoStoreModels {
  return {
    User: getOrCreateModel(connection, "EcoUser", userSchema()),
    Device: getOrCreateModel(connection, "EcoDevice", deviceSchema()),
    RefreshToken: getOrCreateModel(connection, "EcoRefreshToken", refreshTokenSchema()),
    PairingSession: getOrCreateModel(connection, "EcoPairingSession", pairingSessionSchema()),
    DeviceBinding: getOrCreateModel(connection, "EcoDeviceBinding", deviceBindingSchema()),
    AuditLog: getOrCreateModel(connection, "EcoAuditLog", auditLogSchema()),
  };
}

function getOrCreateModel<TDocument>(
  connection: Connection,
  name: string,
  schema: Schema<TDocument>,
): Model<TDocument> {
  return (
    (connection.models[name] as Model<TDocument> | undefined) ?? connection.model<TDocument>(name, schema)
  );
}

function userSchema(): Schema<UserDocument> {
  const schema = new Schema<UserDocument>(
    {
      _id: { type: String, required: true },
      schemaVersion: { type: Number, required: true, default: SCHEMA_VERSION },
      email: { type: String, required: true, lowercase: true, trim: true },
      displayName: { type: String, default: null },
      passwordSalt: { type: String, required: true },
      passwordHash: { type: String, required: true },
      passwordIterations: { type: Number, required: true },
      createdAt: { type: Date, required: true },
      disabledAt: { type: Date, default: null },
    },
    { collection: "users", versionKey: false, id: false },
  );
  schema.index({ email: 1 }, { unique: true });
  return schema;
}

function deviceSchema(): Schema<DeviceDocument> {
  const schema = new Schema<DeviceDocument>(
    {
      _id: { type: String, required: true },
      schemaVersion: { type: Number, required: true, default: SCHEMA_VERSION },
      userId: { type: String, required: true },
      kind: { type: String, required: true, enum: ["desktop", "mobile"] },
      name: { type: String, required: true },
      secretHash: { type: String, required: true },
      metadata: { type: Schema.Types.Mixed, default: {} },
      createdAt: { type: Date, required: true },
      lastSeenAt: { type: Date, default: null },
      disabledAt: { type: Date, default: null },
    },
    { collection: "devices", versionKey: false, id: false },
  );
  schema.index({ userId: 1, createdAt: 1 });
  return schema;
}

function refreshTokenSchema(): Schema<RefreshTokenDocument> {
  const schema = new Schema<RefreshTokenDocument>(
    {
      _id: { type: String, required: true },
      schemaVersion: { type: Number, required: true, default: SCHEMA_VERSION },
      userId: { type: String, required: true },
      deviceId: { type: String, default: null },
      tokenHash: { type: String, required: true },
      expiresAt: { type: Date, required: true },
      revokedAt: { type: Date, default: null },
      createdAt: { type: Date, required: true },
    },
    { collection: "refresh_tokens", versionKey: false, id: false },
  );
  schema.index({ tokenHash: 1 }, { unique: true });
  schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  schema.index({ userId: 1, deviceId: 1 });
  return schema;
}

function pairingSessionSchema(): Schema<PairingSessionDocument> {
  const schema = new Schema<PairingSessionDocument>(
    {
      _id: { type: String, required: true },
      schemaVersion: { type: Number, required: true, default: SCHEMA_VERSION },
      userId: { type: String, required: true },
      desktopDeviceId: { type: String, required: true },
      codeHash: { type: String, required: true },
      bootstrapTokenHash: { type: String, required: true },
      expiresAt: { type: Date, required: true },
      claimedAt: { type: Date, default: null },
      createdAt: { type: Date, required: true },
    },
    { collection: "pairing_sessions", versionKey: false, id: false },
  );
  schema.index({ codeHash: 1 }, { unique: true });
  schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  schema.index({ userId: 1, desktopDeviceId: 1, createdAt: -1 });
  return schema;
}

function deviceBindingSchema(): Schema<DeviceBindingDocument> {
  const schema = new Schema<DeviceBindingDocument>(
    {
      _id: { type: String, required: true },
      schemaVersion: { type: Number, required: true, default: SCHEMA_VERSION },
      userId: { type: String, required: true },
      desktopDeviceId: { type: String, required: true },
      mobileDeviceId: { type: String, required: true },
      capabilities: { type: [String], required: true },
      createdAt: { type: Date, required: true },
      revokedAt: { type: Date, default: null },
    },
    { collection: "device_bindings", versionKey: false, id: false },
  );
  schema.index({ userId: 1, desktopDeviceId: 1, mobileDeviceId: 1 }, { unique: true });
  schema.index({ userId: 1, desktopDeviceId: 1, revokedAt: 1 });
  schema.index({ userId: 1, mobileDeviceId: 1, revokedAt: 1 });
  return schema;
}

function auditLogSchema(): Schema<AuditLogDocument> {
  const schema = new Schema<AuditLogDocument>(
    {
      _id: { type: String, required: true },
      schemaVersion: { type: Number, required: true, default: SCHEMA_VERSION },
      userId: { type: String, required: true },
      action: { type: String, required: true },
      status: {
        type: String,
        required: true,
        enum: ["accepted", "rejected", "succeeded", "failed", "timeout"],
      },
      actorDeviceId: { type: String },
      targetDeviceId: { type: String },
      rpcMethod: { type: String },
      channel: { type: String },
      errorCode: { type: Number },
      errorMessage: { type: String },
      metadata: { type: Schema.Types.Mixed },
      createdAt: { type: Date, required: true },
    },
    { collection: "audit_logs", versionKey: false, id: false },
  );
  schema.index({ userId: 1, createdAt: -1 });
  return schema;
}

function toDate(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return date;
}

function toIso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function toIsoOrNull(value: Date | string | null | undefined): string | null {
  return value ? toIso(value) : null;
}

function mapUser(row: UserDocument): UserRecord {
  return {
    id: row._id,
    email: row.email,
    displayName: row.displayName,
    passwordSalt: row.passwordSalt,
    passwordHash: row.passwordHash,
    passwordIterations: row.passwordIterations,
    createdAt: toIso(row.createdAt),
    disabledAt: toIsoOrNull(row.disabledAt),
  };
}

function mapDevice(row: DeviceDocument): DeviceRecord {
  return {
    id: row._id,
    userId: row.userId,
    kind: row.kind,
    name: row.name,
    secretHash: row.secretHash,
    metadata: normalizeDeviceMetadata(row.metadata),
    createdAt: toIso(row.createdAt),
    lastSeenAt: toIsoOrNull(row.lastSeenAt),
    disabledAt: toIsoOrNull(row.disabledAt),
  };
}

function normalizeDeviceMetadata(value: unknown): DeviceRecord["metadata"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const metadata: DeviceRecord["metadata"] = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string" && raw.trim()) {
      if (key === "model" || key === "ipAddress" || key === "platform" || key === "hostname") {
        metadata[key] = raw.trim();
      }
    }
  }
  return metadata;
}

function mapRefreshToken(row: RefreshTokenDocument): RefreshTokenRecord {
  return {
    id: row._id,
    userId: row.userId,
    deviceId: row.deviceId,
    tokenHash: row.tokenHash,
    expiresAt: toIso(row.expiresAt),
    revokedAt: toIsoOrNull(row.revokedAt),
    createdAt: toIso(row.createdAt),
  };
}

function mapPairingSession(row: PairingSessionDocument): PairingSessionRecord {
  return {
    id: row._id,
    userId: row.userId,
    desktopDeviceId: row.desktopDeviceId,
    codeHash: row.codeHash,
    bootstrapTokenHash: row.bootstrapTokenHash,
    expiresAt: toIso(row.expiresAt),
    claimedAt: toIsoOrNull(row.claimedAt),
    createdAt: toIso(row.createdAt),
  };
}

function mapDeviceBinding(row: DeviceBindingDocument): DeviceBindingRecord {
  return {
    id: row._id,
    userId: row.userId,
    desktopDeviceId: row.desktopDeviceId,
    mobileDeviceId: row.mobileDeviceId,
    capabilities: [...row.capabilities],
    createdAt: toIso(row.createdAt),
    revokedAt: toIsoOrNull(row.revokedAt),
  };
}

function mapAuditLog(row: AuditLogDocument): AuditLogRecord {
  return {
    id: row._id,
    userId: row.userId,
    action: row.action,
    status: row.status,
    ...(row.actorDeviceId ? { actorDeviceId: row.actorDeviceId } : {}),
    ...(row.targetDeviceId ? { targetDeviceId: row.targetDeviceId } : {}),
    ...(row.rpcMethod ? { rpcMethod: row.rpcMethod } : {}),
    ...(row.channel ? { channel: row.channel } : {}),
    ...(row.errorCode !== undefined ? { errorCode: row.errorCode } : {}),
    ...(row.errorMessage ? { errorMessage: row.errorMessage } : {}),
    ...(row.metadata ? { metadata: row.metadata } : {}),
    createdAt: toIso(row.createdAt),
  };
}
