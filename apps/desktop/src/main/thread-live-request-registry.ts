import { randomUUID } from "node:crypto";

interface ActiveRequestEntry {
  requestId: string;
  role: string;
  agentId?: string;
}

/** Tracks the active provider-scoped request id per thread for live timeline attribution. */
export class ThreadLiveRequestRegistry {
  private readonly activeByThread = new Map<string, ActiveRequestEntry[]>();

  beginRequest(threadId: string, input: { role: string; agentId?: string }): string {
    const requestId = `req_${randomUUID()}`;
    const next: ActiveRequestEntry = {
      requestId,
      role: input.role,
      ...(input.agentId?.trim() && { agentId: input.agentId.trim() }),
    };
    this.upsert(threadId, next);
    return requestId;
  }

  adoptProviderRequestId(
    threadId: string,
    input: { role: string; agentId?: string },
    providerRequestId: string,
  ): { requestId: string; replacedRequestId?: string } {
    const trimmed = providerRequestId.trim();
    if (!trimmed) {
      return { requestId: this.beginRequest(threadId, input) };
    }
    const scopeEntry: ActiveRequestEntry = {
      requestId: trimmed,
      role: input.role,
      ...(input.agentId?.trim() && { agentId: input.agentId.trim() }),
    };
    const entries = this.activeByThread.get(threadId) ?? [];
    const existing = entries.find((entry) => sameScope(entry, scopeEntry));
    const replacedRequestId =
      existing && existing.requestId !== trimmed ? existing.requestId : undefined;
    this.upsert(threadId, scopeEntry);
    return {
      requestId: trimmed,
      ...(replacedRequestId && { replacedRequestId }),
    };
  }

  resolve(threadId: string, input: { role?: string; agentId?: string }): string | undefined {
    const entries = this.activeByThread.get(threadId);
    if (!entries || entries.length === 0) {
      return undefined;
    }
    const agentId = input.agentId?.trim();
    if (agentId) {
      return [...entries].reverse().find((entry) => entry.agentId === agentId)?.requestId;
    }
    const role = input.role?.trim();
    if (!role) {
      return undefined;
    }
    // Main-thread scope only: entries registered without agentId. Never guess across
    // concurrent subagent requests that share the same role.
    const byRole = entries.filter((entry) => entry.role === role && !entry.agentId);
    return byRole.length === 1 ? byRole[0]!.requestId : undefined;
  }

  endRequest(threadId: string, requestId: string): void {
    const trimmed = requestId.trim();
    if (!trimmed) {
      return;
    }
    const entries = this.activeByThread.get(threadId);
    if (!entries) {
      return;
    }
    const next = entries.filter((entry) => entry.requestId !== trimmed);
    if (next.length === 0) {
      this.activeByThread.delete(threadId);
      return;
    }
    this.activeByThread.set(threadId, next);
  }

  clearThread(threadId: string): void {
    this.activeByThread.delete(threadId);
  }

  private upsert(threadId: string, entry: ActiveRequestEntry): void {
    const entries = this.activeByThread.get(threadId) ?? [];
    const next = [...entries.filter((existing) => !sameScope(existing, entry)), entry];
    this.activeByThread.set(threadId, next);
  }
}

function sameScope(left: ActiveRequestEntry, right: ActiveRequestEntry): boolean {
  const leftAgentId = left.agentId?.trim();
  const rightAgentId = right.agentId?.trim();
  if (leftAgentId && rightAgentId) {
    return leftAgentId === rightAgentId;
  }
  if (leftAgentId || rightAgentId) {
    return false;
  }
  return left.role === right.role;
}
