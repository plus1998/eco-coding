import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);

const smokeScripts = {
  "agent-ui": ["apps/desktop/scripts/agent-ui-smoke.mjs", { build: true }],
  "feed-loading": ["apps/desktop/e2e/feed-loading.spec.ts"],
  "subagent-drawer": ["apps/desktop/e2e/subagent-drawer.spec.ts"],
  "codex-approval": ["apps/desktop/e2e/codex-approval.spec.ts"],
  "codex-capabilities": ["apps/desktop/e2e/codex-capabilities.spec.ts"],
  "codex-multi-agent": ["apps/desktop/e2e/codex-multi-agent.spec.ts"],
  "codex-session-modes": ["apps/desktop/e2e/codex-session-modes.spec.ts"],
  "browser-webview": ["apps/desktop/e2e/browser-webview.spec.ts"],
};

const testSuites = {
  "agent-presets": [
    "apps/desktop/test/agent-orchestration.test.ts",
    "packages/runtime/test/agent-orchestration.test.ts",
    "packages/runtime/test/eco-sdk-hooks.test.ts",
  ],
  "agent-security": [
    "packages/runtime/test/agent-permission-redteam.test.ts",
    "packages/runtime/test/eco-sdk-hooks.test.ts",
  ],
  "agent-commercial": [
    "apps/desktop/test/orchestration-readiness.test.ts",
    "apps/desktop/test/agent-template-archive.test.ts",
    "apps/desktop/test/billing-diagnostics.test.ts",
    "apps/desktop/test/billing-projector.test.ts",
    "apps/desktop/test/usage-ledger-coordinator.test.ts",
    "apps/desktop/test/thread-run-projection-view.test.ts",
    "apps/desktop/test/usage-breakdown-panel.test.ts",
    "packages/runtime/test/agent-orchestration.test.ts",
    "packages/runtime/test/agent-permission-redteam.test.ts",
    "packages/runtime/test/eco-sdk-hooks.test.ts",
  ],
  "claude-regression": [
    "packages/runtime/test/core-runtime.test.ts",
    "packages/runtime/test/claude-agent-sdk.test.ts",
    "packages/runtime/test/eco-sdk-hooks.test.ts",
    "packages/runtime/test/sdk-stream-events.test.ts",
    "packages/runtime/test/agent-orchestration.test.ts",
    "packages/runtime/test/agent-permission-redteam.test.ts",
    "packages/runtime/test/tool-confirmation.test.ts",
    "packages/runtime/test/tool-permission-policy.test.ts",
    "packages/runtime/test/filesystem-scope-policy.test.ts",
    "apps/desktop/test/thread-core-routing.test.ts",
    "apps/desktop/test/thread-live-follow-up-v2-sdk-surface.test.ts",
    "apps/desktop/test/claude-mid-turn-port.test.ts",
    "apps/desktop/test/codex-mid-turn-port.test.ts",
    "packages/runtime/test/codex-turn-steer.test.ts",
    "packages/runtime/test/codex-turn-interrupt.test.ts",
    "apps/desktop/test/anthropic-proxy.test.ts",
    "apps/desktop/test/plan-approval-bridge.test.ts",
    "apps/desktop/test/thread-plan-approval-runtime.test.ts",
    "apps/desktop/test/thread-continue-routing.test.ts",
    "apps/desktop/test/sdk-run-input.test.ts",
    "apps/desktop/test/conversation-store-runtime.test.ts",
    "apps/desktop/test/thread-run-projection.test.ts",
    "apps/desktop/test/thread-run-projection-feed.test.ts",
    "apps/desktop/test/proxy-usage-billing.test.ts",
    "apps/desktop/test/usage-ledger-coordinator.test.ts",
    "apps/desktop/test/context-snapshot-scheduler.test.ts",
  ],
};

const parsed = parseArgs(args);
const command = resolveCommand(parsed);
if (!command) {
  printUsage();
  process.exitCode = 1;
} else {
  process.exitCode = await run(command);
}

function parseArgs(argv) {
  const options = new Set();
  const passthrough = [];
  const controlOptions = new Set([
    "help",
    "h",
    "smoke",
    "sqlite",
    ...Object.keys(smokeScripts),
    ...Object.keys(testSuites),
  ]);
  for (const arg of argv) {
    const option = arg.startsWith("--") ? arg.slice(2) : "";
    if (controlOptions.has(option)) {
      options.add(option);
    } else {
      passthrough.push(arg);
    }
  }
  for (const option of controlOptions) {
    const envName = `npm_config_${option.replaceAll("-", "_")}`;
    if (process.env[envName] === "true") {
      options.add(option);
    }
  }
  return { options, passthrough };
}

function resolveCommand({ options, passthrough }) {
  if (options.has("help") || options.has("h")) return { kind: "help" };

  const smoke = [...options].find((option) => Object.hasOwn(smokeScripts, option));
  if (options.has("smoke") || smoke) {
    if (!smoke) {
      throwUsageError("缺少 smoke 类型，例如 --smoke --feed-loading。");
    }
    const [script, config] = smokeScripts[smoke];
    const commands = [];
    if (config?.build) {
      commands.push(["bun", "run", "--cwd", "apps/desktop", "build"]);
    }
    if (script.endsWith(".spec.ts")) {
      commands.push([
        "bun",
        "run",
        "--cwd",
        "apps/desktop",
        "test:e2e",
        "--",
        script.replace(/^apps\/desktop\//, ""),
        ...passthrough,
      ]);
    } else {
      commands.push(["node", script, ...passthrough]);
    }
    return { kind: "commands", commands };
  }

  const suite = [...options].find((option) => Object.hasOwn(testSuites, option));
  if (suite) {
    const commands = [["bun", "test", ...testSuites[suite], ...passthrough]];
    if (suite === "claude-regression") {
      commands.push([process.execPath, "scripts/test-node-sqlite.mjs", ...passthrough]);
    }
    return { kind: "commands", commands };
  }

  if (options.has("sqlite")) {
    return { kind: "commands", commands: [["node", "scripts/test-node-sqlite.mjs", ...passthrough]] };
  }

  if (options.size > 0) {
    throwUsageError(`未知参数：${[...options].map((option) => `--${option}`).join(" ")}`);
  }
  return { kind: "commands", commands: [["bun", "test", ...passthrough]] };
}

async function run(command) {
  if (command.kind === "help") {
    printUsage();
    return 0;
  }

  for (const argv of command.commands) {
    const exitCode = await spawnCommand(argv);
    if (exitCode !== 0) return exitCode;
  }
  return 0;
}

function spawnCommand(argv) {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        resolve(1);
      } else {
        resolve(code ?? 1);
      }
    });
  }).catch((error) => {
    console.error(`无法执行 ${argv.join(" ")}：${error.message}`);
    return 1;
  });
}

function throwUsageError(message) {
  console.error(message);
  printUsage();
  process.exit(1);
}

function printUsage() {
  console.log(`用法：
  npm run test
  npm run test -- --smoke --feed-loading
  npm run test -- --smoke --codex-session-modes
  npm run test -- --agent-presets
  npm run test -- --sqlite

  --sqlite  用系统 Node（node:sqlite）跑 apps/desktop/test-node/*.test.ts

smoke 类型：
  ${Object.keys(smokeScripts)
    .map((name) => `--${name}`)
    .join(", ")}

测试套件：
  ${Object.keys(testSuites)
    .map((name) => `--${name}`)
    .join(", ")}`);
}
