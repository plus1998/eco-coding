/**
 * End-to-end PI Core probe with a deterministic local Anthropic-compatible API.
 *
 * The PI process/session, pi-mcp-adapter, MCP transport, and Hub are real. The
 * local API only scripts the model's two mcp proxy calls, so this is a protocol
 * probe rather than a model-quality claim.
 */

import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startHub, type RunningHub } from "./run";
import { PiCodingAgentDriver, PiSessionRegistry, type PiBridgeModelResolution } from "../../packages/runtime/src/pi-coding-agent-driver";
import type { AgentRuntimeRunInput } from "../../packages/runtime/src/index";

type Request = { body: Record<string, any>; toolNames: string[]; messageTypes: string[] };
type Api = { url: string; requests: Request[]; close: () => Promise<void> };

function lastToolResult(body: Record<string, any>): { id: string; text: string } | undefined {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user" || !Array.isArray(message.content)) continue;
    const block = message.content.find((item: any) => item?.type === "tool_result");
    if (!block) continue;
    const content = Array.isArray(block.content)
      ? block.content.map((item: any) => item?.text ?? JSON.stringify(item)).join(" ")
      : String(block.content ?? "");
    return { id: String(block.tool_use_id ?? ""), text: content };
  }
  return undefined;
}

function sse(res: http.ServerResponse, payload: { text?: string; input?: Record<string, unknown>; id?: string }): void {
  const isText = payload.text !== undefined;
  const block = isText
    ? { type: "text", text: payload.text }
    : { type: "tool_use", id: payload.id ?? "pi_probe", name: "mcp", input: payload.input ?? {} };
  const events: Array<[string, Record<string, unknown>]> = [
    ["message_start", {
      type: "message_start",
      message: {
        id: `msg_pi_${Date.now()}`,
        type: "message",
        role: "assistant",
        content: [],
        model: "eco-local-probe",
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 0 },
      },
    }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: block }],
    ["content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: isText ? { type: "text_delta", text: payload.text } : { type: "input_json_delta", partial_json: JSON.stringify(payload.input ?? {}) },
    }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: isText ? "end_turn" : "tool_use", stop_sequence: null }, usage: { output_tokens: 3 } }],
    ["message_stop", { type: "message_stop" }],
  ];
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  for (const [event, data] of events) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  res.end();
}

async function startApi(identity: "A" | "B"): Promise<Api> {
  const requests: Request[] = [];
  let turnStep = 0;
  const server = http.createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => { raw += String(chunk); });
    request.on("end", () => {
      if (request.url?.startsWith("/api/hello")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}");
        return;
      }
      if (!request.url?.startsWith("/v1/messages")) {
        response.writeHead(404);
        response.end();
        return;
      }
      const body = JSON.parse(raw) as Record<string, any>;
      requests.push({
        body,
        toolNames: (body.tools ?? []).map((tool: any) => tool?.name).filter(Boolean),
        messageTypes: (body.messages ?? []).flatMap((message: any) => Array.isArray(message.content) ? message.content.map((block: any) => block?.type) : []),
      });
      // The scripted model starts a fresh search/call/text triplet for every
      // prompt, including a prompt loaded from a persisted PI session file.
      turnStep = (turnStep % 3) + 1;
      const result = lastToolResult(body);
      if (turnStep === 1) {
        sse(response, { input: { tool: "eco_mcp_call_tool", args: { name: "search_tools", arguments: { query: "echo" } } }, id: "pi_search" });
        return;
      }
      if (turnStep === 2) {
        sse(response, { input: { tool: "eco_mcp_call_tool", args: { name: "echo_context", arguments: { clientSessionId: "pi-model-forged", marker: `pi-${identity}` } } }, id: "pi_call" });
        return;
      }
      sse(response, { text: JSON.stringify({ identity, toolResult: result.text.slice(0, 600) }) });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("PI fake API did not bind");
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function drain<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of iterable) result.push(item);
  return result;
}

function route(): AgentRuntimeRunInput["routes"] {
  return [{
    role: "planner" as const,
    primary: {
      id: "local-probe",
      provider: "anthropic",
      displayName: "local-probe",
      baseUrl: "http://127.0.0.1",
      modelId: "eco-local-probe",
      capabilities: ["messages_api"],
      enabled: true,
    },
    fallbacks: [],
  }];
}

