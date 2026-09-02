/**
 * One-shot RPC surface smoke against the workspace-pinned Codex app-server.
 * Run: bun scripts/codex-rpc-smoke.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CodexAppServerClient } from "../packages/runtime/src/codex-app-server-client.ts";
import { forkCodexThread } from "../packages/runtime/src/codex-fork.ts";
import { listCodexSkills } from "../packages/runtime/src/codex-skills-list.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const codexExecutable = path.join(root, "apps/desktop/node_modules/.bin/codex");
const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "eco-codex-rpc-"));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "eco-codex-ws-"));
const observed = { methods: new Set(), itemTypes: new Set(), serverRequests: [] };

const stub = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: async (request) => {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/v1/responses") {
      return new Response("not found", { status: 404 });
    }
    const body = await request.json();
    return new Response(buildStream(body.model ?? "unknown"), {
      headers: { "content-type": "text/event-stream" },
    });
  },
});

fs.writeFileSync(
  path.join(codexHome, "config.toml"),
  [
    'model_provider = "stub"',
    "[features]",
    "remote_plugin = false",
    "plugins = false",
    "",
    "[model_providers.stub]",
    'name = "Local stub"',
    `base_url = "http://127.0.0.1:${stub.port}/v1"`,
    'env_key = "STUB_API_KEY"',
    'wire_api = "responses"',
    "request_max_retries = 0",
    "stream_idle_timeout_ms = 5000",
    "",
  ].join("\n"),
);

const skillDir = path.join(codexHome, "skills", "smoke");
fs.mkdirSync(skillDir, { recursive: true });
fs.writeFileSync(
  path.join(skillDir, "SKILL.md"),
  `---
name: smoke
description: smoke skill
---
# Smoke
`,
);

const child = spawn(codexExecutable, ["app-server", "--stdio"], {
  env: { ...process.env, CODEX_HOME: codexHome, STUB_API_KEY: "k" },
  stdio: ["pipe", "pipe", "pipe"],
});
let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (c) => {
  stderr += c;
});

const client = CodexAppServerClient.attachToProcess(child, {
  timeoutMs: 20_000,
  onServerRequest: async (method, params) => {
    observed.serverRequests.push({ method, params });
    const err = new Error(`unexpected server request ${method}`);
    err.code = -32601;
    throw err;
  },
});
client.addNotificationHandler((method, params) => {
  observed.methods.add(method);
  if (params && typeof params === "object" && params.item && typeof params.item === "object") {
    const t = params.item.type;
    if (typeof t === "string") observed.itemTypes.add(t);
  }
});

const report = { ok: [], fail: [], observed };
function pass(name, detail) {
  report.ok.push({ name, detail });
}
function fail(name, detail) {
  report.fail.push({ name, detail });
}

try {
  const init = await client.initialize();
  pass("initialize", init.userAgent);

  const skills = await listCodexSkills(client, { cwds: [workspace], forceReload: true });
  pass("skills/list", {
    count: skills.length,
    totalSkills: skills.reduce((n, e) => n + e.skills.length, 0),
    scopes: [...new Set(skills.flatMap((e) => e.skills.map((s) => s.scope)))],
  });

  await client.request("skills/extraRoots/set", { extraRoots: [] }).then(
    () => pass("skills/extraRoots/set", "ok"),
    (e) => fail("skills/extraRoots/set", String(e)),
  );

  const started = await client.request("thread/start", {
    cwd: workspace,
    modelProvider: "stub",
    config: { model: "gpt-5.1-codex-mini" },
  });
  pass("thread/start", started.thread.id);

  const turnDone = waitFor(client, "turn/completed", started.thread.id);
  const turn = await client.request("turn/start", {
    threadId: started.thread.id,
    input: [{ type: "text", text: "Say hi only." }],
    model: "gpt-5.1-codex-mini",
    approvalPolicy: "never",
    sandboxPolicy: { type: "readOnly" },
  });
  pass("turn/start", turn.turn?.id);
  await turnDone;
  pass("turn/completed", "observed");

  const read = await client.request("thread/read", {
    threadId: started.thread.id,
    includeTurns: true,
  });
  const turns = read.thread?.turns;
  const turnCount = Array.isArray(turns) ? turns.length : -1;
  const userItems = [];
  if (Array.isArray(turns)) {
    for (const t of turns) {
      for (const item of t.items ?? []) {
        if (item?.type === "userMessage") userItems.push(item);
        if (item?.type) observed.itemTypes.add(item.type);
      }
    }
  }
  pass("thread/read includeTurns", {
    turnCount,
    userItems: userItems.length,
    status: read.thread?.status,
  });

  if (userItems[0]?.id) {
    try {
      // Prefer a second-turn rewind if we ever accumulate >1 user turns; first-turn
      // fork clears mapping without an RPC (lastTurnId would be absent).
      const target = userItems[userItems.length > 1 ? 1 : 0];
      const forked = await forkCodexThread(client, {
        threadId: started.thread.id,
        itemId: target.id,
      });
      pass("thread/fork rewind", forked);
    } catch (e) {
      fail("thread/fork rewind", String(e));
    }
  } else {
    fail("thread/fork rewind", "no userMessage id in thread/read turns");
  }

  try {
    await waitIdle(client, started.thread.id);
    await client.request("thread/compact/start", { threadId: started.thread.id });
    pass("thread/compact/start", "accepted");
  } catch (e) {
    fail("thread/compact/start", String(e));
  }

  try {
    const mcp = await client.request("mcpServerStatus/list", {});
    pass("mcpServerStatus/list", mcp);
  } catch (e) {
    fail("mcpServerStatus/list", String(e));
  }

  try {
    await client.request("config/mcpServer/reload", {});
    pass("config/mcpServer/reload", "ok");
  } catch (e) {
    fail("config/mcpServer/reload", String(e));
  }
} catch (e) {
  fail("fatal", String(e));
} finally {
  client.close();
  child.kill("SIGTERM");
  await Bun.sleep(300);
  stub.stop(true);
  fs.rmSync(codexHome, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
}

report.observed = {
  methods: [...observed.methods].sort(),
  itemTypes: [...observed.itemTypes].sort(),
  serverRequests: observed.serverRequests,
};
console.log(JSON.stringify(report, null, 2));
if (report.fail.length) process.exitCode = 1;
if (stderr.trim()) console.error("---stderr tail---\n", stderr.slice(-2000));

function buildStream(model) {
  const responseId = "r1";
  const itemId = "m1";
  const message = {
    type: "message",
    id: itemId,
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: "hi", annotations: [] }],
  };
  const events = [
    {
      type: "response.created",
      sequence_number: 0,
      response: { id: responseId, object: "response", model, status: "in_progress", output: [] },
    },
    {
      type: "response.output_item.added",
      sequence_number: 1,
      output_index: 0,
      item: { type: "message", id: itemId, role: "assistant", status: "in_progress", content: [] },
    },
    {
      type: "response.content_part.added",
      sequence_number: 2,
      output_index: 0,
      content_index: 0,
      item_id: itemId,
      part: { type: "output_text", text: "", annotations: [] },
    },
    {
      type: "response.output_text.delta",
      sequence_number: 3,
      output_index: 0,
      content_index: 0,
      item_id: itemId,
      delta: "hi",
    },
    {
      type: "response.output_text.done",
      sequence_number: 4,
      output_index: 0,
      content_index: 0,
      item_id: itemId,
      text: "hi",
    },
    {
      type: "response.content_part.done",
      sequence_number: 5,
      output_index: 0,
      content_index: 0,
      item_id: itemId,
      part: { type: "output_text", text: "hi", annotations: [] },
    },
    { type: "response.output_item.done", sequence_number: 6, output_index: 0, item: message },
    {
      type: "response.completed",
      sequence_number: 7,
      response: {
        id: responseId,
        object: "response",
        model,
        status: "completed",
        output: [message],
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          total_tokens: 2,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      },
    },
  ];
  return `${events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n`).join("\n")}\n`;
}

function waitFor(client, method, threadId) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      rem();
      reject(new Error(`timeout ${method}`));
    }, 15_000);
    const rem = client.addNotificationHandler((m, p) => {
      if (m !== method || p?.threadId !== threadId) return;
      clearTimeout(t);
      rem();
      resolve(p);
    });
  });
}

async function waitIdle(client, threadId) {
  for (let i = 0; i < 50; i++) {
    const r = await client.request("thread/read", { threadId, includeTurns: false });
    if (r.thread?.status?.type === "idle") return;
    await Bun.sleep(50);
  }
  throw new Error("not idle");
}
