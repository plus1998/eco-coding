import {
  buildEcoJsonRpcFailure,
  buildEcoJsonRpcRequest,
  buildEcoJsonRpcSuccess,
  ECO_RPC_ERROR,
  ECO_RPC_METHODS,
  type EcoDeviceCapability,
  type EcoDeviceKind,
  type EcoEventEnvelope,
  type EcoForwardedInvokeParams,
  type EcoInvokeParams,
  type EcoJsonRpcId,
  type EcoJsonRpcMessage,
  type EcoJsonRpcNotification,
  type EcoJsonRpcRequest,
  type EcoJsonRpcResponse,
  isEcoInvokeParams,
  isEcoJsonRpcNotification,
  isEcoJsonRpcRequest,
  isEcoJsonRpcResponse,
} from "@eco/shared";
import type { SqliteStore } from "../db/sqlite-store";
import type { PresenceStore } from "../presence/presence-store";
import { PolicyEngine } from "./policy";

export interface RpcPeer {
  sessionId: string;
  userId: string;
  deviceId: string;
  deviceKind: EcoDeviceKind;
  capabilities: EcoDeviceCapability[];
  send(message: EcoJsonRpcMessage): void;
  close?(code: number, reason: string): void;
}

export interface RpcGatewayOptions {
  store: SqliteStore;
  presence: PresenceStore;
  policy?: PolicyEngine;
  rpcTimeoutMs: number;
  now?: () => Date;
}

export interface OnlineDeviceSnapshot {
  deviceId: string;
  deviceKind: EcoDeviceKind;
  sessionId: string;
  connectedAt: string;
  lastSeenAt: string;
}

interface PendingRequest {
  mobile: RpcPeer;
  originalId: EcoJsonRpcId;
  serverId: string;
  userId: string;
  mobileDeviceId: string;
  desktopDeviceId: string;
  channel: string;
  timeout: ReturnType<typeof setTimeout>;
}

export class RpcGateway {
  private readonly store: SqliteStore;
  private readonly presence: PresenceStore;
  private readonly policy: PolicyEngine;
  private readonly rpcTimeoutMs: number;
  private readonly clock: () => Date;
  private readonly desktops = new Map<string, RpcPeer>();
  private readonly mobiles = new Map<string, RpcPeer>();
  private readonly sessions = new Map<string, OnlineDeviceSnapshot & { userId: string }>();
  private readonly pending = new Map<string, PendingRequest>();

  constructor(options: RpcGatewayOptions) {
    this.store = options.store;
    this.presence = options.presence;
    this.policy = options.policy ?? new PolicyEngine();
    this.rpcTimeoutMs = options.rpcTimeoutMs;
    this.clock = options.now ?? (() => new Date());
  }

  async connect(peer: RpcPeer): Promise<void> {
    if (peer.deviceKind === "desktop") {
      this.desktops.set(peer.deviceId, peer);
    } else {
      this.mobiles.set(peer.deviceId, peer);
    }
    const now = this.clock().toISOString();
    const session = {
      sessionId: peer.sessionId,
      userId: peer.userId,
      deviceId: peer.deviceId,
      deviceKind: peer.deviceKind,
      connectedAt: now,
      lastSeenAt: now,
    };
    this.sessions.set(peer.sessionId, session);
    await this.presence.setSession(session);
    this.store.touchDevice(peer.deviceId, now);
  }

  async disconnect(peer: RpcPeer): Promise<void> {
    if (peer.deviceKind === "desktop" && this.desktops.get(peer.deviceId)?.sessionId === peer.sessionId) {
      this.desktops.delete(peer.deviceId);
      this.failPendingForDesktop(peer.deviceId);
    }
    if (peer.deviceKind === "mobile" && this.mobiles.get(peer.deviceId)?.sessionId === peer.sessionId) {
      this.mobiles.delete(peer.deviceId);
    }
    this.sessions.delete(peer.sessionId);
    await this.presence.deleteSession(peer.sessionId);
  }

  async disconnectDevice(deviceId: string, reason = "Device was revoked."): Promise<void> {
    const peer = this.desktops.get(deviceId) ?? this.mobiles.get(deviceId);
    if (!peer) {
      return;
    }
    peer.close?.(4003, reason);
    await this.disconnect(peer);
  }

  listOnlineDevices(userId: string): OnlineDeviceSnapshot[] {
    return Array.from(this.sessions.values())
      .filter((session) => session.userId === userId)
      .map(({ userId: _userId, ...session }) => session);
  }

