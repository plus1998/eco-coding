#!/usr/bin/env bun
/**
 * Gateway protocol-conversion smoke (automated)
 *
 * Matrix:
 *   client face          × upstream kind
 *   · /v1/messages       → anthropic-messages | responses | openai-chat
 *   · /v1/responses      → anthropic-messages | responses | openai-chat
 *   · Bridge compact intercept (2A)
 *   · missing provider id → 400
 *   · Claude product prepare miss → still requires provider path
 *
 * Usage:
 *   bun apps/desktop/scripts/smoke-gateway-protocol-matrix.mjs
 *   bun apps/desktop/scripts/smoke-gateway-protocol-matrix.mjs --open-report
 *   ECO_CDP_URL=http://127.0.0.1:9222 bun apps/desktop/scripts/smoke-gateway-protocol-matrix.mjs --electron-cdp
 *
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GATEWAY_PROVIDER_ID_HEADER,
  GATEWAY_REQUESTED_MODEL_HEADER,
  GATEWAY_UPSTREAM_KIND_HEADER,
  createGatewayFetchHandler,
} from "@eco/gateway";
import {
  createEcoSdkBridgeHandler,
  buildEcoBridgeCompactInterceptResponse,
} from "../src/main/eco-sdk-bridge.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");
const REPORT_DIR = join(REPO_ROOT, ".cursor/smoke-reports");
const OPEN_REPORT = process.argv.includes("--open-report");
const ELECTRON_CDP = process.argv.includes("--electron-cdp");

/** @type {Array<Record<string, unknown>>} */
const cases = [];

function record(caseResult) {
  cases.push(caseResult);
  const mark = caseResult.ok ? "✓" : "✗";
  console.log(`${mark} ${caseResult.id} — ${caseResult.summary}`);
  if (!caseResult.ok && caseResult.detail) {
    console.log(`    detail: ${caseResult.detail}`);
  }
}

