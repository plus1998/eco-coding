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
}
