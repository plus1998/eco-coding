/**
 * Supabase Center Desktop client (Track C + D + E).
 *
 * Owns: project URL + anon key settings, Auth (signUp/signIn/refresh),
 * device registration via Edge Function `device-register`, connection status,
 * pairing / bindings / presence via PostgREST + Edge Functions, Realtime
 * Presence + `eco:bind:*` private Broadcast RPC (see supabase-realtime-rpc.ts),
 * and account settings / secrets sync + vault claim (Track E).
 *
 * Event fan-out uses MobileRemoteEventPublisher (projection / context throttling).
 *
 * The old Mongo/Redis Center Server WebSocket `/v1/rpc` client has been removed.
 */
import { createClient, type Session, type SupabaseClient, type User } from "@supabase/supabase-js";
import {
  buildPairingQrPayload,
  buildEcoAuthEmailConfirmRedirect,
  CENTER_SERVER_EMAIL_NOT_CONFIRMED_MESSAGE,
  CENTER_SERVER_REAUTH_MESSAGE,
  type CenterServerAccountAuthResult,
  type CenterServerAccountView,
  type CenterServerConnectionStatus,
  type CenterServerCreatePairingResult,
  type CenterServerDeviceBindingView,
  type CenterServerDevicePresenceView,
  type CenterServerDeviceView,
  type CenterServerRegisterDesktopRequest,
  type CenterServerRegisterDesktopResult,
  CenterServerRemoveConnectionError,
  type CenterServerRemoveConnectionOptions,
  type CenterServerRemoveConnectionResult,
  type CenterServerSettingsSnapshot,
  type CenterServerSignInRequest,
  type CenterServerSignUpRequest,
  type CenterServerSubmitVaultClaimCodeResult,
  type CenterServerSyncConfigResult,
  type CenterServerTestConnectionRequest,
  type CenterServerTestConnectionResult,
  type CenterServerVaultClaimView,
  type CenterServerVaultStatus,
  type CenterServerApproveVaultClaimResult,
  type CenterServerRequestVaultClaimResult,
  centerServerAuthRecoveryMessage,
  classifyCenterServerAuthError,
  isCenterServerAuthCredentialError,
  normalizeSupabaseProjectUrl,
  resolveSupabaseProjectUrl,
} from "../shared/center-server";
import type { EventCenterEnvelope, EventCenterJsonRpcNotification } from "../shared/event-center";
import type { CenterServerSettingsSecret, CenterServerStore } from "./center-server-store";
import {
  collectDesktopDeviceProfile,
  defaultDesktopDeviceName,
  desktopDeviceMetadata,
} from "./desktop-device-profile";
import type { DesktopEventCenter, DesktopEventCenterSink } from "./event-center";
import { SupabaseRealtimeRpc } from "./supabase-realtime-rpc";
import {
  markDeviceVaultSynced,
  SettingsSyncConflictError,
  SettingsSyncVaultDecryptError,
  SettingsSyncVaultRequiredError,
  syncAccountConfig,
  type SettingsSyncHooks,
} from "./supabase-settings-sync";
import {
  accountHasCloudVaultMaterial,
  beginApproveVaultClaim,
  cancelVaultClaim,
  countOnlineVaultSyncedPeers,
  createVaultClaim,
  listPendingVaultClaims,
  startVaultClaimApproverSession,
  submitVaultClaimCodeAndReceiveKey,
  VaultClaimError,
} from "./supabase-vault-claim";
import { MobileRemoteEventPublisher } from "./mobile-remote-event-publisher";

type FetchLike = typeof fetch;

export interface SupabaseCenterDesktopClientOptions {
  store: CenterServerStore;
  eventCenter: DesktopEventCenter;
  fetch?: FetchLike;
  now?: () => Date;
  log?: (message: string) => void;
  onStatusChange?: (snapshot: CenterServerSettingsSnapshot) => void;
  /** Optional hooks for pushing/pulling provider/ASR/image settings + secrets. */
  settingsSyncHooks?: SettingsSyncHooks;
  /** Test/integration seam; production defaults to SupabaseRealtimeRpc. */
  realtimeFactory?: (options: SupabaseRealtimeRpcOptions) => CenterRealtimeTransport;
}

interface SupabaseRealtimeRpcOptions {
  client: SupabaseClient;
  eventCenter: DesktopEventCenter;
  log: (message: string) => void;
  now: () => Date;
}

interface CenterRealtimeTransport {
  start(input: { userId: string; deviceId: string }): Promise<void>;
  stop(): Promise<void>;
  syncBindings(bindings: readonly CenterServerDeviceBindingView[]): Promise<void>;
  publishNotification(notification: EventCenterJsonRpcNotification): void;
  listOnlineDeviceIds(): ReadonlySet<string>;
}

interface DeviceRegisterResponse {
  device: CenterServerDeviceView;
  deviceSecret: string;
}

const DEVICE_REGISTER_FUNCTION = "device-register";
const DEVICE_DISABLE_FUNCTION = "device-disable";
const PAIRING_CREATE_FUNCTION = "pairing-create";
const BINDINGS_REFRESH_INTERVAL_MS = 60_000;
/** Poll pending vault claims so approvers see requests without the requester being online. */
const VAULT_CLAIMS_REFRESH_INTERVAL_MS = 20_000;

/** Module singleton for Realtime / other modules to share the same client. */
let activeSupabaseClient: SupabaseClient | undefined;

export function getSupabaseClient(): SupabaseClient | undefined {
  return activeSupabaseClient;
}

export class SupabaseCenterDesktopClient implements DesktopEventCenterSink {
  private readonly store: CenterServerStore;
  private readonly eventCenter: DesktopEventCenter;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;
  private readonly log: (message: string) => void;
  private readonly onStatusChange: ((snapshot: CenterServerSettingsSnapshot) => void) | undefined;
  private readonly realtimeFactory: (options: SupabaseRealtimeRpcOptions) => CenterRealtimeTransport;
  private readonly unsubscribe: () => void;
  private settingsSyncHooks: SettingsSyncHooks | undefined;
  private supabase: SupabaseClient | undefined;
  private realtime: CenterRealtimeTransport | undefined;
  private readonly remotePublisher: MobileRemoteEventPublisher;
  private bindingsRefreshTimer: ReturnType<typeof setInterval> | undefined;
  private vaultClaimsRefreshTimer: ReturnType<typeof setInterval> | undefined;
  private intentionallyStopped = true;
  private connectInFlight: Promise<void> | undefined;
  private status: CenterServerConnectionStatus = { state: "disabled" };
  private vaultStatus: CenterServerVaultStatus = { hasVaultKey: false, state: "idle" };
  private pendingClaimPrivateKey: string | undefined;
  private pendingClaimId: string | undefined;
  private approverSessionStop: (() => Promise<void>) | undefined;
  private approvalCode: string | undefined;
  private approvalClaimId: string | undefined;

