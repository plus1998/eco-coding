import { expect, test } from "bun:test";
import {
  AcpJsonRpcPeer,
  encodeJsonRpcLine,
  parseJsonRpcLine,
} from "../src/acp-jsonrpc";

test("encodeJsonRpcLine appends newline", () => {
  const line = encodeJsonRpcLine({ jsonrpc: "2.0", method: "ping" });
  expect(line.endsWith("\n")).toBe(true);
  expect(JSON.parse(line.trim())).toEqual({ jsonrpc: "2.0", method: "ping" });
});

test("parseJsonRpcLine parses valid JSON and ignores bad lines", () => {
  expect(parseJsonRpcLine('{"jsonrpc":"2.0","method":"n"}\n')).toEqual({
    jsonrpc: "2.0",
    method: "n",
  });
  expect(parseJsonRpcLine("not-json")).toBeUndefined();
  expect(parseJsonRpcLine("")).toBeUndefined();
  expect(parseJsonRpcLine("   \n")).toBeUndefined();
});

function createMockIo() {
  let lineHandler: ((line: string) => void) | undefined;
  const writes: string[] = [];
  return {
    writes,
    write: (line: string) => {
      writes.push(line);
    },
    onLine: (cb: (line: string) => void) => {
      lineHandler = cb;
    },
    emit: (line: string) => {
      lineHandler?.(line);
    },
  };
}

test("request matches response by id and returns result", async () => {
  const io = createMockIo();
  const peer = new AcpJsonRpcPeer(io);

  const pending = peer.request("session/new", { cwd: "/tmp" });
  expect(io.writes).toHaveLength(1);
  const sent = JSON.parse(io.writes[0]!.trim()) as {
    jsonrpc: string;
    id: string | number;
    method: string;
    params: unknown;
  };
  expect(sent.jsonrpc).toBe("2.0");
  expect(sent.method).toBe("session/new");
  expect(sent.params).toEqual({ cwd: "/tmp" });

  io.emit(
    encodeJsonRpcLine({
      jsonrpc: "2.0",
      id: sent.id,
      result: { sessionId: "s1" },
    }),
  );

  await expect(pending).resolves.toEqual({ sessionId: "s1" });
  peer.dispose();
});

test("request rejects on json-rpc error response", async () => {
  const io = createMockIo();
  const peer = new AcpJsonRpcPeer(io);
  const pending = peer.request("fail");
  const sent = JSON.parse(io.writes[0]!.trim()) as { id: string | number };

  io.emit(
    encodeJsonRpcLine({
      jsonrpc: "2.0",
      id: sent.id,
      error: { code: -32601, message: "Method not found" },
    }),
  );

  await expect(pending).rejects.toThrow(/fail failed \(-32601\): Method not found/);
  peer.dispose();
});

test("request times out when no matching response", async () => {
  const io = createMockIo();
  const peer = new AcpJsonRpcPeer(io);
  const pending = peer.request("slow", undefined, 20);
  await expect(pending).rejects.toThrow(/timed out/i);
  peer.dispose();
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("idle timeout fires when no inbound activity", async () => {
  const io = createMockIo();
  const peer = new AcpJsonRpcPeer(io);
  const pending = peer.request("session/prompt", {}, { idleTimeoutMs: 40 });
  await expect(pending).rejects.toThrow(/after 40ms idle/i);
  peer.dispose();
});

test("idle timeout is reset by inbound notification", async () => {
  const io = createMockIo();
  const peer = new AcpJsonRpcPeer(io);
  const pending = peer.request("session/prompt", {}, { idleTimeoutMs: 80 });
  await sleep(40);
  io.emit(
    encodeJsonRpcLine({
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionUpdate: "agent_message_chunk" },
    }),
  );
  await sleep(40);
  const sent = JSON.parse(io.writes[0]!.trim()) as { id: string | number };
  io.emit(
    encodeJsonRpcLine({
      jsonrpc: "2.0",
      id: sent.id,
      result: { stopReason: "end_turn" },
    }),
  );
  await expect(pending).resolves.toEqual({ stopReason: "end_turn" });
  peer.dispose();
});

test("idle timeout is reset by inbound request", async () => {
  const io = createMockIo();
  const peer = new AcpJsonRpcPeer(io);
  peer.onRequest(() => ({ outcome: { outcome: "selected", optionId: "allow-once" } }));
  const pending = peer.request("session/prompt", {}, { idleTimeoutMs: 80 });
  await sleep(40);
  io.emit(
    encodeJsonRpcLine({
      jsonrpc: "2.0",
      id: 7,
      method: "session/request_permission",
      params: { sessionId: "s1" },
    }),
  );
  await sleep(40);
  const sent = JSON.parse(io.writes[0]!.trim()) as { id: string | number };
  io.emit(
    encodeJsonRpcLine({
      jsonrpc: "2.0",
      id: sent.id,
      result: { stopReason: "end_turn" },
    }),
  );
  await expect(pending).resolves.toEqual({ stopReason: "end_turn" });
  peer.dispose();
});

test("idle timeout fires after activity then silence", async () => {
  const io = createMockIo();
  const peer = new AcpJsonRpcPeer(io);
  const pending = peer.request("session/prompt", {}, { idleTimeoutMs: 50 });
  await sleep(20);
  io.emit(
    encodeJsonRpcLine({
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionUpdate: "agent_message_chunk" },
    }),
  );
  await expect(pending).rejects.toThrow(/after 50ms idle/i);
  peer.dispose();
});

