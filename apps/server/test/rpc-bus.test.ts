import { expect, test } from "bun:test";
import { buildEcoJsonRpcNotification, ECO_RPC_METHODS, type EcoJsonRpcNotification } from "@eco/shared";
import { RedisRpcBus, type RpcBusMessage } from "../src/rpc/rpc-bus";

test("redis rpc bus delivers messages to the target instance only", async () => {
  const prefix = `eco:test:rpc-bus:${crypto.randomUUID()}:`;
  const redisUrl = Bun.env.ECO_TEST_REDIS_URL ?? "redis://127.0.0.1:6379";
  const busA = new RedisRpcBus({ instanceId: "server-a", redisUrl, channelPrefix: prefix });
  const busB = new RedisRpcBus({ instanceId: "server-b", redisUrl, channelPrefix: prefix });
  const receivedByA: RpcBusMessage[] = [];
  const receivedByB: RpcBusMessage[] = [];

  try {
    await busA.start((message) => {
      receivedByA.push(message);
    });
    let resolveReceived: (message: RpcBusMessage) => void = () => undefined;
    const receivedMessage = new Promise<RpcBusMessage>((resolve) => {
      resolveReceived = resolve;
    });
    await busB.start((message) => {
      receivedByB.push(message);
      resolveReceived(message);
    });

    const notification: EcoJsonRpcNotification = buildEcoJsonRpcNotification(ECO_RPC_METHODS.event, {
      protocolVersion: 1,
      id: "evt_redis",
      kind: "thread.lifecycle",
      source: "desktop",
      occurredAt: "2026-01-01T00:00:00.000Z",
      payload: { type: "thread.started" },
    });
    await busA.publish("server-b", {
      type: "event",
      mobileDeviceId: "dev_mobile",
      mobileSessionId: "sess_mobile",
      notification,
    });

    expect(await withTimeout(receivedMessage, 1000)).toMatchObject({
      type: "event",
      mobileDeviceId: "dev_mobile",
    });
    expect(receivedByB).toHaveLength(1);
    expect(receivedByA).toHaveLength(0);
  } finally {
    await busA.close();
    await busB.close();
  }
});

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error("Timed out waiting for Redis bus message.")), timeoutMs);
    }),
  ]);
}
