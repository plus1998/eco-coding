#!/usr/bin/env bun
/**
 * Official DeepSeek 三协议实网冒烟（读 eco SQLite 密钥，按协议改库）
 *
 * DeepSeek 官方（文档）:
 *   - Anthropic Messages : base=https://api.deepseek.com  path=/anthropic
 *   - OpenAI Responses   : base=https://api.deepseek.com  path=（空）  model=deepseek-v4-flash only
 *   - OpenAI Chat        : base=https://api.deepseek.com  path=（空）
 *
 * 覆盖:
 *   Claude face  /v1/messages  × 三种上游
 *   Codex face   /v1/responses × 三种上游
 *   非流式 / 流式 / 工具调用
 *   Bridge compact intercept + missing provider 400
 *   改 SQLite provider + route_profiles（DeepSeek 组合）
 *
 * Usage:
 *   bun apps/desktop/scripts/smoke-deepseek-live-protocol.mjs
 *   bun apps/desktop/scripts/smoke-deepseek-live-protocol.mjs --protocol=anthropic
 *   bun apps/desktop/scripts/smoke-deepseek-live-protocol.mjs --keep-db   # 不恢复原始 DB
 *   ECO_CDP_URL=http://127.0.0.1:9222 bun apps/desktop/scripts/smoke-deepseek-live-protocol.mjs --electron-cdp
 *
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";
import {
  GATEWAY_PROVIDER_ID_HEADER,
  GATEWAY_REQUESTED_MODEL_HEADER,
  GATEWAY_UPSTREAM_KIND_HEADER,
  createGatewayFetchHandler,
  mapApiCompatToUpstreamKind,
} from "@eco/gateway";
import { createEcoSdkBridgeHandler } from "../src/main/eco-sdk-bridge.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");
const REPORT_DIR = join(REPO_ROOT, ".cursor/smoke-reports");

const DB_PATH =
  process.env.ECO_SQLITE_PATH?.trim() ||
  join(
    process.env.HOME ?? "",
    "Library/Application Support/@eco/desktop/eco-coding.sqlite",
  );

const PROVIDER_ID = process.env.ECO_DEEPSEEK_PROVIDER_ID?.trim() || "deepseek-1z2ogb";
const PROFILE_ID = process.env.ECO_DEEPSEEK_PROFILE_ID?.trim() || "deepseek-bean1o";
const MODEL = process.env.ECO_DEEPSEEK_MODEL?.trim() || "deepseek-v4-flash";
const KEEP_DB = process.argv.includes("--keep-db");
const ELECTRON_CDP = process.argv.includes("--electron-cdp");
const ONLY_PROTOCOL = process.argv
  .find((a) => a.startsWith("--protocol="))
  ?.slice("--protocol=".length);

/** @typedef {"anthropic"|"openai_responses"|"openai_chat_completions"} Protocol */

/** @type {Array<{id:string, protocol?:string, ok:boolean, summary:string, detail?:string, status?:number, hypothesisId?:string}>} */
const results = [];

function record(r) {
  results.push(r);
  console.log(`${r.ok ? "✓" : "✗"} [${r.protocol ?? "-"}] ${r.id} — ${r.summary}`);
  if (!r.ok && r.detail) console.log(`    ${String(r.detail).slice(0, 400)}`);
}

function preview(s, n = 280) {
  const t = String(s ?? "");
  return t.length <= n ? t : `${t.slice(0, n)}…`;
}

function maskKey(key) {
  if (!key || key.length < 8) return "(short)";
  return `${key.slice(0, 3)}…${key.slice(-4)} (len=${key.length})`;
}

/** @type {Protocol[]} */
const PROTOCOLS = ["anthropic", "openai_responses", "openai_chat_completions"];

/** @param {Protocol} p */
function protocolConfig(p) {
  // DeepSeek 官方：Anthropic 走 /anthropic；Responses/Chat 走根路径
  if (p === "anthropic") {
    return {
      api_compat: "anthropic",
      base_url: "https://api.deepseek.com",
      request_path: "/anthropic",
      upstreamKind: "anthropic-messages",
      token_count_mode: "anthropic_messages",
    };
  }
  if (p === "openai_responses") {
    return {
      api_compat: "openai_responses",
      base_url: "https://api.deepseek.com",
      request_path: "",
      upstreamKind: "responses",
      token_count_mode: "local_heuristic",
    };
  }
  return {
    api_compat: "openai_chat_completions",
    base_url: "https://api.deepseek.com",
    request_path: "",
    upstreamKind: "openai-chat",
    token_count_mode: "local_heuristic",
  };
}

