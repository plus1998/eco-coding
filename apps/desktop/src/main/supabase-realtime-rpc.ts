/**
 * Desktop Supabase Realtime Presence + bind-channel JSON-RPC (Track D).
 *
 * Presence: private `eco:user:{userId}`
 * RPC: private `eco:bind:{bindingId}` for each active binding of this desktop device
 */
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import {
  buildEcoBindTopic,
  buildEcoJsonRpcFailure,
  buildEcoJsonRpcSuccess,
  buildEcoUserTopic,
  ECO_REALTIME_BROADCAST_EVENT,
  ECO_RPC_ERROR,
  ECO_RPC_METHODS,
  isEcoJsonRpcMessage,
  isEcoJsonRpcNotification,
  isEcoJsonRpcRequest,
  isEcoJsonRpcResponse,
  unwrapEcoRpcFromBroadcast,
  wrapEcoRpcForBroadcast,
  type EcoJsonRpcMessage,
  type EcoJsonRpcResponse,
} from "@eco/shared";
import type { EventCenterJsonRpcNotification } from "../shared/event-center";
import type { CenterServerDeviceBindingView } from "../shared/center-server";
import type { DesktopEventCenter } from "./event-center";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export interface SupabaseRealtimeRpcOptions {
  client: SupabaseClient;
  eventCenter: DesktopEventCenter;
  log?: (message: string) => void;
  now?: () => Date;
  requestTimeoutMs?: number;
}

export interface SupabaseRealtimeRpcStartInput {
  userId: string;
  deviceId: string;
}

export interface EcoPresenceDeviceState {
  deviceId: string;
  deviceKind?: string;
  online?: boolean;
  connectedAt?: string;
  lastSeenAt?: string;
}

interface BindChannelEntry {
  channel: RealtimeChannel;
  capabilities: string[];
}

interface PendingRequest {
  resolve: (response: EcoJsonRpcResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Unwrap Broadcast callback payload (envelope may be nested under `.payload`). */
export function extractEcoRpcFromBroadcastPayload(payload: unknown): EcoJsonRpcMessage | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const raw = record.payload !== undefined ? record.payload : payload;
  const unwrapped = unwrapEcoRpcFromBroadcast(raw);
  if (unwrapped) {
    return unwrapped;
  }
  return isEcoJsonRpcMessage(raw) ? raw : null;
}

export function bindingHasEventsRead(capabilities: readonly string[]): boolean {
  return capabilities.includes("events:read");
}

export function bindingCanInvoke(capabilities: readonly string[]): boolean {
  return capabilities.includes("rpc:invoke");
}

export class SupabaseRealtimeRpc {
  private readonly client: SupabaseClient;
  private readonly eventCenter: DesktopEventCenter;
  private readonly log: (message: string) => void;
  private readonly now: () => Date;
  private readonly requestTimeoutMs: number;

  private userId: string | undefined;
  private deviceId: string | undefined;
  private userChannel: RealtimeChannel | undefined;
  private readonly bindChannels = new Map<string, BindChannelEntry>();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly onlineDeviceIds = new Set<string>();
  private started = false;

