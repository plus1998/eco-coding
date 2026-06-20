import { expect, test } from "bun:test";
import {
  buildEcoJsonRpcNotification,
  buildEcoJsonRpcRequest,
  buildEcoJsonRpcSuccess,
  ECO_RPC_METHODS,
  type EcoJsonRpcMessage,
} from "@eco/shared";
import { MemoryPresenceStore } from "../src/presence/presence-store";
import { RpcGateway, type RpcPeer } from "../src/rpc/rpc-gateway";
import { closeTestMongoStore, createTestMongoStore } from "./mongo-test-store";

test("routes mobile eco.invoke requests to the bound desktop and returns desktop responses", async () => {
  const context = await createGatewayContext();
  await context.gateway.connect(context.desktopPeer);
  await context.gateway.connect(context.mobilePeer);

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

function createPeer(input: Omit<RpcPeer, "send"> & { messages: EcoJsonRpcMessage[] }): RpcPeer {
  return {
    sessionId: input.sessionId,
    userId: input.userId,
    deviceId: input.deviceId,
    deviceKind: input.deviceKind,
    capabilities: input.capabilities,
    send(message) {
      input.messages.push(message);
    },
  };
}