  constructor(options: SupabaseCenterDesktopClientOptions) {
    this.store = options.store;
    this.eventCenter = options.eventCenter;
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.log = options.log ?? (() => {});
    this.onStatusChange = options.onStatusChange;
    this.realtimeFactory =
      options.realtimeFactory ?? ((realtimeOptions) => new SupabaseRealtimeRpc(realtimeOptions));
    this.settingsSyncHooks = options.settingsSyncHooks;
    this.remotePublisher = new MobileRemoteEventPublisher({
      deliver: (notification) => {
        this.realtime?.publishNotification(notification);
      },
      shouldDeliver: () => Boolean(this.realtime),
    });
    this.unsubscribe = this.eventCenter.subscribe(this);
    const pendingClaim = this.store.getPendingVaultClaim?.();
    this.pendingClaimId = pendingClaim?.claimId;
    this.pendingClaimPrivateKey = pendingClaim?.requesterPrivateKey;
    this.refreshVaultStatusFromStore();
  }

  setSettingsSyncHooks(hooks: SettingsSyncHooks | undefined): void {
    this.settingsSyncHooks = hooks;
  }

  /**
   * Forward EventCenter notifications over Realtime bind channels
   * (with projection / context / usage throttling).
   */
  publish(envelope: EventCenterEnvelope, notification: EventCenterJsonRpcNotification): void {
    const settings = this.store.getSettingsWithSecrets();
    if (!settings.enabled) {
      return;
    }
    this.remotePublisher.publish(envelope, notification);
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
    void this.clearVaultClaimSessions();
    this.teardownClient();
    this.setStatus({ state: "disconnected", lastDisconnectedAt: this.now().toISOString() });
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
    const refreshToken = request.refreshToken?.trim() ?? "";
    if (!refreshToken) {
      throw new Error("A refresh token is required. Sign in or sign up so Eco can store a renewing session.");
    }
    const { supabaseUrl, anonKey } = this.requireProjectCredentialsOrStored(request);
    const profile = collectDesktopDeviceProfile();
    const deviceName = request.deviceName.trim() || defaultDesktopDeviceName(profile);
    const client = this.createEphemeralClient(supabaseUrl, anonKey);
    const registered = await this.invokeDeviceRegister(client, request.userAccessToken, deviceName);
    return this.persistRegisteredDevice({
      supabaseUrl,
      anonKey,
      accessToken: request.userAccessToken,
      refreshToken,
      accessTokenExpiresAt: "",
      device: registered.device,
      deviceSecret: registered.deviceSecret,
    });
  }

  async signUpAndRegisterDesktop(request: CenterServerSignUpRequest): Promise<CenterServerAccountAuthResult> {
    this.stop();
    const { supabaseUrl, anonKey } = this.requireProjectCredentialsOrStored(request);
    // Persist project credentials even when email confirmation is required,
    // so the user can sign in afterwards without re-entering the anon key.
    if (anonKey) {
      this.store.saveSettings({
        enabled: this.store.getSettingsWithSecrets().enabled,
        supabaseUrl,
        anonKey,
        deviceName:
          request.deviceName.trim() ||
          this.store.getSettingsWithSecrets().deviceName ||
          defaultDesktopDeviceName(collectDesktopDeviceProfile()),
      });
    }

    const client = this.createEphemeralClient(supabaseUrl, anonKey);
    const { data, error } = await client.auth.signUp({
      email: request.email.trim(),
      password: request.password,
      options: {
        ...(request.displayName?.trim() ? { data: { display_name: request.displayName.trim() } } : {}),
        emailRedirectTo: buildEcoAuthEmailConfirmRedirect(supabaseUrl),
      },
    });
    if (error) {
      throw new Error(error.message);
    }
    const session = data.session;
    const user = data.user;
    if (!session || !user) {
      const email = request.email.trim();
      return {
        emailConfirmationRequired: true,
        email,
        ...this.getSnapshot(),
      };
    }
    return this.registerAfterAuth({
      supabaseUrl,
      anonKey,
      session,
      user,
      deviceName: request.deviceName,
    });
  }

  async signInAndRegisterDesktop(request: CenterServerSignInRequest): Promise<CenterServerAccountAuthResult> {
    this.stop();
    const { supabaseUrl, anonKey } = this.requireProjectCredentialsOrStored(request);
    const client = this.createEphemeralClient(supabaseUrl, anonKey);
    const { data, error } = await client.auth.signInWithPassword({
      email: request.email.trim(),
      password: request.password,
    });
    if (error) {
      const message = error.message;
      if (/email\s*not\s*confirmed/i.test(message) || error.code === "email_not_confirmed") {
        throw new Error(CENTER_SERVER_EMAIL_NOT_CONFIRMED_MESSAGE);
      }
      throw new Error(message);
    }
    if (!data.session || !data.user) {
      throw new Error("Sign-in succeeded but no session was returned.");
    }
    return this.registerAfterAuth({
      supabaseUrl,
      anonKey,
      session: data.session,
      user: data.user,
      deviceName: request.deviceName,
    });
  }

