import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Codex OAuth Login Service
 *
 * Manages `codex login` via the Codex CLI to authenticate users
 * with their OpenAI ChatGPT subscription. Auth is stored in
 * CODEX_HOME/auth.json.
 */

export interface CodexOAuthLoginStatus {
  isLoggedIn: boolean;
  message: string;
}

export interface CodexOAuthLoginResult {
  success: boolean;
  message: string;
}

function buildLoginEnv(codexHomeDir: string, upstreamProxyUrl?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: codexHomeDir };
  if (upstreamProxyUrl) {
    env.http_proxy = upstreamProxyUrl;
    env.https_proxy = upstreamProxyUrl;
  }
  return env;
}

function waitForLoginResult(child: ReturnType<typeof spawn>, codexHomeDir: string): Promise<CodexOAuthLoginResult> {
  return new Promise((resolve) => {
    let resolved = false;

    const resolveOnce = (result: CodexOAuthLoginResult) => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    // Watch for auth.json creation (backup in case exit code is non-zero)
    const authPath = path.join(codexHomeDir, "auth.json");
    const checkAuthJson = async () => {
      try {
        await fs.access(authPath);
        resolveOnce({ success: true, message: "登录成功 (auth.json detected)" });
      } catch {
        // auth.json not yet created
      }
    };

    // Poll for auth.json every 2 seconds
    const pollInterval = setInterval(checkAuthJson, 2000);

    child.on("exit", (code) => {
      clearInterval(pollInterval);
      // Double-check: even if exit code != 0, auth.json might exist
      checkAuthJson().then(() => {
        // If auth.json wasn't found, report based on exit code
        fs.access(authPath).catch(() => {
          resolveOnce({
            success: code === 0,
            message: code === 0 ? "登录成功" : `登录失败 (exit code ${code})`,
          });
        });
      });
    });

    child.on("error", (error) => {
      clearInterval(pollInterval);
      resolveOnce({
        success: false,
        message: `登录失败: ${error instanceof Error ? error.message : String(error)}`,
      });
    });

    // Hard timeout: 5 minutes max for the entire login flow
    setTimeout(() => {
      clearInterval(pollInterval);
      child.kill("SIGTERM");
      resolveOnce({ success: false, message: "登录超时 (5分钟)" });
    }, 5 * 60 * 1000);
  });
}

export class CodexOAuthLoginService {
  constructor(
    private readonly codexHomeDir: string,
    private readonly codexExecutable: string,
    private readonly upstreamProxyUrl?: string,
  ) {}

  /** Check if the user is currently logged in. */
  async getStatus(): Promise<CodexOAuthLoginStatus> {
    try {
      // Check if auth.json exists in CODEX_HOME
      const authPath = path.join(this.codexHomeDir, "auth.json");
      const exists = await fs.access(authPath).then(() => true).catch(() => false);

      if (!exists) {
        return { isLoggedIn: false, message: "未登录" };
      }

      // Check if auth.json is valid JSON and not expired
      try {
        const content = await fs.readFile(authPath, "utf-8");
        const auth = JSON.parse(content);

        // auth.json structure: { auth_mode, tokens: { access_token, ... }, last_refresh }
        const accessToken = auth.tokens?.access_token ?? auth.access_token;
        if (!accessToken) {
          return { isLoggedIn: false, message: "登录信息无效" };
        }

        // Check expiration if present (id_token has exp claim)
        if (auth.tokens?.id_token) {
          try {
            const payload = JSON.parse(
              Buffer.from(auth.tokens.id_token.split(".")[1], "base64url").toString("utf-8"),
            );
            if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
              return { isLoggedIn: false, message: "登录已过期" };
            }
          } catch {
            // Can't decode id_token, assume valid
          }
        }

        return { isLoggedIn: true, message: "已登录" };
      } catch {
        return { isLoggedIn: false, message: "登录信息无效" };
      }
    } catch (error) {
      return {
        isLoggedIn: false,
        message: `检查登录状态失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Start the OAuth login flow and return the auth URL.
   *
   * Uses `codex login` and parses the output to extract the authorization URL.
   * The caller is responsible for opening the URL in a browser.
   * After the user authorizes, OpenAI redirects to the local server callback
   * and the codex process completes the auth, writing auth.json.
   */
  async startLogin(): Promise<{
    authUrl: string;
    result: Promise<CodexOAuthLoginResult>;
  } | null> {
    return new Promise((resolve) => {
      let authUrl = "";
      let urlFound = false;

      const child = spawn(this.codexExecutable, ["login"], {
        env: buildLoginEnv(this.codexHomeDir, this.upstreamProxyUrl),
        stdio: ["ignore", "pipe", "pipe"],
      });

      child.stdout.setEncoding("utf-8");
      child.stderr.setEncoding("utf-8");

      const handleOutput = (data: string) => {
        // Log all output for debugging
        process.stderr.write(`[codex-login] ${data.trim()}\n`);

        // Extract the OAuth authorization URL
        const urlMatch = data.match(/https:\/\/auth\.openai\.com\/oauth\/authorize\?[^\s]+/);
        if (urlMatch && !urlFound) {
          authUrl = urlMatch[0];
          urlFound = true;
          resolve({
            authUrl,
            result: waitForLoginResult(child, this.codexHomeDir),
          });
        }
      };

      child.stdout.on("data", handleOutput);
      child.stderr.on("data", handleOutput);

      // Timeout after 30 seconds if we can't extract the URL
      setTimeout(() => {
        if (!urlFound) {
          child.kill("SIGTERM");
          resolve(null);
        }
      }, 30000);
    });
  }

  /**
   * Logout the user by removing auth.json.
   */
  async logout(): Promise<CodexOAuthLoginResult> {
    try {
      const authPath = path.join(this.codexHomeDir, "auth.json");
      await fs.access(authPath).then(() => fs.unlink(authPath)).catch(() => {});
      return { success: true, message: "已退出登录" };
    } catch (error) {
      return {
        success: false,
        message: `退出登录失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
