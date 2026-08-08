import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testNodeDir = path.join(repoRoot, "apps/desktop/test-node");
const outputDir = await mkdtemp(path.join(os.tmpdir(), "eco-node-sqlite-tests-"));

function run(command, args, { throwOnError = true } = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  const status = result.status ?? 1;
  if (throwOnError && status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with status ${status}.`);
  }
  return status;
}

try {
  const entries = await readdir(testNodeDir);
  const sources = entries
    .filter((name) => name.endsWith(".test.ts"))
    .sort()
    .map((name) => path.join(testNodeDir, name));
  if (sources.length === 0) {
    throw new Error(`No *.test.ts files found under ${testNodeDir}`);
  }

  /** @type {{ source: string; outfile: string }[]} */
  const built = [];
  for (const source of sources) {
    const base = path.basename(source, ".ts");
    const outfile = path.join(outputDir, `${base}.mjs`);
    run("bun", [
      "build",
      source,
      "--target=node",
      "--external=electron",
      "--external=@anthropic-ai/claude-agent-sdk",
      `--outfile=${outfile}`,
    ]);
    built.push({ source, outfile });
  }

  // Run every suite so one pre-existing failure does not mask others.
  /** @type {string[]} */
  const failures = [];
  for (const { source, outfile } of built) {
    console.log(`\n→ node --test ${path.relative(repoRoot, source)}`);
    const status = run(process.execPath, ["--test", outfile], { throwOnError: false });
    if (status !== 0) {
      failures.push(path.relative(repoRoot, source));
    }
  }

  if (failures.length > 0) {
    console.error(`\nNode SQLite suites failed (${failures.length}):`);
    for (const file of failures) {
      console.error(`  - ${file}`);
    }
    process.exitCode = 1;
  }
} finally {
  await rm(outputDir, { recursive: true, force: true });
}
