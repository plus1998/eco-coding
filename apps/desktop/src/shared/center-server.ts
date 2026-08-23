export type CenterServerConnectionState = "disabled" | "disconnected" | "connecting" | "connected" | "error";

export interface CenterServerConnectionStatus {
  state: CenterServerConnectionState;
  connectedAt?: string;
  lastDisconnectedAt?: string;
  lastError?: string;
  lastPresenceChangedAt?: string;
}

export interface CenterServerSettingsView {
  enabled: boolean;
  /**
   * Supabase project URL. Prefer this over serverUrl.
   * serverUrl is kept in sync for migration / display compatibility.
   */
  supabaseUrl: string;
  /** @deprecated Alias of supabaseUrl; kept for gradual migration away from Center Server. */
  serverUrl: string;
  hasAnonKey: boolean;
  anonKeyPreview?: string;
  deviceId?: string;
  deviceName: string;
  hasDeviceSecret: boolean;
  deviceSecretPreview?: string;
  hasRefreshToken: boolean;
  /** Local vault_key present (required to decrypt synced API keys). */
  hasVaultKey: boolean;
  accessTokenExpiresAt?: string;
  lastConnectedAt?: string;
  lastSettingsSyncedAt?: string;
  lastError?: string;
}

export interface CenterServerSettingsInput {
  enabled: boolean;
  /** Preferred project URL field. */
  supabaseUrl?: string;
  /**
   * @deprecated Prefer supabaseUrl. If supabaseUrl is empty, serverUrl is used.
   */
  serverUrl?: string;
  /** Empty string keeps the stored anon key. */
  anonKey?: string;
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
  supabaseUrl: string;
  anonKey: string;
  userAccessToken: string;
  /** Required for session renewal after token-only device registration. */
  refreshToken?: string;
  deviceName: string;
  /** @deprecated Prefer supabaseUrl. */
  serverUrl?: string;
}

export interface CenterServerDeviceMetadataView {
  model?: string;
  ipAddress?: string;
  platform?: string;
  hostname?: string;
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
  supabaseUrl: string;
  /** Optional when anon key was already saved for this project URL. */
  anonKey?: string;
  email: string;
  password: string;
  deviceName: string;
  displayName?: string;
  /** @deprecated Prefer supabaseUrl. */
  serverUrl?: string;
}

/**
 * Build the Auth email-confirmation redirect for a given Supabase project URL.
 * Hosted as Edge Function `auth-email-confirmed` (no JWT).
 */
export function buildEcoAuthEmailConfirmRedirect(supabaseUrl: string): string {
  const base = normalizeSupabaseProjectUrl(supabaseUrl).replace(/\/+$/, "");
  return `${base}/functions/v1/auth-email-confirmed`;
}


export interface CenterServerSignInRequest {
  supabaseUrl: string;
  /** Optional when anon key was already saved for this project URL. */
  anonKey?: string;
  email: string;
  password: string;
  deviceName: string;
  /** @deprecated Prefer supabaseUrl. */
  serverUrl?: string;
}

export interface CenterServerAccountAuthResult {
  /**
   * True when Auth created the user but email confirmation is required before a session exists.
   * Caller should keep the account form open and switch to sign-in after the user confirms.
   */
  emailConfirmationRequired?: boolean;
  email?: string;
  notice?: string;
  /** Present when registration completed (session available). */
  settings?: CenterServerSettingsView;
  status?: CenterServerConnectionStatus;
  device?: CenterServerDeviceView;
  user?: CenterServerAccountView;
}


export interface CenterServerCreatePairingResult {
  pairingId: string;
  code: string;
  bootstrapToken: string;
  qrPayload: string;
  expiresAt: string;
}

export interface CenterServerTestConnectionRequest {
  supabaseUrl: string;
  /** Optional when anon key was already saved for this project URL. */
  anonKey?: string;
  /** @deprecated Prefer supabaseUrl. */
  serverUrl?: string;
}

export interface CenterServerTestConnectionResult {
  ok: boolean;
  error?: string;
}

export interface CenterServerRemoveConnectionOptions {
  forceLocal?: boolean;
}

export interface CenterServerRemoveConnectionResult extends CenterServerSettingsSnapshot {
  notice?: string;
}

