import type { EcoDeviceCapability, EcoDeviceKind } from "@eco/shared";

export interface UserRecord {
  id: string;
  email: string;
  displayName: string | null;
  passwordSalt: string;
  passwordHash: string;
  passwordIterations: number;
  createdAt: string;
  disabledAt: string | null;
}

export interface PublicDeviceMetadata {
  model?: string;
  ipAddress?: string;
  platform?: string;
}

export interface DeviceRecord {
  id: string;
  userId: string;
  kind: EcoDeviceKind;
  name: string;
  secretHash: string;
  metadata: PublicDeviceMetadata;
  createdAt: string;
  lastSeenAt: string | null;
  disabledAt: string | null;
}

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  deviceId: string | null;
  tokenHash: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}

export interface PairingSessionRecord {
  id: string;
  userId: string;
  desktopDeviceId: string;
  codeHash: string;
  bootstrapTokenHash: string;
  expiresAt: string;
  claimedAt: string | null;
  createdAt: string;
}

export interface DeviceBindingRecord {
  id: string;
  userId: string;
  desktopDeviceId: string;
  mobileDeviceId: string;
  capabilities: EcoDeviceCapability[];
  createdAt: string;
  revokedAt: string | null;
}

export type AuditStatus = "accepted" | "rejected" | "succeeded" | "failed" | "timeout";

export interface AuditLogInput {
  userId: string;
  action: string;
  status: AuditStatus;
  actorDeviceId?: string;
  targetDeviceId?: string;
  rpcMethod?: string;
  channel?: string;
  errorCode?: number;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditLogRecord extends AuditLogInput {
  id: string;
  createdAt: string;
}

export interface UserAccessTokenClaims {
  tokenType: "access";
  subjectKind: "user";
  tokenId: string;
  userId: string;
  capabilities: EcoDeviceCapability[];
  issuedAt: number;
  expiresAt: number;
}

export interface DeviceAccessTokenClaims {
  tokenType: "access";
  subjectKind: "device";
  tokenId: string;
  userId: string;
  deviceId: string;
  deviceKind: EcoDeviceKind;
  capabilities: EcoDeviceCapability[];
  issuedAt: number;
  expiresAt: number;
}

export type AccessTokenClaims = UserAccessTokenClaims | DeviceAccessTokenClaims;

export interface TokenBundle {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export interface AccessTokenResult {
  accessToken: string;
  expiresAt: string;
}

export interface PublicUser {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: string;
}

export interface PublicDevice {
  id: string;
  userId: string;
  kind: EcoDeviceKind;
  name: string;
  metadata: PublicDeviceMetadata;
  createdAt: string;
  lastSeenAt: string | null;
  disabledAt: string | null;
}

export interface PublicDeviceBinding {
  id: string;
  userId: string;
  desktopDeviceId: string;
  mobileDeviceId: string;
  capabilities: EcoDeviceCapability[];
  createdAt: string;
  revokedAt: string | null;
}

export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt,
  };
}

export function toPublicDevice(device: DeviceRecord): PublicDevice {
  return {
    id: device.id,
    userId: device.userId,
    kind: device.kind,
    name: device.name,
    metadata: device.metadata,
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt,
    disabledAt: device.disabledAt,
  };
}

export function toPublicDeviceBinding(binding: DeviceBindingRecord): PublicDeviceBinding {
  return {
    id: binding.id,
    userId: binding.userId,
    desktopDeviceId: binding.desktopDeviceId,
    mobileDeviceId: binding.mobileDeviceId,
    capabilities: binding.capabilities,
    createdAt: binding.createdAt,
    revokedAt: binding.revokedAt,
  };
}
