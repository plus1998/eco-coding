import { expect, test } from "bun:test";
import {
  buildEcoJsonRpcNotification,
  buildEcoJsonRpcRequest,
  buildEcoJsonRpcSuccess,
  ECO_RPC_METHODS,
  type EcoJsonRpcMessage,
} from "@eco/shared";
import { MemoryPresenceStore } from "../src/presence/presence-store";
import { MemoryRpcBus, MemoryRpcBusHub } from "../src/rpc/rpc-bus";
import { RpcGateway, type RpcPeer } from "../src/rpc/rpc-gateway";
import { closeTestMongoStore, createTestMongoStore } from "./mongo-test-store";

test("routes mobile eco.invoke requests to the bound desktop and returns desktop responses", async () => {
  const context = await createGatewayContext();
  await context.gateway.connect(context.desktopPeer);
  await context.gateway.connect(context.mobilePeer);
  clearMessages(context);

  await context.gateway.handleMessage(
    context.mobilePeer,
    JSON.stringify(
      buildEcoJsonRpcRequest("mobile_req_1", ECO_RPC_METHODS.invoke, {
        desktopDeviceId: context.desktopPeer.deviceId,
        channel: "thread:list",
        args: [],
      }),
    ),
  );

  expect(context.desktopMessages).toHaveLength(1);
  const forwarded = context.desktopMessages[0];
  expect(forwarded).toMatchObject({
    jsonrpc: "2.0",
    method: ECO_RPC_METHODS.invoke,
  });
  expect((forwarded as { params: { caller: string } }).params.caller).toBe("mobile");

  await context.gateway.handleMessage(
    context.desktopPeer,
    JSON.stringify(buildEcoJsonRpcSuccess((forwarded as { id: string }).id, { threads: [] })),
  );

  expect(context.mobileMessages).toContainEqual({
    jsonrpc: "2.0",
    id: "mobile_req_1",
    result: { threads: [] },
  });
  expect((await context.store.listAuditLogs()).map((log) => log.status).sort()).toEqual([
    "accepted",
    "succeeded",
  ]);
  await closeTestMongoStore(context.store);
});

test("rejects invokes from unbound mobile devices", async () => {
  const context = await createGatewayContext({ bindDevices: false });
  await context.gateway.connect(context.desktopPeer);
  await context.gateway.connect(context.mobilePeer);

  await context.gateway.handleMessage(
    context.mobilePeer,
    JSON.stringify(
      buildEcoJsonRpcRequest("mobile_req_1", ECO_RPC_METHODS.invoke, {
        desktopDeviceId: context.desktopPeer.deviceId,
        channel: "thread:list",
      }),
    ),
  );

  expect(context.desktopMessages).toHaveLength(0);
  expect(context.mobileMessages[0]).toMatchObject({
    jsonrpc: "2.0",
    id: "mobile_req_1",
    error: {
      code: -32003,
    },
  });
  expect(await context.store.listAuditLogs()).toHaveLength(1);
  await closeTestMongoStore(context.store);
});

test("rejects non remote-enabled commands before forwarding to desktop", async () => {
  const context = await createGatewayContext();
  await context.gateway.connect(context.desktopPeer);
  await context.gateway.connect(context.mobilePeer);
  clearMessages(context);

  await context.gateway.handleMessage(
    context.mobilePeer,
    JSON.stringify(
      buildEcoJsonRpcRequest("mobile_req_1", ECO_RPC_METHODS.invoke, {
        desktopDeviceId: context.desktopPeer.deviceId,
        channel: "center-server:sign-in",
        args: [],
      }),
    ),
  );

  expect(context.desktopMessages).toHaveLength(0);
  expect(context.mobileMessages[0]).toMatchObject({
    jsonrpc: "2.0",
    id: "mobile_req_1",
    error: {
      code: -32003,
      message: "PC command is not remote-enabled: center-server:sign-in",
    },
  });
  expect((await context.store.listAuditLogs())[0]).toMatchObject({
    status: "rejected",
    channel: "center-server:sign-in",
  });
  await closeTestMongoStore(context.store);
});

