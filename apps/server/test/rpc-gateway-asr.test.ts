import { expect, test } from "bun:test";
import {
  buildEcoJsonRpcRequest,
  buildEcoJsonRpcSuccess,
  ECO_RPC_METHODS,
  type EcoJsonRpcMessage,
} from "@eco/shared";
import type { MongoStore } from "../src/db/mongo-store";
import { MemoryPresenceStore } from "../src/presence/presence-store";
import { MemoryRpcBus, MemoryRpcBusHub } from "../src/rpc/rpc-bus";
import { RpcGateway, type RpcPeer } from "../src/rpc/rpc-gateway";

const NOW = "2026-01-01T00:00:00.000Z";
const RPC_TIMEOUT_MS = 30_000;

test("rejects remote access to authenticated ASR client config", async () => {
  const context = createGatewayContext();
  await connectPeers(context);

  await invoke(context.gateway, context.mobilePeer, "mobile_req_asr_secret", {
    channel: "asr-settings:get-client-config",
    args: [],
  });

  expect(context.desktopMessages).toHaveLength(0);
  expect(context.mobileMessages[0]).toMatchObject({
    jsonrpc: "2.0",
    id: "mobile_req_asr_secret",
    error: {
      code: -32003,
      message: "PC command is not remote-enabled: asr-settings:get-client-config",
    },
  });
});

test("forwards ASR transcription without recording audio in audit metadata", async () => {
  const context = createGatewayContext();
  await connectPeers(context);
  const audioWavBase64 = "UklGRkFVRElPX1NFQ1JFVA==";

  await invoke(context.gateway, context.mobilePeer, "mobile_req_asr", {
    channel: "asr:transcribe",
    args: [{ audioWavBase64, profileId: "profile_1" }],
    deadlineMs: 240_000,
  });

  expect(context.desktopMessages).toHaveLength(1);
  const forwarded = context.desktopMessages[0] as {
    id: string;
    params: { channel: string; args: unknown[]; deadlineMs: number };
  };
  expect(forwarded.params).toMatchObject({
    channel: "asr:transcribe",
    args: [{ audioWavBase64, profileId: "profile_1" }],
    deadlineMs: 240_000,
  });

  await context.gateway.handleMessage(
    context.desktopPeer,
    JSON.stringify(buildEcoJsonRpcSuccess(forwarded.id, { text: "transcribed" })),
  );

  const asrAudits = context.auditLogs.filter((log) => log.channel === "asr:transcribe");
  expect(asrAudits.map((log) => log.status)).toEqual(["accepted", "succeeded"]);
  expect(asrAudits[0]).toMatchObject({
    metadata: {
      remoteCommand: "asr:transcribe",
      remoteCommandRisk: "execute",
      requiresConfirmation: false,
    },
  });
  for (const audit of asrAudits) {
    const metadata = JSON.stringify(audit.metadata);
    expect(metadata).not.toContain("audioWavBase64");
    expect(metadata).not.toContain(audioWavBase64);
    expect(metadata).not.toContain('"args"');
  }
});

test("keeps ordinary remote commands within the configured RPC timeout", async () => {
  const context = createGatewayContext();
  await connectPeers(context);

  await invoke(context.gateway, context.mobilePeer, "mobile_req_timeout", {
    channel: "thread:list",
    args: [],
    deadlineMs: 240_000,
  });

  const forwarded = context.desktopMessages[0] as { id: string; params: { deadlineMs: number } };
  expect(forwarded.params.deadlineMs).toBe(RPC_TIMEOUT_MS);
  await context.gateway.handleMessage(
    context.desktopPeer,
    JSON.stringify(buildEcoJsonRpcSuccess(forwarded.id, { threads: [] })),
  );
});

test("uses the 240 second ASR timeout limit across server instances", async () => {
  const context = createTwoInstanceContext();
  await context.gatewayA.start();
  await context.gatewayB.start();
  await context.gatewayA.connect(context.mobilePeer);
  await context.gatewayB.connect(context.desktopPeer);
  clearMessages(context);

  await invoke(context.gatewayA, context.mobilePeer, "mobile_req_asr_remote", {
    channel: "asr:transcribe",
    args: [{ audioWavBase64: "UklGRg==" }],
    deadlineMs: 300_000,
  });

  const forwarded = context.desktopMessages[0] as {
    id: string;
    params: { channel: string; deadlineMs: number };
  };
  expect(forwarded.params).toMatchObject({
    channel: "asr:transcribe",
    deadlineMs: 240_000,
  });
  await context.gatewayB.handleMessage(
    context.desktopPeer,
    JSON.stringify(buildEcoJsonRpcSuccess(forwarded.id, { text: "transcribed" })),
  );

  await context.gatewayA.close();
  await context.gatewayB.close();
});