  constructor(options: SupabaseRealtimeRpcOptions) {
    this.client = options.client;
    this.eventCenter = options.eventCenter;
    this.log = options.log ?? (() => {});
    this.now = options.now ?? (() => new Date());
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  async start(input: SupabaseRealtimeRpcStartInput): Promise<void> {
    await this.stop();
    this.userId = input.userId;
    this.deviceId = input.deviceId;
    this.started = true;

    const topic = buildEcoUserTopic(input.userId);
    const channel = this.client.channel(topic, {
      config: {
        private: true,
        presence: { key: input.deviceId, enabled: true },
      },
    });

    channel.on("presence", { event: "sync" }, () => {
      this.refreshPresenceFromChannel(channel);
    });
    channel.on("presence", { event: "join" }, () => {
      this.refreshPresenceFromChannel(channel);
    });
    channel.on("presence", { event: "leave" }, () => {
      this.refreshPresenceFromChannel(channel);
    });

    this.userChannel = channel;
    channel.subscribe((status, err) => {
      if (status === "SUBSCRIBED") {
        void channel
          .track({
            deviceId: input.deviceId,
            deviceKind: "desktop",
            online: true,
            connectedAt: this.now().toISOString(),
            lastSeenAt: this.now().toISOString(),
          })
          .catch((error) => {
            this.log(`[eco] presence track failed: ${errorMessage(error)}\n`);
          });
        return;
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        this.log(`[eco] presence channel ${topic} status=${status}${err ? `: ${err.message}` : ""}\n`);
      }
    });
  }

  async stop(): Promise<void> {
    this.started = false;
    this.rejectAllPending(new Error("Realtime session stopped."));
    this.onlineDeviceIds.clear();

    const bindIds = [...this.bindChannels.keys()];
    for (const bindingId of bindIds) {
      await this.dropBindChannel(bindingId);
    }

    if (this.userChannel) {
      try {
        await this.client.removeChannel(this.userChannel);
      } catch (error) {
        this.log(`[eco] presence unsubscribe failed: ${errorMessage(error)}\n`);
      }
      this.userChannel = undefined;
    }

    this.userId = undefined;
    this.deviceId = undefined;
  }

  async syncBindings(bindings: readonly CenterServerDeviceBindingView[]): Promise<void> {
    if (!this.started || !this.deviceId) {
      return;
    }

    const active = bindings.filter(
      (binding) =>
        !binding.revokedAt &&
        binding.desktopDeviceId === this.deviceId &&
        typeof binding.id === "string" &&
        binding.id.length > 0,
    );
    const nextIds = new Set(active.map((binding) => binding.id));

    for (const bindingId of [...this.bindChannels.keys()]) {
      if (!nextIds.has(bindingId)) {
        await this.dropBindChannel(bindingId);
      }
    }

    for (const binding of active) {
      const existing = this.bindChannels.get(binding.id);
      if (existing) {
        existing.capabilities = [...binding.capabilities];
        continue;
      }
      this.subscribeBindChannel(binding);
    }
  }

  /**
   * Broadcast a JSON-RPC message on a bind channel.
   * Requests with an `id` wait for a matching response (pending map + timeout).
   */
  async sendOnBinding(
    bindingId: string,
    message: EcoJsonRpcMessage,
    options?: { timeoutMs?: number },
  ): Promise<EcoJsonRpcResponse | undefined> {
    const entry = this.bindChannels.get(bindingId);
    if (!entry) {
      throw new Error(`No active Realtime bind channel for binding ${bindingId}.`);
    }

    const isRequest = isEcoJsonRpcRequest(message);
    const requestId =
      isRequest && message.id !== undefined && message.id !== null ? String(message.id) : undefined;

    let pendingPromise: Promise<EcoJsonRpcResponse> | undefined;
    if (requestId) {
      pendingPromise = new Promise<EcoJsonRpcResponse>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(requestId);
          reject(new Error(`Realtime RPC timed out for id=${requestId}`));
        }, options?.timeoutMs ?? this.requestTimeoutMs);
        this.pending.set(requestId, { resolve, reject, timer });
      });
    }

    const envelope = wrapEcoRpcForBroadcast(message);
    const result = await entry.channel.send({
      type: "broadcast",
      event: ECO_REALTIME_BROADCAST_EVENT,
      payload: envelope,
    });
    if (result !== "ok") {
      if (requestId) {
        const pending = this.pending.get(requestId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(requestId);
          pending.reject(new Error(`Realtime broadcast send failed: ${result}`));
        }
      }
      throw new Error(`Realtime broadcast send failed: ${result}`);
    }

    return pendingPromise;
  }

  /** Fan-out `eco.event` notifications to bind channels with `events:read`. */
  publishNotification(notification: EventCenterJsonRpcNotification): void {
    for (const [bindingId, entry] of this.bindChannels) {
      if (!bindingHasEventsRead(entry.capabilities)) {
        continue;
      }
      void this.sendOnBinding(bindingId, notification).catch((error) => {
        this.log(`[eco] publish to bind ${bindingId} failed: ${errorMessage(error)}\n`);
      });
    }
  }

  listOnlineDeviceIds(): ReadonlySet<string> {
    return this.onlineDeviceIds;
  }

  getPresenceDevices(): EcoPresenceDeviceState[] {
    if (!this.userChannel) {
      return [];
    }
    return collectPresenceDevices(this.userChannel.presenceState());
  }

  private subscribeBindChannel(binding: CenterServerDeviceBindingView): void {
    const topic = buildEcoBindTopic(binding.id);
    const channel = this.client.channel(topic, {
      config: {
        private: true,
        broadcast: { self: false },
      },
    });

    channel.on("broadcast", { event: ECO_REALTIME_BROADCAST_EVENT }, (payload) => {
      void this.handleBindBroadcast(binding.id, payload);
    });

    this.bindChannels.set(binding.id, {
      channel,
      capabilities: [...binding.capabilities],
    });

    channel.subscribe((status, err) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        this.log(`[eco] bind channel ${topic} status=${status}${err ? `: ${err.message}` : ""}\n`);
      }
    });
  }

  private async dropBindChannel(bindingId: string): Promise<void> {
    const entry = this.bindChannels.get(bindingId);
    if (!entry) {
      return;
    }
    this.bindChannels.delete(bindingId);
    try {
      await this.client.removeChannel(entry.channel);
    } catch (error) {
      this.log(`[eco] bind unsubscribe failed (${bindingId}): ${errorMessage(error)}\n`);
    }
  }

  private async handleBindBroadcast(bindingId: string, payload: unknown): Promise<void> {
    const message = extractEcoRpcFromBroadcastPayload(payload);
    if (!message) {
      return;
    }

    if (isEcoJsonRpcResponse(message)) {
      const requestId = message.id === undefined || message.id === null ? undefined : String(message.id);
      if (requestId) {
        const pending = this.pending.get(requestId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(requestId);
          pending.resolve(message);
        }
      }
      return;
    }

    if (isEcoJsonRpcNotification(message)) {
      // Desktop is the event publisher; ignore peer eco.event (and other) notifications.
      if (message.method === ECO_RPC_METHODS.event) {
        return;
      }
      return;
    }

    if (!isEcoJsonRpcRequest(message)) {
      return;
    }

    if (message.method === ECO_RPC_METHODS.ping) {
      const response = buildEcoJsonRpcSuccess(message.id ?? null, { ok: true });
      await this.sendOnBinding(bindingId, response).catch((error) => {
        this.log(`[eco] ping reply failed: ${errorMessage(error)}\n`);
      });
      return;
    }

    if (message.method === ECO_RPC_METHODS.invoke) {
      const entry = this.bindChannels.get(bindingId);
      if (!entry || !bindingCanInvoke(entry.capabilities)) {
        const response = buildEcoJsonRpcFailure(
          message.id ?? null,
          ECO_RPC_ERROR.forbidden,
          "Binding does not grant rpc:invoke.",
        );
        await this.sendOnBinding(bindingId, response).catch((error) => {
          this.log(`[eco] forbidden invoke reply failed: ${errorMessage(error)}\n`);
        });
        return;
      }
      let response: EcoJsonRpcResponse | undefined;
      try {
        response = await this.eventCenter.handleJsonRpcMessage(message);
      } catch (error) {
        response = buildEcoJsonRpcFailure(
          message.id ?? null,
          ECO_RPC_ERROR.internalError,
          errorMessage(error),
        );
      }
      if (response) {
        await this.sendOnBinding(bindingId, response).catch((error) => {
          this.log(`[eco] invoke reply failed: ${errorMessage(error)}\n`);
        });
      }
      return;
    }

    if (message.id !== undefined) {
      const response = buildEcoJsonRpcFailure(
        message.id ?? null,
        ECO_RPC_ERROR.methodNotFound,
        `Unsupported Realtime RPC method: ${message.method}`,
      );
      await this.sendOnBinding(bindingId, response).catch(() => {});
    }
  }

  private refreshPresenceFromChannel(channel: RealtimeChannel): void {
    this.onlineDeviceIds.clear();
    for (const device of collectPresenceDevices(channel.presenceState())) {
      if (device.deviceId) {
        this.onlineDeviceIds.add(device.deviceId);
      }
    }
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function collectPresenceDevices(
  state: Record<string, Array<{ [key: string]: unknown }>>,
): EcoPresenceDeviceState[] {
  const devices: EcoPresenceDeviceState[] = [];
  for (const metas of Object.values(state)) {
    for (const meta of metas) {
      const deviceId =
        typeof meta.deviceId === "string"
          ? meta.deviceId
          : typeof meta.device_id === "string"
            ? meta.device_id
            : undefined;
      if (!deviceId) {
        continue;
      }
      devices.push({
        deviceId,
        ...(typeof meta.deviceKind === "string"
          ? { deviceKind: meta.deviceKind }
          : typeof meta.device_kind === "string"
            ? { deviceKind: meta.device_kind }
            : {}),
        ...(typeof meta.online === "boolean" ? { online: meta.online } : { online: true }),
        ...(typeof meta.connectedAt === "string"
          ? { connectedAt: meta.connectedAt }
          : typeof meta.connected_at === "string"
            ? { connectedAt: meta.connected_at }
            : {}),
        ...(typeof meta.lastSeenAt === "string"
          ? { lastSeenAt: meta.lastSeenAt }
          : typeof meta.last_seen_at === "string"
            ? { lastSeenAt: meta.last_seen_at }
            : {}),
      });
    }
  }
  return devices;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
