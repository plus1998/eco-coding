import { afterEach, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startCodexBrowserLogin } from "../src/main/codex-browser-login";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function start(options: { completed?: boolean; unrelated?: boolean; rpcError?: boolean; exit?: boolean } = {}, onAuthenticated: (signal: AbortSignal) => Promise<void> = async () => {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "eco-browser-login-"));
  cleanup.push(() => fs.rm(root, { recursive: true, force: true }));
  const executable = path.join(root, "codex");
  await fs.writeFile(executable, `#!/usr/bin/env node
const readline = require('node:readline');
const options = ${JSON.stringify(options)};
if (process.argv[2] !== 'app-server' || !process.argv.includes('--stdio')) process.exit(9);
const send = (...messages) => process.stdout.write(messages.map(m => JSON.stringify(m)).join('\\n') + '\\n');
readline.createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') send({ id: request.id, result: {} });
  else if (request.method === 'account/login/start') {
    if (request.params.type !== 'chatgpt') process.exit(10);
    if (options.rpcError) return send({ id: request.id, error: { code: -32000, message: 'Login unavailable' } });
    const response = { id: request.id, result: { type: 'chatgpt', loginId: 'test-login', authUrl: 'https://auth.openai.com/oauth/authorize?client_id=test' } };
    const notification = { method: 'account/login/completed', params: { loginId: 'test-login', success: true } };
    if (options.unrelated) {
      send(response, { ...notification, params: { loginId: 'another-login', success: false, error: 'Wrong account' } });
      setTimeout(() => send(notification), 20);
    } else if (options.completed) send(response, notification);
    else send(response);
    if (options.exit) setTimeout(() => process.exit(0), 20);
  }
});
`, { mode: 0o755 });
  const login = await startCodexBrowserLogin({ executable, codexHomeDir: path.join(root, "home"), onAuthenticated });
  cleanup.push(async () => { login.cancel(); await login.result; });
  return login;
}

test("batched login response and completion persist credentials before reporting success", async () => {
  let saved = false;
  const login = await start({ completed: true }, async () => { saved = true; });
  expect(login.authUrl).toStartWith("https://auth.openai.com/");
  expect(await login.result).toEqual({ success: true, message: "登录成功" });
  expect(saved).toBe(true);
});

test("completion for another login cannot settle this account's login", async () => {
  let calls = 0;
  const login = await start({ unrelated: true }, async () => { calls++; });
  expect((await login.result).success).toBe(true);
  expect(calls).toBe(1);
});

test("credential persistence failure is surfaced as a failed login", async () => {
  const login = await start({ completed: true }, async () => { throw new Error("SQLite write failed"); });
  expect(await login.result).toEqual({ success: false, message: "登录凭据保存失败：SQLite write failed" });
});

test("cancelling during credential persistence aborts its callback", async () => {
  let started!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  let aborted = false;
  const login = await start({ completed: true }, async (signal) => {
    started();
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => { aborted = true; resolve(); }, { once: true }));
    signal.throwIfAborted();
  });
  await entered;
  login.cancel();
  expect(await login.result).toEqual({ success: false, message: "登录已取消" });
  expect(aborted).toBe(true);
});

test("RPC startup failures are explicit and do not start another login mechanism", async () => {
  await expect(start({ rpcError: true })).rejects.toThrow("Login unavailable");
});

test("an exit without a completion notification cannot be reported as success", async () => {
  const login = await start({ exit: true });
  const result = await login.result;
  expect(result.success).toBe(false);
  expect(result.message).toContain("登录进程提前退出");
});
