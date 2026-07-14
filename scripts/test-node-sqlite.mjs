import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = await mkdtemp(path.join(os.tmpdir(), "eco-node-sqlite-tests-"));
const outputFile = path.join(outputDir, "conversation-store-sqlite.test.mjs");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with status ${result.status ?? "unknown"}.`);
  }
}

try {
  run("bun", [
    "build",
    "apps/desktop/test-node/conversation-store-sqlite.test.ts",
    "--target=node",
    "--external=electron",
    "--external=@anthropic-ai/claude-agent-sdk",
    `--outfile=${outputFile}`,
  ]);
  run(process.execPath, ["--test", outputFile]);
} finally {
  await rm(outputDir, { recursive: true, force: true });
}