function createGatewayContext() {
  const auditLogs: Array<Record<string, unknown>> = [];
  const store = createMemoryStore(auditLogs);
  const gateway = new RpcGateway({
    store,
    presence: new MemoryPresenceStore(),
    rpcTimeoutMs: RPC_TIMEOUT_MS,
    now: () => new Date(NOW),
  });
  const desktopMessages: EcoJsonRpcMessage[] = [];
  const mobileMessages: EcoJsonRpcMessage[] = [];
  return {
    auditLogs,
    gateway,
    desktopMessages,
    mobileMessages,
    desktopPeer: createPeer("desktop", desktopMessages),
    mobilePeer: createPeer("mobile", mobileMessages),
  };
}

function createTwoInstanceContext() {
  const auditLogs: Array<Record<string, unknown>> = [];
  const store = createMemoryStore(auditLogs);
  const presence = new MemoryPresenceStore();
  const hub = new MemoryRpcBusHub();
  const gatewayA = new RpcGateway({
    store,
    presence,
    instanceId: "server-a",
    bus: new MemoryRpcBus("server-a", hub),
    rpcTimeoutMs: RPC_TIMEOUT_MS,
    now: () => new Date(NOW),
  });
  const gatewayB = new RpcGateway({
    store,
    presence,
    instanceId: "server-b",
    bus: new MemoryRpcBus("server-b", hub),
    rpcTimeoutMs: RPC_TIMEOUT_MS,
    now: () => new Date(NOW),
  });
  const desktopMessages: EcoJsonRpcMessage[] = [];
  const mobileMessages: EcoJsonRpcMessage[] = [];
  return {
    gatewayA,
    gatewayB,
    desktopMessages,
    mobileMessages,
    desktopPeer: createPeer("desktop", desktopMessages),
    mobilePeer: createPeer("mobile", mobileMessages),
  };
}

function createMemoryStore(auditLogs: Array<Record<string, unknown>>): MongoStore {
  const binding = {
    id: "bind_1",
    userId: "usr_1",
    desktopDeviceId: "dev_desktop",
    mobileDeviceId: "dev_mobile",
    capabilities: ["events:read", "rpc:invoke", "approval:decide"],
    createdAt: NOW,
    revokedAt: null,
  };
  return {
    touchDevice: async () => undefined,
    updateDeviceProfile: async () => undefined,
    listActiveBindingsForDesktop: async () => [],
    listActiveBindingsForMobile: async () => [],
    findActiveBinding: async () => binding,
    createAuditLog: async (input: Record<string, unknown>) => {
      auditLogs.push(input);
      return input;
    },
  } as unknown as MongoStore;
}

function createPeer(deviceKind: "desktop" | "mobile", messages: EcoJsonRpcMessage[]): RpcPeer {
  const desktop = deviceKind === "desktop";
  return {
    sessionId: desktop ? "sess_desktop" : "sess_mobile",
    userId: "usr_1",
    deviceId: desktop ? "dev_desktop" : "dev_mobile",
    deviceKind,
    capabilities: desktop
      ? ["events:publish", "rpc:receive", "device:pair"]
      : ["events:read", "rpc:invoke", "approval:decide"],
    send(message) {
      messages.push(message);
    },
  };
}

async function connectPeers(context: ReturnType<typeof createGatewayContext>): Promise<void> {
  await context.gateway.connect(context.desktopPeer);
  await context.gateway.connect(context.mobilePeer);
  clearMessages(context);
}

async function invoke(
  gateway: RpcGateway,
  mobilePeer: RpcPeer,
  requestId: string,
  input: {
    channel: string;
    args: unknown[];
    deadlineMs?: number;
  },
): Promise<void> {
  await gateway.handleMessage(
    mobilePeer,
    JSON.stringify(
      buildEcoJsonRpcRequest(requestId, ECO_RPC_METHODS.invoke, {
        desktopDeviceId: "dev_desktop",
        ...input,
      }),
    ),
  );
}

function clearMessages(input: {
  desktopMessages: EcoJsonRpcMessage[];
  mobileMessages: EcoJsonRpcMessage[];
}): void {
  input.desktopMessages.length = 0;
  input.mobileMessages.length = 0;
}
