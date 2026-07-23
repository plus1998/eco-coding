import {
  buildEcoJsonRpcFailure,
  buildEcoJsonRpcNotification,
  buildEcoJsonRpcRequest,
  buildEcoJsonRpcSuccess,
  ECO_RPC_ERROR,
  ECO_RPC_METHODS,
  ECO_RPC_PROTOCOL_VERSION,
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
  type EcoPresenceDeviceEventPayload,
  isEcoInvokeParams,
  isEcoJsonRpcNotification,
  isEcoJsonRpcRequest,
  isEcoJsonRpcResponse,
  type RemoteCommandDefinition,
} from "@eco/shared";
import { normalizeIpAddress } from "../client-ip";
import type { MongoStore } from "../db/mongo-store";
import type { PresenceStore } from "../presence/presence-store";
import { type InvokeAuthorization, PolicyEngine } from "./policy";
import type { RpcBus, RpcBusMessage } from "./rpc-bus";

export interface RpcPeer {
  sessionId: string;
  userId: string;
  deviceId: string;
  deviceKind: EcoDeviceKind;
  capabilities: EcoDeviceCapability[];
  clientIp?: string;
  send(message: EcoJsonRpcMessage): void;
  close?(code: number, reason: string): void;
}

export interface RpcGatewayOptions {
  store: MongoStore;
  presence: PresenceStore;
  instanceId?: string;
  bus?: RpcBus;
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
  command: RemoteCommandDefinition;
  timeout: ReturnType<typeof setTimeout>;
}

interface RemoteDesktopRequest {
  originInstanceId: string;
  desktopDeviceId: string;
  desktopSessionId: string;
  timeout: ReturnType<typeof setTimeout>;
}

export class RpcGateway {
  private readonly store: MongoStore;
  private readonly presence: PresenceStore;
  private readonly instanceId: string;
  private readonly bus: RpcBus | undefined;
  private readonly policy: PolicyEngine;
  private readonly rpcTimeoutMs: number;
  private readonly clock: () => Date;
  private readonly desktops = new Map<string, RpcPeer>();
  private readonly mobiles = new Map<string, RpcPeer>();
  private readonly sessions = new Map<string, OnlineDeviceSnapshot & { userId: string }>();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly remoteDesktopRequests = new Map<string, RemoteDesktopRequest>();

  constructor(options: RpcGatewayOptions) {
    this.store = options.store;
    this.presence = options.presence;
    this.instanceId = options.instanceId ?? options.bus?.instanceId ?? "single-instance";
    this.bus = options.bus;
    this.policy = options.policy ?? new PolicyEngine();
    this.rpcTimeoutMs = options.rpcTimeoutMs;
    this.clock = options.now ?? (() => new Date());
  }

  async start(): Promise<void> {
    await this.bus?.start((message) => this.handleBusMessage(message));
  }

  async close(): Promise<void> {
    await this.bus?.close();
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
    await this.presence.setDeviceRoute({ ...session, instanceId: this.instanceId });
    await this.store.touchDevice(peer.deviceId, now);
    if (peer.deviceKind === "desktop") {
      const clientIp = normalizeIpAddress(peer.clientIp);
      if (clientIp) {
        await this.store.updateDeviceProfile({
          userId: peer.userId,
          deviceId: peer.deviceId,
          metadata: { ipAddress: clientIp },
        });
      }
    }
    await this.publishPresenceDeviceEvent(peer, true, now, session);
  }