  async createPairing(): Promise<CenterServerCreatePairingResult> {
    const settings = this.store.getSettingsWithSecrets();
    if (!settings.deviceId || !settings.deviceSecret) {
      throw new Error(CENTER_SERVER_REAUTH_MESSAGE);
    }
    if (!settings.supabaseUrl || !settings.anonKey) {
      throw new Error("Supabase project URL and anon key are required.");
    }
    const client = this.supabase ?? this.createEphemeralClient(settings.supabaseUrl, settings.anonKey);
    const accessToken = await this.ensureAccessToken(settings, client);
    const { data, error } = await client.functions.invoke(PAIRING_CREATE_FUNCTION, {
      headers: { authorization: `Bearer ${accessToken}` },
      body: {
        desktopDeviceId: settings.deviceId,
        deviceSecret: settings.deviceSecret,
      },
    });
    if (error) {
      throw new Error(
        isMissingEdgeFunctionError(error.message)
          ? `Edge Function "${PAIRING_CREATE_FUNCTION}" is not deployed. ${error.message}`
          : error.message,
      );
    }
    const created = parsePairingCreateResponse(data);
    const result: CenterServerCreatePairingResult = {
      ...created,
      qrPayload: buildPairingQrPayload({
        supabaseUrl: settings.supabaseUrl,
        anonKey: settings.anonKey,
        code: created.code,
        bootstrapToken: created.bootstrapToken,
      }),
    };
    void this.refreshRealtimeBindings().catch((refreshError) => {
      this.log(`[eco] bindings refresh after pairing failed: ${errorMessage(refreshError)}\n`);
    });
    return result;
  }

  async listBindings(): Promise<CenterServerDeviceBindingView[]> {
    const settings = this.store.getSettingsWithSecrets();
    if (!settings.deviceId) {
      throw new Error(CENTER_SERVER_REAUTH_MESSAGE);
    }
    const client = this.requireClient(settings);
    await this.ensureAccessToken(settings, client);
    return this.fetchBindingsForDesktop(client, settings.deviceId, { activeOnly: false });
  }

  async listPresence(): Promise<CenterServerDevicePresenceView[]> {
    const settings = this.store.getSettingsWithSecrets();
    const client = this.requireClient(settings);
    await this.ensureAccessToken(settings, client);
    const {
      data: { session },
      error: sessionError,
    } = await client.auth.getSession();
    if (sessionError) {
      throw new Error(sessionError.message);
    }
    const userId = session?.user.id;
    if (!userId) {
      throw new Error(CENTER_SERVER_REAUTH_MESSAGE);
    }

    const { data, error } = await client
      .from("devices_public")
      .select("id, user_id, kind, name, metadata, created_at, last_seen_at, disabled_at, vault_synced_at")
      .order("created_at", { ascending: true });
    if (error) {
      throw new Error(error.message);
    }

    const onlineFromPresence = this.realtime?.listOnlineDeviceIds() ?? new Set<string>();
    return (data ?? []).map((row): CenterServerDevicePresenceView => {
      const device = parseDeviceRow(row);
      const connectedAt = onlineFromPresence.has(device.id) ? device.lastSeenAt : null;
      return {
        ...device,
        online: onlineFromPresence.has(device.id),
        ...(connectedAt ? { connectedAt } : {}),
      };
    });
  }

  async revokeBinding(bindingId: string): Promise<CenterServerDeviceBindingView> {
    const trimmed = bindingId.trim();
    if (!trimmed) {
      throw new Error("bindingId is required.");
    }
    const settings = this.store.getSettingsWithSecrets();
    const client = this.requireClient(settings);
    await this.ensureAccessToken(settings, client);
    const revokedAt = this.now().toISOString();
    const { data, error } = await client
      .from("device_bindings")
      .update({ revoked_at: revokedAt })
      .eq("id", trimmed)
      .select("id, user_id, desktop_device_id, mobile_device_id, capabilities, created_at, revoked_at")
      .single();
    if (error) {
      throw new Error(error.message);
    }
    const binding = parseBindingRow(data);
    void this.refreshRealtimeBindings().catch((refreshError) => {
      this.log(`[eco] bindings refresh after revoke failed: ${errorMessage(refreshError)}\n`);
    });
    return binding;
  }