function openDb() {
  return new Database(DB_PATH);
}

function readProvider(db) {
  const row = db
    .query(
      `SELECT id, name, base_url, request_path, api_compat, token_count_mode,
              default_model, enabled, api_key
       FROM provider_configs WHERE id = ?`,
    )
    .get(PROVIDER_ID);
  if (!row) throw new Error(`Provider ${PROVIDER_ID} not found in ${DB_PATH}`);
  if (!row.api_key?.trim()) throw new Error(`Provider ${PROVIDER_ID} has empty api_key`);
  return row;
}

function snapshotProvider(row) {
  return {
    id: row.id,
    name: row.name,
    base_url: row.base_url,
    request_path: row.request_path ?? "",
    api_compat: row.api_compat,
    token_count_mode: row.token_count_mode,
    default_model: row.default_model,
    enabled: row.enabled,
  };
}

function applyProtocolToDb(db, protocol) {
  const cfg = protocolConfig(protocol);
  const now = new Date().toISOString();
  db.query(
    `UPDATE provider_configs SET
       base_url = ?,
       request_path = ?,
       api_compat = ?,
       token_count_mode = ?,
       default_model = ?,
       enabled = 1,
       updated_at = ?
     WHERE id = ?`,
  ).run(cfg.base_url, cfg.request_path, cfg.api_compat, cfg.token_count_mode, MODEL, now, PROVIDER_ID);

  // Activate DeepSeek profile; point all roles at official DeepSeek + this protocol
  db.query(`UPDATE route_profiles SET is_active = 0`).run();
  db.query(`UPDATE route_profiles SET is_active = 1, updated_at = ? WHERE id = ?`).run(
    now,
    PROFILE_ID,
  );

  const roles = db
    .query(`SELECT role FROM role_routes WHERE profile_id = ?`)
    .all(PROFILE_ID)
    .map((r) => r.role);
  if (roles.length === 0) {
    throw new Error(`Profile ${PROFILE_ID} has no role_routes`);
  }
  for (const role of roles) {
    db.query(
      `UPDATE role_routes SET
         provider_id = ?,
         model_id = ?,
         api_compat = ?,
         updated_at = ?
       WHERE profile_id = ? AND role = ?`,
    ).run(PROVIDER_ID, MODEL, cfg.api_compat, now, PROFILE_ID, role);
  }
}

function restoreProvider(db, snap) {
  db.query(
    `UPDATE provider_configs SET
       base_url = ?,
       request_path = ?,
       api_compat = ?,
       token_count_mode = ?,
       default_model = ?,
       enabled = ?,
       updated_at = ?
     WHERE id = ?`,
  ).run(
    snap.base_url,
    snap.request_path,
    snap.api_compat,
    snap.token_count_mode,
    snap.default_model,
    snap.enabled,
    new Date().toISOString(),
    snap.id,
  );
}

/**
 * Build bridge+gateway wired to live DeepSeek (reads key from row each call).
 * @param {Protocol} protocol
 * @param {string} apiKey
 */
function buildHandlers(protocol, apiKey) {
  const cfg = protocolConfig(protocol);
  const provider = {
    id: PROVIDER_ID,
    name: "DeepSeek official (smoke)",
    upstreamKind: cfg.upstreamKind,
    baseUrl: cfg.base_url,
    requestPath: cfg.request_path || undefined,
    apiKey,
    upstreamModelId: MODEL,
    models: [MODEL],
  };
  const gatewayHandler = createGatewayFetchHandler(
    { host: "127.0.0.1", port: 0, providers: [provider] },
    fetch,
  );
  const bridgeHandler = createEcoSdkBridgeHandler({
    gateway: {
      port: 0,
      handleRequest: gatewayHandler,
      stop: () => undefined,
      getProviders: () => [provider],
      setProviders: () => undefined,
      setUpstreamUserAgent: () => undefined,
      setUpstreamProxyUrl: () => undefined,
      getUpstreamProxyUrl: () => undefined,
    },
  });
  return { gatewayHandler, bridgeHandler, cfg, provider };
}

const CALL_TIMEOUT_MS = Number(process.env.ECO_SMOKE_TIMEOUT_MS ?? 45_000);

