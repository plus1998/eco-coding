/**
 * Replay / validate a recorded Codex scenario smoke fixture (no network).
 *
 *   bun scripts/codex-scenario-smoke/replay.mjs
 *   bun scripts/codex-scenario-smoke/replay.mjs --fixture=<runId>
 *   bun scripts/codex-scenario-smoke/replay.mjs --fixture=path/to/fixture-dir
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHECKLIST_KEYS, diffAgainstBaseline, evaluateScenarioChecklist } from "./assert.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.join(__dirname, "fixtures");

const args = process.argv.slice(2);
const fixtureArg = args.find((a) => a.startsWith("--fixture="))?.slice("--fixture=".length);
const requireAll = args.includes("--strict");

const fixtureDir = resolveFixtureDir(fixtureArg);
const summaryPath = path.join(fixtureDir, "summary.json");
const rpcPath = path.join(fixtureDir, "rpc-log.jsonl");
const skillsPath = path.join(fixtureDir, "skills-list.json");
const workspacePath = path.join(fixtureDir, "workspace-files.json");
const metaPath = path.join(fixtureDir, "meta.json");

if (!fs.existsSync(rpcPath)) {
  console.error(`Missing rpc-log.jsonl in ${fixtureDir}`);
  process.exit(2);
}

const rpcLog = fs
  .readFileSync(rpcPath, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const skillsListResult = fs.existsSync(skillsPath)
  ? JSON.parse(fs.readFileSync(skillsPath, "utf8"))
  : undefined;
const workspaceFiles = fs.existsSync(workspacePath) ? JSON.parse(fs.readFileSync(workspacePath, "utf8")) : {};
const recordedSummary = fs.existsSync(summaryPath)
  ? JSON.parse(fs.readFileSync(summaryPath, "utf8"))
  : undefined;
const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, "utf8")) : {};
const marker = recordedSummary?.marker || meta.marker;
if (!marker) {
  console.error("Fixture missing marker");
  process.exit(2);
}

const evaluation = evaluateScenarioChecklist({
  rpcLog,
  workspaceFiles,
  marker,
  skillsListResult,
});

const recordedOk = recordedSummary?.ok === true;
const drift = recordedSummary
  ? diffAgainstBaseline(recordedSummary, evaluation)
  : { ok: true, regressions: [] };

// Structural integrity of the raw log
const structural = {
  hasInitialize: rpcLog.some((e) => e.method === "initialize"),
  hasTurnStart: rpcLog.some((e) => e.method === "turn/start" || e.method === "turn/started"),
  hasTurnCompleted: rpcLog.some((e) => e.method === "turn/completed"),
  entryCount: rpcLog.length,
};

const structuralOk = structural.hasTurnCompleted && structural.entryCount > 0 && structural.hasTurnStart;

const result = {
  ok: evaluation.ok && structuralOk && (!requireAll || drift.ok),
  fixtureDir,
  marker,
  recordedOk,
  reevaluatedOk: evaluation.ok,
  structural,
  checklist: evaluation.checklist,
  failed: evaluation.failed,
  observed: evaluation.observed,
  drift,
  checklistKeys: CHECKLIST_KEYS,
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}

function resolveFixtureDir(arg) {
  if (arg) {
    if (path.isAbsolute(arg) && fs.existsSync(arg)) return arg;
    const asName = path.join(fixturesRoot, arg);
    if (fs.existsSync(asName)) return asName;
    if (fs.existsSync(arg)) return path.resolve(arg);
    throw new Error(`Fixture not found: ${arg}`);
  }
  const latest = path.join(fixturesRoot, "latest.json");
  if (!fs.existsSync(latest)) {
    throw new Error(
      `No fixtures/latest.json. Run: LONGCAT_API_KEY=... bun scripts/codex-scenario-smoke/run.mjs`,
    );
  }
  const pointer = JSON.parse(fs.readFileSync(latest, "utf8"));
  const dir = pointer.path || path.join(fixturesRoot, pointer.runId);
  if (!fs.existsSync(dir)) {
    throw new Error(`latest.json points to missing dir: ${dir}`);
  }
  return dir;
}
