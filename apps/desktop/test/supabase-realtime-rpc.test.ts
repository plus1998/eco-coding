import { expect, test } from "bun:test";
import {
  ECO_JSON_RPC_VERSION,
  ECO_REALTIME_BROADCAST_EVENT,
  ECO_RPC_METHODS,
  wrapEcoRpcForBroadcast,
} from "@eco/shared";
import {
  bindingCanInvoke,
  bindingHasEventsRead,
  extractEcoRpcFromBroadcastPayload,
  invokeTargetsDesktop,
  SupabaseRealtimeRpc,
} from "../src/main/supabase-realtime-rpc";

test("extractEcoRpcFromBroadcastPayload unwraps nested and flat envelopes", () => {
  const message = {
    jsonrpc: ECO_JSON_RPC_VERSION,
    id: "ping_1",
    method: ECO_RPC_METHODS.ping,
    params: {},
  };
  const envelope = wrapEcoRpcForBroadcast(message);

  expect(extractEcoRpcFromBroadcastPayload({ payload: envelope })).toEqual(message);
  expect(
    extractEcoRpcFromBroadcastPayload({
      type: "broadcast",
      event: ECO_REALTIME_BROADCAST_EVENT,
      payload: envelope,
    }),
  ).toEqual(message);
  expect(extractEcoRpcFromBroadcastPayload(envelope)).toEqual(message);
  expect(extractEcoRpcFromBroadcastPayload({ junk: true })).toBeNull();
});

test("bindingHasEventsRead checks capability", () => {
  expect(bindingHasEventsRead(["rpc:invoke", "events:read"])).toBe(true);
  expect(bindingHasEventsRead(["rpc:invoke"])).toBe(false);
});

test("bindingCanInvoke requires rpc:invoke capability", () => {
  expect(bindingCanInvoke(["events:read", "rpc:invoke"])).toBe(true);
  expect(bindingCanInvoke(["events:read"])).toBe(false);
});

test("invokeTargetsDesktop rejects a different or missing desktop target", () => {
  const desktopDeviceId = "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
  expect(
    invokeTargetsDesktop(
      {
        jsonrpc: ECO_JSON_RPC_VERSION,
        id: "invoke_1",
        method: ECO_RPC_METHODS.invoke,
        params: { desktopDeviceId, channel: "thread:list", args: [] },
      },
      desktopDeviceId,
    ),
  ).toBe(true);
  expect(
    invokeTargetsDesktop(
      {
        jsonrpc: ECO_JSON_RPC_VERSION,
        id: "invoke_2",
        method: ECO_RPC_METHODS.invoke,
        params: {
          desktopDeviceId: "c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
          channel: "thread:list",
          args: [],
        },
      },
      desktopDeviceId,
    ),
  ).toBe(false);
  expect(
    invokeTargetsDesktop(
      {
        jsonrpc: ECO_JSON_RPC_VERSION,
        id: "invoke_3",
        method: ECO_RPC_METHODS.invoke,
        params: { channel: "thread:list", args: [] },
      },
      desktopDeviceId,
    ),
  ).toBe(false);
});

test("SupabaseRealtimeRpc rejects invoke addressed to another desktop", async () => {
  const callbacks = new Map<string, (status: string, error?: Error) => void>();
  const broadcastHandlers = new Map<string, (payload: unknown) => void>();
  const sent: unknown[] = [];
  const client = createRealtimeClient(callbacks, async () => "ok", broadcastHandlers, sent);
  let invoked = false;
  const realtime = new SupabaseRealtimeRpc({
    client: client as never,
    eventCenter: {
      async handleJsonRpcMessage() {
        invoked = true;
        return undefined;
      },
    } as never,
  });
  const desktopDeviceId = "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
  const bindingId = "d3eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
  const presenceTopic = "eco:user:a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
  const bindTopic = `eco:bind:${bindingId}`;

  const startPromise = realtime.start({
    userId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    deviceId: desktopDeviceId,
  });
  await Bun.sleep(0);
  callbacks.get(presenceTopic)?.("SUBSCRIBED");
  await startPromise;
  const syncPromise = realtime.syncBindings([
    {
      id: bindingId,
      userId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      desktopDeviceId,
      mobileDeviceId: "c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      capabilities: ["rpc:invoke"],
      createdAt: "2030-01-01T00:00:00.000Z",
      revokedAt: null,
    },
  ]);
  await Bun.sleep(0);
  callbacks.get(bindTopic)?.("SUBSCRIBED");
  await syncPromise;

  broadcastHandlers.get(bindTopic)?.({
    payload: wrapEcoRpcForBroadcast({
      jsonrpc: ECO_JSON_RPC_VERSION,
      id: "invoke_wrong_target",
      method: ECO_RPC_METHODS.invoke,
      params: {
        desktopDeviceId: "e4eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        channel: "thread:list",
        args: [],
      },
    }),
  });
  await Bun.sleep(0);

  expect(invoked).toBe(false);
  expect(sent).toHaveLength(1);
  expect(JSON.stringify(sent[0])).toContain("Invoke target does not match this desktop device.");
  await realtime.stop();
});

