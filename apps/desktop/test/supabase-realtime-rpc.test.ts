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
) {
  return {
    channel(topic: string) {
      const channel = {
        on() {
          return channel;
        },
        subscribe(callback: (status: string, error?: Error) => void) {
          callbacks.set(topic, callback);
          return channel;
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