test("rejects remote commands with invalid args before forwarding to desktop", async () => {
  const context = await createGatewayContext();
  await context.gateway.connect(context.desktopPeer);
  await context.gateway.connect(context.mobilePeer);
  clearMessages(context);

  await context.gateway.handleMessage(
    context.mobilePeer,
    JSON.stringify(
      buildEcoJsonRpcRequest("mobile_req_1", ECO_RPC_METHODS.invoke, {
        desktopDeviceId: context.desktopPeer.deviceId,
        channel: "thread:start",
        args: [],
      }),
    ),
  );

  expect(context.desktopMessages).toHaveLength(0);
  expect(context.mobileMessages[0]).toMatchObject({
    jsonrpc: "2.0",
    id: "mobile_req_1",
    error: {
      code: -32003,
    },
  });
  expect(JSON.stringify(context.mobileMessages[0])).toContain("expects 1 args");
  await closeTestMongoStore(context.store);
});

test("requires approval capability for privileged remote commands", async () => {
  const context = await createGatewayContext({
    mobileCapabilities: ["events:read", "rpc:invoke"],
    bindingCapabilities: ["events:read", "rpc:invoke"],
  });
  await context.gateway.connect(context.desktopPeer);
  await context.gateway.connect(context.mobilePeer);
  clearMessages(context);

  await context.gateway.handleMessage(
    context.mobilePeer,
    JSON.stringify(
      buildEcoJsonRpcRequest("mobile_req_1", ECO_RPC_METHODS.invoke, {
        desktopDeviceId: context.desktopPeer.deviceId,
        channel: "thread:approve-plan",
        args: [{ threadId: "thr_1" }],
      }),
    ),
  );

  expect(context.desktopMessages).toHaveLength(0);
  expect(context.mobileMessages[0]).toMatchObject({
    jsonrpc: "2.0",
    id: "mobile_req_1",
    error: {
      code: -32003,
      message: "Mobile device is missing required capability approval:decide.",
    },
  });
  await closeTestMongoStore(context.store);
});

test("fans out desktop events only to bound online mobiles", async () => {
  const context = await createGatewayContext();
  await context.gateway.connect(context.desktopPeer);
  await context.gateway.connect(context.mobilePeer);
  clearMessages(context);

  const event = buildEcoJsonRpcNotification(ECO_RPC_METHODS.event, {
    protocolVersion: 1,
    id: "evt_1",
    kind: "thread.lifecycle",
    source: "desktop",
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload: { type: "thread.started" },
  });
  await context.gateway.handleMessage(context.desktopPeer, JSON.stringify(event));

  expect(context.mobileMessages).toEqual([event]);
  expect(await context.store.listAuditLogs()).toMatchObject([
    {
      action: "event.publish",
      status: "accepted",
    },
  ]);
  await closeTestMongoStore(context.store);
});

test("publishes desktop presence changes to bound mobiles", async () => {
  const context = await createGatewayContext();
  await context.gateway.connect(context.mobilePeer);

  await context.gateway.connect(context.desktopPeer);
  expectPresenceNotification(context.mobileMessages, context.desktopPeer.deviceId, true);

  context.mobileMessages.length = 0;
  await context.gateway.disconnect(context.desktopPeer);
  expectPresenceNotification(context.mobileMessages, context.desktopPeer.deviceId, false);

  await closeTestMongoStore(context.store);
});

test("publishes mobile presence changes to bound desktops", async () => {
  const context = await createGatewayContext();
  await context.gateway.connect(context.desktopPeer);

  await context.gateway.connect(context.mobilePeer);
  expectPresenceNotification(context.desktopMessages, context.mobilePeer.deviceId, true);

  context.desktopMessages.length = 0;
  await context.gateway.disconnect(context.mobilePeer);
  expectPresenceNotification(context.desktopMessages, context.mobilePeer.deviceId, false);

  await closeTestMongoStore(context.store);
});

test("routes mobile invokes across server instances", async () => {
  const context = await createTwoInstanceContext();
  await context.gatewayA.connect(context.mobilePeer);
  await context.gatewayB.connect(context.desktopPeer);
  clearMessages(context);

  await context.gatewayA.handleMessage(
    context.mobilePeer,
    JSON.stringify(
      buildEcoJsonRpcRequest("mobile_req_1", ECO_RPC_METHODS.invoke, {
        desktopDeviceId: context.desktopPeer.deviceId,
        channel: "thread:list",
        args: [],
      }),
    ),
  );

  expect(context.desktopMessages).toHaveLength(1);
  const forwarded = context.desktopMessages[0] as { id: string };
  await context.gatewayB.handleMessage(
    context.desktopPeer,
    JSON.stringify(buildEcoJsonRpcSuccess(forwarded.id, { threads: [] })),
  );

  expect(context.mobileMessages).toContainEqual({
    jsonrpc: "2.0",
    id: "mobile_req_1",
    result: { threads: [] },
  });
  expect((await context.store.listAuditLogs()).map((log) => log.status).sort()).toEqual([
    "accepted",
    "succeeded",
  ]);
  await context.busA.close();
  await context.busB.close();
  await closeTestMongoStore(context.store);
});

