/**
 * Offline replay for gateway client-round fixtures.
 *
 *   bun scripts/gateway-http-round/replay.mjs
 *   bun scripts/gateway-http-round/replay.mjs --cell=pi:longcat_chat
 *   bun scripts/gateway-http-round/replay.mjs --feed-only
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

const args = process.argv.slice(2);
const cellArg = args.find((arg) => arg.startsWith("--cell="))?.slice("--cell=".length);
const feedOnly = args.includes("--feed-only");
const fixtureArg = args.find((arg) => arg.startsWith("--fixture="))?.slice("--fixture=".length);

const env = {
  ...process.env,
  ...(fixtureArg ? { ECO_GATEWAY_CLIENT_ROUND_FIXTURE: fixtureArg } : {}),
  ...(cellArg ? { ECO_DEMO_FEED_REPLAY: cellArg.replace(":", "/").replace("/", ":") } : {}),
};

const tests = ["apps/desktop/test/gateway-client-round-feed-replay.test.ts"];
if (!feedOnly) {
  tests.push("apps/gateway/test/gateway-client-round-replay.test.ts");
}

let ok = true;
for (const testPath of tests) {
  const proc = spawnSync("bun", ["test", testPath], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  if (proc.status !== 0) {
    ok = false;
  }
}

if (!ok) {
  process.exitCode = 1;
}
