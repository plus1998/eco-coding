/**
 * Offline replay for recorded conversation round fixtures.
 *
 *   bun scripts/conversation-round/replay.mjs
 *   bun scripts/conversation-round/replay.mjs --fixture=<runId>
 *   bun scripts/conversation-round/replay.mjs --core=codex|pi|claude|all
 *   bun scripts/conversation-round/replay.mjs --strict
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateScenarioChecklist } from "../codex-scenario-smoke/assert.mjs";
import { evaluateSdkScenarioChecklist } from "./lib/sdk-checklist.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const fixturesRoot = path.join(__dirname, "fixtures");

const args = process.argv.slice(2);
const fixtureArg = args.find((arg) => arg.startsWith("--fixture="))?.slice("--fixture=".length);
const coreArg = args.find((arg) => arg.startsWith("--core="))?.slice("--core=".length) || "codex";
const strict = args.includes("--strict");

function resolveFixtureDir(arg) {
  if (arg) {
    const candidates = [
      path.isAbsolute(arg) ? arg : "",
      path.join(fixturesRoot, arg),
      path.join(root, "scripts/codex-scenario-smoke/fixtures", arg),
    ].filter(Boolean);
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    throw new Error(`Fixture not found: ${arg}`);
  }
  for (const pointerPath of [
    path.join(fixturesRoot, "latest.json"),
    path.join(root, "scripts/codex-scenario-smoke/fixtures/latest.json"),
  ]) {
    if (!fs.existsSync(pointerPath)) {
      continue;
    }
    const pointer = JSON.parse(fs.readFileSync(pointerPath, "utf8"));
    const dir = pointer.path || path.join(path.dirname(pointerPath), pointer.runId);
    if (fs.existsSync(dir)) {
      return dir;
    }
  }
  throw new Error(
    "No Codex fixture found. Run: LONGCAT_API_KEY=... bun scripts/conversation-round/record.mjs",
  );
}

function resolveSdkFixtureDir(core, arg) {
  if (arg) {
    return resolveFixtureDir(arg);
  }
  const pointerName = core === "pi" ? "latest-pi.json" : "latest-claude.json";
  const pointerPath = path.join(fixturesRoot, pointerName);
  if (!fs.existsSync(pointerPath)) {
    throw new Error(`No ${core} fixture pointer. Run record-${core}.mts first.`);
  }
  const pointer = JSON.parse(fs.readFileSync(pointerPath, "utf8"));
  const dir = pointer.path || path.join(fixturesRoot, pointer.runId);
  if (!fs.existsSync(dir)) {
    throw new Error(`${core} fixture dir missing: ${dir}`);
  }
  return dir;
}

function readJsonl(filePath, field) {
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .map((row) => row[field])
    .filter((value) => value != null);
}

function replayCodex(fixtureArgValue) {
  const fixtureDir = resolveFixtureDir(fixtureArgValue);
  const rpcLog = fs
    .readFileSync(path.join(fixtureDir, "rpc-log.jsonl"), "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const summary = fs.existsSync(path.join(fixtureDir, "summary.json"))
    ? JSON.parse(fs.readFileSync(path.join(fixtureDir, "summary.json"), "utf8"))
    : {};
  const workspaceFiles = fs.existsSync(path.join(fixtureDir, "workspace-files.json"))
    ? JSON.parse(fs.readFileSync(path.join(fixtureDir, "workspace-files.json"), "utf8"))
    : {};
  const skillsListResult = fs.existsSync(path.join(fixtureDir, "skills-list.json"))
    ? JSON.parse(fs.readFileSync(path.join(fixtureDir, "skills-list.json"), "utf8"))
    : undefined;
  const marker = summary.marker;
  if (!marker) {
    console.error("Fixture missing marker");
    process.exit(2);
  }

  const scenario = evaluateScenarioChecklist({
    rpcLog,
    workspaceFiles,
    marker,
    skillsListResult,
  });

  const test = spawnSync("bun", ["test", "apps/desktop/test/conversation-round-replay.test.ts"], {
    cwd: root,
    env: {
      ...process.env,
      ECO_CONVERSATION_ROUND_FIXTURE: fixtureDir,
    },
    stdio: "inherit",
  });

  return {
    core: "codex",
    ok: scenario.ok && test.status === 0,
    fixtureDir,
    marker,
    scenario: {
      ok: scenario.ok,
      failed: scenario.failed,
      checklist: scenario.checklist,
    },
    pipelineTestExitCode: test.status ?? 1,
    summary,
  };
}

function replaySdk(core, fixtureArgValue) {
  const fixtureDir = resolveSdkFixtureDir(core, fixtureArgValue);
  const summary = fs.existsSync(path.join(fixtureDir, "summary.json"))
    ? JSON.parse(fs.readFileSync(path.join(fixtureDir, "summary.json"), "utf8"))
    : {};
  const workspaceFiles = fs.existsSync(path.join(fixtureDir, "workspace-files.json"))
    ? JSON.parse(fs.readFileSync(path.join(fixtureDir, "workspace-files.json"), "utf8"))
    : {};
  const marker = summary.marker;
  if (!marker) {
    console.error("Fixture missing marker");
    process.exit(2);
  }

  const agentEvents = readJsonl(path.join(fixtureDir, "agent-events.jsonl"), "event");
  const scenario = evaluateSdkScenarioChecklist({
    agentEvents,
    workspaceFiles,
    marker,
    skillsListed: true,
  });

  const envKey = core === "pi" ? "ECO_SDK_ROUND_FIXTURE_PI" : "ECO_SDK_ROUND_FIXTURE_CLAUDE";
  const test = spawnSync("bun", ["test", "apps/desktop/test/sdk-round-replay.test.ts"], {
    cwd: root,
    env: {
      ...process.env,
      [envKey]: fixtureDir,
    },
    stdio: "inherit",
  });

  return {
    core,
    ok: scenario.ok && test.status === 0,
    fixtureDir,
    marker,
    scenario: {
      ok: scenario.ok,
      failed: scenario.failed,
      checklist: scenario.checklist,
    },
    pipelineTestExitCode: test.status ?? 0,
    summary,
  };
}

const cores = coreArg === "all" ? ["codex", "pi", "claude"] : [coreArg];

const results = [];
for (const core of cores) {
  try {
    if (core === "codex") {
      results.push(replayCodex(fixtureArg));
    } else if (core === "pi" || core === "claude") {
      results.push(replaySdk(core, fixtureArg));
    } else {
      throw new Error(`Unknown core: ${core}`);
    }
  } catch (error) {
    results.push({ core, ok: false, error: String(error) });
  }
}

const payload =
  results.length === 1
    ? results[0]
    : {
        ok: results.every((result) => result.ok),
        results,
      };

console.log(JSON.stringify(payload, null, 2));

if (!payload.ok) {
  process.exitCode = 1;
} else if (strict) {
  const summaries = results.map((result) => result.summary).filter(Boolean);
  if (summaries.some((summary) => summary.ok !== true)) {
    process.exitCode = 1;
  }
}