  async handleMessage(peer: RpcPeer, rawMessage: string | Uint8Array): Promise<void> {
    await this.refreshPresence(peer);
    const message = parseJsonRpc(rawMessage);
    if (!message.ok) {
      peer.send(buildEcoJsonRpcFailure(null, ECO_RPC_ERROR.parseError, message.error));
      return;
    }
    const value = message.value;
    if (isEcoJsonRpcResponse(value)) {
      await this.handleDesktopResponse(peer, value);
      return;
    }
    if (isEcoJsonRpcRequest(value)) {
      await this.handleRequest(peer, value);
      return;
    }
    if (isEcoJsonRpcNotification(value)) {
      await this.handleNotification(peer, value);
      return;
    }
    peer.send(buildEcoJsonRpcFailure(null, ECO_RPC_ERROR.invalidRequest, "Invalid JSON-RPC message."));
  }

  private async handleRequest(peer: RpcPeer, request: EcoJsonRpcRequest): Promise<void> {
    if (request.method === ECO_RPC_METHODS.ping) {
      peer.send(buildEcoJsonRpcSuccess(request.id ?? null, { ok: true, now: this.clock().toISOString() }));
      return;
    }
    if (request.method !== ECO_RPC_METHODS.invoke) {
      peer.send(buildEcoJsonRpcFailure(request.id ?? null, ECO_RPC_ERROR.methodNotFound, "Method was not found."));
      return;
    }
    await this.routeMobileInvoke(peer, request as EcoJsonRpcRequest<EcoInvokeParams>);
  }

  private async handleNotification(peer: RpcPeer, notification: EcoJsonRpcNotification): Promise<void> {
    if (notification.method !== ECO_RPC_METHODS.event) {
      return;
    }
    if (peer.deviceKind !== "desktop" || !peer.capabilities.includes("events:publish")) {
      return;
    }
    const event = notification.params as EcoEventEnvelope | undefined;
    const bindings = this.store.listActiveBindingsForDesktop(peer.userId, peer.deviceId);
    for (const binding of bindings) {
      const mobile = this.mobiles.get(binding.mobileDeviceId);
      if (mobile && binding.capabilities.includes("events:read")) {
        mobile.send(notification);
      }
    }
    this.store.createAuditLog({
      id: createId("aud"),
      userId: peer.userId,
      action: "event.publish",
      status: "accepted",
      actorDeviceId: peer.deviceId,
      rpcMethod: notification.method,
      metadata: {
        kind: event?.kind,
        fanoutCount: bindings.length,
      },
      now: this.clock().toISOString(),
    });
  }

