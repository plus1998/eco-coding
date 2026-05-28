import { spawn } from "node:child_process";

const rendererUrl = "http://127.0.0.1:5173/";
const children = new Set();

await run("bun", ["run", "build:main"]);
await run("bun", ["run", "build:preload"]);

const rendererAlreadyRunning = await isRendererReady();
if (!rendererAlreadyRunning) {
  start("bun", ["run", "dev:renderer"], { name: "renderer" });
  await waitForRenderer();
}

start("./node_modules/.bin/electron", [".", "--enable-logging"], {
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

function shutdown() {
  for (const child of children) {
    child.kill("SIGTERM");
  }
  process.exit(0);
}