test("publishes presence changes across server instances", async () => {
  const context = await createTwoInstanceContext();
  await context.gatewayA.connect(context.mobilePeer);

  await context.gatewayB.connect(context.desktopPeer);
  expectPresenceNotification(context.mobileMessages, context.desktopPeer.deviceId, true);

  context.mobileMessages.length = 0;
  await context.gatewayB.disconnect(context.desktopPeer);
  expectPresenceNotification(context.mobileMessages, context.desktopPeer.deviceId, false);

  await context.busA.close();
  await context.busB.close();
  await closeTestMongoStore(context.store);
});

test("fans out desktop events across server instances", async () => {
  const context = await createTwoInstanceContext();
  await context.gatewayA.connect(context.mobilePeer);
  await context.gatewayB.connect(context.desktopPeer);
  clearMessages(context);

  const event = buildEcoJsonRpcNotification(ECO_RPC_METHODS.event, {
    protocolVersion: 1,
    id: "evt_remote",
    kind: "thread.lifecycle",
    source: "desktop",
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload: { type: "thread.started" },
  });
  await context.gatewayB.handleMessage(context.desktopPeer, JSON.stringify(event));

  expect(context.mobileMessages).toEqual([event]);
  await context.busA.close();
  await context.busB.close();
  await closeTestMongoStore(context.store);
});

test("disconnects devices across server instances", async () => {
  const context = await createTwoInstanceContext();
  await context.gatewayA.connect(context.mobilePeer);
  await context.gatewayB.connect(context.desktopPeer);

  await context.gatewayA.disconnectDevice(context.desktopPeer.deviceId, "Device was disabled.");

  expect(context.desktopCloses).toEqual([{ code: 4003, reason: "Device was disabled." }]);
  expect(await context.presence.getDeviceRoute(context.desktopPeer.deviceId)).toBeUndefined();
  await context.busA.close();
  await context.busB.close();
  await closeTestMongoStore(context.store);
});

async function createGatewayContext(
  options: {
    bindDevices?: boolean;
    bindingCapabilities?: Array<"events:read" | "rpc:invoke" | "approval:decide">;
    mobileCapabilities?: Array<"events:read" | "rpc:invoke" | "approval:decide">;
  } = {},
) {
  const store = await createTestMongoStore("rpc_gateway");
  const now = "2026-01-01T00:00:00.000Z";
  const user = await store.createUser({
    id: "usr_1",
    email: "owner@example.com",
    displayName: null,
    passwordSalt: "salt",
    passwordHash: "hash",
    passwordIterations: 1,
    now,
  });
  const desktop = await store.createDevice({
    id: "dev_desktop",
    userId: user.id,
    kind: "desktop",
    name: "Desktop",
    secretHash: "secret",
    now,
  });
  const mobile = await store.createDevice({
    id: "dev_mobile",
    userId: user.id,
    kind: "mobile",
    name: "Mobile",
    secretHash: "secret",
    now,
  });
  if (options.bindDevices ?? true) {
    await store.createDeviceBinding({
      id: "bind_1",
      userId: user.id,
      desktopDeviceId: desktop.id,
      mobileDeviceId: mobile.id,
      capabilities: options.bindingCapabilities ?? ["events:read", "rpc:invoke", "approval:decide"],
      now,
    });
  }
  const gateway = new RpcGateway({
    store,
    presence: new MemoryPresenceStore(),
    rpcTimeoutMs: 1000,
    now: () => new Date(now),
  });
  const desktopMessages: EcoJsonRpcMessage[] = [];
  const mobileMessages: EcoJsonRpcMessage[] = [];
  const desktopPeer = createPeer({
    userId: user.id,
    deviceId: desktop.id,
    deviceKind: "desktop",
    sessionId: "sess_desktop",
    capabilities: ["events:publish", "rpc:receive", "device:pair"],
    messages: desktopMessages,
  });
  const mobilePeer = createPeer({
    userId: user.id,
    deviceId: mobile.id,
    deviceKind: "mobile",
    sessionId: "sess_mobile",
    capabilities: options.mobileCapabilities ?? ["events:read", "rpc:invoke", "approval:decide"],
    messages: mobileMessages,
  });
  return {
    store,
    gateway,
    desktopPeer,
    mobilePeer,
    desktopMessages,
    mobileMessages,
  };
}

