/**
 * Shared deterministic PI session harness for the codemode / nested-call tests.
 *
 * A local Anthropic Messages endpoint scripts the model's tool calls, so the PI
 * session, the official MCP extension, the codemode sandbox and the event
 * adapter are all real while the transcript stays reproducible offline.
 */

import { mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import type { AgentEvent, AgentRuntimeRunInput } from "../src";
import type { SdkToolPermissionHandler } from "../src/ask-user-question";
import {
  createDefaultPiSession,
  PiCodingAgentDriver,
  PiSessionRegistry,
} from "../src/pi-coding-agent-driver";

export interface ScriptedTurn {
  /** Tool call for this turn, or a text answer when `text` is set. */
  tool?: string;
  input?: Record<string, unknown>;
  id?: string;
  text?: string;
}

export interface ProbeSessionOptions {
  workspace: string;
  agentDir: string;
  threadId: string;
  turns: ScriptedTurn[];
  mcpServers?: Record<string, unknown>;
  /** Resume an existing conversation JSONL instead of starting a fresh session. */
  sessionFile?: string;
  sessionMode?: "agent" | "ask" | "plan";
  mcpStartupWaitMs?: number;
  toolsAllowlist?: string[];
  toolPermissionHandler?: SdkToolPermissionHandler;
}

export interface ProbeSessionResult {
  events: AgentEvent[];
  /**
   * Every request body the scripted model received. `toolNames` backs the
   * allowlist assertions; `messages` is the restored history, which is how a
   * resumed session is shown to have kept its earlier turns.
   */
  requests: Array<{ toolNames: string[]; messages: unknown[] }>;
  /** Turns the model actually served (a runaway loop shows up as a high count). */
  turnCount: number;
  dispose: () => Promise<void>;
  runAgain: (mcpServers?: Record<string, unknown>) => Promise<AgentEvent[]>;
}

function sse(res: http.ServerResponse, payload: ScriptedTurn): void {
  const isText = payload.text !== undefined;
  const block = isText
    ? { type: "text", text: payload.text }
    : { type: "tool_use", id: payload.id ?? "call_1", name: payload.tool, input: payload.input ?? {} };
  const events: Array<[string, Record<string, unknown>]> = [
    [
      "message_start",
      {
        type: "message_start",
        message: {
          id: `msg_${Date.now()}`,
          type: "message",
          role: "assistant",
          content: [],
          model: "eco-probe",
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
    ],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: block }],
    [
      "content_block_delta",
      {
        type: "content_block_delta",
        index: 0,
        delta: isText
          ? { type: "text_delta", text: payload.text }
          : { type: "input_json_delta", partial_json: JSON.stringify(payload.input ?? {}) },
      },
    ],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    [
      "message_delta",
      {
        type: "message_delta",
        delta: { stop_reason: isText ? "end_turn" : "tool_use", stop_sequence: null },
        usage: { output_tokens: 3 },
      },
    ],
    ["message_stop", { type: "message_stop" }],
  ];
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  for (const [event, data] of events) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  res.end();
}

/**
 * Run a PI session whose model answers with the given scripted turns.
 * The last turn must be a text answer or the loop would never settle.
 */
export async function runScriptedPiSession(options: ProbeSessionOptions): Promise<ProbeSessionResult> {
  const requests: Array<{ toolNames: string[]; messages: unknown[] }> = [];
  let turnIndex = 0;
  let turnCount = 0;
  const server = http.createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += String(chunk);
    });
    request.on("end", () => {
      if (!request.url?.startsWith("/v1/messages")) {
        response.writeHead(404);
        response.end();
        return;
      }
      const body = JSON.parse(raw || "{}") as {
        tools?: Array<{ name?: string }>;
        messages?: unknown[];
      };
      requests.push({
        toolNames: (body.tools ?? []).map((tool) => String(tool?.name ?? "")).filter(Boolean),
        messages: body.messages ?? [],
      });
      turnCount += 1;
      // The script never advances past the last turn: a prompt that keeps
      // producing tool calls would otherwise spin forever.
      const turn = options.turns[Math.min(turnIndex, options.turns.length - 1)];
      turnIndex += 1;
      sse(response, turn);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("probe API did not bind");
  const port = address.port;

  const registry = new PiSessionRegistry();
  const driver = new PiCodingAgentDriver(
    {
      createSession: (input) =>
        createDefaultPiSession({
          ...input,
          ...(options.mcpStartupWaitMs !== undefined ? { mcpStartupWaitMs: options.mcpStartupWaitMs } : {}),
          ...(options.toolsAllowlist ? { toolsAllowlist: options.toolsAllowlist } : {}),
        }),
      resolveBridgeModel: async () => ({
        bridgeBaseUrl: `http://127.0.0.1:${port}`,
        bridgeModelId: "eco-probe",
        apiKey: "probe-key",
        agentDir: options.agentDir,
        apiCompat: "anthropic" as const,
        bindingId: "probe-binding",
        providerId: "eco-probe",
      }),
    },
    registry,
  );

  const input: AgentRuntimeRunInput = {
    threadId: options.threadId,
    prompt: "probe",
    workspacePath: options.workspace,
    worktreePath: options.workspace,
    routes: [
      {
        role: "planner" as const,
        primary: {
          id: "probe",
          provider: "anthropic",
          displayName: "probe",
          baseUrl: `http://127.0.0.1:${port}`,
          modelId: "eco-probe",
          capabilities: ["messages_api"],
          enabled: true,
        },
        fallbacks: [],
      },
    ],
    signal: new AbortController().signal,
    piSession: {
      sessionMode: options.sessionMode ?? "agent",
      ...(options.mcpServers ? { mcpServers: options.mcpServers } : {}),
      ...(options.sessionFile ? { sessionFile: options.sessionFile } : {}),
      ...(options.toolPermissionHandler ? { toolPermissionHandler: options.toolPermissionHandler } : {}),
    },
  };

  const events: AgentEvent[] = [];
  for await (const event of driver.run(input)) events.push(event);
  let disposal: Promise<void> | undefined;
  return {
    events,
    requests,
    get turnCount() {
      return turnCount;
    },
    runAgain: async (mcpServers) => {
      const next: AgentEvent[] = [];
      for await (const event of driver.run({
        ...input,
        piSession: { ...input.piSession, ...(mcpServers ? { mcpServers } : {}) },
      }))
        next.push(event);
      return next;
    },
    dispose: () => {
      disposal ??= (async () => {
        try {
          await registry.deleteThread(options.threadId);
        } finally {
          await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          );
        }
      })();
      return disposal;
    },
  };
}

/** Write an image file the PI `read` tool returns as an image content block. */
export async function writeProbeImage(workspace: string, name = "pixel.png"): Promise<string> {
  await mkdir(path.join(workspace, "assets"), { recursive: true });
  // 1x1 PNG.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const target = path.join(workspace, "assets", name);
  await writeFile(target, png);
  return path.join("assets", name);
}
