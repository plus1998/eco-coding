/**
 * Record full conversation-round scenarios through Eco Bridge → Gateway for each
 * client × protocol profile cell.
 *
 *   export GATEWAY_RECORD_RESPONSES_KEY=...   # Luna Responses @ gpt.pomener.ru
 *   export GATEWAY_RECORD_PACKY_ANTHROPIC_KEY=...
 *   export GATEWAY_RECORD_LONGCAT_CHAT_KEY=...
 *   bun scripts/gateway-http-round/record-client-round.mts
 *
 * Options:
 *   --client=codex|claude|pi|all     default all
 *   --profile=packy_responses|packy_anthropic|longcat_chat|longcat_responses|all
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runClaudeGatewayRound } from "./clients/claude-gateway-round.mts";
import { runCodexGatewayRound } from "./clients/codex-gateway-round.mts";
import { runPiGatewayRound } from "./clients/pi-gateway-round.mts";
import { countCellUpstreamExchanges, resolveCellDir, writeCellUpstreamLog } from "./lib/cell-artifacts.mjs";
import {
  buildRecordingCells,
  listClientIds,
  listRecordableProfileIds,
  listSkippedRecordingCells,
  RECORDING_CELL_SPECS,
} from "./lib/client-matrix.mjs";
import { ensureDir, writeJson } from "./lib/fixture-io.mjs";
import { createGatewayRecordingStack } from "./lib/gateway-stack.mts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.join(__dirname, "fixtures");

const clientArg = process.argv.find((a) => a.startsWith("--client="))?.slice("--client=".length) || "all";
const profileArg = process.argv.find((a) => a.startsWith("--profile="))?.slice("--profile=".length) || "all";

const clients = listClientIds(clientArg);
const profileIds = listRecordableProfileIds(profileArg, { requireApiKey: true });
if (profileIds.length === 0) {
  console.error("No profiles with API keys found. Set GATEWAY_RECORD_* env vars.");
  process.exit(2);
}

const marker = process.env.ECO_SMOKE_MARKER?.trim() || `LC${Date.now().toString(36).toUpperCase()}`;
const runId =
  process.env.GATEWAY_HTTP_ROUND_RUN_ID?.trim() ||
  `${new Date().toISOString().replace(/[:.]/g, "-")}-client-round`;
const outDir = path.join(fixturesRoot, runId);
const masterUpstreamLog = path.join(outDir, "upstream-via-gateway.jsonl");
const artifactDir = path.join(outDir, "artifacts");

ensureDir(outDir);
ensureDir(artifactDir);

const cells = buildRecordingCells(clients, profileIds);
const skippedCells = listSkippedRecordingCells(clients, profileIds).map((spec) => ({
  ...spec,
  reason: `Not in RECORDING_CELL_SPECS for --client=${clients.join(",")} --profile=${profileIds.join(",")}`,
}));
if (skippedCells.length > 0 && (clientArg !== "all" || profileArg !== "all")) {
  process.stderr.write(
    `[gateway-client-round] note: ${skippedCells.length} matrix cell(s) not selected:\n` +
      skippedCells.map((s) => `  - ${s.client}/${s.profileId}: ${s.reason}`).join("\n") +
      "\n",
  );
}
process.stderr.write(`[gateway-client-round] matrix: ${cells.length}/${RECORDING_CELL_SPECS.length} cells\n`);
const stack = await createGatewayRecordingStack({
  profileIds,
  upstreamLogPath: masterUpstreamLog,
  artifactDir,
});

const report = {
  runId,
  layer: "client-round",
  marker,
  recordedAt: new Date().toISOString(),
  clients,
  profileIds,
  skippedCells,
  cells: /** @type {Record<string, unknown>} */ ({}),
  ok: true,
};

try {
  for (const cell of cells) {
    const cellKey = `${cell.client}/${cell.profileId}`;
    const cellDir = resolveCellDir(outDir, cell.client, cell.profileId);
    ensureDir(cellDir);

    const beforeCount = countCellUpstreamExchanges(masterUpstreamLog, cell);
    process.stderr.write(`\n[gateway-client-round] recording ${cellKey} …\n`);

    let result;
    const sharedInput = {
      stack,
      profileId: cell.profileId,
      outDir: cellDir,
      marker,
    };

    if (cell.client === "codex") {
      result = await runCodexGatewayRound(sharedInput);
    } else if (cell.client === "claude") {
      result = await runClaudeGatewayRound(sharedInput);
    } else if (cell.client === "pi") {
      result = await runPiGatewayRound(sharedInput);
    } else {
      throw new Error(`Unknown client: ${cell.client}`);
    }

    const afterCount = countCellUpstreamExchanges(masterUpstreamLog, cell);
    const upstreamExchangeCount = afterCount - beforeCount;
    writeCellUpstreamLog(masterUpstreamLog, path.join(cellDir, "upstream-via-gateway.jsonl"), cell);

    const cellOk = Boolean(result.checklist?.ok) && upstreamExchangeCount > 0;
    const cellErrors = [...result.errors];
    if (upstreamExchangeCount === 0) {
      cellErrors.push("No upstream-via-gateway exchanges recorded for this cell");
    }

    report.cells[cellKey] = {
      client: cell.client,
      profileId: cell.profileId,
      scenarioId: cell.scenarioId,
      ok: cellOk,
      upstreamExchangeCount,
      checklistOk: result.checklist?.ok ?? false,
      failed: result.checklist?.failed ?? [],
      errors: cellErrors,
    };
    if (!cellOk) {
      report.ok = false;
    }
  }
} finally {
  stack.stop();
}

writeJson(path.join(outDir, "summary.json"), report);
writeJson(path.join(outDir, "meta.json"), {
  runId,
  layer: "client-round",
  marker,
  clients,
  profileIds,
  cellCount: cells.length,
});
writeJson(path.join(fixturesRoot, "latest-client-round.json"), {
  runId,
  path: outDir,
  ok: report.ok,
  recordedAt: report.recordedAt,
});

process.stderr.write(
  `\n[gateway-client-round] fixture: ${outDir}\n` + `  cells: ${cells.length}\n` + `  ok: ${report.ok}\n`,
);

process.exit(report.ok ? 0 : 1);