  async disconnect(peer: RpcPeer): Promise<void> {
    const now = this.clock().toISOString();
    const session = this.sessions.get(peer.sessionId);
    const routeBeforeDelete = await this.presence.getDeviceRoute(peer.deviceId);
    const shouldPublishOffline =
      routeBeforeDelete?.userId === peer.userId && routeBeforeDelete.sessionId === peer.sessionId;
    if (peer.deviceKind === "desktop" && this.desktops.get(peer.deviceId)?.sessionId === peer.sessionId) {
      this.desktops.delete(peer.deviceId);
      await this.failPendingForDesktop(peer.deviceId);
    }
    if (peer.deviceKind === "mobile" && this.mobiles.get(peer.deviceId)?.sessionId === peer.sessionId) {
      this.mobiles.delete(peer.deviceId);
    }
    this.sessions.delete(peer.sessionId);
    await this.presence.deleteSession(peer.sessionId);
    await this.presence.deleteDeviceRoute({
      deviceId: peer.deviceId,
      userId: peer.userId,
      sessionId: peer.sessionId,
    });
    if (shouldPublishOffline) {
      await this.publishPresenceDeviceEvent(peer, false, now, session);
    }
  }

  async disconnectDevice(deviceId: string, reason = "Device was revoked."): Promise<void> {
    const peer = this.desktops.get(deviceId) ?? this.mobiles.get(deviceId);
    if (peer) {
      peer.close?.(4003, reason);
      await this.disconnect(peer);
      return;
    }
    const route = await this.presence.getDeviceRoute(deviceId);
    if (route && route.instanceId !== this.instanceId) {
      await this.bus?.publish(route.instanceId, {
        type: "disconnect-device",
        deviceId,
        sessionId: route.sessionId,
        reason,
      });
    }
  }

  async listOnlineDevices(userId: string): Promise<OnlineDeviceSnapshot[]> {
    const routes = await this.presence.listDeviceRoutesForUser(userId);
    return routes.map(({ userId: _userId, instanceId: _instanceId, ...session }) => session);
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
      peer.send(
        buildEcoJsonRpcFailure(request.id ?? null, ECO_RPC_ERROR.methodNotFound, "Method was not found."),
      );
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
    const bindings = await this.store.listActiveBindingsForDesktop(peer.userId, peer.deviceId);
    let fanoutCount = 0;
    for (const binding of bindings) {
      const mobile = this.mobiles.get(binding.mobileDeviceId);
      if (mobile && binding.capabilities.includes("events:read")) {
        mobile.send(notification);
        fanoutCount += 1;
        continue;
      }
      const route = await this.presence.getDeviceRoute(binding.mobileDeviceId);
      if (route && route.instanceId !== this.instanceId && binding.capabilities.includes("events:read")) {
        await this.bus?.publish(route.instanceId, {
          type: "event",
          mobileDeviceId: binding.mobileDeviceId,
          mobileSessionId: route.sessionId,
          notification,
        });
        fanoutCount += 1;
      }
    }
    await this.store.createAuditLog({
      id: createId("aud"),
      userId: peer.userId,
      action: "event.publish",
      status: "accepted",
      actorDeviceId: peer.deviceId,
      rpcMethod: notification.method,
      metadata: {
        kind: event?.kind,
        fanoutCount,
      },
      now: this.clock().toISOString(),
    });
  }

