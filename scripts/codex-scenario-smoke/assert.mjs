/**
 * Shared assertion logic for Codex scenario smoke record + replay.
 *
 * Checklist keys (must stay stable for fixtures):
 * - skills_listed
 * - skill_invoked_or_mentioned
 * - file_written
 * - file_read_back
 * - mcp_tool_called
 * - subagent_spawned
 * - subagent_turn_events
 * - turn_completed
 * - marker_in_assistant
 */

export const CHECKLIST_KEYS = [
  "skills_listed",
  "skill_invoked_or_mentioned",
  "file_written",
  "file_read_back",
  "mcp_tool_called",
  "subagent_spawned",
  "subagent_turn_events",
  "turn_completed",
  "marker_in_assistant",
];

/**
 * @param {{
 *   rpcLog: Array<{ kind: string, method: string, params?: unknown, direction?: string }>,
 *   workspaceFiles?: Record<string, string>,
 *   marker: string,
 *   skillsListResult?: unknown,
 * }} input
 */
export function evaluateScenarioChecklist(input) {
  const { rpcLog, workspaceFiles = {}, marker, skillsListResult } = input;
  const methods = new Set(rpcLog.map((e) => e.method));
  const itemTypes = new Set();
  const toolNames = new Set();
  const texts = [];
  const subagentThreadIds = new Set();
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

    // Assistant / agent text
    collectTexts(params, texts);

    // File change items
    if (item?.type === "fileChange" || item?.type === "patchApply" || item?.type === "agentMessage") {
      // fall through — also check commandExecution for write/read
    }
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
      if (typeof item.tool === "string") toolNames.add(item.tool);
      if (typeof item.name === "string") toolNames.add(item.name);
      if (typeof item.server === "string" && typeof item.tool === "string") {
        toolNames.add(`${item.server}/${item.tool}`);
      }
      const toolLabel = String(item.tool ?? item.name ?? "");
      const status = typeof item.status === "string" ? item.status : "";
      // Only count successful native smoke_* tool calls — not list_mcp_resources / failed startups.
      if (/^(smoke_ping|smoke_echo)$/i.test(toolLabel) && status !== "failed") {
        mcpSeen = true;
      }
    }
    // Collab / spawn
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
    // Codex collab spawnAgent puts child ids on receiverThreadIds / agentsStates keys
    // (not agentThreadId / thread.started.parentThreadId).
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
        if (typeof thread?.id === "string") subagentThreadIds.add(thread.id);
        if (typeof params.threadId === "string") subagentThreadIds.add(params.threadId);
      }
    }
    if (item?.type === "skill" || item?.type === "skillInvocation" || item?.type === "skillLoad") {
      skillItemSeen = true;
    }
    // Tool names embedded in generic tool items
    if (typeof item?.tool === "string") toolNames.add(item.tool);
    if (typeof item?.name === "string" && /smoke_|spawn|mcp/i.test(item.name)) {
      toolNames.add(item.name);
    }
  }

  const joinedText = texts.join("\n");
  const markerHit =
    joinedText.includes(marker) || Object.values(workspaceFiles).some((v) => v.includes(marker));

  // Workspace evidence is authoritative for file write/read
  const notePathKeys = Object.keys(workspaceFiles).filter((p) => /smoke-note/i.test(p));
  if (notePathKeys.length > 0) {
    fileWriteSeen = true;
    const content = notePathKeys.map((k) => workspaceFiles[k]).join("\n");
    if (content.includes(marker) || content.includes("SMOKE_FILE")) {
      fileReadSeen = true; // we verify content exists after the turn
    }
  }

  const skillsListed =
    Array.isArray(skillsListResult) &&
    skillsListResult.some((entry) => {
      const skills = entry?.skills;
      return Array.isArray(skills) && skills.length > 0;
    });

  // mcpSeen is set only from successful native mcpToolCall(smoke_ping|smoke_echo) above.
  // Do NOT accept list_mcp_resources, prose, or shell bridging that prints SMOKE_MCP_*.

  const skillMentioned =
    skillItemSeen || /skill/i.test(joinedText) || /smoke-skill|SMOKE_SKILL/i.test(joinedText);

  const subagentEvents =
    spawnSeen &&
    (subagentThreadIds.size > 0 ||
      [...itemTypes].some((t) => /subAgent|collab|agentTool/i.test(t)) ||
      rpcLog.some((e) => e.method === "thread/started" && isRecord(e.params) && e.params.parentThreadId));

  /** @type {Record<string, { ok: boolean, detail: string }>} */
  const checklist = {
    skills_listed: {
      ok: Boolean(skillsListed),
      detail: skillsListed
        ? `skills entries=${skillsListResult.length}`
        : "skills/list returned empty or missing",
    },
    skill_invoked_or_mentioned: {
      ok: Boolean(skillMentioned),
      detail: skillMentioned ? "skill evidence found in items/text" : "no skill item or SMOKE_SKILL mention",
    },
    file_written: {
      ok: Boolean(fileWriteSeen || notePathKeys.length > 0),
      detail:
        notePathKeys.length > 0
          ? `workspace files: ${notePathKeys.join(", ")}`
          : fileWriteSeen
            ? "fileChange/commandExecution write observed"
            : "no file write evidence",
    },
    file_read_back: {
      ok: Boolean(fileReadSeen || (notePathKeys.length > 0 && markerHit)),
      detail: fileReadSeen || notePathKeys.length > 0 ? "read/content verified" : "no read-back evidence",
    },
    mcp_tool_called: {
      ok: Boolean(mcpSeen),
      detail: mcpSeen
        ? `native mcpToolCall tools=${[...toolNames].filter((n) => /(^|\/)(smoke_ping|smoke_echo)$/i.test(n)).join(",")}`
        : "no successful native mcpToolCall for smoke_ping/smoke_echo (list_mcp_resources / prose / shell do not count)",
    },
    subagent_spawned: {
      ok: Boolean(spawnSeen),
      detail: spawnSeen
        ? `spawn evidence; childThreads=${[...subagentThreadIds].join(",") || "(inline)"}`
        : "no spawn/collab/subagent evidence",
    },
    subagent_turn_events: {
      ok: Boolean(subagentEvents || (spawnSeen && turnCompleted)),
      detail: subagentEvents
        ? "subagent lifecycle events observed"
        : spawnSeen
          ? "spawn seen but weak lifecycle evidence"
          : "missing",
    },
    turn_completed: {
      ok: turnCompleted,
      detail: turnCompleted ? "turn/completed observed" : "missing turn/completed",
    },
    marker_in_assistant: {
      ok: Boolean(markerHit),
      detail: markerHit ? `marker ${marker} found` : `marker ${marker} not found in texts/files`,
    },
  };

  const failed = CHECKLIST_KEYS.filter((k) => !checklist[k].ok);
  return {
    ok: failed.length === 0,
    failed,
    checklist,
    observed: {
      methods: [...methods].sort(),
      itemTypes: [...itemTypes].sort(),
      toolNames: [...toolNames].sort(),
      subagentThreadIds: [...subagentThreadIds],
      textSample: joinedText.slice(0, 2000),
    },
  };
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function collectTexts(node, out, depth = 0) {
  if (depth > 8 || node == null) return;
  if (typeof node === "string") {
    if (node.length > 0 && node.length < 20_000) out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectTexts(item, out, depth + 1);
    return;
  }
  if (!isRecord(node)) return;
  for (const [key, value] of Object.entries(node)) {
    if (
      key === "text" ||
      key === "content" ||
      key === "message" ||
      key === "output" ||
      key === "delta" ||
      key === "summary"
    ) {
      collectTexts(value, out, depth + 1);
    } else if (key === "item" || key === "turn" || key === "items" || key === "parts") {
      collectTexts(value, out, depth + 1);
    }
  }
}

/**
 * Soft replay: compare recorded checklist keys / required methods against a new live run.
 * Used when re-running live smoke to detect regressions vs baseline fixture.
 */
export function diffAgainstBaseline(baselineSummary, currentEvaluation) {
  const regressions = [];
  for (const key of CHECKLIST_KEYS) {
    const wasOk = baselineSummary?.checklist?.[key]?.ok === true;
    const nowOk = currentEvaluation.checklist[key]?.ok === true;
    if (wasOk && !nowOk) {
      regressions.push({
        key,
        detail: `baseline ok → now fail: ${currentEvaluation.checklist[key]?.detail}`,
      });
    }
  }
  const baselineMethods = new Set(baselineSummary?.observed?.methods ?? []);
  const requiredSticky = ["turn/started", "turn/completed", "item/started", "item/completed"];
  for (const method of requiredSticky) {
    if (baselineMethods.has(method) && !currentEvaluation.observed.methods.includes(method)) {
      regressions.push({ key: `method:${method}`, detail: "baseline had method, current run missing it" });
    }
  }
  return {
    ok: regressions.length === 0,
    regressions,
  };
}
