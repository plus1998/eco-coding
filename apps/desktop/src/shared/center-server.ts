import { previewSecret } from "./session-sync";

export type CenterServerConnectionState =
  | "disabled"
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface CenterServerConnectionStatus {
  state: CenterServerConnectionState;
  connectedAt?: string;
  lastDisconnectedAt?: string;
  lastError?: string;
}

export interface CenterServerSettingsView {
  enabled: boolean;
  serverUrl: string;
  deviceId?: string;
  deviceName: string;
  hasDeviceSecret: boolean;
  deviceSecretPreview?: string;
  hasRefreshToken: boolean;
  accessTokenExpiresAt?: string;
  lastConnectedAt?: string;
  lastError?: string;
}

export interface CenterServerSettingsInput {
  enabled: boolean;
  serverUrl: string;
  deviceId?: string;
  deviceName?: string;
  /** Empty string keeps the stored secret. */
  deviceSecret?: string;
  /** Empty string keeps the stored refresh token. */
  refreshToken?: string;
  accessToken?: string;
  accessTokenExpiresAt?: string;
}

export interface CenterServerSettingsSnapshot {
  settings: CenterServerSettingsView;
  status: CenterServerConnectionStatus;
}

export interface CenterServerRegisterDesktopRequest {
  serverUrl: string;
  userAccessToken: string;
  deviceName: string;
}

export interface CenterServerDeviceMetadataView {
  model?: string;
  ipAddress?: string;
  platform?: string;
}

export interface CenterServerDeviceView {
  id: string;
  userId: string;
  kind: "desktop" | "mobile";
  name: string;
  metadata?: CenterServerDeviceMetadataView;
  createdAt: string;
  lastSeenAt: string | null;
  disabledAt: string | null;
}

export interface CenterServerRegisterDesktopResult {
  settings: CenterServerSettingsView;
  status: CenterServerConnectionStatus;
  device: CenterServerDeviceView;
}

export interface CenterServerAccountView {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: string;
}

export interface CenterServerSignUpRequest {
  serverUrl: string;
  email: string;
  password: string;
  deviceName: string;
  displayName?: string;
}

export interface CenterServerSignInRequest {
  serverUrl: string;
  email: string;
  password: string;
  deviceName: string;
}

export interface CenterServerAccountAuthResult extends CenterServerRegisterDesktopResult {
  user: CenterServerAccountView;
}

export interface CenterServerCreatePairingResult {
  pairingId: string;
  code: string;
  bootstrapToken: string;
  qrPayload: string;
  expiresAt: string;
}

export interface CenterServerTestConnectionRequest {
  serverUrl: string;
}

export interface CenterServerTestConnectionResult {
  ok: boolean;
  error?: string;
}

export interface CenterServerDeviceBindingView {
  id: string;
  userId: string;
  desktopDeviceId: string;
  mobileDeviceId: string;
  capabilities: string[];
  createdAt: string;
  revokedAt: string | null;
}

export interface CenterServerDevicePresenceView extends CenterServerDeviceView {
  online?: boolean;
  connectedAt?: string;
}

export interface CenterServerListBindingsResult {
  bindings: CenterServerDeviceBindingView[];
}

export interface CenterServerListPresenceResult {
  devices: CenterServerDevicePresenceView[];
}

export interface CenterServerRevokeBindingResult {
  binding: CenterServerDeviceBindingView;
}

export function validateCenterServerSettingsInput(input: CenterServerSettingsInput): void {
  if (input.enabled && !input.serverUrl.trim()) {
    throw new Error("Center server URL is required when enabled.");
  }
  if (input.serverUrl.trim()) {
    normalizeCenterServerHttpUrl(input.serverUrl);
  }
}

export function normalizeCenterServerHttpUrl(serverUrl: string): string {
  const trimmed = serverUrl.trim();
  const parsed = new URL(trimmed);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Center server URL must use http or https.");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

export function buildCenterServerWebSocketUrl(serverUrl: string, accessToken: string): string {
  const parsed = new URL(normalizeCenterServerHttpUrl(serverUrl));
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/v1/rpc`;
  parsed.searchParams.set("access_token", accessToken);
  return parsed.toString();
}

export function buildPairingQrPayload(input: {
  serverUrl: string;
  code: string;
  bootstrapToken: string;
}): string {
  const params = new URLSearchParams({
    server: normalizeCenterServerHttpUrl(input.serverUrl),
    code: input.code,
    token: input.bootstrapToken,
  });
  return `eco://pair?${params.toString()}`;
}

export function isLocalhostCenterServerUrl(serverUrl: string): boolean {
  try {
    const hostname = new URL(normalizeCenterServerHttpUrl(serverUrl)).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

export function previewCenterServerSecret(value: string): string | undefined {
  return previewSecret(value);
}
