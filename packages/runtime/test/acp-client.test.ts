import { expect, test } from "bun:test";
import { AcpClient } from "../src/acp-client";
import {
  AcpJsonRpcPeer,
  encodeJsonRpcLine,
} from "../src/acp-jsonrpc";

/** Measured against local `agent acp` (2026.08.11-e8db854). */
const ACP_METHODS = {
  initialize: "initialize",
  initialized: "notifications/initialized",
  sessionNew: "session/new",
  sessionLoad: "session/load",
  sessionPrompt: "session/prompt",
  /** Notification (not request) — request returns -32601 Method not found. */
  sessionCancel: "session/cancel",
  sessionUpdate: "session/update",
} as const;

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

function parseWrites(writes: string[]) {
  return writes.map((line) => JSON.parse(line.trim()) as Record<string, unknown>);
}

function createClient(io = createMockIo()) {
  const peer = new AcpJsonRpcPeer(io);
  const client = new AcpClient({
    peer,
    clientInfo: { name: "eco-test", version: "0.0.0" },
  });
  return { io, peer, client };
}

const INIT_RESULT = {
  protocolVersion: 1,
  agentCapabilities: {
    loadSession: true,
    mcpCapabilities: { http: true, sse: true },
    promptCapabilities: { audio: false, embeddedContext: false, image: true },
    sessionCapabilities: { list: {} },
  },
  authMethods: [
    {
      id: "cursor_login",
      name: "Cursor Login",
      description: "Authenticate using existing Cursor login credentials.",
    },
  ],
};

async function handshake(io: ReturnType<typeof createMockIo>, client: AcpClient) {
  const initPromise = client.initialize();
  const initReq = parseWrites(io.writes).at(-1)!;
  expect(initReq.method).toBe(ACP_METHODS.initialize);
  io.emit(
    encodeJsonRpcLine({
      jsonrpc: "2.0",
      id: initReq.id,
      result: INIT_RESULT,
    }),
  );
  await initPromise;
  client.confInitialized();
}

test("initialize sends protocolVersion 1 with empty clientCapabilities and returns agent result", async () => {
  const { io, peer, client } = createClient();
  const pending = client.initialize();
  const sent = parseWrites(io.writes)[0]!;
  expect(sent).toEqual({
    jsonrpc: "2.0",
    id: sent.id,
    method: ACP_METHODS.initialize,
    params: {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: "eco-test", version: "0.0.0" },
    },
  });

  io.emit(
    encodeJsonRpcLine({
      jsonrpc: "2.0",
      id: sent.id,
      result: INIT_RESULT,
    }),
  );

  await expect(pending).resolves.toEqual(INIT_RESULT);
  peer.dispose();
});

test("confInitialized notifies notifications/initialized", async () => {
  const { io, peer, client } = createClient();
  await handshake(io, client);
  const last = parseWrites(io.writes).at(-1)!;
  expect(last).toEqual({
    jsonrpc: "2.0",
    method: ACP_METHODS.initialized,
  });
  expect("id" in last).toBe(false);
  peer.dispose();
});

test("newSession returns sessionId from session/new", async () => {
  const { io, peer, client } = createClient();
  await handshake(io, client);
  const pending = client.newSession({ cwd: "/tmp/ws" });
  const sent = parseWrites(io.writes).at(-1)!;
  expect(sent.method).toBe(ACP_METHODS.sessionNew);
  expect(sent.params).toEqual({ cwd: "/tmp/ws", mcpServers: [] });

  io.emit(
    encodeJsonRpcLine({
      jsonrpc: "2.0",
      id: sent.id,
      result: { sessionId: "sess-1" },
    }),
  );

  await expect(pending).resolves.toEqual({ sessionId: "sess-1" });
  peer.dispose();
});

test("loadSession calls session/load with mcpServers when capability present", async () => {
  const { io, peer, client } = createClient();
  await handshake(io, client);
  const pending = client.loadSession({ sessionId: "sess-1", cwd: "/tmp/ws" });
  const sent = parseWrites(io.writes).at(-1)!;
  expect(sent.method).toBe(ACP_METHODS.sessionLoad);
  // Measured: Cursor requires mcpServers: array on session/load
  expect(sent.params).toEqual({
    sessionId: "sess-1",
    cwd: "/tmp/ws",
    mcpServers: [],
  });

  io.emit(
    encodeJsonRpcLine({
      jsonrpc: "2.0",
      id: sent.id,
      result: {},
    }),
  );

  await expect(pending).resolves.toBeUndefined();
  peer.dispose();
});

test("loadSession throws ACP_LOAD_SESSION_UNSUPPORTED when capability false", async () => {
  const { io, peer, client } = createClient();
  const pending = client.initialize();
  const sent = parseWrites(io.writes)[0]!;
  io.emit(
    encodeJsonRpcLine({
      jsonrpc: "2.0",
      id: sent.id,
      result: {
        protocolVersion: 1,
        agentCapabilities: { loadSession: false },
        authMethods: [],
      },
    }),
  );
  await pending;
  client.confInitialized();

  await expect(
    client.loadSession({ sessionId: "x", cwd: "/tmp" }),
  ).rejects.toThrow(/ACP_LOAD_SESSION_UNSUPPORTED/);
  peer.dispose();
});

test("prompt and cancel use measured method names; cancel is a notification", async () => {
  const { io, peer, client } = createClient();
  await handshake(io, client);

  const promptPending = client.prompt({
    sessionId: "sess-1",
    prompt: [{ type: "text", text: "hi" }],
  });
  const promptReq = parseWrites(io.writes).at(-1)!;
  expect(promptReq.method).toBe(ACP_METHODS.sessionPrompt);
  expect(promptReq.params).toEqual({
    sessionId: "sess-1",
    prompt: [{ type: "text", text: "hi" }],
  });
  io.emit(
    encodeJsonRpcLine({
      jsonrpc: "2.0",
      id: promptReq.id,
      result: { stopReason: "end_turn" },
    }),
  );
  await expect(promptPending).resolves.toEqual({ stopReason: "end_turn" });

  const before = io.writes.length;
  await client.cancel({ sessionId: "sess-1" });
  const cancelMsg = parseWrites(io.writes).at(-1)!;
  expect(io.writes.length).toBe(before + 1);
  expect(cancelMsg).toEqual({
    jsonrpc: "2.0",
    method: ACP_METHODS.sessionCancel,
    params: { sessionId: "sess-1" },
  });
  expect("id" in cancelMsg).toBe(false);
  peer.dispose();
});

test("onSessionUpdate subscribes to session/update notifications", () => {
  const { io, peer, client } = createClient();
  const seen: unknown[] = [];
  const unsubscribe = client.onSessionUpdate((params) => {
    seen.push(params);
  });

  io.emit(
    encodeJsonRpcLine({
      jsonrpc: "2.0",
      method: ACP_METHODS.sessionUpdate,
      params: { sessionId: "s", update: { sessionUpdate: "agent_message_chunk" } },
    }),
  );
  expect(seen).toEqual([
    { sessionId: "s", update: { sessionUpdate: "agent_message_chunk" } },
  ]);

  unsubscribe();
  io.emit(
    encodeJsonRpcLine({
      jsonrpc: "2.0",
      method: ACP_METHODS.sessionUpdate,
      params: { sessionId: "s", update: { sessionUpdate: "ignored" } },
    }),
  );
  expect(seen).toHaveLength(1);
  peer.dispose();
});
