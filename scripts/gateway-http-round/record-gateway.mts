/**
 * Record Eco gateway round-trip: client → gateway → upstream.
 * Upstream traffic is captured via a logging fetchImpl; client req/resp are stored too.
 *
 *   GATEWAY_RECORD_* env keys (see profiles.mjs) \
 *   bun scripts/gateway-http-round/record-gateway.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GATEWAY_BRIDGE_BINDING_ID_HEADER,
  GATEWAY_PROVIDER_ID_HEADER,
  GATEWAY_REQUESTED_MODEL_HEADER,
  GATEWAY_RUN_ATTEMPT_ID_HEADER,
  GATEWAY_THREAD_ID_HEADER,
} from "../../apps/gateway/src/provider-router.ts";
import { createGatewayFetchHandler } from "../../apps/gateway/src/server.ts";
import type { GatewayProvider } from "../../apps/gateway/src/types.ts";
import { ensureDir, writeJson } from "./lib/fixture-io.mjs";
import { captureHttpExchange, logExchange } from "./lib/http-capture.mjs";
import { listProfileIds, resolveProfile } from "./lib/profiles.mjs";
import { buildGatewayClientBody, SCENARIOS } from "./lib/scenarios.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.join(__dirname, "fixtures");

const profileArg = process.argv.find((a) => a.startsWith("--profile="))?.slice("--profile=".length) || "all";
const runId =
  process.env.GATEWAY_HTTP_ROUND_RUN_ID?.trim() ||
  `${new Date().toISOString().replace(/[:.]/g, "-")}-gateway`;

const outDir = path.join(fixturesRoot, runId);
ensureDir(outDir);
ensureDir(path.join(outDir, "artifacts"));

const gatewayLogPath = path.join(outDir, "gateway-http.jsonl");
const upstreamLogPath = path.join(outDir, "upstream-via-gateway.jsonl");
let seq = 0;

function toGatewayProvider(profile) {
  return {
    id: profile.id,
    name: profile.label,
    upstreamKind: profile.upstreamKind,
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    upstreamModelId: profile.model,
    models: [profile.model, `eco_${profile.id}`],
  } satisfies GatewayProvider;
}

const report = {
  runId,
  layer: "gateway",
  recordedAt: new Date().toISOString(),
  profiles: {},
};

for (const profileId of listProfileIds(profileArg)) {
  const profile = resolveProfile(profileId);
  const provider = toGatewayProvider(profile);
  const capturedUpstream = [];
  const profileReport = { id: profileId, gatewayFace: profile.gatewayFace, scenarios: {} };
  let activeScenarioId = "unknown";

  const loggingFetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = typeof init?.body === "string" ? init.body : init?.body ? String(init.body) : undefined;
    const result = await captureHttpExchange({
      fetchImpl: fetch,
      method,
      url,
      headers,
      body,
      secrets: [profile.apiKey],
      scenarioId: activeScenarioId,
      layer: "upstream-via-gateway",
      profileId,
      artifactDir: path.join(outDir, "artifacts"),
      seq: ++seq,
    });
    logExchange(upstreamLogPath, result.exchange);
    capturedUpstream.push(result.exchange);
    return result.response;
  };

  const handler = createGatewayFetchHandler(
    { host: "127.0.0.1", port: 18765, providers: [provider] },
    loggingFetch,
  );

  for (const scenario of SCENARIOS) {
    activeScenarioId = scenario.id;
    const body = buildGatewayClientBody(profile, scenario);
    const clientHeaders = {
      "content-type": "application/json",
      accept: scenario.stream ? "text/event-stream" : "application/json",
      [GATEWAY_PROVIDER_ID_HEADER]: provider.id,
      [GATEWAY_REQUESTED_MODEL_HEADER]: profile.model,
      [GATEWAY_THREAD_ID_HEADER]: `thr_gw_${profile.id}`,
      [GATEWAY_BRIDGE_BINDING_ID_HEADER]: `cbb_gw_${profile.id}`,
      [GATEWAY_RUN_ATTEMPT_ID_HEADER]: `attempt_${scenario.id}`,
    };
    const authValue = `${profile.upstreamAuthPrefix ?? ""}${profile.apiKey}`;
    clientHeaders[profile.clientAuthHeader] = authValue;

    const clientUrl = `http://127.0.0.1:18765${profile.gatewayFace}`;
    const { exchange } = await captureHttpExchange({
      fetchImpl: async (url, init) => handler(new Request(url, init)),
      method: "POST",
      url: clientUrl,
      headers: clientHeaders,
      body: JSON.stringify(body),
      secrets: [profile.apiKey],
      scenarioId: scenario.id,
      layer: "gateway-client",
      profileId,
      artifactDir: path.join(outDir, "artifacts"),
      seq: ++seq,
    });
    logExchange(gatewayLogPath, exchange);
    profileReport.scenarios[scenario.id] = {
      ok: exchange.ok,
      status: exchange.response.status,
      durationMs: exchange.durationMs,
      bodyArtifact: exchange.response.bodyArtifact,
      upstreamCount: capturedUpstream.length,
    };
  }

  report.profiles[profileId] = profileReport;
}

report.ok = Object.values(report.profiles).every((p) => Object.values(p.scenarios).every((s) => s.ok));

writeJson(path.join(outDir, "summary.json"), report);
writeJson(path.join(outDir, "meta.json"), {
  runId,
  layer: "gateway",
  profileArg,
  recordedAt: report.recordedAt,
});
writeJson(path.join(fixturesRoot, "latest-gateway.json"), {
  runId,
  path: outDir,
  ok: report.ok,
  recordedAt: report.recordedAt,
});

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
