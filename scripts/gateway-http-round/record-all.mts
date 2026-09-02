/**
 * Record the full gateway client-round matrix (10 explicit cells in RECORDING_CELL_SPECS).
 *
 *   bun scripts/gateway-http-round/record-all.mts
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

const marker = process.env.ECO_SMOKE_MARKER?.trim() || `LC${Date.now().toString(36).toUpperCase()}`;
const proc = spawnSync(
  "bun",
  ["scripts/gateway-http-round/record-client-round.mts", ...process.argv.slice(2)],
  {
    cwd: root,
    env: { ...process.env, ECO_SMOKE_MARKER: marker },
    stdio: "inherit",
  },
);

const fixturesRoot = path.join(__dirname, "fixtures");
fs.writeFileSync(
  path.join(fixturesRoot, "latest-all.json"),
  JSON.stringify(
    {
      marker,
      ok: proc.status === 0,
      exitCode: proc.status ?? 1,
      recordedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);

process.exit(proc.status ?? 1);
