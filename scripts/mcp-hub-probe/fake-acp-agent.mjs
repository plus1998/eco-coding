#!/usr/bin/env node

// Tiny ACP v1 agent used only by run.ts. It receives mcpServers from Eco's
// session/new, then performs search_tools + call_tool against the supplied Hub
// during session/prompt. It is intentionally not Cursor and must not be used
// as evidence for all ACP implementations.

import readline from "node:readline";

const sessions = new Map();
const cancelled = new Set();

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function headerMap(server) {
  const headers = {};
  for (const entry of server?.headers ?? []) {
    if (entry && typeof entry.name === "string" && typeof entry.value === "string") {
      headers[entry.name] = entry.value;
    }
  }
  return headers;
}

async function rpc(server, id, method, params = {}) {
  const response = await fetch(server.url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headerMap(server) },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  return response.json();
}

async function runPrompt(id, params) {
  const sessionId = params?.sessionId;
  const session = sessions.get(sessionId);
  if (!session) {
    write({ jsonrpc: "2.0", id, error: { code: -32000, message: "unknown probe session" } });
    return;
  }
  const server = session.mcpServers?.[0];
  if (!server || server.type !== "http") {
    write({ jsonrpc: "2.0", id, error: { code: -32000, message: "probe requires one HTTP MCP server" } });
    return;
  }
  try {
    const listed = await rpc(server, 1, "tools/list");
    const names = listed?.result?.tools?.map((tool) => tool.name) ?? [];
    if (JSON.stringify(names) !== JSON.stringify(["search_tools", "call_tool"])) {
      throw new Error(`unexpected Hub catalog: ${JSON.stringify(names)}`);
    }
    const searched = await rpc(server, 2, "tools/call", {
      name: "call_tool",
      arguments: { name: "search_tools", arguments: { query: "echo" } },
    });
    const schema = searched?.result?.structuredContent?.tools?.[0]?.inputSchema;
    if (!schema) throw new Error("Hub search result did not contain a schema");
    const promptText = String(params?.prompt?.[0]?.text ?? "acp");
    const echo = await rpc(server, 3, "tools/call", {
      name: "call_tool",
      arguments: { name: "echo_context", arguments: { marker: promptText } },
    });
    const expectedIdentity = promptText.includes("acp-B") ? "B" : "A";
    if (echo?.result?.structuredContent?.identity !== expectedIdentity) {
      throw new Error(`Hub identity mismatch: ${JSON.stringify(echo?.result?.structuredContent)}`);
    }
    if (cancelled.has(sessionId)) {
      write({ jsonrpc: "2.0", id, result: { stopReason: "cancelled" } });
      return;
    }
    write({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: promptText },
        },
      },
    });
    write({ jsonrpc: "2.0", id, result: { stopReason: "end_turn" } });
  } catch (error) {
    write({ jsonrpc: "2.0", id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } });
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = message ?? {};
  if (method === "initialize") {
    write({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          sessionCapabilities: { delete: true },
          promptCapabilities: {},
        },
        agentInfo: { name: "eco-mcp-probe-agent", version: "0.1.0" },
      },
    });
    return;
  }
  if (method === "notifications/initialized") return;
  if (method === "session/new") {
    const sessionId = `probe-session-${Math.random().toString(16).slice(2)}`;
    const mcpServers = Array.isArray(params?.mcpServers) ? params.mcpServers : [];
    const identity = String(headerMap(mcpServers[0]).Authorization ?? "").slice(-1) === "" ? "" : "";
    // The identity is checked by Hub; keep the full config private to this process.
    sessions.set(sessionId, { mcpServers, identity: params?.cwd?.includes("acp-B") ? "B" : "A" });
    write({ jsonrpc: "2.0", id, result: { sessionId, modes: { currentModeId: "agent", availableModes: [] } } });
    return;
  }
  if (method === "session/load") {
    const sessionId = String(params?.sessionId ?? "");
    const mcpServers = Array.isArray(params?.mcpServers) ? params.mcpServers : [];
    sessions.set(sessionId, { mcpServers, identity: "A" });
    write({ jsonrpc: "2.0", id, result: { sessionId } });
    return;
  }
  if (method === "session/set_mode" || method === "session/set_model") {
    write({ jsonrpc: "2.0", id, result: {} });
    return;
  }
  if (method === "session/cancel") {
    cancelled.add(String(params?.sessionId ?? ""));
    return;
  }
  if (method === "session/prompt") {
    void runPrompt(id, params);
    return;
  }
  if (method === "session/delete") {
    sessions.delete(String(params?.sessionId ?? ""));
    write({ jsonrpc: "2.0", id, result: {} });
    return;
  }
  if (id !== undefined) {
    write({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } });
  }
});
