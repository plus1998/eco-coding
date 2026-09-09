#!/usr/bin/env bun
/**
 * Unified entry for conversation-round + gateway-http-round harnesses.
 *
 *   bun run round -- conversation record [--core=codex|pi|claude|all]
 *   bun run round -- conversation replay [--core=... --fixture=... --strict]
 *   bun run round -- gateway record [--layer=upstream|gateway|client] [--client=...] [--profile=...]
 *   bun run round -- gateway replay [--cell=... --feed-only --fixture=...]
 *   bun run round -- gateway demo [selector|help]
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const USAGE = `Usage:
  bun run round -- <suite> <action> [options]

Suites / actions:
  conversation record [--core=codex|pi|claude|all]
  conversation replay [--core=codex|pi|claude|all] [--fixture=...] [--strict]
  gateway      record [--layer=upstream|gateway|client] [--client=...] [--profile=...]
  gateway      replay [--cell=...] [--feed-only] [--fixture=...]
  gateway      demo   [selector|help]

Examples:
  LONGCAT_API_KEY=... bun run round -- conversation record --core=pi
  LONGCAT_API_KEY=... bun run round -- conversation record --core=all
  bun run round -- conversation replay --core=all
  bun run round -- gateway record --layer=client --client=codex --profile=packy_responses
  bun run round -- gateway record --layer=upstream --profile=packy_anthropic
  bun run round -- gateway replay
  bun run round -- gateway demo claude:responses
`;

function fail(message) {
  console.error(message);
  console.error(`\n${USAGE}`);
  process.exit(2);
}

function takeFlag(args, name) {
  const exact = `--${name}`;
  const prefix = `--${name}=`;
  const idx = args.findIndex((arg) => arg === exact || arg.startsWith(prefix));
  if (idx < 0) {
    return { value: undefined, rest: args };
  }
  const arg = args[idx];
  let value;
  let consumed = 1;
  if (arg.startsWith(prefix)) {
    value = arg.slice(prefix.length);
  } else {
    value = args[idx + 1];
    if (value == null || value.startsWith("-")) {
      fail(`Missing value for ${exact}`);
    }
    consumed = 2;
  }
  return {
    value,
    rest: [...args.slice(0, idx), ...args.slice(idx + consumed)],
  };
}

function runBun(scriptRelPath, forwardedArgs = []) {
  const proc = spawnSync("bun", [scriptRelPath, ...forwardedArgs], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  process.exit(proc.status ?? 1);
}

const argv = process.argv.slice(2);
if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
  console.log(USAGE);
  process.exit(argv.length === 0 ? 2 : 0);
}

const [suite, action, ...rawArgs] = argv;
if (!suite || !action) {
  fail("Expected: bun run round -- <suite> <action> [options]");
}

if (suite === "conversation") {
  if (action === "record") {
    const { value: core = "codex", rest } = takeFlag(rawArgs, "core");
    if (rest.length > 0) {
      fail(`Unknown conversation record args: ${rest.join(" ")}`);
    }
    const scriptByCore = {
      codex: "scripts/conversation-round/record.mjs",
      pi: "scripts/conversation-round/record-pi.mts",
      claude: "scripts/conversation-round/record-claude.mts",
      all: "scripts/conversation-round/record-all.mjs",
    };
    const script = scriptByCore[core];
    if (!script) {
      fail(`Invalid --core=${core} (expected codex|pi|claude|all)`);
    }
    runBun(script);
  }

  if (action === "replay") {
    runBun("scripts/conversation-round/replay.mjs", rawArgs);
  }

  fail(`Unknown conversation action: ${action} (expected record|replay)`);
}

if (suite === "gateway") {
  if (action === "record") {
    const layerTaken = takeFlag(rawArgs, "layer");
    const layer = layerTaken.value ?? "client";
    const rest = layerTaken.rest;
    const scriptByLayer = {
      upstream: "scripts/gateway-http-round/record-upstream.mts",
      gateway: "scripts/gateway-http-round/record-gateway.mts",
      client: "scripts/gateway-http-round/record-client-round.mts",
      all: "scripts/gateway-http-round/record-client-round.mts",
    };
    const script = scriptByLayer[layer];
    if (!script) {
      fail(`Invalid --layer=${layer} (expected upstream|gateway|client|all)`);
    }
    runBun(script, rest);
  }

  if (action === "replay") {
    runBun("scripts/gateway-http-round/replay.mjs", rawArgs);
  }

  if (action === "demo") {
    runBun("scripts/gateway-http-round/feed-replay-demo.mjs", rawArgs);
  }

  fail(`Unknown gateway action: ${action} (expected record|replay|demo)`);
}

fail(`Unknown suite: ${suite} (expected conversation|gateway)`);
