import { spawn } from "node:child_process";

const rendererPort = readPort(process.env.ECO_RENDERER_PORT ?? "5173", "renderer");
const rendererUrl = `http://127.0.0.1:${rendererPort}/`;
const children = new Set();
const remoteDebuggingPort = readRemoteDebuggingPort();

await run("bun", ["run", "build:main"]);
await run("bun", ["run", "build:preload"]);

console.error("[eco] 主进程仅在 dev 启动时编译一次；修改 apps/desktop/src/main 后请重启 bun run dev。");

const rendererAlreadyRunning = await isRendererReady();
if (!rendererAlreadyRunning) {
  start("./node_modules/.bin/vite", ["--host", "127.0.0.1", "--strictPort", "--port", String(rendererPort)], {
    name: "renderer",
  });
  await waitForRenderer();
}

const electronArgs = [".", "--enable-logging"];
if (remoteDebuggingPort) {
  electronArgs.push(`--remote-debugging-port=${remoteDebuggingPort}`);
  console.error(`[eco] Electron CDP listening on http://127.0.0.1:${remoteDebuggingPort}/`);
}

start("./node_modules/.bin/electron", electronArgs, {
  name: "electron",
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: rendererUrl,
    ELECTRON_ENABLE_LOGGING: "1",
  },
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function start(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: options.env ?? process.env,
    stdio: "inherit",
  });
  children.add(child);
  child.on("exit", () => children.delete(child));
  return child;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = start(command, args);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

async function waitForRenderer() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    if (await isRendererReady()) return;
    await delay(250);
  }
  throw new Error(`Renderer did not start at ${rendererUrl}`);
}

async function isRendererReady() {
  try {
    const response = await fetch(rendererUrl);
    return response.ok;
  } catch {
    return false;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readRemoteDebuggingPort() {
  const cliValue = process.argv.find((arg) => arg.startsWith("--remote-debugging-port="))?.split("=")[1];
  const raw = cliValue ?? process.env.ECO_REMOTE_DEBUGGING_PORT;
  if (!raw) {
    return undefined;
  }
  return readPort(raw, "remote debugging");
}

function readPort(raw, label) {
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`Invalid ${label} port: ${raw}`);
  }
  return port;
}

function shutdown() {
  for (const child of children) {
    child.kill("SIGTERM");
  }
  process.exit(0);
}
