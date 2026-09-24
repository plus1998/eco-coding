import { afterEach, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OpenAIAccountService } from "../src/main/openai-account-service";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function createService(): Promise<{ root: string; service: OpenAIAccountService }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "eco-openai-accounts-"));
  tempDirs.push(root);
  const service = new OpenAIAccountService(root, "codex-test");
  await service.initialize();
  return { root, service };
}

function jwtWithExpiry(exp: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  return `${header}.${payload}.signature`;
}

test("account operations reject traversal and unregistered ids before filesystem access", async () => {
  const { root, service } = await createService();
  const sentinel = path.join(root, "sentinel.txt");
  await fs.writeFile(sentinel, "keep", "utf8");

  await expect(service.deleteAccount("../sentinel.txt")).rejects.toThrow("Invalid OpenAI account id");
  await expect(service.setAuthJson("oa_not_registered", "{}")).rejects.toThrow(
    "OpenAI account not found",
  );
  await expect(service.getAuthJsonContent("oa_not_registered")).rejects.toThrow(
    "OpenAI account not found",
  );
  expect(await fs.readFile(sentinel, "utf8")).toBe("keep");

  service.dispose();
});

test("expired JWT credentials are not reported as logged in", async () => {
  const { service } = await createService();
  const account = await service.createAccount("Expired");
  const result = await service.setAuthJson(
    account.id,
    JSON.stringify({
      tokens: {
        access_token: jwtWithExpiry(Math.floor(Date.now() / 1000) - 60),
        account_id: "chatgpt-account",
      },
    }),
  );

  expect(result.success).toBe(true);
  expect(await service.isAccountLoggedIn(account.id)).toBe(false);
  expect((await service.listAccounts())[0]).toMatchObject({
    id: account.id,
    isLoggedIn: false,
    authState: "expired",
  });

  service.dispose();
});

test("active account proxy is available without listing accounts first", async () => {
  const { service } = await createService();
  const account = await service.createAccount("Proxy", "http://user:secret@127.0.0.1:7890");
  await service.setAuthJson(
    account.id,
    JSON.stringify({
      tokens: {
        access_token: jwtWithExpiry(Math.floor(Date.now() / 1000) + 3600),
        account_id: "chatgpt-account",
      },
    }),
  );
  await service.setActiveAccount(account.id);

  expect(await service.getActiveProxyUrl()).toBe("http://user:secret@127.0.0.1:7890");

  service.dispose();
});
