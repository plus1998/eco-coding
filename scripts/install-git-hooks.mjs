import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(import.meta.dirname, "..");
const hooksPath = ".githooks";

if (!existsSync(resolve(repoRoot, ".git"))) {
  process.exit(0);
}

const result = spawnSync("git", ["config", "--local", "core.hooksPath", hooksPath], {
  cwd: repoRoot,
  stdio: "inherit",
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`[git-hooks] enabled ${hooksPath}/pre-commit`);
