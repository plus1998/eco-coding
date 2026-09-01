/**
 * Record raw upstream HTTP request/response pairs (bypass Eco gateway).
 *
 *   GATEWAY_RECORD_PACKY_RESPONSES_KEY=... \
 *   GATEWAY_RECORD_PACKY_ANTHROPIC_KEY=... \
 *   GATEWAY_RECORD_LONGCAT_CHAT_KEY=... \
 *   bun scripts/gateway-http-round/record-upstream.mjs
 *
 *   bun scripts/gateway-http-round/record-upstream.mjs --profile=packy_anthropic
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildUpstreamUrl } from "../../apps/gateway/src/provider-router.ts";
import type { GatewayProvider } from "../../apps/gateway/src/types.ts";
import { ensureDir, writeJson } from "./lib/fixture-io.mjs";
import { captureHttpExchange, logExchange } from "./lib/http-capture.mjs";
import { listProfileIds, resolveProfile } from "./lib/profiles.mjs";
import { buildUpstreamBody, SCENARIOS } from "./lib/scenarios.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.join(__dirname, "fixtures");

const profileArg = process.argv.find((a) => a.startsWith("--profile="))?.slice("--profile=".length) || "all";
const runId =
  process.env.GATEWAY_HTTP_ROUND_RUN_ID?.trim() ||
  `${new Date().toISOString().replace(/[:.]/g, "-")}-upstream`;

const outDir = path.join(fixturesRoot, runId);
ensureDir(outDir);
ensureDir(path.join(outDir, "artifacts"));

const logPath = path.join(outDir, "upstream-http.jsonl");
let seq = 0;

function toGatewayProvider(profile) {
  return {
    id: profile.id,
    name: profile.label,
    upstreamKind: profile.upstreamKind,
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    upstreamModelId: profile.model,
    models: [profile.model],
  } satisfies GatewayProvider;
}

const report = {
  runId,
  layer: "upstream",
  recordedAt: new Date().toISOString(),
  profiles: {},
};

for (const profileId of listProfileIds(profileArg)) {
  const profile = resolveProfile(profileId);
  const provider = toGatewayProvider(profile);
  const upstreamUrl = buildUpstreamUrl(provider, profile.upstreamKind);
  const profileReport = { id: profileId, upstreamUrl, scenarios: {} };

  for (const scenario of SCENARIOS) {
    const body = buildUpstreamBody(profile, scenario);
    const headers = {
      "content-type": "application/json",
      accept: scenario.stream ? "text/event-stream" : "application/json",
      ...(profile.extraUpstreamHeaders ?? {}),
    };
    const authValue = `${profile.upstreamAuthPrefix ?? ""}${profile.apiKey}`;
    headers[profile.upstreamAuthHeader] = authValue;

    const { exchange } = await captureHttpExchange({
      method: "POST",
      url: upstreamUrl,
      headers,
      body: JSON.stringify(body),
      secrets: [profile.apiKey],
      scenarioId: scenario.id,
      layer: "upstream",
      profileId,
      artifactDir: path.join(outDir, "artifacts"),
      seq: ++seq,
    });
    logExchange(logPath, exchange);
    profileReport.scenarios[scenario.id] = {
      ok: exchange.ok,
      status: exchange.response.status,
      durationMs: exchange.durationMs,
      bodyArtifact: exchange.response.bodyArtifact,
    };
  }

  report.profiles[profileId] = profileReport;
}

report.ok = Object.values(report.profiles).every((p) =>
  Object.values(p.scenarios).every((s) => s.ok),
);

writeJson(path.join(outDir, "summary.json"), report);
writeJson(path.join(outDir, "meta.json"), {
  runId,
  layer: "upstream",
  profileArg,
  recordedAt: report.recordedAt,
});
writeJson(path.join(fixturesRoot, "latest-upstream.json"), {
  runId,
  path: outDir,
  ok: report.ok,
  recordedAt: report.recordedAt,
});

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
