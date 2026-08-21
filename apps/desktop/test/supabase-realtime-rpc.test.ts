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