  async testConnection(
    request: CenterServerTestConnectionRequest,
  ): Promise<CenterServerTestConnectionResult> {
    try {
      const supabaseUrl = resolveSupabaseProjectUrl(request);
      let anonKey = request.anonKey?.trim() ?? "";
      if (!supabaseUrl) {
        throw new Error("Supabase project URL is required.");
      }
      if (!anonKey) {
        const stored = this.store.getSettingsWithSecrets();
        if (
          stored.anonKey &&
          normalizeSupabaseProjectUrl(stored.supabaseUrl || stored.serverUrl) ===
            normalizeSupabaseProjectUrl(supabaseUrl)
        ) {
          anonKey = stored.anonKey;
        }
      }
      if (!anonKey) {
        throw new Error("Supabase anon key is required.");
      }
      const healthUrl = new URL("/auth/v1/health", `${normalizeSupabaseProjectUrl(supabaseUrl)}/`);
      const response = await this.fetchImpl(healthUrl, {
        method: "GET",
        headers: {
          apikey: anonKey,
          authorization: `Bearer ${anonKey}`,
        },
      });
      if (!response.ok) {
        throw new Error(`Supabase Auth health check failed with HTTP ${response.status}.`);
      }
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

    if (!forceLocal && settings.deviceId && settings.supabaseUrl && settings.anonKey) {
      try {
        const accessToken = await this.ensureAccessToken(settings);
        const client = this.createEphemeralClient(settings.supabaseUrl, settings.anonKey);
        await this.invokeDeviceDisable(client, accessToken, settings.deviceId);
      } catch (error) {
        const message = errorMessage(error);
        const recovery = classifyCenterServerAuthError(message);
        // Edge Function may not exist yet (Track A gap).
        if (isMissingEdgeFunctionError(message)) {
          notice =
            "device-disable Edge Function is not available; cleared local connection only. Server device row may remain.";
        } else if (recovery === "device_inactive") {
          notice = centerServerAuthRecoveryMessage(recovery);
        } else {
          throw new CenterServerRemoveConnectionError(message, recovery);
        }
      }
    }

    await this.clearVaultClaimSessions();
    this.store.clearConnection();
    this.refreshVaultStatusFromStore();
    this.setStatus({ state: "disabled" });
    const snapshot = this.getSnapshot();
    return notice ? { ...snapshot, notice } : snapshot;
  }

  getVaultStatus(): CenterServerVaultStatus {
    return { ...this.vaultStatus, hasVaultKey: this.store.getVaultKey().length > 0 };
  }

  async syncConfig(mode: "pull" | "push" | "reconcile" = "reconcile"): Promise<CenterServerSyncConfigResult> {
    const settings = this.store.getSettingsWithSecrets();
    const client = this.requireClient(settings);
    await this.ensureAccessToken(settings, client);
    const userId = await this.requireUserId(client);
    if (!settings.deviceId) {
      throw new Error(CENTER_SERVER_REAUTH_MESSAGE);
    }
    if (!this.settingsSyncHooks) {
      throw new Error("Settings sync hooks are not configured.");
    }

    const { error: _previousError, ...currentVaultStatus } = this.getVaultStatus();
    this.setVaultStatus({
      ...currentVaultStatus,
      state: "syncing",
    });

    try {
      const hasVaultKey = this.store.getVaultKey().length > 0;
      const result = await syncAccountConfig({
        client,
        userId,
        deviceId: settings.deviceId,
        getVaultKey: () => this.store.getVaultKey(),
        saveVaultKey: (vaultKey) => this.store.saveVaultKey(vaultKey),
        hooks: this.settingsSyncHooks,
        allowCreateVaultKey:
          mode !== "pull" && (hasVaultKey || (await this.shouldBootstrapVaultKey(client, settings.deviceId))),
        mode,
      });
      if (!result.needsUserChoice) {
        this.store.markSettingsSynced(result.syncedAt);
      }
      const status = {
        ...this.buildVaultStatusAfterSync(),
        ...(result.needsUserChoice ? { needsSyncChoice: true as const } : {}),
      };
      this.setVaultStatus(status);
      this.onStatusChange?.(this.getSnapshot());
      return {
        mode: result.mode,
        settingsPushed: result.settingsPushed,
        settingsPulled: result.settingsPulled,
        secretsPushed: result.secretsPushed,
        secretsPulled: result.secretsPulled,
        syncedAt: result.syncedAt,
        vaultStatus: status,
        ...(result.needsUserChoice ? { needsUserChoice: true } : {}),
        ...(result.vaultMarkFailed ? { vaultMarkFailed: result.vaultMarkFailed } : {}),
        ...(result.secretsSkipped ? { secretsSkipped: result.secretsSkipped } : {}),
      };
    } catch (error) {
      if (error instanceof SettingsSyncVaultRequiredError) {
        this.setVaultStatus({
          hasVaultKey: false,
          state: "needs_claim",
          error: error.code,
          hint: "Authorize this device before syncing. Settings and API keys are applied together.",
        });
        throw error;
      }
      if (error instanceof SettingsSyncVaultDecryptError) {
        this.setVaultStatus({
          ...this.getVaultStatus(),
          state: "error",
          error: error.message,
          hint: "The vault key was retained. No settings or API keys were applied; inspect the reported cloud secret before explicitly reauthorizing or resetting the vault.",
        });
        throw error;
      }
      const message =
        error instanceof SettingsSyncConflictError || error instanceof VaultClaimError
          ? error.message
          : errorMessage(error);
      const code =
        error instanceof SettingsSyncConflictError || error instanceof VaultClaimError
          ? error.code
          : undefined;
      this.setVaultStatus({
        ...this.getVaultStatus(),
        state: "error",
        error: code ? `${code}: ${message}` : message,
      });
      throw error;
    }
  }

  async requestVaultClaim(): Promise<CenterServerRequestVaultClaimResult> {
    const settings = this.store.getSettingsWithSecrets();
    if (settings.vaultKey) {
      throw new Error("This device already has a vault key.");
    }
    if (this.pendingClaimId && this.pendingClaimPrivateKey) {
      throw new Error("A vault claim is already active. Cancel it before requesting another.");
    }
    const client = this.requireClient(settings);
    await this.ensureAccessToken(settings, client);
    const userId = await this.requireUserId(client);
    if (!settings.deviceId) {
      throw new Error(CENTER_SERVER_REAUTH_MESSAGE);
    }

    const online = this.realtime?.listOnlineDeviceIds() ?? new Set<string>();
    const created = await createVaultClaim({
      client,
      userId,
      requesterDeviceId: settings.deviceId,
      onlineDeviceIds: online,
      now: this.now,
    });
    this.pendingClaimId = created.claim.id;
    this.pendingClaimPrivateKey = created.requesterPrivateKey;
    this.store.savePendingVaultClaim(created.claim.id, created.requesterPrivateKey);
    const { error: _previousError, ...currentVaultStatus } = this.getVaultStatus();
    this.setVaultStatus({
      ...currentVaultStatus,
      state: "claim_pending",
      activeClaimId: created.claim.id,
      hint: "Request sent. Open Eco on a device that already has your synced secrets, approve the request, then enter the 6-digit code here.",
    });
    return { claimId: created.claim.id, expiresAt: created.claim.expiresAt };
  }

  async listPendingVaultClaims(): Promise<CenterServerVaultClaimView[]> {
    const settings = this.store.getSettingsWithSecrets();
    const client = this.requireClient(settings);
    await this.ensureAccessToken(settings, client);
    const claims = await listPendingVaultClaims(client, this.now);
    return claims.map((claim) => ({
      id: claim.id,
      requesterDeviceId: claim.requesterDeviceId,
      status: claim.status,
      expiresAt: claim.expiresAt,
      createdAt: claim.createdAt,
      approverDeviceId: claim.approverDeviceId,
    }));
  }

  async approveVaultClaim(claimId: string): Promise<CenterServerApproveVaultClaimResult> {
    const settings = this.store.getSettingsWithSecrets();
    const vaultKey = settings.vaultKey;
    if (!vaultKey) {
      throw new Error("This device does not have a vault key to share.");
    }
    if (!settings.deviceId) {
      throw new Error(CENTER_SERVER_REAUTH_MESSAGE);
    }
    const client = this.requireClient(settings);
    await this.ensureAccessToken(settings, client);

    if (this.approverSessionStop) {
      await this.approverSessionStop();
      this.approverSessionStop = undefined;
    }

    const started = await beginApproveVaultClaim({
      client,
      claimId,
      approverDeviceId: settings.deviceId,
    });
    const session = await startVaultClaimApproverSession({
      client,
      claimId,
      approverDeviceId: settings.deviceId,
      vaultKey,
      log: this.log,
    });
    this.approverSessionStop = session.stop;
    this.approvalCode = started.code;
    this.approvalClaimId = claimId;
    const { error: _previousError, ...currentVaultStatus } = this.getVaultStatus();
    this.setVaultStatus({
      ...currentVaultStatus,
      approvalCode: started.code,
      approvalClaimId: claimId,
    });
    return {
      claimId,
      code: started.code,
      expiresAt: started.claim.expiresAt,
    };
  }

  async submitVaultClaimCode(code: string): Promise<CenterServerSubmitVaultClaimCodeResult> {
    const settings = this.store.getSettingsWithSecrets();
    if (settings.vaultKey) {
      throw new Error("This device already has a vault key.");
    }
    if (!this.pendingClaimId || !this.pendingClaimPrivateKey || !settings.deviceId) {
      throw new Error("No active vault claim. Request a claim first.");
    }
    const client = this.requireClient(settings);
    await this.ensureAccessToken(settings, client);

    try {
      const vaultKey = await submitVaultClaimCodeAndReceiveKey({
        client,
        claimId: this.pendingClaimId,
        requesterDeviceId: settings.deviceId,
        requesterPrivateKey: this.pendingClaimPrivateKey,
        code,
      });
      this.store.saveVaultKey(vaultKey);
      const claimId = this.pendingClaimId;
      this.pendingClaimId = undefined;
      this.pendingClaimPrivateKey = undefined;
      this.store.clearPendingVaultClaim();
      if (this.settingsSyncHooks) {
        await this.syncConfig("pull");
      } else {
        await markDeviceVaultSynced(client, settings.deviceId);
        this.setVaultStatus({
          hasVaultKey: true,
          state: "ready",
          lastSyncedAt: this.now().toISOString(),
        });
      }
      return { claimId, hasVaultKey: true };
    } catch (error) {
      if (error instanceof VaultClaimError) {
        this.setVaultStatus({
          ...this.getVaultStatus(),
          state: "error",
          error: error.message,
        });
      }
      throw error;
    }
  }

  async cancelActiveVaultClaim(): Promise<void> {
    const claimId = this.pendingClaimId;
    if (!claimId) {
      return;
    }
    const settings = this.store.getSettingsWithSecrets();
    try {
      const client = this.requireClient(settings);
      await this.ensureAccessToken(settings, client);
      await cancelVaultClaim(client, claimId);
    } catch (error) {
      this.log(`[eco] cancel vault claim failed: ${errorMessage(error)}\n`);
    }
    this.pendingClaimId = undefined;
    this.pendingClaimPrivateKey = undefined;
    this.store.clearPendingVaultClaim();
    this.refreshVaultStatusFromStore();
  }

  private async shouldBootstrapVaultKey(client: SupabaseClient, selfDeviceId: string): Promise<boolean> {
    try {
      // Cloud already has vault material (synced device or user_secrets) → never mint a
      // second vault_key; decrypt would fail with OperationError and overwrite risk is high.
      if (await accountHasCloudVaultMaterial(client)) {
        return false;
      }
      const { data, error } = await client
        .from("devices_public")
        .select("id, vault_synced_at")
        .not("vault_synced_at", "is", null)
        .is("disabled_at", null);
      if (error) {
        throw new Error(error.message);
      }
      const others = (data ?? []).filter((row) => row.id !== selfDeviceId);
      return others.length === 0;
    } catch (error) {
      this.log(`[eco] vault bootstrap check failed: ${errorMessage(error)}\n`);
      return false;
    }
  }

  private buildVaultStatusAfterSync(): CenterServerVaultStatus {
    const hasVaultKey = this.store.getVaultKey().length > 0;
    const lastSyncedAt = this.store.getSettings().settings.lastSettingsSyncedAt;
    if (hasVaultKey) {
      return {
        hasVaultKey: true,
        state: "ready",
        ...(lastSyncedAt ? { lastSyncedAt } : {}),
        ...(typeof this.vaultStatus.pendingClaimCount === "number"
          ? { pendingClaimCount: this.vaultStatus.pendingClaimCount }
          : {}),
      };
    }
    return {
      hasVaultKey: false,
      state: this.pendingClaimId ? "claim_pending" : "needs_claim",
      ...(this.pendingClaimId ? { activeClaimId: this.pendingClaimId } : {}),
      hint: this.pendingClaimId
        ? "Waiting for another device to approve. It does not need to have been online when you requested."
        : "Request authorization when ready. Approve later on a device that already synced secrets.",
    };
  }

  private refreshVaultStatusFromStore(): void {
    const hasVaultKey = this.store.getVaultKey().length > 0;
    const lastSyncedAt = this.store.getSettings().settings.lastSettingsSyncedAt;
    const pendingClaimCount = this.vaultStatus?.pendingClaimCount;
    this.vaultStatus = {
      hasVaultKey,
      state: hasVaultKey ? "ready" : this.pendingClaimId ? "claim_pending" : "idle",
      ...(lastSyncedAt ? { lastSyncedAt } : {}),
      ...(this.pendingClaimId ? { activeClaimId: this.pendingClaimId } : {}),
      ...(this.approvalCode ? { approvalCode: this.approvalCode } : {}),
      ...(this.approvalClaimId ? { approvalClaimId: this.approvalClaimId } : {}),
      ...(typeof pendingClaimCount === "number" ? { pendingClaimCount } : {}),
    };
  }

  private setVaultStatus(status: CenterServerVaultStatus): void {
    this.vaultStatus = status;
    this.onStatusChange?.(this.getSnapshot());
  }

  private async clearVaultClaimSessions(): Promise<void> {
    if (this.approverSessionStop) {
      try {
        await this.approverSessionStop();
      } catch {
        // ignore
      }
      this.approverSessionStop = undefined;
    }
    this.approvalCode = undefined;
    this.approvalClaimId = undefined;
  }

  private async requireUserId(client: SupabaseClient): Promise<string> {
    const { data, error } = await client.auth.getSession();
    if (error) {
      throw new Error(error.message);
    }
    const userId = data.session?.user.id;
    if (!userId) {
      throw new Error(CENTER_SERVER_REAUTH_MESSAGE);
    }
    return userId;
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
    if (!settings.supabaseUrl.trim()) {
      const message = "Supabase project URL is required.";
      this.failConnection(message);
      throw new Error(message);
    }
    if (!settings.anonKey.trim()) {
      const message = "Supabase anon key is required.";
      this.failConnection(message);
      throw new Error(message);
    }
    if (!settings.deviceId || !settings.deviceSecret) {
      const message = CENTER_SERVER_REAUTH_MESSAGE;
      this.failConnection(message);
      throw new Error(message);
    }

    this.setStatus({ state: "connecting" });

    try {
      const client = this.createPersistentClient(settings.supabaseUrl, settings.anonKey);
      await this.ensureAccessToken(settings, client);
      if (this.intentionallyStopped) {
        throw new Error("Connection aborted.");
      }

      const { data, error } = await client.auth.getSession();
      if (error) {
        throw new Error(error.message);
      }
      if (!data.session?.user?.id) {
        throw new Error(CENTER_SERVER_REAUTH_MESSAGE);
      }

      const userId = data.session.user.id;
      const deviceId = settings.deviceId;
      const bindings = await this.fetchBindingsForDesktop(client, deviceId, { activeOnly: true });

      this.realtime = this.realtimeFactory({
        client,
        eventCenter: this.eventCenter,
        log: this.log,
        now: this.now,
      });
      await this.realtime.start({ userId, deviceId });
      await this.realtime.syncBindings(bindings);
      this.startBindingsRefreshLoop();
      this.startVaultClaimsRefreshLoop();

      const connectedAt = this.now().toISOString();
      this.store.markConnected(connectedAt);
      this.setStatus({ state: "connected", connectedAt });

      if (this.settingsSyncHooks) {
        void this.syncConfig("reconcile")
          .then(async () => {
            if (this.store.getVaultKey()) {
              await this.refreshPendingVaultClaimCount(client);
              return;
            }
            const hasPeer = await accountHasCloudVaultMaterial(client);
            const online = this.realtime?.listOnlineDeviceIds() ?? new Set<string>();
            const peerCount = await countOnlineVaultSyncedPeers({
              client,
              selfDeviceId: deviceId,
              onlineDeviceIds: online,
            });
            this.setVaultStatus({
              hasVaultKey: false,
              state: this.pendingClaimId ? "claim_pending" : "needs_claim",
              syncedPeerOnline: peerCount > 0,
              ...(this.pendingClaimId ? { activeClaimId: this.pendingClaimId } : {}),
              ...(!hasPeer ? { error: "vault_no_synced_device" } : {}),
              ...(hasPeer
                ? {
                    hint: "Request authorization when ready. The other device does not need to be online right now — open Eco there later to approve.",
                  }
                : {}),
            });
          })
          .catch((syncError) => {
            this.log(`[eco] settings sync after connect failed: ${errorMessage(syncError)}\n`);
          });
      } else {
        this.refreshVaultStatusFromStore();
      }
    } catch (error) {
      this.stopBindingsRefreshLoop();
      this.stopVaultClaimsRefreshLoop();
      if (this.realtime) {
        void this.realtime.stop().catch(() => {});
        this.realtime = undefined;
      }
      const message = errorMessage(error);
      if (this.status.state === "connecting") {
        this.failConnection(message);
      }
      if (!this.intentionallyStopped && !isCenterServerAuthCredentialError(message)) {
        // Soft reconnect is still limited; Realtime channel callbacks log channel errors.
      }
    }
  }

  private async registerAfterAuth(input: {
    supabaseUrl: string;
    anonKey: string;
    session: Session;
    user: User;
    deviceName: string;
  }): Promise<CenterServerAccountAuthResult> {
    const profile = collectDesktopDeviceProfile();
    const deviceName = input.deviceName.trim() || defaultDesktopDeviceName(profile);
    const client = this.createEphemeralClient(input.supabaseUrl, input.anonKey);
    const registered = await this.invokeDeviceRegister(client, input.session.access_token, deviceName);
    const persisted = await this.persistRegisteredDevice({
      supabaseUrl: input.supabaseUrl,
      anonKey: input.anonKey,
      accessToken: input.session.access_token,
      refreshToken: input.session.refresh_token,
      accessTokenExpiresAt: expiresAtIso(input.session.expires_at),
      device: registered.device,
      deviceSecret: registered.deviceSecret,
    });
    return {
      ...persisted,
      user: toAccountView(input.user),
    };
  }

  private async persistRegisteredDevice(input: {
    supabaseUrl: string;
    anonKey: string;
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresAt: string;
    device: CenterServerDeviceView;
    deviceSecret: string;
  }): Promise<CenterServerRegisterDesktopResult> {
    this.store.saveSettings({
      enabled: true,
      supabaseUrl: input.supabaseUrl,
      anonKey: input.anonKey,
      deviceId: input.device.id,
      deviceName: input.device.name,
      deviceSecret: input.deviceSecret,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      accessTokenExpiresAt: input.accessTokenExpiresAt,
    });
    await this.reload();
    return {
      settings: this.store.getSettingsWithSecrets(),
      status: this.status,
      device: input.device,
    };
  }

  private async ensureAccessToken(
    settings: CenterServerSettingsSecret,
    client?: SupabaseClient,
  ): Promise<string> {
    if (settings.accessToken && tokenStillValid(settings.accessTokenExpiresAt, this.now())) {
      if (client && settings.refreshToken) {
        const { error } = await client.auth.setSession({
          access_token: settings.accessToken,
          refresh_token: settings.refreshToken,
        });
        if (error) {
          this.log(`[eco] supabase setSession failed: ${error.message}\n`);
        }
      }
      return settings.accessToken;
    }

    if (!settings.refreshToken) {
      throw new Error(CENTER_SERVER_REAUTH_MESSAGE);
    }

    const supabase = client ?? this.createEphemeralClient(settings.supabaseUrl, settings.anonKey);
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: settings.refreshToken,
    });
    if (error || !data.session) {
      this.store.clearRefreshToken();
      throw new Error(error?.message ?? CENTER_SERVER_REAUTH_MESSAGE);
    }

