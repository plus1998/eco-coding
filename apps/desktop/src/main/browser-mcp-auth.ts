import { randomBytes } from "node:crypto";

/**
 * Thread-scoped bearer tokens for Eco's browser MCP gateway.
 * - UI / composer toggle stays `eco_agent_browser` (one logical server name).
 * - Each conversation gets a secret token; the gateway maps token → Eco threadId → CDP.
 * - Codex may share one MCP process: concurrent routing also uses the tool.started claim queue.
 */

export type BrowserThreadTokenRecord = {
  token: string;
  threadId: string;
  issuedAt: number;
};

export class BrowserMcpAuthRegistry {
  private readonly byToken = new Map<string, BrowserThreadTokenRecord>();
  private readonly byThread = new Map<string, string>();

  issue(threadId: string): BrowserThreadTokenRecord {
    const tid = threadId.trim();
    if (!tid) {
      throw new Error("Browser MCP auth requires a thread id");
    }
    const existing = this.byThread.get(tid);
    if (existing) {
      this.byToken.delete(existing);
    }
    const token = `ebt_${randomBytes(24).toString("base64url")}`;
    const record: BrowserThreadTokenRecord = {
      token,
      threadId: tid,
      issuedAt: Date.now(),
    };
    this.byToken.set(token, record);
    this.byThread.set(tid, token);
    return record;
  }

  resolve(token: string | undefined | null): BrowserThreadTokenRecord | undefined {
    const t = token?.trim();
    if (!t) {
      return undefined;
    }
    return this.byToken.get(t);
  }

  getTokenForThread(threadId: string): string | undefined {
    return this.byThread.get(threadId.trim());
  }

  revokeThread(threadId: string): void {
    const tid = threadId.trim();
    const token = this.byThread.get(tid);
    if (token) {
      this.byToken.delete(token);
    }
    this.byThread.delete(tid);
  }
}

/** Shared secret so the stdio MCP child may call Eco control HTTP. */
export function createBrowserMcpControlSecret(): string {
  return `ecs_${randomBytes(24).toString("base64url")}`;
}