test("absolute timeout is not extended by inbound notifications", async () => {
  const io = createMockIo();
  const peer = new AcpJsonRpcPeer(io);
  const pending = peer.request("slow", undefined, 50);
  await sleep(20);
  io.emit(
    encodeJsonRpcLine({
      jsonrpc: "2.0",
      method: "session/update",
      params: { n: 1 },
    }),
  );
  await expect(pending).rejects.toThrow(/timed out waiting for slow response after 50ms$/i);
  peer.dispose();
});

test("notification is dispatched by method; unknown lines ignored", () => {
  const io = createMockIo();
  const peer = new AcpJsonRpcPeer(io);
  const seen: unknown[] = [];
  const unsubscribe = peer.onNotification("session/update", (params) => {
    seen.push(params);
  });

  io.emit(encodeJsonRpcLine({ jsonrpc: "2.0", method: "session/update", params: { n: 1 } }));
  io.emit(encodeJsonRpcLine({ jsonrpc: "2.0", method: "other", params: { n: 2 } }));
  io.emit("not-json\n");
  io.emit(encodeJsonRpcLine({ jsonrpc: "2.0", id: 99, result: "orphan" }));

  expect(seen).toEqual([{ n: 1 }]);

  unsubscribe();
  io.emit(encodeJsonRpcLine({ jsonrpc: "2.0", method: "session/update", params: { n: 3 } }));
  expect(seen).toEqual([{ n: 1 }]);

  peer.notify("client/cancel", { reason: "stop" });
  const last = JSON.parse(io.writes.at(-1)!.trim()) as Record<string, unknown>;
  expect(last).toEqual({
    jsonrpc: "2.0",
    method: "client/cancel",
    params: { reason: "stop" },
  });
  expect("id" in last).toBe(false);

  peer.dispose();
});

test("incoming JSON-RPC request is answered by onRequest", async () => {
  const io = createMockIo();
  const peer = new AcpJsonRpcPeer(io);
  peer.onRequest(async (request) => {
    expect(request.method).toBe("session/request_permission");
    return { outcome: { outcome: "selected", optionId: "allow-once" } };
  });

  io.emit(
    encodeJsonRpcLine({
      jsonrpc: "2.0",
      id: 7,
      method: "session/request_permission",
      params: { sessionId: "s1" },
    }),
  );
  await Promise.resolve();

  const reply = JSON.parse(io.writes.at(-1)!.trim()) as Record<string, unknown>;
  expect(reply).toEqual({
    jsonrpc: "2.0",
    id: 7,
    result: { outcome: { outcome: "selected", optionId: "allow-once" } },
  });
  peer.dispose();
});

test("incoming JSON-RPC request without handler returns method not found", async () => {
  const io = createMockIo();
  const peer = new AcpJsonRpcPeer(io);
  io.emit(
    encodeJsonRpcLine({
      jsonrpc: "2.0",
      id: 8,
      method: "session/request_permission",
      params: {},
    }),
  );
  await Promise.resolve();
  const reply = JSON.parse(io.writes.at(-1)!.trim()) as {
    id: number;
    error: { code: number; message: string };
  };
  expect(reply.id).toBe(8);
  expect(reply.error.code).toBe(-32601);
  expect(reply.error.message).toMatch(/session\/request_permission/);
  peer.dispose();
});

test("dispose rejects pending requests", async () => {
  const io = createMockIo();
  const peer = new AcpJsonRpcPeer(io);
  const pending = peer.request("hang", undefined, 60_000);
  peer.dispose();
  await expect(pending).rejects.toThrow(/disposed|closed/i);
});
