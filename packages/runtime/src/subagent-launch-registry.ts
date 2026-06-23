import type { RuntimeAgentRole } from "../../shared/src";

export interface SubagentLaunchRecord {
  parentToolUseId: string;
  role: RuntimeAgentRole;
  prompt: string;
  todoIdHint?: string;
}

export class SubagentLaunchRegistry {
  private readonly launches = new Map<string, SubagentLaunchRecord>();
  private readonly parentToolUseIdByTaskId = new Map<string, string>();

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

  linkTask(taskId: string, parentToolUseId: string): SubagentLaunchRecord | undefined {
    const taskKey = taskId.trim();
    const parentKey = parentToolUseId.trim();
    if (!taskKey || !parentKey) {
      return undefined;
    }
    const record = this.launches.get(parentKey);
    if (!record) {
      return undefined;
    }
    this.parentToolUseIdByTaskId.set(taskKey, parentKey);
    return record;
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
    for (const [taskId, linkedParentToolUseId] of this.parentToolUseIdByTaskId) {
      if (linkedParentToolUseId === record.parentToolUseId) {
        this.parentToolUseIdByTaskId.delete(taskId);
      }
    }
    return record;
  }

  /**
   * Resolve a pending launch for SubagentStart. This intentionally requires the
   * SDK-provided parent tool id, or a task/agent id previously linked from
   * TaskCreated. Role-only matching is not deterministic under parallel
   * same-role subagents.
   */
  takeForSubagentStart(input: {
    parentToolUseId?: string;
    agentId?: string;
    taskId?: string;
    role: RuntimeAgentRole;
  }): SubagentLaunchRecord | undefined {
    const explicitId = input.parentToolUseId?.trim();
    if (explicitId) {
      return this.take(explicitId);
    }
    for (const candidate of [input.taskId, input.agentId]) {
      const taskId = candidate?.trim();
      if (!taskId) {
        continue;
      }
      const parentToolUseId = this.parentToolUseIdByTaskId.get(taskId);
      if (!parentToolUseId) {
        continue;
      }
      const record = this.peek(parentToolUseId);
      if (!record || record.role !== input.role) {
        continue;
      }
      return this.take(parentToolUseId);
    }
    return undefined;
  }
}
