import type { RuntimeAgentRole } from "../../shared/src";

export interface SubagentLaunchRecord {
  parentToolUseId: string;
  role: RuntimeAgentRole;
  prompt: string;
  todoIdHint?: string;
}

export interface SubagentStreamDelegationLink {
  agentId: string;
  launch: SubagentLaunchRecord;
  matchMethod: "streamParentToolUseId";
}

export class SubagentLaunchRegistry {
  private readonly launches = new Map<string, SubagentLaunchRecord>();
  private readonly parentToolUseIdByTaskId = new Map<string, string>();
  /** SubagentStart agent ids waiting for SDK stream parent_tool_use_id. */
  private readonly awaitingStreamAgentsByRole = new Map<RuntimeAgentRole, string[]>();
  /** parent_tool_use_id values seen on stream before SubagentStart arrived. */
  private readonly streamSeenParentToolUseIds = new Set<string>();
  private readonly linkedStreamParentToolUseIds = new Set<string>();

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
   * Queue a SubagentStart agent id until SDK stream exposes parent_tool_use_id.
   * If stream already arrived for a pending launch of the same role, pairs immediately.
   */
  noteSubagentAwaitingStream(
    agentId: string,
    role: RuntimeAgentRole,
  ): SubagentStreamDelegationLink | undefined {
    const agentKey = agentId.trim();
    if (!agentKey) {
      return undefined;
    }
    const queue = this.awaitingStreamAgentsByRole.get(role) ?? [];
    queue.push(agentKey);
    this.awaitingStreamAgentsByRole.set(role, queue);
    for (const parentToolUseId of this.streamSeenParentToolUseIds) {
      const linked = this.tryPairStreamParentToolUseId(parentToolUseId);
      if (linked) {
        return linked;
      }
    }
    return undefined;
  }

  /**
   * Pair a structured SDK stream parent_tool_use_id with a pending launch and agent id.
   */
  resolveFromStreamParentToolUseId(
    parentToolUseId: string,
  ): SubagentStreamDelegationLink | undefined {
    const parentKey = parentToolUseId.trim();
    if (!parentKey) {
      return undefined;
    }
    this.streamSeenParentToolUseIds.add(parentKey);
    return this.tryPairStreamParentToolUseId(parentKey);
  }

  /**
   * Resolve a pending launch for SubagentStart hook callbacks. Uses structured ids and
   * prompt only; production Agent delegations defer to resolveFromStreamParentToolUseId.
   */
  takeForSubagentStart(input: {
    parentToolUseIds?: readonly string[];
    agentId?: string;
    taskId?: string;
    role: RuntimeAgentRole;
    prompt?: string;
  }): SubagentLaunchRecord | undefined {
    for (const candidateId of input.parentToolUseIds ?? []) {
      const trimmed = candidateId.trim();
      if (!trimmed) {
        continue;
      }
      const direct = this.take(trimmed);
      if (direct) {
        return direct;
      }
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
    const prompt = input.prompt?.trim();
    if (prompt) {
      const matches = this.findPendingLaunchesByPrompt(input.role, prompt);
      if (matches.length === 1) {
        return this.take(matches[0]!.parentToolUseId);
      }
      if (matches.length > 1) {
        return undefined;
      }
      return undefined;
    }
    return undefined;
  }

  private tryPairStreamParentToolUseId(
    parentToolUseId: string,
  ): SubagentStreamDelegationLink | undefined {
    const parentKey = parentToolUseId.trim();
    if (!parentKey || this.linkedStreamParentToolUseIds.has(parentKey)) {
      return undefined;
    }
    const launch = this.peek(parentKey);
    if (!launch) {
      return undefined;
    }
    const queue = this.awaitingStreamAgentsByRole.get(launch.role);
    const agentId = queue?.shift()?.trim();
    if (!agentId) {
      return undefined;
    }
    if (queue && queue.length === 0) {
      this.awaitingStreamAgentsByRole.delete(launch.role);
    }
    const taken = this.take(parentKey);
    if (!taken) {
      return undefined;
    }
    this.linkedStreamParentToolUseIds.add(parentKey);
    this.streamSeenParentToolUseIds.delete(parentKey);
    this.linkTask(agentId, parentKey);
    const link: SubagentStreamDelegationLink = {
      agentId,
      launch: taken,
      matchMethod: "streamParentToolUseId",
    };
    return link;
  }

  private findPendingLaunchesByPrompt(
    role: RuntimeAgentRole,
    prompt: string,
  ): SubagentLaunchRecord[] {
    const matches: SubagentLaunchRecord[] = [];
    for (const record of this.launches.values()) {
      if (record.role === role && record.prompt.trim() === prompt) {
        matches.push(record);
      }
    }
    return matches;
  }
}
