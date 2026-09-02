import type { ThreadRunEvent } from "../shared/ipc";
import type { ThreadRunProjectionAgent } from "../shared/thread-run-projection";
import type { RpcLogEntry } from "./conversation-round-fixture";

export const REPLAY_SCENARIO_CHECKLIST_KEYS = [
  "skills_listed",
  "skill_invoked_or_mentioned",
  "file_written",
  "file_read_back",
  "mcp_tool_called",
  "subagent_spawned",
  "subagent_turn_events",
  "turn_completed",
  "marker_in_assistant",
] as const;

export type ReplayScenarioChecklistKey = (typeof REPLAY_SCENARIO_CHECKLIST_KEYS)[number];

export interface ScenarioChecklistEntry {
  ok: boolean;
  detail: string;
}

export interface ScenarioChecklistResult {
  ok: boolean;
  failed: string[];
  checklist: Record<ReplayScenarioChecklistKey, ScenarioChecklistEntry>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectTexts(node: unknown, out: string[], depth = 0): void {
  if (depth > 8 || node == null) {
    return;
  }
  if (typeof node === "string") {
    if (node.length > 0 && node.length < 20_000) {
      out.push(node);
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      collectTexts(item, out, depth + 1);
    }
    return;
  }
  if (!isRecord(node)) {
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (["text", "content", "message", "output", "delta", "summary"].includes(key)) {
      collectTexts(value, out, depth + 1);
    } else if (key === "item" || key === "turn" || key === "items" || key === "parts") {
      collectTexts(value, out, depth + 1);
    }
  }
}

export function skillsListResultHasEntries(skillsListResult: unknown): boolean {
  return (
    Array.isArray(skillsListResult) &&
    skillsListResult.some((entry) => {
      const skills = isRecord(entry) ? entry.skills : undefined;
      return Array.isArray(skills) && skills.length > 0;
    })
  );
}

/** Validate replay projection output (persisted thread run events + agent instances). */
export function evaluateReplayScenarioChecklist(input: {
  persistedEvents: readonly ThreadRunEvent[];
  agents?: readonly ThreadRunProjectionAgent[] | readonly { kind?: string; status?: string }[];
  workspaceFiles?: Record<string, string>;
  marker: string;
  skillsListResult?: unknown;
}): ScenarioChecklistResult {
  const { persistedEvents, agents = [], workspaceFiles = {}, marker, skillsListResult } = input;
  const messages = persistedEvents.map((event) => event.message).join("\n");
  const metadataText = persistedEvents.map((event) => JSON.stringify(event.metadata ?? {})).join("\n");
  const joinedText = `${messages}\n${metadataText}`;

  const notePathKeys = Object.keys(workspaceFiles).filter((pathKey) => /smoke-note/i.test(pathKey));
  const markerHit =
    joinedText.includes(`SMOKE_DONE:${marker}`) ||
    joinedText.includes(`SMOKE_CHILD:${marker}`) ||
    joinedText.includes(marker) ||
    Object.values(workspaceFiles).some((value) => value.includes(marker));

  const skillsListed = skillsListResultHasEntries(skillsListResult);
  const skillMentioned = /SMOKE_SKILL_OK|smoke-skill|SKILL-GREETING/i.test(joinedText);

  const fileWriteSeen =
    notePathKeys.length > 0 ||
    persistedEvents.some((event) => {
      const toolName = String((event.metadata?.tool as { name?: string } | undefined)?.name ?? "");
      const command = String(event.metadata?.command ?? "");
      return toolName === "Write" || /smoke-note|write|echo|printf|tee|>/i.test(command);
    });

  const fileReadSeen =
    (notePathKeys.length > 0 &&
      notePathKeys.some((pathKey) => {
        const content = workspaceFiles[pathKey] ?? "";
        return content.includes(marker) || content.includes("SMOKE_FILE");
      })) ||
    persistedEvents.some((event) => {
      const toolName = String((event.metadata?.tool as { name?: string } | undefined)?.name ?? "");
      const command = String(event.metadata?.command ?? "");
      return toolName === "Read" || /cat|read|type|smoke-note/i.test(command);
    });

  const mcpSeen = persistedEvents.some((event) => {
    const toolName = String((event.metadata?.tool as { name?: string } | undefined)?.name ?? "");
    return /mcp|smoke_ping|smoke_echo/i.test(toolName);
  });

  const subagentAgents = agents.filter((agent) => agent.kind === "subagent");
  const subagentStopped = persistedEvents.some((event) =>
    ["agent.stopped", "agent.abandoned"].includes(event.eventType),
  );
  const subagentSpawned = subagentAgents.length > 0;
  const childMarkerSeen = joinedText.includes(`SMOKE_CHILD:${marker}`);
  const subagentTurnEvents =
    subagentSpawned &&
    (childMarkerSeen || subagentStopped || subagentAgents.some((agent) => agent.status === "stopped"));

  const turnCompleted = persistedEvents.some((event) => event.eventType === "message.final") || markerHit;

  const checklist: Record<ReplayScenarioChecklistKey, ScenarioChecklistEntry> = {
    skills_listed: {
      ok: skillsListed || skillMentioned,
      detail:
        skillsListed || skillMentioned
          ? skillsListed
            ? "skills/list has entries"
            : "skill evidence in replay output"
          : "skills/list empty or missing",
    },
    skill_invoked_or_mentioned: {
      ok: skillMentioned,
      detail: skillMentioned ? "skill evidence in replay output" : "missing skill evidence in replay",
    },
    file_written: {
      ok: fileWriteSeen,
      detail: fileWriteSeen ? "write tool or workspace file evidence" : "missing file write in replay",
    },
    file_read_back: {
      ok: fileReadSeen,
      detail: fileReadSeen ? "read tool or workspace content verified" : "missing read-back in replay",
    },
    mcp_tool_called: {
      ok: mcpSeen,
      detail: mcpSeen ? "mcp tool events in replay" : "missing mcp tool events in replay",
    },
    subagent_spawned: {
      ok: subagentSpawned,
      detail: subagentSpawned ? "subagent instance or agent.started in replay" : "missing subagent in replay",
    },
    subagent_turn_events: {
      ok: subagentTurnEvents,
      detail: subagentTurnEvents
        ? "subagent output or stop in replay"
        : "subagent spawned but missing child output/stop in replay",
    },
    turn_completed: {
      ok: turnCompleted,
      detail: turnCompleted ? "message.final or marker in replay" : "missing turn completion in replay",
    },
    marker_in_assistant: {
      ok: markerHit,
      detail: markerHit ? `marker ${marker} found in replay` : `marker ${marker} missing in replay`,
    },
  };

  const failed = REPLAY_SCENARIO_CHECKLIST_KEYS.filter((key) => !checklist[key].ok);
  return { ok: failed.length === 0, failed: [...failed], checklist };
}

/** Validate recorded Codex rpc-log (upstream fixture quality, not replay output). */
export function evaluateCodexRecordingScenarioChecklist(input: {
  rpcLog: readonly RpcLogEntry[];
  workspaceFiles?: Record<string, string>;
  marker: string;
  skillsListResult?: unknown;
}): ScenarioChecklistResult {
  const { rpcLog, workspaceFiles = {}, marker, skillsListResult } = input;
  const texts: string[] = [];
  const itemTypes = new Set<string>();
  const toolNames = new Set<string>();
  const subagentThreadIds = new Set<string>();
  let spawnSeen = false;
  let mcpSeen = false;
  let fileWriteSeen = false;
  let fileReadSeen = false;
  let skillItemSeen = false;
  let turnCompleted = false;

  for (const entry of rpcLog) {
    const params = isRecord(entry.params) ? entry.params : {};
    const item = isRecord(params.item) ? params.item : undefined;
    if (item?.type && typeof item.type === "string") {
      itemTypes.add(item.type);
    }
    if (entry.method === "turn/completed") {
      turnCompleted = true;
    }
    collectTexts(params, texts);
    if (item?.type === "fileChange") {
      fileWriteSeen = true;
    }
    if (item?.type === "commandExecution") {
      const cmd = typeof item.command === "string" ? item.command : "";
      if (/\b(cat|type|Get-Content|read)\b/i.test(cmd) || /smoke-read/i.test(cmd)) {
        fileReadSeen = true;
      }
      if (/\b(echo|Set-Content|printf|tee|>|Out-File)\b/i.test(cmd) || /smoke-note/i.test(cmd)) {
        fileWriteSeen = true;
      }
    }
    if (item?.type === "mcpToolCall" || item?.type === "mcpToolCallOutput") {
      if (typeof item.tool === "string") {
        toolNames.add(item.tool);
      }
      const toolLabel = String(item.tool ?? item.name ?? "");
      const status = typeof item.status === "string" ? item.status : "";
      if (/^(smoke_ping|smoke_echo)$/i.test(toolLabel) && status !== "failed") {
        mcpSeen = true;
      }
    }
    if (
      item?.type === "collabAgentToolCall" ||
      item?.type === "agentToolCall" ||
      item?.type === "subAgent" ||
      item?.type === "subagent"
    ) {
      spawnSeen = true;
    }
    if (typeof item?.agentThreadId === "string") {
      subagentThreadIds.add(item.agentThreadId);
      spawnSeen = true;
    }
    if (Array.isArray(item?.receiverThreadIds)) {
      for (const id of item.receiverThreadIds) {
        if (typeof id === "string" && id.trim()) {
          subagentThreadIds.add(id);
          spawnSeen = true;
        }
      }
    }
    if (isRecord(item?.agentsStates)) {
      for (const id of Object.keys(item.agentsStates)) {
        if (id.trim()) {
          subagentThreadIds.add(id);
          spawnSeen = true;
        }
      }
    }
    if (entry.method === "thread/started") {
      const thread = isRecord(params.thread) ? params.thread : params;
      const parentId =
        (isRecord(thread) && typeof thread.parentThreadId === "string" && thread.parentThreadId) ||
        (typeof params.parentThreadId === "string" && params.parentThreadId) ||
        undefined;
      if (parentId) {
        spawnSeen = true;
        if (typeof thread?.id === "string") {
          subagentThreadIds.add(thread.id);
        }
      }
    }
    if (item?.type === "skill" || item?.type === "skillInvocation" || item?.type === "skillLoad") {
      skillItemSeen = true;
    }
  }

  const joinedText = texts.join("\n");
  const markerHit =
    joinedText.includes(marker) || Object.values(workspaceFiles).some((value) => value.includes(marker));
  const notePathKeys = Object.keys(workspaceFiles).filter((pathKey) => /smoke-note/i.test(pathKey));
  if (notePathKeys.length > 0) {
    fileWriteSeen = true;
    const content = notePathKeys.map((key) => workspaceFiles[key]).join("\n");
    if (content.includes(marker) || content.includes("SMOKE_FILE")) {
      fileReadSeen = true;
    }
  }

  const skillsListed = skillsListResultHasEntries(skillsListResult);
  const skillMentioned =
    skillItemSeen || /skill/i.test(joinedText) || /smoke-skill|SMOKE_SKILL/i.test(joinedText);
  const subagentEvents =
    spawnSeen &&
    (subagentThreadIds.size > 0 ||
      [...itemTypes].some((type) => /subAgent|collab|agentTool/i.test(type)) ||
      rpcLog.some(
        (entry) => entry.method === "thread/started" && isRecord(entry.params) && entry.params.parentThreadId,
      ));

  const checklist: Record<ReplayScenarioChecklistKey, ScenarioChecklistEntry> = {
    skills_listed: {
      ok: skillsListed,
      detail: skillsListed ? "skills/list has entries" : "skills/list empty or missing",
    },
    skill_invoked_or_mentioned: {
      ok: skillMentioned,
      detail: skillMentioned ? "skill evidence in recording" : "no skill evidence in recording",
    },
    file_written: {
      ok: fileWriteSeen || notePathKeys.length > 0,
      detail: fileWriteSeen ? "file write evidence in recording" : "missing file write in recording",
    },
    file_read_back: {
      ok: fileReadSeen || (notePathKeys.length > 0 && markerHit),
      detail: fileReadSeen ? "read-back evidence in recording" : "missing read-back in recording",
    },
    mcp_tool_called: {
      ok: mcpSeen,
      detail: mcpSeen ? `mcp tools=${[...toolNames].join(",")}` : "missing native mcp tool call in recording",
    },
    subagent_spawned: {
      ok: spawnSeen,
      detail: spawnSeen ? "spawn evidence in recording" : "missing spawn in recording",
    },
    subagent_turn_events: {
      ok: Boolean(subagentEvents || (spawnSeen && turnCompleted)),
      detail: subagentEvents ? "subagent lifecycle in recording" : "weak subagent lifecycle in recording",
    },
    turn_completed: {
      ok: turnCompleted,
      detail: turnCompleted ? "turn/completed in recording" : "missing turn/completed in recording",
    },
    marker_in_assistant: {
      ok: markerHit,
      detail: markerHit ? `marker ${marker} in recording` : `marker ${marker} missing in recording`,
    },
  };

  const failed = REPLAY_SCENARIO_CHECKLIST_KEYS.filter((key) => !checklist[key].ok);
  return { ok: failed.length === 0, failed: [...failed], checklist };
}
