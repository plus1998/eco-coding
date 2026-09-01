/**
 * @deprecated Use record-client-round.mts --client=codex --profile=packy_responses
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const proc = spawnSync(
  "bun",
  [
    "scripts/gateway-http-round/record-client-round.mts",
    "--client=codex",
    "--profile=packy_responses",
    ...process.argv.slice(2),
  ],
  { cwd: root, env: process.env, stdio: "inherit" },
);
process.exit(proc.status ?? 1);