async function createTwoInstanceContext() {
  const store = await createTestMongoStore("rpc_gateway_multi_instance");
  const presence = new MemoryPresenceStore();
  const hub = new MemoryRpcBusHub();
  const busA = new MemoryRpcBus("server-a", hub);
  const busB = new MemoryRpcBus("server-b", hub);
  const now = "2026-01-01T00:00:00.000Z";
  const user = await store.createUser({
    id: "usr_1",
    email: "owner@example.com",
    displayName: null,
    passwordSalt: "salt",
    passwordHash: "hash",
    passwordIterations: 1,
    now,
  });
  const desktop = await store.createDevice({
    id: "dev_desktop",
    userId: user.id,
    kind: "desktop",
    name: "Desktop",
    secretHash: "secret",
    now,
  });
  const mobile = await store.createDevice({
    id: "dev_mobile",
    userId: user.id,
    kind: "mobile",
    name: "Mobile",
    secretHash: "secret",
    now,
  });
  await store.createDeviceBinding({
    id: "bind_1",
    userId: user.id,
    desktopDeviceId: desktop.id,
    mobileDeviceId: mobile.id,
    capabilities: ["events:read", "rpc:invoke", "approval:decide"],
    now,
  });
  const gatewayA = new RpcGateway({
    store,
    presence,
    instanceId: "server-a",
    bus: busA,
    rpcTimeoutMs: 1000,
    now: () => new Date(now),
  });
  const gatewayB = new RpcGateway({
    store,
    presence,
    instanceId: "server-b",
    bus: busB,
    rpcTimeoutMs: 1000,
    now: () => new Date(now),
  });
  await gatewayA.start();
  await gatewayB.start();
  const desktopMessages: EcoJsonRpcMessage[] = [];
  const mobileMessages: EcoJsonRpcMessage[] = [];
  const desktopCloses: Array<{ code: number; reason: string }> = [];
  const desktopPeer = createPeer({
    userId: user.id,
    deviceId: desktop.id,
    deviceKind: "desktop",
    sessionId: "sess_desktop",
    capabilities: ["events:publish", "rpc:receive", "device:pair"],
    messages: desktopMessages,
    closes: desktopCloses,
  });
  const mobilePeer = createPeer({
    userId: user.id,
    deviceId: mobile.id,
    deviceKind: "mobile",
    sessionId: "sess_mobile",
    capabilities: ["events:read", "rpc:invoke", "approval:decide"],
    messages: mobileMessages,
  });
  return {
    store,
    presence,
    busA,
    busB,
    gatewayA,
    gatewayB,
    desktopPeer,
    mobilePeer,
    desktopMessages,
    mobileMessages,
    desktopCloses,
  };
}

function createPeer(
  input: Omit<RpcPeer, "send" | "close"> & {
    messages: EcoJsonRpcMessage[];
    closes?: Array<{ code: number; reason: string }>;
  },
): RpcPeer {
  return {
    sessionId: input.sessionId,
    userId: input.userId,
    deviceId: input.deviceId,
    deviceKind: input.deviceKind,
    capabilities: input.capabilities,
    send(message) {
      input.messages.push(message);
    },
    close(code, reason) {
      input.closes?.push({ code, reason });
    },
  };
}

function clearMessages(input: {
  desktopMessages: EcoJsonRpcMessage[];
  mobileMessages: EcoJsonRpcMessage[];
}): void {
  input.desktopMessages.length = 0;
  input.mobileMessages.length = 0;
}

function expectPresenceNotification(messages: EcoJsonRpcMessage[], deviceId: string, online: boolean): void {
  expect(messages).toContainEqual(
    expect.objectContaining({
      jsonrpc: "2.0",
      method: ECO_RPC_METHODS.event,
      params: expect.objectContaining({
        kind: "presence.device",
        source: "center-server",
        payload: expect.objectContaining({
          deviceId,
          online,
        }),
      }),
    }),
  );
}
