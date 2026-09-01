/**
 * Record Codex + PI + Claude conversation-round fixtures in one pass.
 *
 *   LONGCAT_API_KEY=... bun scripts/conversation-round/record-all.mjs
 *
 * Options:
 *   --codex-only | --pi-only | --claude-only
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const args = process.argv.slice(2);

const marker = process.env.ECO_SMOKE_MARKER?.trim() || `LC${Date.now().toString(36).toUpperCase()}`;
const sharedEnv = {
  ...process.env,
  ECO_SMOKE_MARKER: marker,
};

const onlyCodex = args.includes("--codex-only");
const onlyPi = args.includes("--pi-only");
const onlyClaude = args.includes("--claude-only");

const runCodex = !onlyPi && !onlyClaude;
const runPi = !onlyCodex && !onlyClaude;
const runClaude = !onlyCodex && !onlyPi;

const longcatKey =
  process.env.LONGCAT_API_KEY?.trim() || process.env.ECO_CODEX_SMOKE_API_KEY?.trim() || "";

const results = [];

function runStep(label, command, commandArgs, extraEnv = {}) {
  console.log(`\n=== ${label} ===`);
  const proc = spawnSync(command, commandArgs, {
    cwd: root,
    env: { ...sharedEnv, ...extraEnv },
    stdio: "inherit",
  });
  results.push({ label, exitCode: proc.status ?? 1 });
  return proc.status ?? 1;
}

if (runCodex || runPi || runClaude) {
  if (!longcatKey) {
    console.error("Missing LONGCAT_API_KEY (or ECO_CODEX_SMOKE_API_KEY)");
    process.exit(2);
  }
}

if (runCodex) {
  runStep("Codex", "bun", ["scripts/conversation-round/record.mjs"]);
}

if (runPi) {
  runStep("PI", "bun", ["scripts/conversation-round/record-pi.mts"]);
}

if (runClaude) {
  runStep("Claude", "bun", ["scripts/conversation-round/record-claude.mts"]);
}

const summary = {
  marker,
  ok: results.every((r) => r.exitCode === 0),
  results,
};

const fixturesRoot = path.join(__dirname, "fixtures");
fs.writeFileSync(path.join(fixturesRoot, "latest-all.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

if (!summary.ok) {
  process.exitCode = 1;
}