function preview(text, max = 240) {
  const s = String(text ?? "");
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

function sseTextDelta(text) {
  return [
    "event: message_start",
    `data: ${JSON.stringify({
      type: "message_start",
      message: {
        id: "msg_mock",
        type: "message",
        role: "assistant",
        content: [],
        model: "mock-model",
        stop_reason: null,
        usage: { input_tokens: 1, output_tokens: 0 },
      },
    })}`,
    "",
    "event: content_block_start",
    `data: ${JSON.stringify({
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    })}`,
    "",
    "event: content_block_delta",
    `data: ${JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text },
    })}`,
    "",
    "event: content_block_stop",
    `data: ${JSON.stringify({ type: "content_block_stop", index: 0 })}`,
    "",
    "event: message_delta",
    `data: ${JSON.stringify({
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 3 },
    })}`,
    "",
    "event: message_stop",
    `data: ${JSON.stringify({ type: "message_stop" })}`,
    "",
    "",
  ].join("\n");
}

function responsesSse(text) {
  return [
    `data: ${JSON.stringify({
      type: "response.created",
      response: { id: "resp_mock", status: "in_progress", output: [] },
    })}`,
    "",
    `data: ${JSON.stringify({
      type: "response.output_item.added",
      output_index: 0,
      item: { type: "message", id: "msg_1", role: "assistant", content: [] },
    })}`,
    "",
    `data: ${JSON.stringify({
      type: "response.output_text.delta",
      delta: text,
      item_id: "msg_1",
      output_index: 0,
      content_index: 0,
    })}`,
    "",
    `data: ${JSON.stringify({
      type: "response.completed",
      response: {
        id: "resp_mock",
        status: "completed",
        output: [
          {
            type: "message",
            id: "msg_1",
            role: "assistant",
            content: [{ type: "output_text", text }],
          },
        ],
        usage: { input_tokens: 1, output_tokens: 3 },
      },
    })}`,
    "",
    "",
  ].join("\n");
}

/** @returns {{ server: ReturnType<typeof Bun.serve>, baseUrl: string, hits: Array<{path:string, body:unknown}> }} */
function startMockUpstream(kind) {
  /** @type {Array<{path:string, body:unknown}>} */
  const hits = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      let body = null;
      if (req.method === "POST") {
        try {
          body = await req.json();
        } catch {
          body = null;
        }
      }
      hits.push({ path: url.pathname, body });

      if (kind === "anthropic-messages") {
        if (url.pathname.endsWith("/count_tokens")) {
          return Response.json({ input_tokens: 11 });
        }
        if (body?.stream === true) {
          return new Response(sseTextDelta("from-anthropic"), {
            status: 200,
            headers: { "content-type": "text/event-stream; charset=utf-8" },
          });
        }
        return Response.json({
          id: "msg_mock",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "from-anthropic" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 2, output_tokens: 3 },
        });
      }

      if (kind === "responses") {
        if (body?.stream === true) {
          return new Response(responsesSse("from-responses"), {
            status: 200,
            headers: { "content-type": "text/event-stream; charset=utf-8" },
          });
        }
        return Response.json({
          id: "resp_mock",
          object: "response",
          status: "completed",
          model: "mock-model",
          output: [
            {
              type: "message",
              id: "msg_1",
              role: "assistant",
              content: [{ type: "output_text", text: "from-responses" }],
            },
          ],
          usage: { input_tokens: 2, output_tokens: 3 },
        });
      }

      // openai-chat
      if (body?.stream === true) {
        const chunks = [
          {
            id: "chatcmpl-1",
            object: "chat.completion.chunk",
            created: 1,
            model: "mock-model",
            choices: [{ index: 0, delta: { role: "assistant", content: "from-chat" }, finish_reason: null }],
          },
          {
            id: "chatcmpl-1",
            object: "chat.completion.chunk",
            created: 1,
            model: "mock-model",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          },
        ];
        const sse = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
        return new Response(sse, {
          status: 200,
          headers: { "content-type": "text/event-stream; charset=utf-8" },
        });
      }
      return Response.json({
        id: "chatcmpl-1",
        object: "chat.completion",
        created: 1,
        model: "mock-model",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "from-chat" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      });
    },
  });
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.port}`,
    hits,
  };
}

async function runMatrix() {
  const mocks = {
    anthropic: startMockUpstream("anthropic-messages"),
    responses: startMockUpstream("responses"),
    chat: startMockUpstream("openai-chat"),
  };

  const providers = [
    {
      id: "p-anthropic",
      name: "Anthropic mock",
      upstreamKind: "anthropic-messages",
      baseUrl: mocks.anthropic.baseUrl,
      apiKey: "sk-a",
      upstreamModelId: "mock-anthropic",
      models: ["mock-anthropic"],
    },
    {
      id: "p-responses",
      name: "Responses mock",
      upstreamKind: "responses",
      baseUrl: mocks.responses.baseUrl,
      apiKey: "sk-r",
      upstreamModelId: "mock-responses",
      models: ["mock-responses"],
    },
    {
      id: "p-chat",
      name: "Chat mock",
      upstreamKind: "openai-chat",
      baseUrl: mocks.chat.baseUrl,
      apiKey: "sk-c",
      upstreamModelId: "mock-chat",
      models: ["mock-chat"],
    },
  ];

  const gatewayFetchLog = [];
  const gatewayHandler = createGatewayFetchHandler(
    {
      host: "127.0.0.1",
      port: 0,
      providers,
    },
    async (input, init) => {
      const url = String(input);
      gatewayFetchLog.push({ url, method: init?.method ?? "GET" });
      // route to matching mock by origin
      return fetch(input, init);
    },
  );

  const bridgeHandler = createEcoSdkBridgeHandler({
    gateway: {
      port: 0,
      handleRequest: gatewayHandler,
      stop: () => undefined,
      getProviders: () => providers,
      setProviders: () => undefined,
      setUpstreamUserAgent: () => undefined,
      setUpstreamProxyUrl: () => undefined,
      getUpstreamProxyUrl: () => undefined,
    },
    // No Claude session → prepare miss; product stamps via resolveRoute only for codex tests
  });

  // ---- Case matrix ----
  const matrix = [
    {
      id: "messages→anthropic non-stream",
      hypothesisId: "H-A",
      face: "messages",
      providerId: "p-anthropic",
      model: "mock-anthropic",
      kind: "anthropic-messages",
      stream: false,
      expectStatus: 200,
      expectBodyIncludes: "from-anthropic",
      expectCtIncludes: "application/json",
    },
    {
      id: "messages→anthropic stream",
      hypothesisId: "H-A",
      face: "messages",
      providerId: "p-anthropic",
      model: "mock-anthropic",
      kind: "anthropic-messages",
      stream: true,
      expectStatus: 200,
      expectBodyIncludes: "from-anthropic",
      expectCtIncludes: "text/event-stream",
    },
    {
      id: "messages→responses non-stream",
      hypothesisId: "H-B",
      face: "messages",
      providerId: "p-responses",
      model: "mock-responses",
      kind: "responses",
      stream: false,
      expectStatus: 200,
      expectBodyIncludes: "from-responses",
      expectCtIncludes: "application/json",
      // Anthropic face after conversion
      expectJsonType: "message",
    },
    {
      id: "messages→responses stream",
      hypothesisId: "H-B",
      face: "messages",
      providerId: "p-responses",
      model: "mock-responses",
      kind: "responses",
      stream: true,
      expectStatus: 200,
      expectBodyIncludes: "from-responses",
      expectCtIncludes: "text/event-stream",
    },
    {
      id: "messages→openai-chat non-stream",
      hypothesisId: "H-C",
      face: "messages",
      providerId: "p-chat",
      model: "mock-chat",
      kind: "openai-chat",
      stream: false,
      expectStatus: 200,
      expectBodyIncludes: "from-chat",
      expectCtIncludes: "application/json",
      expectJsonType: "message",
    },
    {
      id: "messages→openai-chat stream",
      hypothesisId: "H-C",
      face: "messages",
      providerId: "p-chat",
      model: "mock-chat",
      kind: "openai-chat",
      stream: true,
      expectStatus: 200,
      expectBodyIncludes: "from-chat",
      expectCtIncludes: "text/event-stream",
    },
    {
      id: "responses→anthropic non-stream",
      hypothesisId: "H-D",
      face: "responses",
      providerId: "p-anthropic",
      model: "mock-anthropic",
      kind: "anthropic-messages",
      stream: false,
      expectStatus: 200,
      expectBodyIncludes: "from-anthropic",
    },
    {
      id: "responses→responses non-stream",
      hypothesisId: "H-D",
      face: "responses",
      providerId: "p-responses",
      model: "mock-responses",
      kind: "responses",
      stream: false,
      expectStatus: 200,
      expectBodyIncludes: "from-responses",
    },
    {
      id: "responses→openai-chat non-stream",
      hypothesisId: "H-D",
      face: "responses",
      providerId: "p-chat",
      model: "mock-chat",
      kind: "openai-chat",
      stream: false,
      expectStatus: 200,
      expectBodyIncludes: "from-chat",
    },
  ];

  for (const c of matrix) {
    const path = c.face === "messages" ? "/v1/messages" : "/v1/responses";
    const body =
      c.face === "messages"
        ? {
            model: c.model,
            max_tokens: 64,
            stream: c.stream,
            messages: [{ role: "user", content: "hi" }],
          }
        : {
            model: c.model,
            stream: c.stream,
            input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }],
          };

    const req = new Request(`http://bridge.local${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [GATEWAY_PROVIDER_ID_HEADER]: c.providerId,
        [GATEWAY_UPSTREAM_KIND_HEADER]: c.kind,
        [GATEWAY_REQUESTED_MODEL_HEADER]: `eco-test-${c.model}`,
      },
      body: JSON.stringify(body),
    });

    let status = 0;
    let ct = "";
    let text = "";
    let err = null;
    try {
      const res = await bridgeHandler(req);
      status = res.status;
      ct = res.headers.get("content-type") ?? "";
      text = await res.text();
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }

    const ok =
      !err &&
      status === c.expectStatus &&
      (!c.expectBodyIncludes || text.includes(c.expectBodyIncludes)) &&
      (!c.expectCtIncludes || ct.includes(c.expectCtIncludes)) &&
      (!c.expectJsonType ||
        (() => {
          try {
            return JSON.parse(text).type === c.expectJsonType;
          } catch {
            return false;
          }
        })());

    record({
      id: c.id,
      hypothesisId: c.hypothesisId,
      ok,
      summary: ok
        ? `status=${status} ct=${ct.split(";")[0]} bytes=${text.length}`
        : `status=${status} err=${err ?? "assert"}`,
      detail: ok
        ? preview(text, 160)
        : `status=${status} ct=${ct} body=${preview(text)} err=${err}`,
      status,
      contentType: ct,
      bodyPreview: preview(text),
      face: c.face,
      upstreamKind: c.kind,
      stream: c.stream,
    });
  }

  // Missing provider id
  {
    const res = await bridgeHandler(
      new Request("http://bridge.local/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "mock-anthropic",
          max_tokens: 16,
          messages: [{ role: "user", content: "x" }],
        }),
      }),
    );
    const text = await res.text();
    const ok = res.status === 400 && text.includes("x-gateway-provider-id");
    record({
      id: "messages missing provider-id → 400",
      hypothesisId: "H1",
      ok,
      summary: `status=${res.status}`,
      detail: preview(text),
      status: res.status,
      bodyPreview: preview(text),
    });
  }

  // Bridge compact intercept (must not call gateway fetch)
  {
    const fetchBefore = gatewayFetchLog.length;
    const res = await bridgeHandler(
      new Request("http://bridge.local/v1/responses/compact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "mock-responses", input: "x" }),
      }),
    );
    const json = await res.json();
    const fetchAfter = gatewayFetchLog.length;
    const ok =
      res.status === 200 &&
      fetchAfter === fetchBefore &&
      Array.isArray(json.output) &&
      json.output.some((o) => o.type === "compaction");
    record({
      id: "bridge compact intercept (2A)",
      hypothesisId: "H2",
      ok,
      summary: ok ? "intercepted, gateway unused" : "compact path wrong",
      detail: JSON.stringify({ status: res.status, gatewayFetches: fetchAfter - fetchBefore, json }),
      status: res.status,
    });
  }

  // Gateway pure compact 501
  {
    const res = await gatewayHandler(
      new Request("http://gw.local/v1/responses/compact", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [GATEWAY_PROVIDER_ID_HEADER]: "p-responses",
        },
        body: JSON.stringify({ model: "mock-responses", input: "x" }),
      }),
    );
    const json = await res.json();
    const ok = res.status === 501 && json?.error?.type === "eco_bridge_compact_only";
    record({
      id: "gateway compact → 501",
      hypothesisId: "H2",
      ok,
      summary: `status=${res.status} type=${json?.error?.type}`,
      detail: preview(JSON.stringify(json)),
      status: res.status,
    });
  }

  // count_tokens anthropic via gateway
  {
    const res = await gatewayHandler(
      new Request("http://gw.local/v1/messages/count_tokens", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [GATEWAY_PROVIDER_ID_HEADER]: "p-anthropic",
          [GATEWAY_UPSTREAM_KIND_HEADER]: "anthropic-messages",
        },
        body: JSON.stringify({
          model: "mock-anthropic",
          messages: [{ role: "user", content: "count me" }],
        }),
      }),
    );
    const json = await res.json();
    const ok = res.status === 200 && json.input_tokens === 11;
    record({
      id: "count_tokens anthropic exact",
      hypothesisId: "H4",
      ok,
      summary: `status=${res.status} tokens=${json.input_tokens}`,
      detail: JSON.stringify(json),
      status: res.status,
    });
  }

  // shape helper export
  {
    const res = buildEcoBridgeCompactInterceptResponse({ model: "x" });
    const ok = res.status === 200;
    record({
      id: "compact response helper shape",
      hypothesisId: "H2",
      ok,
      summary: ok ? "ok" : "bad status",
      status: res.status,
    });
  }

  for (const m of Object.values(mocks)) {
    m.server.stop(true);
  }

  return cases;
}

