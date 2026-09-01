/**
 * Record a live LongCat conversation round and build offline replay artifacts.
 *
 *   LONGCAT_API_KEY=... bun scripts/conversation-round/record.mjs
 *
 * Options (env):
 *   LONGCAT_API_KEY / ECO_CODEX_SMOKE_API_KEY
 *   ECO_CODEX_SMOKE_BASE_URL   default https://api.longcat.chat/openai/v1
 *   ECO_CODEX_SMOKE_MODEL      default LongCat-2.0
 *   ECO_CODEX_SMOKE_TIMEOUT_MS default 600000
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const fixturesRoot = path.join(__dirname, "fixtures");

const apiKey =
  process.env.LONGCAT_API_KEY?.trim() ||
  process.env.ECO_CODEX_SMOKE_API_KEY?.trim() ||
  "";
if (!apiKey) {
  console.error("Missing LONGCAT_API_KEY or ECO_CODEX_SMOKE_API_KEY");
  process.exit(2);
}

fs.mkdirSync(fixturesRoot, { recursive: true });

const smoke = spawnSync("bun", ["scripts/codex-scenario-smoke/run.mjs"], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
});

if (smoke.status !== 0) {
  process.exit(smoke.status ?? 1);
}

const latestPointer = path.join(root, "scripts/codex-scenario-smoke/fixtures/latest.json");
if (!fs.existsSync(latestPointer)) {
  console.error("codex-scenario-smoke did not write fixtures/latest.json");
  process.exit(2);
}

const latest = JSON.parse(fs.readFileSync(latestPointer, "utf8"));
const sourceDir =
  latest.path && fs.existsSync(latest.path)
    ? latest.path
    : path.join(root, "scripts/codex-scenario-smoke/fixtures", latest.runId);
const targetDir = path.join(fixturesRoot, latest.runId);

if (sourceDir !== targetDir) {
  fs.cpSync(sourceDir, targetDir, { recursive: true, force: true });
}

const build = spawnSync(
  "bun",
  ["scripts/conversation-round/build-expected.ts", `--fixture=${targetDir}`],
  {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  },
);
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

fs.writeFileSync(
  path.join(fixturesRoot, "latest.json"),
  JSON.stringify(
    {
      runId: latest.runId,
      path: targetDir,
      marker: latest.marker,
      ok: latest.ok,
      recordedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);

console.log(
  JSON.stringify(
    {
      ok: latest.ok === true,
      runId: latest.runId,
      fixtureDir: targetDir,
      replay: "bun scripts/conversation-round/replay.mjs",
      test: "bun test apps/desktop/test/conversation-round-replay.test.ts",
    },
    null,
    2,
  ),
);

if (latest.ok !== true) {
  process.exitCode = 1;
}