export class CenterServerRemoveConnectionError extends Error {
  readonly recovery: CenterServerAuthRecovery;

  constructor(message: string, recovery: CenterServerAuthRecovery) {
    super(message);
    this.name = "CenterServerRemoveConnectionError";
    this.recovery = recovery;
  }
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

export type CenterServerVaultSyncState =
  | "idle"
  | "syncing"
  | "ready"
  | "needs_claim"
  | "claim_pending"
  | "error";

export interface CenterServerVaultStatus {
  hasVaultKey: boolean;
  state: CenterServerVaultSyncState;
  lastSyncedAt?: string;
  error?: string;
  /** Non-error guidance (e.g. claim request accepted, waiting for approver). */
  hint?: string;
  /** Pending vault claims visible to this account (approver UI). */
  pendingClaimCount?: number;
  /** True when at least one other vault-synced device appears online (presence). */
  syncedPeerOnline?: boolean;
  activeClaimId?: string;
  /** Approver-only: 6-digit code currently shown for an open approve session. */
  approvalCode?: string;
  approvalClaimId?: string;
  /** Local vs cloud settings differ; user must choose pull or push. */
  needsSyncChoice?: boolean;
}

export interface CenterServerVaultClaimView {
  id: string;
  requesterDeviceId: string;
  requesterDeviceName?: string;
  status: "pending" | "approved" | "consumed" | "expired" | "cancelled";
  expiresAt: string;
  createdAt: string;
  approverDeviceId?: string | null;
}

export interface CenterServerRequestVaultClaimResult {
  claimId: string;
  expiresAt: string;
}

export interface CenterServerApproveVaultClaimResult {
  claimId: string;
  /** 6-digit code for the requester to enter on the new device. */
  code: string;
  expiresAt: string;
}

export interface CenterServerSubmitVaultClaimCodeResult {
  claimId: string;
  hasVaultKey: boolean;
}

export interface CenterServerSyncConfigResult {
  mode: "pull" | "push" | "reconcile";
  settingsPushed: boolean;
  settingsPulled: boolean;
  secretsPushed: number;
  secretsPulled: number;
  syncedAt: string;
  vaultStatus: CenterServerVaultStatus;
  /** Local and cloud both have settings and differ — choose pull or push explicitly. */
  needsUserChoice?: boolean;
  /** Cloud write succeeded but vault_synced_at mark failed (deploy eco_mark_device_vault_synced). */
  vaultMarkFailed?: string;
  /** Some cloud secret rows were skipped (undecryptable with this vault key). */
  secretsSkipped?: number;
  /** Pull found no cloud settings snapshot to apply. */
  cloudEmpty?: boolean;
}

export type CenterServerSyncConfigMode = "pull" | "push" | "reconcile";

export function resolveSupabaseProjectUrl(input: {
  supabaseUrl?: string;
  serverUrl?: string;
}): string {
  const raw = (input.supabaseUrl ?? input.serverUrl ?? "").trim();
  return raw ? normalizeSupabaseProjectUrl(raw) : "";
}

export function validateCenterServerSettingsInput(input: CenterServerSettingsInput): void {
  const projectUrl = resolveSupabaseProjectUrl(input);
  if (input.enabled && !projectUrl) {
    throw new Error("Supabase project URL is required when enabled.");
  }
  if (projectUrl) {
    normalizeSupabaseProjectUrl(projectUrl);
  }
}

/** @deprecated Prefer normalizeSupabaseProjectUrl. */
export function normalizeCenterServerHttpUrl(serverUrl: string): string {
  return normalizeSupabaseProjectUrl(serverUrl);
}

export function normalizeSupabaseProjectUrl(projectUrl: string): string {
  const trimmed = projectUrl.trim();
  const parsed = new URL(trimmed);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Supabase project URL must use http or https.");
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

/**
 * Pairing QR for Mobile.
 * Supabase-aware: `eco://pair?supabase=...&anon=...&code=...&token=...`
 * Legacy Center Server: `eco://pair?server=...&code=...&token=...`
 */
export function buildPairingQrPayload(input: {
  /** @deprecated Prefer supabaseUrl + anonKey for Supabase Center. */
  serverUrl?: string;
  supabaseUrl?: string;
  anonKey?: string;
  code: string;
  bootstrapToken: string;
}): string {
  const params = new URLSearchParams({
    code: input.code,
    token: input.bootstrapToken,
  });
  const supabaseUrl = (input.supabaseUrl ?? "").trim();
  const anonKey = (input.anonKey ?? "").trim();
  if (supabaseUrl && anonKey) {
    params.set("supabase", normalizeSupabaseProjectUrl(supabaseUrl));
    params.set("anon", anonKey);
  } else {
    const serverUrl = (input.serverUrl ?? input.supabaseUrl ?? "").trim();
    if (!serverUrl) {
      throw new Error("supabaseUrl+anonKey or serverUrl is required for pairing QR.");
    }
    params.set("server", normalizeSupabaseProjectUrl(serverUrl));
  }
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
  if (!value) {
    return undefined;
  }
  if (value.length <= 4) {
    return "••••";
  }
  return `${value.slice(0, 2)}••••${value.slice(-2)}`;
}

export const CENTER_SERVER_REAUTH_MESSAGE = "登录已失效，请重新登录。";

/**
 * Local connection credentials are missing (never registered, or cleared).
 * Distinct from REAUTH: the login session may be fine, but this device has
 * no refresh token / device secret to prove its identity, so it must sign in again.
 */
export const CENTER_SERVER_INCOMPLETE_CONFIG_MESSAGE = "连接配置不完整，请重新登录。";

/** Stable marker for UI i18n when Auth rejects unconfirmed email. */
export const CENTER_SERVER_EMAIL_NOT_CONFIRMED_MESSAGE = "CENTER_SERVER_EMAIL_NOT_CONFIRMED";

export type CenterServerAuthRecovery =
  | "network"
  | "device_inactive"
  | "account_unusable"
  | "relogin"
  | "unknown";

export function classifyCenterServerAuthError(message: string | undefined): CenterServerAuthRecovery {
  if (!message?.trim()) {
    return "unknown";
  }
  if (message === CENTER_SERVER_REAUTH_MESSAGE) {
    return "relogin";
  }
  // 配置不完整（缺少 deviceId/deviceSecret）不是认证错误，不应归类为 relogin
  if (message === CENTER_SERVER_INCOMPLETE_CONFIG_MESSAGE) {
    return "unknown";
  }
  const lower = message.toLowerCase();
  if (
    lower.includes("timed out") ||
    lower.includes("network request failed") ||
    lower.includes("econnrefused") ||
    lower.includes("enotfound") ||
    lower.includes("failed to fetch") ||
    lower.includes("request failed with http 5")
  ) {
    return "network";
  }
  if (
    lower.includes("token user is not active") ||
    lower.includes("refresh token subject is not active")
  ) {
    return "account_unusable";
  }
  if (
    lower.includes("device is not active") ||
    lower.includes("token device is not active") ||
    lower.includes("refresh token device is not active")
  ) {
    return "device_inactive";
  }
  if (
    lower.includes("refresh token is invalid or expired") ||
    lower.includes("invalid refresh token") ||
    lower.includes("invalid login credentials") ||
    lower.includes("credentials are missing") ||
    lower.includes("credentials are invalid") ||
    lower.includes("device credentials are invalid") ||
    lower.includes("device credentials are missing") ||
    lower.includes("user session expired") ||
    lower.includes("session missing") ||
    lower.includes("jwt expired") ||
    lower.includes("not authorized") ||
    lower.includes("unauthorized")
  ) {
    return "relogin";
  }
  return "unknown";
}

export function isCenterServerAuthCredentialError(message: string | undefined): boolean {
  const recovery = classifyCenterServerAuthError(message);
  return recovery === "relogin" || recovery === "device_inactive" || recovery === "account_unusable";
}

export function isCenterServerReloginError(message: string | undefined): boolean {
  return classifyCenterServerAuthError(message) === "relogin";
}

export function centerServerAuthRecoveryMessage(recovery: CenterServerAuthRecovery): string {
  switch (recovery) {
    case "network":
      return "无法连接服务端，请检查网络后重试。";
    case "device_inactive":
      return "设备已在服务端注销或禁用，请重新配置连接。";
    case "account_unusable":
      return "账号已停用，请联系管理员。";
    case "relogin":
      return CENTER_SERVER_REAUTH_MESSAGE;
    default:
      return "连接失败，请稍后重试。";
  }
}