    this.store.saveTokens({
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      accessTokenExpiresAt: expiresAtIso(data.session.expires_at),
    });
    return data.session.access_token;
  }

  private async invokeDeviceRegister(
    client: SupabaseClient,
    accessToken: string,
    deviceName: string,
  ): Promise<DeviceRegisterResponse> {
    const profile = collectDesktopDeviceProfile();
    const { data, error } = await client.functions.invoke(DEVICE_REGISTER_FUNCTION, {
      headers: { authorization: `Bearer ${accessToken}` },
      body: {
        kind: "desktop",
        name: deviceName,
        metadata: desktopDeviceMetadata(profile),
      },
    });
    if (error) {
      throw new Error(
        isMissingEdgeFunctionError(error.message)
          ? `Edge Function "${DEVICE_REGISTER_FUNCTION}" is not deployed (Track A). ${error.message}`
          : error.message,
      );
    }
    return parseDeviceRegisterResponse(data);
  }

  private async invokeDeviceDisable(
    client: SupabaseClient,
    accessToken: string,
    deviceId: string,
  ): Promise<void> {
    const { error } = await client.functions.invoke(DEVICE_DISABLE_FUNCTION, {
      headers: { authorization: `Bearer ${accessToken}` },
      body: { deviceId },
    });
    if (error) {
      throw new Error(error.message);
    }
  }

  private requireProjectCredentialsOrStored(input: {
    supabaseUrl?: string;
    serverUrl?: string;
    anonKey?: string;
  }): { supabaseUrl: string; anonKey: string } {
    const supabaseUrl = resolveSupabaseProjectUrl(input);
    let anonKey = input.anonKey?.trim() ?? "";
    if (!supabaseUrl) {
      throw new Error("Supabase project URL is required.");
    }
    if (!anonKey) {
      const stored = this.store.getSettingsWithSecrets();
      if (
        stored.anonKey &&
        normalizeSupabaseProjectUrl(stored.supabaseUrl || stored.serverUrl) ===
          normalizeSupabaseProjectUrl(supabaseUrl)
      ) {
        anonKey = stored.anonKey;
      }
    }
    if (!anonKey) {
      throw new Error("Supabase anon key is required.");
    }
    return { supabaseUrl, anonKey };
  }

  private createPersistentClient(supabaseUrl: string, anonKey: string): SupabaseClient {
    this.teardownClient();
    const client = createBrowserlessClient(supabaseUrl, anonKey, this.fetchImpl);
    this.supabase = client;
    activeSupabaseClient = client;
    return client;
  }

  private createEphemeralClient(supabaseUrl: string, anonKey: string): SupabaseClient {
    return createBrowserlessClient(supabaseUrl, anonKey, this.fetchImpl);
  }

  private teardownClient(): void {
    this.stopBindingsRefreshLoop();
    this.stopVaultClaimsRefreshLoop();
    this.remotePublisher.reset();
    const realtime = this.realtime;
    this.realtime = undefined;
    if (realtime) {
      void realtime.stop().catch((error) => {
        this.log(`[eco] realtime stop failed: ${errorMessage(error)}\n`);
      });
    }
    if (this.supabase && activeSupabaseClient === this.supabase) {
      activeSupabaseClient = undefined;
    }
    this.supabase = undefined;
  }

  private requireClient(settings: CenterServerSettingsSecret): SupabaseClient {
    if (this.supabase) {
      return this.supabase;
    }
    if (!settings.supabaseUrl || !settings.anonKey) {
      throw new Error("Supabase project URL and anon key are required.");
    }
    return this.createEphemeralClient(settings.supabaseUrl, settings.anonKey);
  }

  private startBindingsRefreshLoop(): void {
    this.stopBindingsRefreshLoop();
    this.bindingsRefreshTimer = setInterval(() => {
      void this.refreshRealtimeBindings().catch((error) => {
        this.log(`[eco] periodic bindings refresh failed: ${errorMessage(error)}\n`);
      });
    }, BINDINGS_REFRESH_INTERVAL_MS);
  }

  private stopBindingsRefreshLoop(): void {
    if (this.bindingsRefreshTimer) {
      clearInterval(this.bindingsRefreshTimer);
      this.bindingsRefreshTimer = undefined;
    }
  }

  private startVaultClaimsRefreshLoop(): void {
    this.stopVaultClaimsRefreshLoop();
    this.vaultClaimsRefreshTimer = setInterval(() => {
      void this.refreshPendingVaultClaimCount().catch((error) => {
        this.log(`[eco] periodic vault claims refresh failed: ${errorMessage(error)}\n`);
      });
    }, VAULT_CLAIMS_REFRESH_INTERVAL_MS);
    void this.refreshPendingVaultClaimCount().catch((error) => {
      this.log(`[eco] initial vault claims refresh failed: ${errorMessage(error)}\n`);
    });
  }

  private stopVaultClaimsRefreshLoop(): void {
    if (this.vaultClaimsRefreshTimer) {
      clearInterval(this.vaultClaimsRefreshTimer);
      this.vaultClaimsRefreshTimer = undefined;
    }
  }

  private async refreshPendingVaultClaimCount(client?: SupabaseClient): Promise<void> {
    if (this.intentionallyStopped) {
      return;
    }
    const settings = this.store.getSettingsWithSecrets();
    if (!settings.deviceId || !this.store.getVaultKey()) {
      return;
    }
    const supabase = client ?? this.supabase;
    if (!supabase) {
      return;
    }
    await this.ensureAccessToken(settings, supabase);
    const claims = await listPendingVaultClaims(supabase, this.now);
    const pendingClaimCount = claims.filter((claim) => claim.requesterDeviceId !== settings.deviceId).length;
    if (this.vaultStatus.pendingClaimCount === pendingClaimCount) {
      return;
    }
    const { hint: _previousHint, ...currentVaultStatus } = this.getVaultStatus();
    this.setVaultStatus({
      ...currentVaultStatus,
      pendingClaimCount,
      ...(pendingClaimCount > 0
        ? { hint: `${pendingClaimCount} device(s) waiting for vault authorization.` }
        : {}),
    });
  }

  private async refreshRealtimeBindings(): Promise<void> {
    if (!this.realtime || !this.supabase || this.intentionallyStopped) {
      return;
    }
    const settings = this.store.getSettingsWithSecrets();
    if (!settings.deviceId) {
      return;
    }
    await this.ensureAccessToken(settings, this.supabase);
    const bindings = await this.fetchBindingsForDesktop(this.supabase, settings.deviceId, {
      activeOnly: true,
    });
    await this.realtime.syncBindings(bindings);
  }

  private async fetchBindingsForDesktop(
    client: SupabaseClient,
    desktopDeviceId: string,
    options: { activeOnly: boolean },
  ): Promise<CenterServerDeviceBindingView[]> {
    let query = client
      .from("device_bindings")
      .select("id, user_id, desktop_device_id, mobile_device_id, capabilities, created_at, revoked_at")
      .eq("desktop_device_id", desktopDeviceId)
      .order("created_at", { ascending: false });
    if (options.activeOnly) {
      query = query.is("revoked_at", null);
    }
    const { data, error } = await query;
    if (error) {
      throw new Error(error.message);
    }
    return (data ?? []).map(parseBindingRow);
  }

  private failConnection(message: string): void {
    this.log(`[eco] supabase center connection failed: ${message}\n`);
    this.store.markError(message);
    this.setStatus({
      state: "error",
      lastError: message,
      lastDisconnectedAt: this.now().toISOString(),
    });
  }

  private setStatus(status: CenterServerConnectionStatus): void {
    this.status = status;
    this.onStatusChange?.(this.getSnapshot());
  }
}