async function readBodyWithTimeout(res, timeoutMs) {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  const deadline = Date.now() + timeoutMs;
  let idle = 0;
  while (Date.now() < deadline) {
    const slice = Math.min(5_000, Math.max(500, deadline - Date.now()));
    /** @type {{done:boolean, value?: Uint8Array}|null} */
    let chunk = null;
    try {
      chunk = await Promise.race([
        reader.read(),
        new Promise((resolve) => setTimeout(() => resolve(null), slice)),
      ]);
    } catch (e) {
      out += `\n/* read error: ${e instanceof Error ? e.message : String(e)} */`;
      break;
    }
    if (chunk === null) {
      idle += slice;
      if (
        out.includes("message_stop") ||
        out.includes("response.completed") ||
        out.includes("[DONE]") ||
        out.includes("data: [DONE]")
      ) {
        break;
      }
      if (idle >= 15_000 && out.length > 0) break;
      continue;
    }
    idle = 0;
    if (chunk.done) break;
    if (chunk.value) out += decoder.decode(chunk.value, { stream: true });
  }
  try {
    await reader.cancel();
  } catch {
    // ignore
  }
  out += decoder.decode();
  return out;
}

async function callBridge(bridgeHandler, face, body, protocol, cfg) {
  const path = face === "messages" ? "/v1/messages" : "/v1/responses";
  const req = new Request(`http://bridge.local${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      [GATEWAY_PROVIDER_ID_HEADER]: PROVIDER_ID,
      [GATEWAY_UPSTREAM_KIND_HEADER]: cfg.upstreamKind,
      [GATEWAY_REQUESTED_MODEL_HEADER]: `eco-smoke-${protocol}-${face}`,
    },
    body: JSON.stringify(body),
  });
  const started = Date.now();
  const res = await bridgeHandler(req);
  const text = await readBodyWithTimeout(res, CALL_TIMEOUT_MS);
  return {
    status: res.status,
    ct: res.headers.get("content-type") ?? "",
    text,
    ms: Date.now() - started,
  };
}

function anthropicMessagesBody(stream, withTools) {
  /** @type {Record<string, unknown>} */
  const body = {
    model: MODEL,
    max_tokens: 256,
    stream,
    // DeepSeek: thinking + forced tool_choice is rejected — disable thinking for tool tests.
    thinking: { type: "disabled" },
    messages: [{ role: "user", content: "Reply with exactly: OK" }],
  };
  if (withTools) {
    body.tools = ANTHROPIC_TOOL;
    body.messages = [
      {
        role: "user",
        content:
          "Call get_weather with city=Shanghai. Do not answer with text only — you must use the tool.",
      },
    ];
    // auto avoids "Thinking mode does not support this tool_choice" on DeepSeek
    body.tool_choice = { type: "auto" };
  }
  return body;
}

function responsesBody(stream, withTools) {
  // Structured input (not bare string) so responses→anthropic conversion can parse reliably.
  const text = withTools
    ? "Call get_weather with city=Shanghai using the tool."
    : "Reply with exactly: OK";
  /** @type {Record<string, unknown>} */
  const body = {
    model: MODEL,
    stream,
    max_output_tokens: 256,
    // Reduce thinking interference on tool paths (DeepSeek flash still may enable internally)
    reasoning: { effort: "low" },
    input: [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    ],
  };
  if (withTools) {
    body.tools = RESPONSES_TOOL;
    body.tool_choice = "auto";
  }
  return body;
}

const ANTHROPIC_TOOL = [
  {
    name: "get_weather",
    description: "Get weather for a city",
    input_schema: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    },
  },
];

const RESPONSES_TOOL = [
  {
    type: "function",
    name: "get_weather",
    description: "Get weather for a city",
    parameters: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    },
  },
];

function assertClaudeFaceShape(text, stream) {
  if (stream) {
    // DeepSeek anthropic SSE OR converted SSE — must look like event-stream, not empty
    if (!text.trim()) return "empty stream body";
    if (!/event:|data:/.test(text) && !text.includes("type")) {
      return "stream body not SSE-like";
    }
    // Claude SDK error when intercept returns non-Anthropic HTML/empty 200
    if (text.includes("<html") || text.includes("eco_bridge_compact")) {
      return "looks like intercept/HTML not Messages stream";
    }
    return null;
  }
  try {
    const j = JSON.parse(text);
    if (j?.type === "message" || j?.content || j?.role === "assistant") return null;
    if (j?.error) return `error object: ${JSON.stringify(j.error).slice(0, 200)}`;
    return `unexpected json keys: ${Object.keys(j).join(",")}`;
  } catch {
    return `non-json body: ${preview(text, 80)}`;
  }
}

function assertCodexFaceShape(text, stream) {
  if (stream) {
    if (!text.trim()) return "empty stream body";
    if (!/data:|response\./.test(text) && !text.includes("type")) {
      return "stream body not Responses SSE-like";
    }
    return null;
  }
  try {
    const j = JSON.parse(text);
    if (j?.object === "response" || j?.output || j?.status || j?.id?.startsWith?.("resp"))
      return null;
    if (j?.error) return `error: ${JSON.stringify(j.error).slice(0, 200)}`;
    return `unexpected: ${Object.keys(j).join(",")}`;
  } catch {
    return `non-json: ${preview(text, 80)}`;
  }
}

function hasToolUse(text) {
  return (
    text.includes("tool_use") ||
    text.includes("function_call") ||
    text.includes("get_weather") ||
    text.includes('"name":"get_weather"') ||
    text.includes('"name": "get_weather"')
  );
}

/** Run one case without aborting the whole suite on convert crashes. */
async function safeCase(id, protocol, hypothesisId, fn) {
  try {
    await fn();
  } catch (e) {
    record({
      id,
      protocol,
      hypothesisId,
      ok: false,
      summary: "threw",
      detail: e instanceof Error ? `${e.message}\n${e.stack}` : String(e),
    });
  }
}

/** @param {Protocol} protocol @param {string} apiKey */
async function runProtocolSuite(protocol, apiKey) {
  const { bridgeHandler, cfg } = buildHandlers(protocol, apiKey);
  const kind = mapApiCompatToUpstreamKind(
    protocol === "anthropic"
      ? "anthropic"
      : protocol === "openai_responses"
        ? "openai_responses"
        : "openai_chat_completions",
  );

  await safeCase("Claude /v1/messages non-stream", protocol, "H-claude", async () => {
    const r = await callBridge(
      bridgeHandler,
      "messages",
      anthropicMessagesBody(false, false),
      protocol,
      cfg,
    );
    const shape = r.status === 200 ? assertClaudeFaceShape(r.text, false) : r.text;
    const ok = r.status === 200 && !shape;
    record({
      id: "Claude /v1/messages non-stream",
      protocol,
      hypothesisId: "H-claude",
      ok,
      status: r.status,
      summary: ok ? `200 ${r.ms}ms` : `status=${r.status}`,
      detail: ok ? preview(r.text) : `${shape} | ${preview(r.text)}`,
    });
  });

  await safeCase("Claude /v1/messages stream", protocol, "H-claude-stream", async () => {
    const r = await callBridge(
      bridgeHandler,
      "messages",
      anthropicMessagesBody(true, false),
      protocol,
      cfg,
    );
    const shape = r.status === 200 ? assertClaudeFaceShape(r.text, true) : r.text;
    const emptyBug =
      r.status === 200 && (!r.text.trim() || shape === "empty stream body");
    const ok = r.status === 200 && !shape && !emptyBug;
    record({
      id: "Claude /v1/messages stream",
      protocol,
      hypothesisId: "H-claude-stream",
      ok,
      status: r.status,
      summary: ok
        ? `200 stream bytes=${r.text.length} ${r.ms}ms`
        : emptyBug
          ? "EMPTY/MALFORMED STREAM (Claude SDK bug match)"
          : `status=${r.status}`,
      detail: preview(r.text),
    });
  });

  await safeCase("Claude /v1/messages tool_use", protocol, "H-tool", async () => {
    const r = await callBridge(
      bridgeHandler,
      "messages",
      anthropicMessagesBody(false, true),
      protocol,
      cfg,
    );
    const ok = r.status === 200 && hasToolUse(r.text);
    record({
      id: "Claude /v1/messages tool_use",
      protocol,
      hypothesisId: "H-tool",
      ok,
      status: r.status,
      summary: ok ? "tool_use present" : `no tool_use status=${r.status}`,
      detail: preview(r.text),
    });
  });

  await safeCase("Codex /v1/responses non-stream", protocol, "H-codex", async () => {
    const r = await callBridge(
      bridgeHandler,
      "responses",
      responsesBody(false, false),
      protocol,
      cfg,
    );
    const shape = r.status === 200 ? assertCodexFaceShape(r.text, false) : r.text;
    const ok = r.status === 200 && !shape;
    record({
      id: "Codex /v1/responses non-stream",
      protocol,
      hypothesisId: "H-codex",
      ok,
      status: r.status,
      summary: ok ? `200 ${r.ms}ms` : `status=${r.status}`,
      detail: ok ? preview(r.text) : `${shape} | ${preview(r.text)}`,
    });
  });

  await safeCase("Codex /v1/responses stream", protocol, "H-codex-stream", async () => {
    const r = await callBridge(
      bridgeHandler,
      "responses",
      responsesBody(true, false),
      protocol,
      cfg,
    );
    const shape = r.status === 200 ? assertCodexFaceShape(r.text, true) : r.text;
    const ok = r.status === 200 && !shape;
    record({
      id: "Codex /v1/responses stream",
      protocol,
      hypothesisId: "H-codex-stream",
      ok,
      status: r.status,
      summary: ok ? `200 stream bytes=${r.text.length}` : `status=${r.status}`,
      detail: preview(r.text),
    });
  });

  await safeCase("Codex /v1/responses function_call", protocol, "H-tool", async () => {
    const r = await callBridge(
      bridgeHandler,
      "responses",
      responsesBody(false, true),
      protocol,
      cfg,
    );
    const ok = r.status === 200 && hasToolUse(r.text);
    record({
      id: "Codex /v1/responses function_call",
      protocol,
      hypothesisId: "H-tool",
      ok,
      status: r.status,
      summary: ok ? "function_call present" : `no function_call status=${r.status}`,
      detail: preview(r.text),
    });
  });

  record({
    id: `protocol mapping kind=${kind}`,
    protocol,
    hypothesisId: "H-map",
    ok: kind === cfg.upstreamKind,
    summary: `apiCompat=${protocol} → ${cfg.upstreamKind}`,
    detail: JSON.stringify(cfg),
  });

  return cfg;
}

async function electronCdpNote() {
  if (!ELECTRON_CDP) return;
  const cdpUrl = process.env.ECO_CDP_URL ?? "http://127.0.0.1:9222";
  try {
    const { chromium } = await import("playwright-core");
    const browser = await chromium.connectOverCDP(cdpUrl);
    const pages = browser.contexts().flatMap((c) => c.pages());
    const page = pages.find((p) => /5174/.test(p.url())) ?? pages[0];
    const hasEco = page ? await page.evaluate(() => typeof window.eco !== "undefined") : false;
    let health = null;
    try {
      const hr = await fetch("http://127.0.0.1:18765/health");
      health = { status: hr.status, body: await hr.text() };
    } catch (e) {
      health = { error: e instanceof Error ? e.message : String(e) };
    }
    record({
      id: "Electron CDP product surface",
      hypothesisId: "H-e2e",
      ok: Boolean(page && hasEco && health?.status === 200),
      summary: page
        ? `page=${page.url()} eco=${hasEco} bridge=${health?.status ?? health?.error}`
        : "no page",
      detail: JSON.stringify({ health, pageCount: pages.length }),
    });
    // Product-level: plan / subagent require interactive threads — emit checklist only
    record({
      id: "Electron checklist: plan + subagent",
      hypothesisId: "H-e2e",
      ok: true,
      summary:
        "Manual/product: after DB switch restart Eco, Claude 新建对话→需工具; Codex 新建对话; 触发子代理与计划模式",
    });
    await browser.close().catch(() => undefined);
  } catch (e) {
    record({
      id: "Electron CDP connect",
      hypothesisId: "H-e2e",
      ok: false,
      summary: "start with: cd apps/desktop && npm run dev:cdp",
      detail: e instanceof Error ? e.message : String(e),
    });
  }
}

function writeReport() {
  mkdirSync(REPORT_DIR, { recursive: true });
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  const path = join(REPORT_DIR, "deepseek-live-latest.json");
  const payload = {
    passed,
    failed,
    total: results.length,
    providerId: PROVIDER_ID,
    profileId: PROFILE_ID,
    model: MODEL,
    results,
  };
  writeFileSync(path, JSON.stringify(payload, null, 2));
  const htmlPath = join(REPORT_DIR, "deepseek-live-latest.html");
  writeFileSync(
    htmlPath,
    `<!doctype html><meta charset=utf-8><title>DeepSeek live</title>
<style>
body{font-family:system-ui;background:#0f1419;color:#e7ecf1;padding:1.5rem}
tr.pass td:nth-child(3){color:#3dd68c} tr.fail td:nth-child(3){color:#f07178}
table{border-collapse:collapse;width:100%;font-size:14px}
td,th{border-bottom:1px solid #2a3544;padding:.4rem;text-align:left;vertical-align:top}
code{color:#9aa7b5;font-size:12px;white-space:pre-wrap}
</style>
<h1>DeepSeek 官方三协议实网冒烟</h1>
<div id=summary data-passed=${passed} data-failed=${failed}>${passed}/${results.length} passed · ${failed} failed</div>
<table><tr><th>Protocol</th><th>Case</th><th>R</th><th>Summary</th><th>Detail</th></tr>
${results
  .map(
    (r) =>
      `<tr class="${r.ok ? "pass" : "fail"}"><td>${r.protocol ?? ""}</td><td>${r.id}</td><td>${r.ok ? "PASS" : "FAIL"}</td><td>${r.summary}</td><td><code>${String(r.detail ?? "").replace(/</g, "&lt;").slice(0, 500)}</code></td></tr>`,
  )
  .join("")}
</table>
<script>window.__ECO_DEEPSEEK_SMOKE__=${JSON.stringify({ passed, failed, total: results.length })}</script>`,
  );
  return { path, htmlPath, passed, failed };
}

// -------------------- main --------------------
console.log(`DB: ${DB_PATH}`);
console.log(`Provider: ${PROVIDER_ID} · Profile: ${PROFILE_ID} · Model: ${MODEL}`);

const db = openDb();
const providerRow = readProvider(db);
const original = snapshotProvider(providerRow);
console.log(
  `Key: ${maskKey(providerRow.api_key)} · current api_compat=${providerRow.api_compat} path=${providerRow.request_path}`,
);

// Also stash active profile
const originalActive = db
  .query(`SELECT id FROM route_profiles WHERE is_active = 1`)
  .all()
  .map((r) => r.id);
const originalRoutes = db
  .query(
    `SELECT role, provider_id, model_id, api_compat FROM role_routes WHERE profile_id = ?`,
  )
  .all(PROFILE_ID);

const runList = ONLY_PROTOCOL
  ? PROTOCOLS.filter((p) => p === ONLY_PROTOCOL)
  : PROTOCOLS;
if (runList.length === 0) {
  throw new Error(`Unknown --protocol=${ONLY_PROTOCOL}`);
}

try {
  for (const protocol of runList) {
    console.log(`\n======== Protocol: ${protocol} ========`);
    applyProtocolToDb(db, protocol);
    // verify db switch
    const check = readProvider(db);
    record({
      id: "SQLite switch provider_configs",
      protocol,
      hypothesisId: "H-db",
      ok: check.api_compat === protocolConfig(protocol).api_compat,
      summary: `api_compat=${check.api_compat} path=${check.request_path}`,
      detail: JSON.stringify(snapshotProvider(check)),
    });
    await runProtocolSuite(protocol, providerRow.api_key);
  }
  await electronCdpNote();
} finally {
  if (!KEEP_DB) {
    restoreProvider(db, original);
    db.query(`UPDATE route_profiles SET is_active = 0`).run();
    for (const id of originalActive) {
      db.query(`UPDATE route_profiles SET is_active = 1 WHERE id = ?`).run(id);
    }
    for (const route of originalRoutes) {
      db.query(
        `UPDATE role_routes SET provider_id=?, model_id=?, api_compat=?, updated_at=?
         WHERE profile_id=? AND role=?`,
      ).run(
        route.provider_id,
        route.model_id,
        route.api_compat,
        new Date().toISOString(),
        PROFILE_ID,
        route.role,
      );
    }
    console.log("\nDB restored to original provider/profile state.");
  } else {
    console.log("\n--keep-db: leaving last protocol in SQLite.");
  }
  db.close();
}

const report = writeReport();
console.log(`\nReport JSON: ${report.path}`);
console.log(`Report HTML: ${report.htmlPath}`);
console.log(`${report.passed}/${results.length} passed, ${report.failed} failed`);

console.log(`
==== 产品层手测清单（子代理 / 计划 / 执行）====
1. cd apps/desktop && npm run dev:cdp
2. 跑: bun apps/desktop/scripts/smoke-deepseek-live-protocol.mjs --protocol=anthropic --keep-db
3. Eco UI: 激活后选 DeepSeek组合 · Claude 线程发「列出当前目录」
4. 再 --protocol=openai_responses --keep-db，重启后测 Codex 线程 + 工具
5. 再 --protocol=openai_chat_completions --keep-db，两侧各跑一轮
6. 子代理: 在编排开 explore/coder；计划: Claude plan mode
完成后去掉 --keep-db 或手动恢复
`);

if (report.failed > 0) process.exitCode = 1;
