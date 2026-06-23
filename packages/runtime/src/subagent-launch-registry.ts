import type { RuntimeAgentRole } from "../../shared/src";

export interface SubagentLaunchRecord {
  parentToolUseId: string;
  role: RuntimeAgentRole;
  prompt: string;
  todoIdHint?: string;
}

export class SubagentLaunchRegistry {
  private readonly launches = new Map<string, SubagentLaunchRecord>();

  register(record: SubagentLaunchRecord): void {
    const parentToolUseId = record.parentToolUseId.trim();
    if (!parentToolUseId) {
      return;
    }
    this.launches.set(parentToolUseId, {
      ...record,
      parentToolUseId,
      prompt: record.prompt.trim(),
      ...(record.todoIdHint?.trim() && { todoIdHint: record.todoIdHint.trim() }),
    });
  }

  peek(parentToolUseId: string): SubagentLaunchRecord | undefined {
    const key = parentToolUseId.trim();
    if (!key) {
      return undefined;
    }
    return this.launches.get(key);
  }

  take(parentToolUseId: string): SubagentLaunchRecord | undefined {
    const record = this.peek(parentToolUseId);
    if (!record) {
      return undefined;
    }
    this.launches.delete(record.parentToolUseId);
    return record;
  }

  /**
   * Resolve a pending launch for SubagentStart. Prefers explicit parentToolUseId;
   * otherwise consumes only when a single pending launch is unambiguous for the role.
   */
  takeForSubagentStart(input: {
    parentToolUseId?: string;
    role: RuntimeAgentRole;
  }): SubagentLaunchRecord | undefined {
    const explicitId = input.parentToolUseId?.trim();
    if (explicitId) {
      return this.take(explicitId);
    }
    const pending = [...this.launches.values()];
    if (pending.length === 0) {
      return undefined;
    }
    if (pending.length === 1) {
      return this.take(pending[0]!.parentToolUseId);
    }
    const roleMatches = pending.filter((entry) => entry.role === input.role);
    if (roleMatches.length === 1) {
      return this.take(roleMatches[0]!.parentToolUseId);
    }
    return undefined;
  }
}
