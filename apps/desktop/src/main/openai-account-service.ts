import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import { createUpstreamFetchController } from "@eco/gateway";
import { SocksProxyAgent } from "socks-proxy-agent";
import { SocksClient } from "socks";

/**
 * OpenAI Account Management Service
 *
 * Manages multiple OpenAI subscription accounts. Each account has its own
 * CODEX_HOME directory so auth.json files are isolated.
 *
 * Directory structure:
 *   <userData>/codex-accounts/<account-id>/auth.json
 *   <userData>/codex/auth.json  (active account - copied from selected account)
 */

export interface OpenAIAccount {
  id: string;
  name: string;
  /** HTTP proxy URL used for OAuth login only. */
  proxyUrl?: string;
  /** Whether this account has a valid auth.json. */
  isLoggedIn: boolean;
  /** Last login time (ISO string) or undefined. */
  lastLogin?: string;
  createdAt: string;
}

export interface OpenAIAccountStatus {
  isLoggedIn: boolean;
  message: string;
}

export interface OpenAIAccountLoginResult {
  success: boolean;
  message: string;
}

export interface OpenAIAccountQuota {
  planType: string;
  email: string;
  rateLimit: {
    allowed: boolean;
    limitReached: boolean;
    primaryWindow: {
      usedPercent: number;
      limitWindowSeconds: number;
      resetAfterSeconds: number;
      resetAt: number;
    } | null;
    secondaryWindow: {
      usedPercent: number;
      limitWindowSeconds: number;
      resetAfterSeconds: number;
      resetAt: number;
    } | null;
  };
  resetCreditsAvailable: number;
  fetchedAt: number;
}

interface StoredAccount {
  id: string;
  name: string;
  proxyUrl?: string;
  createdAt: string;
}

const ACCOUNTS_FILE = "accounts.json";

function buildLoginEnv(codexHomeDir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CODEX_HOME: codexHomeDir,
    // Prevent codex from launching the system browser; we handle the URL
    // ourselves via BrowserWindow.
    BROWSER: "echo",
  };
}

