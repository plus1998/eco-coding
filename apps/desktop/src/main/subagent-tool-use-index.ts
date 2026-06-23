import type { RuntimeAgentRole } from "../shared/ipc";

interface PendingToolUse {
  toolUseId: string;
  role?: RuntimeAgentRole;
}

export interface NoteSubagentToolUseResult {
  pending: boolean;
  pendingCount: number;
}

export class SubagentToolUseIndex {
  private readonly toolUseToAgentId = new Map<string, string>();
  private readonly pendingToolUses: PendingToolUse[] = [];

  get mappedCount(): number {
    return this.toolUseToAgentId.size;
  }

  note(toolUseId: string, role?: RuntimeAgentRole): NoteSubagentToolUseResult {
    if (!this.toolUseToAgentId.has(toolUseId)) {
      const existing = this.pendingToolUses.find((pending) => pending.toolUseId === toolUseId);
      if (existing) {
        if (!existing.role && role) {
          existing.role = role;
        }
      } else {
        this.pendingToolUses.push({
          toolUseId,
          ...(role && { role }),
        });
      }
    }

    return {
      pending: this.pendingToolUses.some((entry) => entry.toolUseId === toolUseId),
      pendingCount: this.pendingToolUses.length,
    };
  }

  link(toolUseId: string, agentId: string): void {
    this.toolUseToAgentId.set(toolUseId, agentId);
    this.removePending(toolUseId);
  }

  resolve(toolUseId: string): string | undefined {
    return this.toolUseToAgentId.get(toolUseId);
  }

  private removePending(toolUseId: string): void {
    const index = this.pendingToolUses.findIndex((pending) => pending.toolUseId === toolUseId);
    if (index >= 0) {
      this.pendingToolUses.splice(index, 1);
    }
  }
}