function createBrowserlessClient(supabaseUrl: string, anonKey: string, fetchImpl: FetchLike): SupabaseClient {
  return createClient(normalizeSupabaseProjectUrl(supabaseUrl), anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: fetchImpl,
    },
  });
}

function parseDeviceRegisterResponse(payload: unknown): DeviceRegisterResponse {
  if (!isRecord(payload)) {
    throw new Error("device-register returned an empty response.");
  }
  const deviceRaw = payload.device ?? payload;
  if (!isRecord(deviceRaw)) {
    throw new Error("device-register response is missing device.");
  }
  const deviceSecret =
    readString(payload.deviceSecret) ?? readString(payload.device_secret) ?? readString(payload.secret);
  if (!deviceSecret) {
    throw new Error("device-register response is missing deviceSecret.");
  }
  return { device: parseDeviceRow(deviceRaw), deviceSecret };
}

function parsePairingCreateResponse(payload: unknown): Omit<CenterServerCreatePairingResult, "qrPayload"> & {
  qrPayload?: string;
} {
  if (!isRecord(payload)) {
    throw new Error("pairing-create returned an empty response.");
  }
  const pairingId = readString(payload.pairingId) ?? readString(payload.pairing_id);
  const code = readString(payload.code);
  const bootstrapToken = readString(payload.bootstrapToken) ?? readString(payload.bootstrap_token);
  const expiresAt = readString(payload.expiresAt) ?? readString(payload.expires_at);
  if (!pairingId || !code || !bootstrapToken || !expiresAt) {
    throw new Error("pairing-create response shape is invalid.");
  }
  return {
    pairingId,
    code,
    bootstrapToken,
    expiresAt,
    ...(readString(payload.qrPayload) || readString(payload.qr_payload)
      ? { qrPayload: (readString(payload.qrPayload) ?? readString(payload.qr_payload))! }
      : {}),
  };
}