function writeHtmlReport(results) {
  mkdirSync(REPORT_DIR, { recursive: true });
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = join(REPORT_DIR, `protocol-matrix-${stamp}.html`);
  const rows = results
    .map(
      (r) => `<tr class="${r.ok ? "pass" : "fail"}">
      <td>${escapeHtml(r.id)}</td>
      <td>${r.ok ? "PASS" : "FAIL"}</td>
      <td>${escapeHtml(String(r.summary ?? ""))}</td>
      <td><code>${escapeHtml(String(r.detail ?? r.bodyPreview ?? ""))}</code></td>
    </tr>`,
    )
    .join("\n");
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <title>Eco Gateway Protocol Smoke</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem; background: #0f1419; color: #e7ecf1; }
    h1 { font-size: 1.25rem; }
    .sum { margin: 1rem 0; padding: 0.75rem 1rem; border-radius: 8px; background: #1a2332; }
    .sum.ok { border-left: 4px solid #3dd68c; }
    .sum.bad { border-left: 4px solid #f07178; }
    table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    th, td { text-align: left; padding: 0.5rem 0.6rem; border-bottom: 1px solid #2a3544; vertical-align: top; }
    tr.pass td:nth-child(2) { color: #3dd68c; font-weight: 600; }
    tr.fail td:nth-child(2) { color: #f07178; font-weight: 600; }
    code { white-space: pre-wrap; word-break: break-all; color: #9aa7b5; font-size: 0.8rem; }
  </style>
</head>
<body>
  <h1>Gateway 协议转换冒烟矩阵</h1>
  <div class="sum ${failed === 0 ? "ok" : "bad"}" id="summary"
       data-passed="${passed}" data-failed="${failed}" data-total="${results.length}">
    ${passed}/${results.length} passed · ${failed} failed · session ${SESSION_ID}
  </div>
  <table>
    <thead><tr><th>Case</th><th>Result</th><th>Summary</th><th>Detail</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <script>
    // Browser CDP-friendly marker for automation
    window.__ECO_PROTOCOL_SMOKE__ = ${JSON.stringify({
      passed,
      failed,
      total: results.length,
      sessionId: SESSION_ID,
      results: results.map((r) => ({ id: r.id, ok: r.ok, status: r.status })),
    })};
  </script>
</body>
</html>`;
  writeFileSync(reportPath, html, "utf8");
  writeFileSync(join(REPORT_DIR, "protocol-matrix-latest.html"), html, "utf8");
  writeFileSync(
    join(REPORT_DIR, "protocol-matrix-latest.json"),
    JSON.stringify({ passed, failed, total: results.length, results }, null, 2),
    "utf8",
  );
  return reportPath;
}

function escapeHtml(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function openReportWithPlaywright(reportPath) {
  const { chromium } = await import("playwright-core");
  // Prefer system Chrome / Playwright chromium
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: "chrome" });
  } catch {
    try {
      browser = await chromium.launch({ headless: true });
    } catch (e) {
      console.warn("Playwright launch failed, skip browser open:", e);
      return null;
    }
  }
  const page = await browser.newPage();
  /** @type {Array<{url:string, status:number, ct:string}>} */
  const network = [];
  page.on("response", (res) => {
    network.push({
      url: res.url(),
      status: res.status(),
      ct: res.headers()["content-type"] ?? "",
    });
  });
  await page.goto(`file://${reportPath}`, { waitUntil: "domcontentloaded" });
  const marker = await page.evaluate(() => window.__ECO_PROTOCOL_SMOKE__);
  const summaryText = await page.locator("#summary").innerText();
  await browser.close();
  console.log(`\n[browser] report loaded: ${summaryText.trim()}`);
  return marker;
}

async function electronCdpLiveSmoke() {
  const cdpUrl = process.env.ECO_CDP_URL ?? "http://127.0.0.1:9222";
  const { chromium } = await import("playwright-core");
  console.log(`\n[electron-cdp] connecting ${cdpUrl} …`);
  let browser;
  try {
    browser = await chromium.connectOverCDP(cdpUrl);
  } catch (e) {
    record({
      id: "electron CDP connect",
      hypothesisId: "H-E",
      ok: false,
      summary: "cannot connect CDP — start desktop with npm run dev:cdp",
      detail: e instanceof Error ? e.message : String(e),
    });
    return;
  }
  const pages = browser.contexts().flatMap((c) => c.pages());
  const page =
    pages.find((p) => /127\.0\.0\.1:5174|localhost:5174/.test(p.url())) ?? pages[0];
  if (!page) {
    record({
      id: "electron CDP page",
      hypothesisId: "H-E",
      ok: false,
      summary: "no renderer page on CDP",
    });
    await browser.close().catch(() => undefined);
    return;
  }

  // Probe Bridge health from main via renderer evaluate if eco API exposes nothing —
  // at least probe loopback Bridge from the test side.
  let bridgeHealth = null;
  try {
    const healthRes = await fetch("http://127.0.0.1:18765/health");
    bridgeHealth = { status: healthRes.status, body: await healthRes.text() };
  } catch (e) {
    bridgeHealth = { error: e instanceof Error ? e.message : String(e) };
  }

  const pageUrl = page.url();
  const hasEco = await page.evaluate(() => typeof window.eco !== "undefined");

  record({
    id: "electron Bridge /health live",
    hypothesisId: "H-E",
    ok: typeof bridgeHealth.status === "number" && bridgeHealth.status === 200,
    summary:
      typeof bridgeHealth.status === "number"
        ? `Bridge health HTTP ${bridgeHealth.status}`
        : `Bridge not listening: ${bridgeHealth.error}`,
    detail: JSON.stringify(bridgeHealth),
    status: bridgeHealth.status,
  });

  record({
    id: "electron renderer has window.eco",
    hypothesisId: "H-E",
    ok: hasEco,
    summary: hasEco ? `page=${pageUrl}` : "window.eco missing",
    detail: pageUrl,
  });

  // Do not auto-send Claude prompts here (side effects); leave matrix cases for pure gateway.
  await browser.close().catch(() => undefined);
}

// ---- main ----
const results = await runMatrix();
if (ELECTRON_CDP) {
  await electronCdpLiveSmoke();
}
const reportPath = writeHtmlReport(results);
console.log(`\nReport: ${reportPath}`);

if (OPEN_REPORT || process.env.ECO_SMOKE_OPEN_REPORT === "1") {
  await openReportWithPlaywright(reportPath);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
if (failed > 0) {
  process.exitCode = 1;
}