function generateId(): string {
  return `oa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Start a local HTTP CONNECT proxy that tunnels through SOCKS5 (with auth).
 * Returns { port, close } for the local server.
 */
export function startSocksToHttpBridge(proxyUrl: string): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(proxyUrl);
    const socksHost = parsed.hostname;
    const socksPort = Number(parsed.port) || 1080;
    const username = parsed.username ? decodeURIComponent(parsed.username) : undefined;
    const password = parsed.password ? decodeURIComponent(parsed.password) : undefined;

    const server = http.createServer();

    server.on("connect", (req, clientSocket, head) => {
      console.log(`[socks-bridge] CONNECT request: ${req.url}`);
      const [targetHost, targetPort] = req.url.split(":");
      const port = targetPort ? parseInt(targetPort, 10) : 443;

      SocksClient.createConnection({
        proxy: {
          ipaddress: socksHost,
          port: socksPort,
          type: 5,
          ...(username ? { userId: username } : {}),
          ...(password ? { password } : {}),
        },
        destination: {
          host: targetHost,
          port,
        },
        command: "connect",
      })
        .then(({ socket }) => {
          console.log(`[socks-bridge] Tunnel established to ${targetHost}:${port}`);
          clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (head.length > 0) socket.write(head);
          socket.pipe(clientSocket);
          clientSocket.pipe(socket);
          socket.on("error", (e) => console.error(`[socks-bridge] socket error:`, e.message));
          clientSocket.on("error", (e) => console.error(`[socks-bridge] client error:`, e.message));
        })
        .catch((err) => {
          console.error(`[socks-bridge] SOCKS connect failed:`, err.message);
          clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
          clientSocket.destroy();
        });
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        port,
        close: () => {
          server.close();
        },
      });
    });

    server.on("error", reject);
  });
}

async function waitForLoginResult(
  child: ReturnType<typeof spawn>,
  codexHomeDir: string,
): Promise<OpenAIAccountLoginResult> {
  return new Promise((resolve) => {
    let resolved = false;

    const resolveOnce = (result: OpenAIAccountLoginResult) => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    const authPath = path.join(codexHomeDir, "auth.json");

    const checkAuthJson = async (): Promise<boolean> => {
      try {
        await fs.access(authPath);
        return true;
      } catch {
        return false;
      }
    };

    // Poll for auth.json every 2 seconds
    const pollInterval = setInterval(async () => {
      if (await checkAuthJson()) {
        clearInterval(pollInterval);
        resolveOnce({ success: true, message: "登录成功" });
      }
    }, 2000);

    child.on("exit", (code) => {
      clearInterval(pollInterval);
      checkAuthJson().then((exists) => {
        if (exists) {
          resolveOnce({ success: true, message: "登录成功" });
        } else {
          resolveOnce({
            success: code === 0,
            message: code === 0 ? "登录成功" : `登录失败 (exit code ${code})`,
          });
        }
      });
    });

    child.on("error", (error) => {
      clearInterval(pollInterval);
      resolveOnce({
        success: false,
        message: `登录失败: ${error instanceof Error ? error.message : String(error)}`,
      });
    });

    // 5 minute timeout
    setTimeout(() => {
      clearInterval(pollInterval);
      child.kill("SIGTERM");
      resolveOnce({ success: false, message: "登录超时 (5分钟)" });
    }, 5 * 60 * 1000);
  });
}

export class OpenAIAccountService {
  private readonly accountsDir: string;
  private readonly mainCodexDir: string;
  private readonly accountsPath: string;
  private authWatcher: fsSync.FSWatcher | null = null;

  constructor(userDataDir: string, private readonly codexExecutable: string) {
    this.accountsDir = path.join(userDataDir, "codex-accounts");
    this.mainCodexDir = path.join(userDataDir, "codex");
    this.accountsPath = path.join(this.accountsDir, ACCOUNTS_FILE);
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.accountsDir, { recursive: true });
    await fs.mkdir(this.mainCodexDir, { recursive: true });
    try {
      await fs.access(this.accountsPath);
    } catch {
      await fs.writeFile(this.accountsPath, "[]", "utf-8");
    }
    this.startAuthWatcher();
  }

  /**
   * Watch the main codex auth.json for changes (token refreshes).
   * When it changes, sync the content back to the active account's directory.
   */
  private startAuthWatcher(): void {
    const mainAuthPath = path.join(this.mainCodexDir, "auth.json");
    try {
      // Ensure the directory exists before watching
      fsSync.mkdirSync(this.mainCodexDir, { recursive: true });
      this.authWatcher = fsSync.watch(this.mainCodexDir, (eventType, filename) => {
        if (filename === "auth.json") {
          void this.syncAuthToActiveAccount();
        }
      });
    } catch {
      // Directory might not exist yet; will be created on first login
    }
  }

  private async syncAuthToActiveAccount(): Promise<void> {
    const mainAuthPath = path.join(this.mainCodexDir, "auth.json");
    const activeId = await this.getActiveAccountId();
    if (!activeId) return;

    try {
      const content = await fs.readFile(mainAuthPath, "utf-8");
      const destPath = this.authJsonPath(activeId);
      await fs.mkdir(this.accountDir(activeId), { recursive: true });
      await fs.writeFile(destPath, content, "utf-8");
    } catch {
      // File might be mid-write; ignore transient errors
    }
  }

  /** Stop the watcher (call on app quit). */
  dispose(): void {
    this.authWatcher?.close();
    this.authWatcher = null;
  }

  private async loadAccounts(): Promise<StoredAccount[]> {
    try {
      const content = await fs.readFile(this.accountsPath, "utf-8");
      return JSON.parse(content) as StoredAccount[];
    } catch {
      return [];
    }
  }

  private async saveAccounts(accounts: StoredAccount[]): Promise<void> {
    await fs.writeFile(this.accountsPath, JSON.stringify(accounts, null, 2), "utf-8");
  }

  private accountDir(accountId: string): string {
    return path.join(this.accountsDir, accountId);
  }

  private authJsonPath(accountId: string): string {
    return path.join(this.accountDir(accountId), "auth.json");
  }

  /** List all accounts with their login status. */
  async listAccounts(): Promise<OpenAIAccount[]> {
    const accounts = await this.loadAccounts();
    const result: OpenAIAccount[] = [];

    for (const account of accounts) {
      const isLoggedIn = await this.isAccountLoggedIn(account.id);
      let lastLogin: string | undefined;
      if (isLoggedIn) {
        try {
          const content = await fs.readFile(this.authJsonPath(account.id), "utf-8");
          const auth = JSON.parse(content);
          lastLogin = auth.last_refresh;
        } catch {
          // ignore
        }
      }
      result.push({
        id: account.id,
        name: account.name,
        proxyUrl: account.proxyUrl,
        isLoggedIn,
        lastLogin,
        createdAt: account.createdAt,
      });
    }

    return result;
  }

  /** Create a new account (just registers it, doesn't log in yet). */
  async createAccount(name: string, proxyUrl?: string): Promise<OpenAIAccount> {
    const id = generateId();
    const dir = this.accountDir(id);
    await fs.mkdir(dir, { recursive: true });

    const accounts = await this.loadAccounts();
    accounts.push({
      id,
      name: name.trim(),
      proxyUrl: proxyUrl?.trim() || undefined,
      createdAt: new Date().toISOString(),
    });
    await this.saveAccounts(accounts);

    return { id, name: name.trim(), proxyUrl: proxyUrl?.trim() || undefined, isLoggedIn: false, createdAt: new Date().toISOString() };
  }

  /** Delete an account and its auth data. */
  async deleteAccount(accountId: string): Promise<void> {
    const accounts = await this.loadAccounts();
    const filtered = accounts.filter((a) => a.id !== accountId);
    await this.saveAccounts(filtered);

    // Remove the account directory
    const dir = this.accountDir(accountId);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});

    // If this was the active account, clear the main auth.json
    const activeId = await this.getActiveAccountId();
    if (activeId === accountId) {
      await this.clearActiveAuth();
    }
  }

  /** Check if an account has a valid auth.json. */
  async isAccountLoggedIn(accountId: string): Promise<boolean> {
    const authPath = this.authJsonPath(accountId);
    try {
      await fs.access(authPath);
      const content = await fs.readFile(authPath, "utf-8");
      const auth = JSON.parse(content);
      const accessToken = auth.tokens?.access_token ?? auth.access_token;
      return Boolean(accessToken);
    } catch {
      return false;
    }
  }

  /** Start login for a specific account. */
  async startLogin(
    accountId: string,
  ): Promise<{ authUrl: string; result: Promise<OpenAIAccountLoginResult> } | null> {
    const codexHomeDir = this.accountDir(accountId);
    await fs.mkdir(codexHomeDir, { recursive: true });

    return new Promise((resolve) => {
      let authUrl = "";
      let urlFound = false;

      const child = spawn(this.codexExecutable, ["login"], {
        env: buildLoginEnv(codexHomeDir),
        stdio: ["ignore", "pipe", "pipe"],
      });

      child.stdout.setEncoding("utf-8");
      child.stderr.setEncoding("utf-8");

      const handleOutput = (data: string) => {
        process.stderr.write(`[codex-login] ${data.trim()}\n`);

        const urlMatch = data.match(/https:\/\/auth\.openai\.com\/oauth\/authorize\?[^\s]+/);
        if (urlMatch && !urlFound) {
          authUrl = urlMatch[0];
          urlFound = true;
          resolve({
            authUrl,
            result: waitForLoginResult(child, codexHomeDir),
          });
        }
      };

      child.stdout.on("data", handleOutput);
      child.stderr.on("data", handleOutput);

      setTimeout(() => {
        if (!urlFound) {
          child.kill("SIGTERM");
          resolve(null);
        }
      }, 30000);
    });
  }

  /** Get the currently active account ID. */
  async getActiveAccountId(): Promise<string | null> {
    try {
      const content = await fs.readFile(
        path.join(this.accountsDir, "active_account.txt"),
        "utf-8",
      );
      const id = content.trim();
      return id || null;
    } catch {
      return null;
    }
  }

  /** Set the active account - copies its auth.json to the main codex dir. */
  async setActiveAccount(accountId: string | null): Promise<void> {
    const activePath = path.join(this.accountsDir, "active_account.txt");

    if (!accountId) {
      await fs.writeFile(activePath, "", "utf-8");
      await this.clearActiveAuth();
      return;
    }

    // Copy auth.json from the account dir to the main codex dir
    const src = this.authJsonPath(accountId);
    const dest = path.join(this.mainCodexDir, "auth.json");
    await fs.mkdir(this.mainCodexDir, { recursive: true });
    const content = await fs.readFile(src, "utf-8");
    await fs.writeFile(dest, content, "utf-8");

    await fs.writeFile(activePath, accountId, "utf-8");
  }

  private async clearActiveAuth(): Promise<void> {
    const dest = path.join(this.mainCodexDir, "auth.json");
    await fs.rm(dest, { force: true }).catch(() => {});
  }

  /** Get login status for the active account. */
  async getActiveStatus(): Promise<OpenAIAccountStatus> {
    const activeId = await this.getActiveAccountId();
    if (!activeId) {
      return { isLoggedIn: false, message: "未选择账号" };
    }
    const isLoggedIn = await this.isAccountLoggedIn(activeId);
    if (!isLoggedIn) {
      return { isLoggedIn: false, message: "账号未登录" };
    }
    // Also check main auth.json exists
    const mainAuth = path.join(this.mainCodexDir, "auth.json");
    try {
      await fs.access(mainAuth);
      return { isLoggedIn: true, message: "已登录" };
    } catch {
      // auth.json not synced yet
      return { isLoggedIn: false, message: "auth.json 未同步" };
    }
  }

  /** Manually set auth.json content for an account. */
  async setAuthJson(accountId: string, content: string): Promise<OpenAIAccountLoginResult> {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { success: false, message: "JSON 格式无效" };
    }

    // Validate: must have tokens.access_token or top-level access_token
    const tokens = parsed.tokens as Record<string, string> | undefined;
    const accessToken = tokens?.access_token ?? (parsed.access_token as string | undefined);
    const accountId_ = tokens?.account_id ?? (parsed.account_id as string | undefined);
    if (!accessToken || !accountId_) {
      return {
        success: false,
        message: '格式无效：缺少 tokens.access_token 或 tokens.account_id',
      };
    }

    const dir = this.accountDir(accountId);
    await fs.mkdir(dir, { recursive: true });
    const authPath = path.join(dir, "auth.json");
    await fs.writeFile(authPath, content, "utf-8");

    // If this is the active account, sync to main codex dir
    const activeId = await this.getActiveAccountId();
    if (activeId === accountId) {
      const dest = path.join(this.mainCodexDir, "auth.json");
      await fs.mkdir(this.mainCodexDir, { recursive: true });
      await fs.writeFile(dest, content, "utf-8");
    }

    return { success: true, message: "auth.json 已保存" };
  }

  /** Get the raw auth.json content for an account. */
  async getAuthJsonContent(accountId: string): Promise<string | null> {
    try {
      const content = await fs.readFile(this.authJsonPath(accountId), "utf-8");
      return content;
    } catch {
      return null;
    }
  }

  /** Update an account's name and/or proxy URL. */
  async updateAccount(accountId: string, name: string, proxyUrl?: string): Promise<{ success: boolean }> {
    const accounts = await this.loadAccounts();
    const idx = accounts.findIndex((a) => a.id === accountId);
    if (idx === -1) return { success: false };

    accounts[idx].name = name.trim();
    accounts[idx].proxyUrl = proxyUrl?.trim() || undefined;
    await this.saveAccounts(accounts);

    return { success: true };
  }

  /** Quota/usage data for an OpenAI account. */
  async queryQuota(accountId: string): Promise<OpenAIAccountQuota | null> {
    const authPath = this.authJsonPath(accountId);
    let auth: {
      access_token?: string;
      account_id?: string;
      tokens?: { access_token?: string; account_id?: string };
    };
    try {
      const content = await fs.readFile(authPath, "utf-8");
      auth = JSON.parse(content);
    } catch (e) {
      console.error(`[openai-quota] Failed to read auth.json for ${accountId}:`, e);
      return null;
    }

    // Token can be at top level or nested under "tokens"
    const accessToken = auth.access_token ?? auth.tokens?.access_token;
    const chatgptAccountId = auth.account_id ?? auth.tokens?.account_id;
    if (!accessToken || !chatgptAccountId) {
      console.error(`[openai-quota] Missing access_token or account_id for ${accountId}`);
      return null;
    }

    // Get the account's proxy URL
    const accounts = await this.loadAccounts();
    const account = accounts.find((a) => a.id === accountId);
    const proxyUrl = account?.proxyUrl?.trim() || undefined;

    try {
      console.log(`[openai-quota] Querying usage for account ${accountId}${proxyUrl ? ` via proxy ${proxyUrl}` : ""}`);

      let resp: { status: number; ok: boolean; json: () => Promise<unknown>; text: () => Promise<string> };

      if (proxyUrl) {
        const parsed = new URL(proxyUrl);
        if (parsed.protocol.startsWith("socks")) {
          // Use SocksProxyAgent (supports auth)
          const agent = new SocksProxyAgent(proxyUrl);
          const data = await new Promise<{ status: number; body: string }>((resolve, reject) => {
            const req = https.request(
              {
                host: "chatgpt.com",
                port: 443,
                path: "/backend-api/wham/usage",
                method: "GET",
                agent,
                timeout: 20000,
                headers: {
                  authorization: `Bearer ${accessToken}`,
                  "chatgpt-account-id": chatgptAccountId,
                  "openai-beta": "codex-1",
                  "oai-language": "zh-CN",
                  originator: "Codex Desktop",
                  accept: "application/json",
                  "sec-fetch-site": "none",
                  "sec-fetch-mode": "no-cors",
                  "sec-fetch-dest": "empty",
                  priority: "u=4, i",
                },
              },
              (res) => {
                let body = "";
                res.on("data", (chunk) => (body += chunk));
                res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
              },
            );
            req.on("error", reject);
            req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
            req.end();
          });
          resp = {
            status: data.status,
            ok: data.status === 200,
            json: async () => JSON.parse(data.body),
            text: async () => data.body,
          };
        } else {
          // HTTP proxy: use undici via createUpstreamFetchController
          const controller = createUpstreamFetchController(proxyUrl);
          try {
            const fetcher = controller.fetch;
            const r = await fetcher("https://chatgpt.com/backend-api/wham/usage", {
              method: "GET",
              headers: {
                authorization: `Bearer ${accessToken}`,
                "chatgpt-account-id": chatgptAccountId,
                "openai-beta": "codex-1",
                "oai-language": "zh-CN",
                originator: "Codex Desktop",
                accept: "application/json",
                "sec-fetch-site": "none",
                "sec-fetch-mode": "no-cors",
                "sec-fetch-dest": "empty",
                priority: "u=4, i",
              },
            });
            resp = r;
          } finally {
            controller.close();
          }
        }
      } else {
        const r = await fetch("https://chatgpt.com/backend-api/wham/usage", {
          method: "GET",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "chatgpt-account-id": chatgptAccountId,
            "openai-beta": "codex-1",
            "oai-language": "zh-CN",
            originator: "Codex Desktop",
            accept: "application/json",
            "sec-fetch-site": "none",
            "sec-fetch-mode": "no-cors",
            "sec-fetch-dest": "empty",
            priority: "u=4, i",
          },
        });
        resp = r;
      }

      console.log(`[openai-quota] Response status: ${resp.status}`);
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        console.error(`[openai-quota] Non-OK response: ${resp.status} ${body.slice(0, 200)}`);
        return null;
      }

      const data = (await resp.json()) as {
        plan_type?: string;
        email?: string;
        rate_limit?: {
          allowed?: boolean;
          limit_reached?: boolean;
          primary_window?: {
            used_percent?: number;
            limit_window_seconds?: number;
            reset_after_seconds?: number;
            reset_at?: number;
          };
          secondary_window?: {
            used_percent?: number;
            limit_window_seconds?: number;
            reset_after_seconds?: number;
            reset_at?: number;
          };
        };
        rate_limit_reset_credits?: {
          available_count?: number;
        };
      };

      return {
        planType: data.plan_type ?? "unknown",
        email: data.email ?? "",
        rateLimit: {
          allowed: data.rate_limit?.allowed ?? true,
          limitReached: data.rate_limit?.limit_reached ?? false,
          primaryWindow: data.rate_limit?.primary_window
            ? {
                usedPercent: data.rate_limit.primary_window.used_percent ?? 0,
                limitWindowSeconds: data.rate_limit.primary_window.limit_window_seconds ?? 0,
                resetAfterSeconds: data.rate_limit.primary_window.reset_after_seconds ?? 0,
                resetAt: data.rate_limit.primary_window.reset_at ?? 0,
              }
            : null,
          secondaryWindow: data.rate_limit?.secondary_window
            ? {
                usedPercent: data.rate_limit.secondary_window.used_percent ?? 0,
                limitWindowSeconds: data.rate_limit.secondary_window.limit_window_seconds ?? 0,
                resetAfterSeconds: data.rate_limit.secondary_window.reset_after_seconds ?? 0,
                resetAt: data.rate_limit.secondary_window.reset_at ?? 0,
              }
            : null,
        },
        resetCreditsAvailable: data.rate_limit_reset_credits?.available_count ?? 0,
        fetchedAt: Date.now(),
      };
    } catch (e) {
      console.error(`[openai-quota] Exception:`, e);
      return null;
    }
  }
}