function parseBindingRow(row: unknown): CenterServerDeviceBindingView {
  if (!isRecord(row)) {
    throw new Error("device_bindings row is invalid.");
  }
  const id = readString(row.id);
  const userId = readString(row.userId) ?? readString(row.user_id);
  const desktopDeviceId = readString(row.desktopDeviceId) ?? readString(row.desktop_device_id);
  const mobileDeviceId = readString(row.mobileDeviceId) ?? readString(row.mobile_device_id);
  const createdAt = readString(row.createdAt) ?? readString(row.created_at);
  if (!id || !userId || !desktopDeviceId || !mobileDeviceId || !createdAt) {
    throw new Error("device_bindings row is missing required fields.");
  }
  const capabilitiesRaw = row.capabilities;
  const capabilities = Array.isArray(capabilitiesRaw)
    ? capabilitiesRaw.filter((value): value is string => typeof value === "string")
    : [];
  return {
    id,
    userId,
    desktopDeviceId,
    mobileDeviceId,
    capabilities,
    createdAt,
    revokedAt: readString(row.revokedAt) ?? readString(row.revoked_at) ?? null,
  };
}

function parseDeviceRow(row: unknown): CenterServerDeviceView {
  if (!isRecord(row)) {
    throw new Error("devices row is invalid.");
  }
  const id = readString(row.id);
  const userId = readString(row.userId) ?? readString(row.user_id);
  const name = readString(row.name);
  const kind = readString(row.kind);
  const createdAt = readString(row.createdAt) ?? readString(row.created_at) ?? new Date().toISOString();
  if (!id || !userId || !name || (kind !== "desktop" && kind !== "mobile")) {
    throw new Error("devices row shape is invalid.");
  }
  const device: CenterServerDeviceView = {
    id,
    userId,
    kind,
    name,
    createdAt,
    lastSeenAt: readString(row.lastSeenAt) ?? readString(row.last_seen_at) ?? null,
    disabledAt: readString(row.disabledAt) ?? readString(row.disabled_at) ?? null,
  };
  const metadata = row.metadata;
  if (isRecord(metadata)) {
    device.metadata = {
      ...(typeof metadata.model === "string" ? { model: metadata.model } : {}),
      ...(typeof metadata.ipAddress === "string"
        ? { ipAddress: metadata.ipAddress }
        : typeof metadata.ip_address === "string"
          ? { ipAddress: metadata.ip_address }
          : {}),
      ...(typeof metadata.platform === "string" ? { platform: metadata.platform } : {}),
      ...(typeof metadata.hostname === "string" ? { hostname: metadata.hostname } : {}),
    };
  }
  return device;
}

function toAccountView(user: User): CenterServerAccountView {
  const displayName =
    typeof user.user_metadata?.display_name === "string"
      ? user.user_metadata.display_name
      : typeof user.user_metadata?.displayName === "string"
        ? user.user_metadata.displayName
        : null;
  return {
    id: user.id,
    email: user.email ?? "",
    displayName,
    createdAt: user.created_at,
  };
}

function expiresAtIso(expiresAtSeconds: number | undefined): string {
  if (!expiresAtSeconds || !Number.isFinite(expiresAtSeconds)) {
    return "";
  }
  return new Date(expiresAtSeconds * 1000).toISOString();
}

function tokenStillValid(expiresAt: string | undefined, now: Date): boolean {
  if (!expiresAt) {
    return false;
  }
  return Date.parse(expiresAt) - now.getTime() > 30_000;
}

function isMissingEdgeFunctionError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("not found") ||
    lower.includes("404") ||
    lower.includes("function not found") ||
    (lower.includes("failed to fetch") && lower.includes("functions"))
  );
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