test("SupabaseRealtimeRpc start waits for presence subscription and tracking", async () => {
  const callbacks = new Map<string, (status: string, error?: Error) => void>();
  let trackCalls = 0;
  const client = createRealtimeClient(callbacks, async () => {
    trackCalls += 1;
    return "ok";
  });
  const realtime = new SupabaseRealtimeRpc({
    client: client as never,
    eventCenter: {} as never,
  });

  let started = false;
  const startPromise = realtime
    .start({
      userId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      deviceId: "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    })
    .then(() => {
      started = true;
    });
  await Bun.sleep(0);
  expect(started).toBe(false);

  callbacks.get("eco:user:a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11")?.("SUBSCRIBED");
  await startPromise;
  expect(started).toBe(true);
  expect(trackCalls).toBe(1);

  callbacks.get("eco:user:a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11")?.("SUBSCRIBED");
  await Bun.sleep(0);
  expect(trackCalls).toBe(2);
  await realtime.stop();
});

test("SupabaseRealtimeRpc reports an unhealthy subscribed channel", async () => {
  const callbacks = new Map<string, (status: string, error?: Error) => void>();
  const failures: Error[] = [];
  const client = createRealtimeClient(callbacks, async () => "ok");
  const realtime = new SupabaseRealtimeRpc({
    client: client as never,
    eventCenter: {} as never,
    onTransportUnhealthy: (error) => failures.push(error),
  });
  const topic = "eco:user:a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
  const startPromise = realtime.start({
    userId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    deviceId: "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  });
  await Bun.sleep(0);
  callbacks.get(topic)?.("SUBSCRIBED");
  await startPromise;

  callbacks.get(topic)?.("CHANNEL_ERROR", new Error("token expired"));
  expect(failures).toHaveLength(1);
  expect(failures[0]?.message).toContain("token expired");
  await realtime.stop();
});

test("SupabaseRealtimeRpc rejects a private channel authorization failure", async () => {
  const callbacks = new Map<string, (status: string, error?: Error) => void>();
  const client = createRealtimeClient(callbacks, async () => "ok");
  const realtime = new SupabaseRealtimeRpc({
    client: client as never,
    eventCenter: {} as never,
  });
  const topic = "eco:user:a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
  const startPromise = realtime.start({
    userId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    deviceId: "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  });
  await Bun.sleep(0);
  callbacks.get(topic)?.("CHANNEL_ERROR", new Error("Unauthorized"));

  await expect(startPromise).rejects.toThrow(`Realtime channel ${topic} status=CHANNEL_ERROR: Unauthorized`);
});

function createRealtimeClient(
  callbacks: Map<string, (status: string, error?: Error) => void>,
  track: () => Promise<string>,
  broadcastHandlers = new Map<string, (payload: unknown) => void>(),
  sent: unknown[] = [],
) {
  return {
    channel(topic: string) {
      const channel = {
        on(type: string, _filter: unknown, callback: (payload: unknown) => void) {
          if (type === "broadcast") {
            broadcastHandlers.set(topic, callback);
          }
          return channel;
        },
        subscribe(callback: (status: string, error?: Error) => void) {
          callbacks.set(topic, callback);
          return channel;
        },
        async send(payload: unknown) {
          sent.push(payload);
          return "ok";
        },
        track,
        presenceState() {
          return {};
        },
      };
      return channel;
    },
    async removeChannel() {
      return "ok";
    },
  };
}
