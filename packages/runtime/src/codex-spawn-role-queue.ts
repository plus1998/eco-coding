import fsSync from "node:fs";
import path from "node:path";

const QUEUE_DIRECTORY = "eco-pending-spawns";
const PAYLOAD_MAX_AGE_MS = 60 * 60 * 1_000;

export interface CodexSpawnPayload {
  agentRole?: string;
  message?: string;
  taskName?: string;
  toolUseId?: string;
}

export interface CodexSpawnPayloadMatchInput {
  toolUseId?: string;
}

/** Directory of immutable per-call payloads; retained name for API compatibility. */
export function codexSpawnRoleQueuePath(codexHomeDir: string): string {
  return path.join(codexHomeDir, QUEUE_DIRECTORY);
}

export function codexSpawnPayloadPath(codexHomeDir: string, toolUseId: string): string {
  const callId = toolUseId.trim();
  if (!callId) {
    throw new Error("Codex spawn payload requires tool_use_id.");
  }
  const encodedCallId = Buffer.from(callId, "utf8").toString("base64url");
  return path.join(codexSpawnRoleQueuePath(codexHomeDir), `${encodedCallId}.json`);
}

export function clearCodexSpawnPayloadQueueSync(codexHomeDir: string): void {
  fsSync.rmSync(codexSpawnRoleQueuePath(codexHomeDir), { recursive: true, force: true });
}

/** Test/diagnostic helper using the same exclusive per-call write as the hook. */
export function writeCodexSpawnPayloadSync(
  codexHomeDir: string,
  payload: CodexSpawnPayload,
  at = Date.now(),
): string {
  const toolUseId = payload.toolUseId?.trim();
  if (!toolUseId) {
    throw new Error("Codex spawn payload requires tool_use_id.");
  }
  const payloadPath = codexSpawnPayloadPath(codexHomeDir, toolUseId);
  fsSync.mkdirSync(path.dirname(payloadPath), { recursive: true });
  fsSync.writeFileSync(
    payloadPath,
    `${JSON.stringify({
      ...(payload.agentRole?.trim() && { agentRole: payload.agentRole.trim().toLowerCase() }),
      ...(payload.message?.trim() && { message: payload.message.trim() }),
      ...(payload.taskName?.trim() && { task_name: payload.taskName.trim() }),
      tool_use_id: toolUseId,
      at,
    })}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  return payloadPath;
}

/** Consume exactly one immutable payload by the official spawn call id. */
export function dequeueCodexSpawnPayloadMatchingSync(
  codexHomeDir: string,
  input: CodexSpawnPayloadMatchInput,
): CodexSpawnPayload | undefined {
  purgeExpiredCodexSpawnPayloadsSync(codexHomeDir);
  const toolUseId = input.toolUseId?.trim();
  if (!toolUseId) {
    return undefined;
  }
  const payloadPath = codexSpawnPayloadPath(codexHomeDir, toolUseId);
  let raw: string;
  try {
    raw = fsSync.readFileSync(payloadPath, "utf8");
  } catch {
    return undefined;
  }
  const parsed = parseCodexSpawnPayload(raw);
  if (parsed?.payload.toolUseId !== toolUseId) {
    return undefined;
  }
  try {
    fsSync.unlinkSync(payloadPath);
  } catch {
    return undefined;
  }
  return parsed.payload;
}

export function purgeExpiredCodexSpawnPayloadsSync(codexHomeDir: string, now = Date.now()): number {
  const queueDir = codexSpawnRoleQueuePath(codexHomeDir);
  let entries: string[];
  try {
    entries = fsSync.readdirSync(queueDir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.endsWith(".json")) {
      continue;
    }
    const payloadPath = path.join(queueDir, entry);
    let parsed: ParsedCodexSpawnPayload | undefined;
    try {
      parsed = parseCodexSpawnPayload(fsSync.readFileSync(payloadPath, "utf8"));
    } catch {
      // Corrupt queue files are not attribution evidence.
    }
    if (parsed && now - parsed.at <= PAYLOAD_MAX_AGE_MS) {
      continue;
    }
    try {
      fsSync.unlinkSync(payloadPath);
      removed += 1;
    } catch {
      // Another consumer may have removed it.
    }
  }
  return removed;
}

interface ParsedCodexSpawnPayload {
  payload: CodexSpawnPayload;
  at: number;
}

function parseCodexSpawnPayload(raw: string): ParsedCodexSpawnPayload | undefined {
  try {
    const parsed = JSON.parse(raw) as {
      agentRole?: string;
      message?: string;
      task_name?: string;
      tool_use_id?: string;
      at?: number;
    };
    const toolUseId = parsed.tool_use_id?.trim();
    if (!toolUseId || typeof parsed.at !== "number" || !Number.isFinite(parsed.at)) {
      return undefined;
    }
    const agentRole = parsed.agentRole?.trim().toLowerCase();
    const message = parsed.message?.trim();
    const taskName = parsed.task_name?.trim();
    return {
      payload: {
        ...(agentRole && { agentRole }),
        ...(message && { message }),
        ...(taskName && { taskName }),
        toolUseId,
      },
      at: parsed.at,
    };
  } catch {
    return undefined;
  }
}
