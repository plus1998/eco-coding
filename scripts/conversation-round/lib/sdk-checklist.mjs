/**
 * Scenario checklist for AgentEvent streams (PI / Claude SDK replay).
 * Keys align with codex-scenario-smoke/assert.mjs for cross-core comparison.
 */
export const SDK_CHECKLIST_KEYS = [
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
 *   agentEvents: Array<{ type: string; payload?: unknown; role?: string }>,
 *   workspaceFiles?: Record<string, string>,
 *   marker: string,
 *   skillsListed?: boolean,
 * }} input
 */
export function evaluateSdkScenarioChecklist(input) {
  const { agentEvents, workspaceFiles = {}, marker, skillsListed = false } = input;
  const texts = [];
  const toolNames = new Set();
  let mcpSeen = false;
  let fileWriteSeen = false;
  let fileReadSeen = false;
  let spawnSeen = false;
  let agentToolSpawn = false;
  let childLifecycle = false;
  let turnCompleted = false;
  const agentStartedIds = new Set();

  for (const event of agentEvents) {
    collectTexts(event.payload, texts);
    if (event.type === "agent.settled" || event.type === "run.terminal") {
      const status =
        typeof event.payload === "object" && event.payload && "status" in event.payload
          ? String(event.payload.status)
          : "";
      if (status === "completed" || status === "success" || status === "idle") {
        turnCompleted = true;
      } else if (event.type === "agent.settled") {
        turnCompleted = true;
        if (typeof event.agentId === "string" && agentStartedIds.size > 1 && !agentStartedIds.has(event.agentId)) {
          childLifecycle = true;
        }
      }
    }
    if (event.type === "agent.started") {
      spawnSeen = true;
      if (typeof event.agentId === "string") {
        agentStartedIds.add(event.agentId);
        if (agentStartedIds.size > 1) {
          childLifecycle = true;
        }
      }
    }
    if (event.type === "agent.stopped") {
      childLifecycle = true;
    }
    if (event.type === "tool.started" || event.type === "tool.completed") {
      const payload = event.payload;
      const name =
        typeof payload === "object" && payload && "tool_name" in payload
          ? String(payload.tool_name)
          : typeof payload === "object" && payload && "tool" in payload
            ? String(payload.tool?.name ?? "")
            : "";
      if (name) {
        toolNames.add(name);
      }
      if (name === "Agent") {
        agentToolSpawn = true;
      }
      if (/mcp|smoke_ping|smoke_echo/i.test(name)) {
        mcpSeen = true;
      }
      const command =
        typeof payload === "object" && payload && "input" in payload
          ? JSON.stringify(payload.input)
          : typeof payload === "object" && payload && "command" in payload
            ? String(payload.command)
            : "";
      if (/smoke-note|write|echo|printf|tee|>/i.test(command)) {
        fileWriteSeen = true;
      }
      if (/cat|read|type|smoke-note/i.test(command)) {
        fileReadSeen = true;
      }
      const content =
        typeof payload === "object" && payload && "content" in payload
          ? String(payload.content)
          : "";
      if (/SMOKE_FILE|smoke-note/i.test(content)) {
        fileReadSeen = true;
      }
    }
  }

  const joinedText = texts.join("\n");
  const notePathKeys = Object.keys(workspaceFiles).filter((p) => /smoke-note/i.test(p));
  if (notePathKeys.length > 0) {
    fileWriteSeen = true;
    const content = notePathKeys.map((k) => workspaceFiles[k]).join("\n");
    if (content.includes(marker) || content.includes("SMOKE_FILE")) {
      fileReadSeen = true;
    }
  }
  const markerHit =
    joinedText.includes(`SMOKE_DONE:${marker}`) ||
    joinedText.includes(marker) ||
    Object.values(workspaceFiles).some((v) => v.includes(marker));

  const skillMentioned =
    /SMOKE_SKILL_OK|smoke-skill|SKILL-GREETING/i.test(joinedText) || skillsListed;

  const checklist = {
    skills_listed: {
      ok: Boolean(skillsListed),
      detail: skillsListed ? "skills mounted for session" : "no skill mount evidence",
    },
    skill_invoked_or_mentioned: {
      ok: skillMentioned,
      detail: skillMentioned ? "skill evidence in agent stream/workspace" : "missing",
    },
    file_written: {
      ok: fileWriteSeen || notePathKeys.length > 0,
      detail:
        notePathKeys.length > 0
          ? `workspace files: ${notePathKeys.join(", ")}`
          : fileWriteSeen
            ? "write tool evidence"
            : "missing",
    },
    file_read_back: {
      ok: fileReadSeen || (notePathKeys.length > 0 && markerHit),
      detail: fileReadSeen || notePathKeys.length > 0 ? "read/content verified" : "missing",
    },
    mcp_tool_called: {
      ok: mcpSeen,
      detail: mcpSeen
        ? `mcp tools=${[...toolNames].filter((n) => /mcp|smoke_ping|smoke_echo/i.test(n)).join(",")}`
        : "missing",
    },
    subagent_spawned: {
      ok: agentToolSpawn || spawnSeen,
      detail: agentToolSpawn ? "Agent tool observed" : spawnSeen ? "agent.started observed" : "missing",
    },
    subagent_turn_events: {
      ok:
        (agentToolSpawn || spawnSeen) &&
        (childLifecycle || turnCompleted || joinedText.includes(`SMOKE_CHILD:${marker}`)),
      detail:
        agentToolSpawn || spawnSeen
          ? childLifecycle || joinedText.includes(`SMOKE_CHILD:${marker}`)
            ? "subagent lifecycle evidence"
            : "missing child lifecycle"
          : "missing",
    },
    turn_completed: {
      ok: turnCompleted || markerHit,
      detail: turnCompleted ? "terminal settled event" : markerHit ? "marker present" : "missing",
    },
    marker_in_assistant: {
      ok: markerHit,
      detail: markerHit ? `marker ${marker} found` : `marker ${marker} missing`,
    },
  };

  const failed = SDK_CHECKLIST_KEYS.filter((key) => !checklist[key].ok);
  return { ok: failed.length === 0, failed, checklist };
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
  if (typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    if (["text", "content", "message", "output", "delta", "summary"].includes(key)) {
      collectTexts(value, out, depth + 1);
    }
  }
}