  private async routeMobileInvoke(peer: RpcPeer, request: EcoJsonRpcRequest<EcoInvokeParams>): Promise<void> {
    if (peer.deviceKind !== "mobile") {
      peer.send(buildEcoJsonRpcFailure(request.id ?? null, ECO_RPC_ERROR.forbidden, "Only mobile devices can invoke PC commands."));
      return;
    }
    if (!isEcoInvokeParams(request.params)) {
      peer.send(buildEcoJsonRpcFailure(request.id ?? null, ECO_RPC_ERROR.invalidParams, "eco.invoke params are invalid."));
      return;
    }
    const params = request.params;
    const binding = this.store.findActiveBinding(peer.userId, params.desktopDeviceId, peer.deviceId);
    if (!binding) {
      this.auditInvokeRejected(peer, params, "Device is not bound to the target desktop.");
      peer.send(buildEcoJsonRpcFailure(request.id ?? null, ECO_RPC_ERROR.forbidden, "Device is not bound to the target desktop."));
      return;
    }
    try {
      this.policy.authorizeMobileInvoke({
        params,
        mobileCapabilities: peer.capabilities,
        binding,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Command is forbidden.";
      this.auditInvokeRejected(peer, params, message);
      peer.send(buildEcoJsonRpcFailure(request.id ?? null, ECO_RPC_ERROR.forbidden, message));
      return;
    }
    const desktop = this.desktops.get(params.desktopDeviceId);
    if (!desktop) {
      this.auditInvokeRejected(peer, params, "Target desktop is offline.", "target_offline");
      peer.send(buildEcoJsonRpcFailure(request.id ?? null, ECO_RPC_ERROR.targetOffline, "Target desktop is offline."));
      return;
    }

    const serverId = createId("rpc");
    const timeoutMs = Math.min(params.deadlineMs ?? this.rpcTimeoutMs, this.rpcTimeoutMs);
    const timeout = setTimeout(() => {
      this.pending.delete(serverId);
      peer.send(buildEcoJsonRpcFailure(request.id ?? null, ECO_RPC_ERROR.timeout, "PC command timed out."));
      this.store.createAuditLog({
        id: createId("aud"),
        userId: peer.userId,
        action: "rpc.invoke",
        status: "timeout",
        actorDeviceId: peer.deviceId,
        targetDeviceId: params.desktopDeviceId,
        rpcMethod: ECO_RPC_METHODS.invoke,
        channel: params.channel,
        now: this.clock().toISOString(),
      });
    }, timeoutMs);
    this.pending.set(serverId, {
      mobile: peer,
      originalId: request.id ?? null,
      serverId,
      userId: peer.userId,
      mobileDeviceId: peer.deviceId,
      desktopDeviceId: params.desktopDeviceId,
      channel: params.channel,
      timeout,
    });

    const forwarded: EcoForwardedInvokeParams = {
      ...params,
      requestId: params.requestId ?? serverId,
      caller: "mobile",
      origin: {
        source: "mobile",
        userId: peer.userId,
        mobileDeviceId: peer.deviceId,
        mobileSessionId: peer.sessionId,
        capabilities: peer.capabilities,
      },
    };
    desktop.send(buildEcoJsonRpcRequest(serverId, ECO_RPC_METHODS.invoke, forwarded));
    this.store.createAuditLog({
      id: createId("aud"),
      userId: peer.userId,
      action: "rpc.invoke",
      status: "accepted",
      actorDeviceId: peer.deviceId,
      targetDeviceId: params.desktopDeviceId,
      rpcMethod: ECO_RPC_METHODS.invoke,
      channel: params.channel,
      metadata: {
        requestId: params.requestId ?? serverId,
      },
      now: this.clock().toISOString(),
    });
  }

  private async handleDesktopResponse(peer: RpcPeer, response: EcoJsonRpcResponse): Promise<void> {
    if (peer.deviceKind !== "desktop" || typeof response.id !== "string") {
      return;
    }
    const pending = this.pending.get(response.id);
    if (!pending || pending.desktopDeviceId !== peer.deviceId) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pending.delete(response.id);
    if ("error" in response) {
      pending.mobile.send(buildEcoJsonRpcFailure(pending.originalId, response.error.code, response.error.message, response.error.data));
      this.store.createAuditLog({
        id: createId("aud"),
        userId: pending.userId,
        action: "rpc.invoke",
        status: "failed",
        actorDeviceId: pending.mobileDeviceId,
        targetDeviceId: pending.desktopDeviceId,
        rpcMethod: ECO_RPC_METHODS.invoke,
        channel: pending.channel,
        errorCode: response.error.code,
        errorMessage: response.error.message,
        now: this.clock().toISOString(),
      });
      return;
    }
    pending.mobile.send(buildEcoJsonRpcSuccess(pending.originalId, response.result));
    this.store.createAuditLog({
      id: createId("aud"),
      userId: pending.userId,
      action: "rpc.invoke",
      status: "succeeded",
      actorDeviceId: pending.mobileDeviceId,
      targetDeviceId: pending.desktopDeviceId,
      rpcMethod: ECO_RPC_METHODS.invoke,
      channel: pending.channel,
      now: this.clock().toISOString(),
    });
  }

  private failPendingForDesktop(desktopDeviceId: string): void {
    for (const pending of this.pending.values()) {
      if (pending.desktopDeviceId !== desktopDeviceId) {
        continue;
      }
      clearTimeout(pending.timeout);
      this.pending.delete(pending.serverId);
      pending.mobile.send(buildEcoJsonRpcFailure(pending.originalId, ECO_RPC_ERROR.targetOffline, "Target desktop disconnected."));
      this.store.createAuditLog({
        id: createId("aud"),
        userId: pending.userId,
        action: "rpc.invoke",
        status: "failed",
        actorDeviceId: pending.mobileDeviceId,
        targetDeviceId: pending.desktopDeviceId,
        rpcMethod: ECO_RPC_METHODS.invoke,
        channel: pending.channel,
        errorCode: ECO_RPC_ERROR.targetOffline,
        errorMessage: "Target desktop disconnected.",
        now: this.clock().toISOString(),
      });
    }
  }

  private async refreshPresence(peer: RpcPeer): Promise<void> {
    const existing = this.sessions.get(peer.sessionId);
    if (!existing) {
      return;
    }
    const refreshed = {
      ...existing,
      lastSeenAt: this.clock().toISOString(),
    };
    this.sessions.set(peer.sessionId, refreshed);
    await this.presence.setSession(refreshed);
  }

  private auditInvokeRejected(
    peer: RpcPeer,
    params: EcoInvokeParams,
    message: string,
    reason = "forbidden",
  ): void {
    this.store.createAuditLog({
      id: createId("aud"),
      userId: peer.userId,
      action: "rpc.invoke",
      status: "rejected",
      actorDeviceId: peer.deviceId,
      targetDeviceId: params.desktopDeviceId,
      rpcMethod: ECO_RPC_METHODS.invoke,
      channel: params.channel,
      errorMessage: message,
      metadata: { reason },
      now: this.clock().toISOString(),
    });
  }
}

function parseJsonRpc(rawMessage: string | Uint8Array): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    const text = typeof rawMessage === "string" ? rawMessage : new TextDecoder().decode(rawMessage);
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, error: "Message is not valid JSON." };
  }
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
