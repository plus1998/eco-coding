import { describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ChatGptSubscriptionService } from "../src/main/chatgpt-subscription-service";

const codec = {
  isAvailable: () => true,
  encrypt: (value: string) => `test:${Buffer.from(value).toString("base64")}`,
  decrypt: (value: string) => Buffer.from(value.slice("test:".length), "base64").toString("utf8"),
};

describe("ChatGptSubscriptionService", () => {
  test("stores account metadata in an encrypted local record", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-chatgpt-"));
    const service = new ChatGptSubscriptionService(dataDir, codec);
    await service.initialize();
    const created = await service.createAccount("测试账号");
    expect(created.status).toBe("needs_login");
    expect(created.hasCredentials).toBe(false);
    const raw = await fs.readFile(path.join(dataDir, "chatgpt-subscription", "accounts.json"), "utf8");
    expect(raw.startsWith("test:")).toBe(true);
    expect(raw).not.toContain("测试账号");
    await service.deleteAccount(created.accountId);
    expect(service.listAccounts()).toHaveLength(0);
  });

  test("creates a copyable authorization URL without embedding the ID token", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-chatgpt-"));
    const service = new ChatGptSubscriptionService(dataDir, codec);
    await service.initialize();
    const account = await service.createAccount("浏览器授权账号");
    const login = await service.beginLogin(account.accountId, { includeAccountHints: false });
    const params = new URL(login.authorizationUrl).searchParams;
    expect(params.get("client_id")).toBe("dynamic_agent_client");
    expect(params.has("id_token_hint")).toBe(false);
    expect(params.has("login_hint")).toBe(false);
    service.cancelLogin(account.accountId);
    await expect(login.result).rejects.toThrow("已取消");
  });

  test("selects a ready account and refreshes an expired access token", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-chatgpt-"));
    const service = new ChatGptSubscriptionService(dataDir, codec, async () =>
      Response.json({
        access_token: "refreshed-access",
        refresh_token: "rotated-refresh",
        expires_in: 3600,
        scope: "openid offline_access resource.invoke chatgpt.tokens.use.direct",
      }),
    );
    await service.initialize();
    const created = await service.createAccount("刷新账号");
    const state = service as unknown as { state: { accounts: Array<Record<string, unknown>> } };
    Object.assign(state.state.accounts[0], {
      clientId: "oaiapp_test",
      refreshToken: "old-refresh",
      status: "ready",
      accessTokenExpiresAt: Date.now() - 1,
      scopes: ["chatgpt.tokens.use.direct"],
    });
    const resolved = await service.resolveCredential({
      id: "eco-coding-chatgpt",
      name: "ChatGPT",
      upstreamKind: "responses",
      baseUrl: "https://api.openai.com",
      apiKey: "local-unused",
      authMethod: "chatgpt_subscription",
      credentialPoolId: "chatgpt-default",
      upstreamModelId: "gpt-5",
      models: ["gpt-5"],
    });
    expect(resolved.accessToken).toBe("refreshed-access");
    expect(resolved.accountId).toBe(created.accountId);
    expect(service.listAccounts()[0]?.status).toBe("ready");
  });

  test("sends the official OAuth smoke-test message upstream", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-chatgpt-"));
    let requestBody: Record<string, unknown> | undefined;
    const service = new ChatGptSubscriptionService(dataDir, codec, async (input, init) => {
      if (String(input).endsWith("/responses")) {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response("event: response.completed\ndata: {\"type\":\"response.completed\"}\n\n", { status: 200 });
      }
      return Response.json({
        access_token: "test-access",
        refresh_token: "test-refresh",
        expires_in: 3600,
        scope: "openid offline_access resource.invoke chatgpt.tokens.use.direct",
      });
    });
    await service.initialize();
    const created = await service.createAccount("测试账号");
    const state = service as unknown as { state: { accounts: Array<Record<string, unknown>> } };
    Object.assign(state.state.accounts[0], {
      clientId: "oaiapp_test",
      refreshToken: "old-refresh",
      accessToken: "existing-access",
      accessTokenExpiresAt: Date.now() + 3600_000,
      status: "ready",
      scopes: ["chatgpt.tokens.use.direct"],
    });
    const result = await service.testAccount(created.accountId, "gpt-5-mini");
    expect(result.success).toBe(true);
    expect(requestBody?.model).toBe("gpt-5-mini");
    expect(requestBody?.stream).toBe(true);
    expect(requestBody?.store).toBe(false);
    expect(requestBody?.input).toEqual([{ role: "user", content: "hi" }]);
  });

  test("fetches the official model catalog with the selected OAuth account", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-chatgpt-"));
    let authorization: string | null = null;
    const service = new ChatGptSubscriptionService(dataDir, codec, async (input, init) => {
      if (String(input).endsWith("/models")) {
        authorization = new Headers(init?.headers).get("authorization");
        return Response.json({ models: [
          { slug: "gpt-5", display_name: "GPT-5", visibility: "list" },
          { slug: "gpt-5", display_name: "GPT-5", visibility: "list" },
          { slug: "gpt-5-mini", display_name: "GPT-5 mini", visibility: "list" },
          { slug: "internal-preview", display_name: "Internal", visibility: "hidden" },
        ] });
      }
      return Response.json({
        access_token: "test-access",
        refresh_token: "test-refresh",
        expires_in: 3600,
        scope: "openid offline_access resource.invoke chatgpt.tokens.use.direct",
      });
    });
    await service.initialize();
    const created = await service.createAccount("模型账号");
    const state = service as unknown as { state: { accounts: Array<Record<string, unknown>> } };
    Object.assign(state.state.accounts[0], {
      clientId: "oaiapp_test",
      refreshToken: "test-refresh",
      accessToken: "test-access",
      accessTokenExpiresAt: Date.now() + 3600_000,
      status: "ready",
      scopes: ["chatgpt.tokens.use.direct"],
    });
    const models = await service.listModels();
    expect(authorization).toBe("Bearer test-access");
    expect(models).toEqual([
      { id: "gpt-5", displayName: "GPT-5" },
      { id: "gpt-5-mini", displayName: "GPT-5 mini" },
    ]);
    expect(service.listAccounts()[0]?.accountId).toBe(created.accountId);
  });

  test("marks an account unavailable when subscription sharing rejects eligibility", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-chatgpt-"));
    const service = new ChatGptSubscriptionService(dataDir, codec, async () => new Response(JSON.stringify({
      error: { code: "subscription_sharing_user_not_eligible" },
    }), { status: 403, headers: { "content-type": "application/json" } }));
    await service.initialize();
    const created = await service.createAccount("无资格账号");
    const state = service as unknown as { state: { accounts: Array<Record<string, unknown>> } };
    Object.assign(state.state.accounts[0], {
      clientId: "oaiapp_test",
      refreshToken: "test-refresh",
      accessToken: "test-access",
      accessTokenExpiresAt: Date.now() + 3600_000,
      status: "ready",
      scopes: ["chatgpt.tokens.use.direct"],
    });
    await expect(service.testAccount(created.accountId, "gpt-5")).rejects.toThrow("不具备订阅共享资格");
    expect(service.listAccounts()[0]?.status).toBe("not_eligible");
  });

  test("resets a persisted availability state without changing credentials", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-chatgpt-"));
    const service = new ChatGptSubscriptionService(dataDir, codec);
    await service.initialize();
    const created = await service.createAccount("重新检测账号");
    const state = service as unknown as { state: { accounts: Array<Record<string, unknown>> } };
    Object.assign(state.state.accounts[0], {
      refreshToken: "test-refresh",
      accessToken: "test-access",
      status: "not_eligible",
      lastErrorCode: "subscription_sharing_user_not_eligible",
      lastErrorAt: Date.now(),
      cooldownUntil: Date.now() + 30_000,
    });
    const reset = await service.resetAvailability(created.accountId);
    expect(reset.status).toBe("ready");
    expect(reset.hasCredentials).toBe(true);
    expect(reset.lastErrorCode).toBeUndefined();
    expect(reset.cooldownUntil).toBeUndefined();
  });
});