export async function runPiRealProbe(): Promise<Record<string, unknown>> {
  const hub = await startHub();
  const a = hub.state.issue("A", ["echo_context"]);
  const b = hub.state.issue("B", ["echo_context"]);
  const apiA = await startApi("A");
  const apiB = await startApi("B");
  const dirs = {
    A: await mkdtemp(path.join(tmpdir(), "eco-pi-real-a-")),
    B: await mkdtemp(path.join(tmpdir(), "eco-pi-real-b-")),
  };
  const resolveBridgeModel = async ({ threadId }: { threadId: string }): Promise<PiBridgeModelResolution> => {
      const identity = threadId.endsWith("-B") ? "B" : "A";
      const api = identity === "A" ? apiA : apiB;
      return {
        bridgeBaseUrl: api.url,
        bridgeModelId: "eco-local-probe",
        apiKey: "local-probe-key",
        agentDir: dirs[identity],
        apiCompat: "anthropic",
        bindingId: `pi-probe-${identity}`,
        providerId: "eco-local-probe",
      };
    };
  const registry = new PiSessionRegistry();
  const driver = new PiCodingAgentDriver({ resolveBridgeModel }, registry);
  let resumedRegistry: PiSessionRegistry | undefined;
  const input = (identity: "A" | "B"): AgentRuntimeRunInput => ({
    threadId: `pi-real-${identity}`,
    prompt: `Use MCP search and then echo_context for ${identity}.`,
    workspacePath: process.cwd(),
    worktreePath: process.cwd(),
    routes: route(),
    signal: new AbortController().signal,
    piSession: {
      sessionMode: "agent",
      mcpServers: {
        eco_mcp: {
          type: "http",
          url: hub.url,
          headers: { Authorization: `Bearer ${(identity === "A" ? a : b).token}` },
        },
      },
    },
  });
  try {
    const [eventsA, eventsB] = await Promise.all([drain(driver.run(input("A"))), drain(driver.run(input("B")))]);
    // Reuse A's live PI session once, then dispose it and restore the same
    // conversation JSONL in a fresh driver. Both turns must still use A's Hub
    // credential.
    const repeatA = await drain(driver.run(input("A")));
    const capturedA = eventsA.find((event: any) => event.type === "session.captured") as any;
    const sessionFileA = capturedA?.payload?.sessionFile as string | undefined;
    registry.deleteThread("pi-real-A");
    resumedRegistry = new PiSessionRegistry();
    const resumedDriver = new PiCodingAgentDriver({ resolveBridgeModel }, resumedRegistry);
    const resumedA = await drain(resumedDriver.run({
      ...input("A"),
      piSession: { ...input("A").piSession, sessionFile: sessionFileA },
    }));
    const upstream = hub.state.logs.filter((entry) => entry.event === "upstream_call" && entry.phase === "started");
    const identities = upstream.map((entry) => entry.identity);
    const success = identities.includes("A") && identities.includes("B") && identities.filter((identity) => identity === "A").length >= 3 && Boolean(sessionFileA) && apiA.requests.some((request) => request.toolNames.includes("mcp")) && apiB.requests.some((request) => request.toolNames.includes("mcp"));
    return {
      status: success ? "pass" : "fail",
      piVersion: "来自当前 workspace 的 @earendil-works/pi-coding-agent",
      concurrentThreads: 2,
      eventCounts: { A: eventsA.length, B: eventsB.length, ARepeat: repeatA.length, AResume: resumedA.length },
      apiRequests: { A: apiA.requests.length, B: apiB.requests.length },
      modelToolNames: { A: [...new Set(apiA.requests.flatMap((request) => request.toolNames))], B: [...new Set(apiB.requests.flatMap((request) => request.toolNames))] },
      hubIdentities: identities,
      restoredSessionIdentity: identities.filter((identity) => identity === "A").length >= 3 ? "A" : "missing",
      restoredSessionFile: Boolean(sessionFileA),
      forgedClientSessionIdsIgnored: upstream.every((entry) => entry.identity === "A" || entry.identity === "B"),
      hubLogs: hub.state.logs,
      note: "本实验使用真实 PI AgentSession + pi-mcp-adapter，模型响应来自本地确定性 Anthropic API；不代表真实模型的工具选择质量。",
    };
  } finally {
    registry.deleteThread("pi-real-A");
    registry.deleteThread("pi-real-B");
    resumedRegistry?.deleteThread("pi-real-A");
    resumedRegistry?.deleteThread("pi-real-B");
    await Promise.all([apiA.close(), apiB.close(), hub.close()]);
    await Promise.all(Object.values(dirs).map((dir) => rm(dir, { recursive: true, force: true })));
  }
}

if (import.meta.main) console.log(JSON.stringify(await runPiRealProbe(), null, 2));