  private async routeMobileInvoke(peer: RpcPeer, request: EcoJsonRpcRequest<EcoInvokeParams>): Promise<void> {
    if (peer.deviceKind !== "mobile") {
      peer.send(
        buildEcoJsonRpcFailure(
          request.id ?? null,
          ECO_RPC_ERROR.forbidden,
          "Only mobile devices can invoke PC commands.",
        ),
      );
      return;
    }
    if (!isEcoInvokeParams(request.params)) {
      peer.send(
        buildEcoJsonRpcFailure(
          request.id ?? null,
          ECO_RPC_ERROR.invalidParams,
          "eco.invoke params are invalid.",
        ),
      );
      return;
    }
    const params = request.params;
    const binding = await this.store.findActiveBinding(peer.userId, params.desktopDeviceId, peer.deviceId);
    if (!binding) {
      await this.auditInvokeRejected(peer, params, "Device is not bound to the target desktop.");
      peer.send(
        buildEcoJsonRpcFailure(
          request.id ?? null,
          ECO_RPC_ERROR.forbidden,
          "Device is not bound to the target desktop.",
        ),
      );
      return;
    }
    let authorization: InvokeAuthorization;
    try {
      authorization = this.policy.authorizeMobileInvoke({
        params,
        mobileCapabilities: peer.capabilities,
        binding,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Command is forbidden.";
      await this.auditInvokeRejected(peer, params, message);
      peer.send(buildEcoJsonRpcFailure(request.id ?? null, ECO_RPC_ERROR.forbidden, message));
      return;
    }
    const desktop = this.desktops.get(params.desktopDeviceId);
    const desktopRoute = desktop ? undefined : await this.presence.getDeviceRoute(params.desktopDeviceId);
    if (!desktop && (!desktopRoute || desktopRoute.instanceId === this.instanceId || !this.bus)) {
      await this.auditInvokeRejected(
        peer,
        params,
        "Target desktop is offline.",
        "target_offline",
        authorization.command,
      );
      peer.send(
        buildEcoJsonRpcFailure(request.id ?? null, ECO_RPC_ERROR.targetOffline, "Target desktop is offline."),
      );
      return;
    }

    const serverId = createId("rpc");
    const timeoutMs = Math.min(params.deadlineMs ?? this.rpcTimeoutMs, this.rpcTimeoutMs);
    const timeout = setTimeout(() => {
      this.pending.delete(serverId);
      peer.send(buildEcoJsonRpcFailure(request.id ?? null, ECO_RPC_ERROR.timeout, "PC command timed out."));
      void this.store.createAuditLog({
        id: createId("aud"),
        userId: peer.userId,
        action: "rpc.invoke",
        status: "timeout",
        actorDeviceId: peer.deviceId,
        targetDeviceId: params.desktopDeviceId,
        rpcMethod: ECO_RPC_METHODS.invoke,
        channel: params.channel,
        metadata: commandAuditMetadata(authorization.command),
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
      command: authorization.command,
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
    const forwardedRequest = buildEcoJsonRpcRequest(serverId, ECO_RPC_METHODS.invoke, forwarded);
    if (desktop) {
      desktop.send(forwardedRequest);
    } else if (desktopRoute) {
      await this.bus?.publish(desktopRoute.instanceId, {
        type: "invoke",
        serverId,
        originInstanceId: this.instanceId,
        desktopDeviceId: params.desktopDeviceId,
        desktopSessionId: desktopRoute.sessionId,
        request: forwardedRequest,
        deadlineMs: timeoutMs,
      });
    }
    await this.store.createAuditLog({
      id: createId("aud"),
      userId: peer.userId,
      action: "rpc.invoke",
      status: "accepted",
      actorDeviceId: peer.deviceId,
      targetDeviceId: params.desktopDeviceId,
      rpcMethod: ECO_RPC_METHODS.invoke,
      channel: params.channel,
      metadata: {
        ...commandAuditMetadata(authorization.command),
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
      const remote = this.remoteDesktopRequests.get(response.id);
      if (remote && remote.desktopDeviceId === peer.deviceId && remote.desktopSessionId === peer.sessionId) {
        clearTimeout(remote.timeout);
        this.remoteDesktopRequests.delete(response.id);
        await this.bus?.publish(remote.originInstanceId, {
          type: "response",
          serverId: response.id,
          response,
        });
      }
      return;
    }
    await this.completePendingResponse(response.id, response);
  }

  private async completePendingResponse(serverId: string, response: EcoJsonRpcResponse): Promise<void> {
    const pending = this.pending.get(serverId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pending.delete(serverId);
    if ("error" in response) {
      pending.mobile.send(
        buildEcoJsonRpcFailure(
          pending.originalId,
          response.error.code,
          response.error.message,
          response.error.data,
        ),
      );
      await this.store.createAuditLog({
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
        metadata: commandAuditMetadata(pending.command),
        now: this.clock().toISOString(),
      });
      return;
    }
    pending.mobile.send(buildEcoJsonRpcSuccess(pending.originalId, response.result));
    await this.store.createAuditLog({
      id: createId("aud"),
      userId: pending.userId,
      action: "rpc.invoke",
      status: "succeeded",
      actorDeviceId: pending.mobileDeviceId,
      targetDeviceId: pending.desktopDeviceId,
      rpcMethod: ECO_RPC_METHODS.invoke,
      channel: pending.channel,
      metadata: commandAuditMetadata(pending.command),
      now: this.clock().toISOString(),
    });
  }

  private async handleBusMessage(message: RpcBusMessage): Promise<void> {
    switch (message.type) {
      case "invoke":
        await this.handleBusInvoke(message);
        return;
      case "response":
        await this.completePendingResponse(message.serverId, message.response);
        return;
      case "event":
        this.handleBusEvent(message);
        return;
      case "notification":
        this.handleBusNotification(message);
        return;
      case "disconnect-device":
        await this.handleBusDisconnectDevice(message);
        return;
    }
  }

  private async handleBusInvoke(message: Extract<RpcBusMessage, { type: "invoke" }>): Promise<void> {
    const desktop = this.desktops.get(message.desktopDeviceId);
    if (!desktop || desktop.sessionId !== message.desktopSessionId) {
      await this.bus?.publish(message.originInstanceId, {
        type: "response",
        serverId: message.serverId,
        response: buildEcoJsonRpcFailure(
          message.serverId,
          ECO_RPC_ERROR.targetOffline,
          "Target desktop disconnected.",
        ),
      });
      return;
    }
    const timeout = setTimeout(() => {
      this.remoteDesktopRequests.delete(message.serverId);
    }, message.deadlineMs);
    this.remoteDesktopRequests.set(message.serverId, {
      originInstanceId: message.originInstanceId,
      desktopDeviceId: message.desktopDeviceId,
      desktopSessionId: message.desktopSessionId,
      timeout,
    });
    desktop.send(message.request);
  }

  private handleBusEvent(message: Extract<RpcBusMessage, { type: "event" }>): void {
    const mobile = this.mobiles.get(message.mobileDeviceId);
    if (mobile?.sessionId === message.mobileSessionId) {
      mobile.send(message.notification);
    }
  }

  private handleBusNotification(message: Extract<RpcBusMessage, { type: "notification" }>): void {
    const peer = this.desktops.get(message.deviceId) ?? this.mobiles.get(message.deviceId);
    if (peer?.sessionId === message.sessionId) {
      peer.send(message.notification);
    }
  }

  private async handleBusDisconnectDevice(
    message: Extract<RpcBusMessage, { type: "disconnect-device" }>,
  ): Promise<void> {
    const peer = this.desktops.get(message.deviceId) ?? this.mobiles.get(message.deviceId);
    if (!peer || peer.sessionId !== message.sessionId) {
      return;
    }
    peer.close?.(4003, message.reason);
    await this.disconnect(peer);
  }

  private async failPendingForDesktop(desktopDeviceId: string): Promise<void> {
    for (const pending of this.pending.values()) {
      if (pending.desktopDeviceId !== desktopDeviceId) {
        continue;
      }
      clearTimeout(pending.timeout);
      this.pending.delete(pending.serverId);
      pending.mobile.send(
        buildEcoJsonRpcFailure(
          pending.originalId,
          ECO_RPC_ERROR.targetOffline,
          "Target desktop disconnected.",
        ),
      );
      await this.store.createAuditLog({
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
        metadata: commandAuditMetadata(pending.command),
        now: this.clock().toISOString(),
      });
    }
    for (const [serverId, remote] of this.remoteDesktopRequests.entries()) {
      if (remote.desktopDeviceId !== desktopDeviceId) {
        continue;
      }
      clearTimeout(remote.timeout);
      this.remoteDesktopRequests.delete(serverId);
      await this.bus?.publish(remote.originInstanceId, {
        type: "response",
        serverId,
        response: buildEcoJsonRpcFailure(
          serverId,
          ECO_RPC_ERROR.targetOffline,
          "Target desktop disconnected.",
        ),
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
    await this.presence.setDeviceRoute({ ...refreshed, instanceId: this.instanceId });
  }

  private async publishPresenceDeviceEvent(
    peer: RpcPeer,
    online: boolean,
    occurredAt: string,
    session?: OnlineDeviceSnapshot & { userId: string },
  ): Promise<void> {
    const notification = buildEcoJsonRpcNotification<EcoEventEnvelope<EcoPresenceDeviceEventPayload>>(
      ECO_RPC_METHODS.event,
      {
        protocolVersion: ECO_RPC_PROTOCOL_VERSION,
        id: createId("evt"),
        kind: "presence.device",
        source: "center-server",
        occurredAt,
        aggregateKey: `device:${peer.deviceId}:presence`,
        payload: {
          type: online ? "device.online" : "device.offline",
          deviceId: peer.deviceId,
          deviceKind: peer.deviceKind,
          online,
          ...(online && session?.connectedAt ? { connectedAt: session.connectedAt } : {}),
          lastSeenAt: occurredAt,
        },
      },
    );

    if (peer.deviceKind === "desktop") {
      const bindings = await this.store.listActiveBindingsForDesktop(peer.userId, peer.deviceId);
      for (const binding of bindings) {
        if (!binding.capabilities.includes("events:read")) {
          continue;
        }
        await this.sendNotificationToDevice(peer.userId, binding.mobileDeviceId, notification);
      }
      return;
    }

    const bindings = await this.store.listActiveBindingsForMobile(peer.userId, peer.deviceId);
    for (const binding of bindings) {
      if (!binding.capabilities.includes("events:read")) {
        continue;
      }
      await this.sendNotificationToDevice(peer.userId, binding.desktopDeviceId, notification);
    }
  }

  private async sendNotificationToDevice(
    userId: string,
    deviceId: string,
    notification: EcoJsonRpcNotification,
  ): Promise<void> {
    const peer = this.desktops.get(deviceId) ?? this.mobiles.get(deviceId);
    if (peer) {
      if (peer.userId === userId) {
        peer.send(notification);
      }
      return;
    }
    const route = await this.presence.getDeviceRoute(deviceId);
    if (!route || route.userId !== userId || route.instanceId === this.instanceId) {
      return;
    }
    await this.bus?.publish(route.instanceId, {
      type: "notification",
      deviceId,
      sessionId: route.sessionId,
      notification,
    });
  }

  private async auditInvokeRejected(
    peer: RpcPeer,
    params: EcoInvokeParams,
    message: string,
    reason = "forbidden",
    command?: RemoteCommandDefinition,
  ): Promise<void> {
    await this.store.createAuditLog({
      id: createId("aud"),
      userId: peer.userId,
      action: "rpc.invoke",
      status: "rejected",
      actorDeviceId: peer.deviceId,
      targetDeviceId: params.desktopDeviceId,
      rpcMethod: ECO_RPC_METHODS.invoke,
      channel: params.channel,
      errorMessage: message,
      metadata: { reason, ...(command ? commandAuditMetadata(command) : {}) },
      now: this.clock().toISOString(),
    });
  }
}

function commandAuditMetadata(command: RemoteCommandDefinition): Record<string, unknown> {
  return {
    remoteCommand: command.channel,
    remoteCommandAction: command.auditAction,
    remoteCommandRisk: command.risk,
    requiresConfirmation: command.requiresConfirmation,
  };
}

function parseJsonRpc(
  rawMessage: string | Uint8Array,
): { ok: true; value: unknown } | { ok: false; error: string } {
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
