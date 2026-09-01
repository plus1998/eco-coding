/**
 * Launch demo mode with gateway client-round feed replay.
 *
 *   bun run dev:feed-replay-demo
 *   bun run dev:feed-replay-demo -- claude:responses
 *   bun run dev:feed-replay-demo -- claude:responses/messages/chat_completions
 *   bun run dev:feed-replay-demo -- help
 *   ECO_DEMO_FEED_REPLAY=matrix bun run dev:feed-replay-demo
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatFeedReplaySelectorHelp } from "../../apps/desktop/src/feed-replay/gateway-client-round-fixture.ts";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, "../../apps/desktop");
const cellArg = process.argv.slice(2).find((arg) => !arg.startsWith("-"));

if (cellArg?.trim().toLowerCase() === "help" || cellArg?.trim() === "?") {
  console.error(formatFeedReplaySelectorHelp());
  process.exit(0);
}

const env = {
  ...process.env,
  ECO_DEMO: "1",
  ECO_DEMO_FEED_REPLAY: cellArg?.trim() || process.env.ECO_DEMO_FEED_REPLAY?.trim() || "matrix",
  ECO_DIAG_LOG: "0",
};

console.error(
  `[eco-feed-replay-demo] ECO_DEMO_FEED_REPLAY=${env.ECO_DEMO_FEED_REPLAY}\n` +
    formatFeedReplaySelectorHelp() +
    "\n",
);

const child = spawn("bun", ["run", "dev:demo"], {
  cwd: desktopRoot,
  env,
  stdio: "inherit",
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
