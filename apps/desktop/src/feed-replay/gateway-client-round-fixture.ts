import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentEvent } from "@eco/shared";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

export type GatewayClientId = "codex" | "claude" | "pi";
export type GatewayProfileId = "packy_responses" | "packy_anthropic" | "longcat_chat";

export const RECORDING_CELL_SPECS: ReadonlyArray<{ client: GatewayClientId; profileId: GatewayProfileId }> = [
  { client: "codex", profileId: "packy_responses" },
  { client: "codex", profileId: "packy_anthropic" },
  { client: "codex", profileId: "longcat_chat" },
  { client: "claude", profileId: "packy_responses" },
  { client: "claude", profileId: "packy_anthropic" },
  { client: "claude", profileId: "longcat_chat" },
  { client: "pi", profileId: "packy_responses" },
  { client: "pi", profileId: "packy_anthropic" },
  { client: "pi", profileId: "longcat_chat" },
];

export function cellKey(client: GatewayClientId, profileId: GatewayProfileId): string {
  return `${client}/${profileId}`;
}

export interface GatewayClientRoundCell {
  client: GatewayClientId;
  profileId: GatewayProfileId;
  runId: string;
  dir: string;
  marker: string;
  prompt: string;
  checklistOk: boolean;
  workspaceFiles: Record<string, string>;
  skillsListResult?: unknown;
}

function extractMarkerFromPrompt(prompt: string): string | undefined {
  const match = prompt.match(/Marker=([A-Z0-9]+)/);
  return match?.[1];
}

function extractMarkerFromChecklist(dir: string): string | undefined {
  const checklistPath = path.join(dir, "checklist.json");
  if (!existsSync(checklistPath)) {
    return undefined;
  }
  const checklist = JSON.parse(readFileSync(checklistPath, "utf8")) as {
    checklist?: { marker_in_assistant?: { detail?: string } };
  };
  const detail = checklist.checklist?.marker_in_assistant?.detail ?? "";
  const match = detail.match(/marker\s+([A-Z0-9]+)/i);
  return match?.[1];
}

function readJsonlField<T>(filePath: string, field: "event" | "message"): T[] {
  if (!existsSync(filePath)) {
    return [];
  }
  return readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .map((row) => row[field] as T)
    .filter((value) => value != null);
}

export function resolveClientRoundFixtureRoot(configured?: string): string {
  const explicit =
    configured?.trim() ||
    process.env.ECO_GATEWAY_CLIENT_ROUND_FIXTURE?.trim() ||
    process.env.ECO_DEMO_FEED_REPLAY_FIXTURE?.trim();
  if (explicit) {
    if (path.isAbsolute(explicit) && existsSync(explicit)) {
      return explicit;
    }
    const under = path.join(repoRoot, "scripts/gateway-http-round/fixtures", explicit);
    if (existsSync(under)) {
      return under;
    }
    const resolved = path.resolve(explicit);
    if (existsSync(resolved)) {
      return resolved;
    }
    throw new Error(`Gateway client-round fixture not found: ${explicit}`);
  }

  const pointerPath = path.join(repoRoot, "scripts/gateway-http-round/fixtures/latest-client-round.json");
  if (existsSync(pointerPath)) {
    const pointer = JSON.parse(readFileSync(pointerPath, "utf8")) as { path?: string; runId?: string };
    const dir =
      pointer.path && existsSync(pointer.path)
        ? pointer.path
        : pointer.runId
          ? path.join(path.dirname(pointerPath), pointer.runId)
          : undefined;
    if (dir && existsSync(dir)) {
      return dir;
    }
  }

  throw new Error(
    "No gateway client-round fixture found. Run: bun run gateway-http-round:record:all",
  );
}

function loadCellFromDir(
  runId: string,
  runDir: string,
  client: GatewayClientId,
  profileId: GatewayProfileId,
): GatewayClientRoundCell | undefined {
  const dir = path.join(runDir, client, profileId);
  const checklistPath = path.join(dir, "checklist.json");
  if (!existsSync(checklistPath)) {
    return undefined;
  }

  const checklist = JSON.parse(readFileSync(checklistPath, "utf8")) as { ok?: boolean };
  const summaryPath = path.join(runDir, "summary.json");
  const metaPath = path.join(runDir, "meta.json");
  const summary = existsSync(summaryPath)
    ? (JSON.parse(readFileSync(summaryPath, "utf8")) as Record<string, unknown>)
    : {};
  const meta = existsSync(metaPath)
    ? (JSON.parse(readFileSync(metaPath, "utf8")) as Record<string, unknown>)
    : {};
  const workspaceFiles = existsSync(path.join(dir, "workspace-files.json"))
    ? (JSON.parse(readFileSync(path.join(dir, "workspace-files.json"), "utf8")) as Record<string, string>)
    : {};
  const skillsListResult = existsSync(path.join(dir, "skills-list.json"))
    ? JSON.parse(readFileSync(path.join(dir, "skills-list.json"), "utf8"))
    : undefined;
  const prompt = existsSync(path.join(dir, "prompt.txt"))
    ? readFileSync(path.join(dir, "prompt.txt"), "utf8")
    : "";

  return {
    client,
    profileId,
    runId,
    dir,
    marker:
      extractMarkerFromPrompt(prompt) ??
      extractMarkerFromChecklist(dir) ??
      String(summary.marker ?? meta.marker ?? ""),
    prompt,
    checklistOk: checklist.ok === true,
    workspaceFiles,
    ...(skillsListResult !== undefined && { skillsListResult }),
  };
}

function isFixtureRunDir(runDir: string): boolean {
  if (existsSync(path.join(runDir, "summary.json"))) {
    return true;
  }
  for (const spec of RECORDING_CELL_SPECS) {
    if (existsSync(path.join(runDir, spec.client, spec.profileId, "checklist.json"))) {
      return true;
    }
  }
  return false;
}

/** Pick cells from the primary fixture run, then fill missing matrix slots from other runs. */
export function discoverGatewayClientRoundCells(fixtureRoot?: string): Map<string, GatewayClientRoundCell> {
  const cells = new Map<string, GatewayClientRoundCell>();

  const loadRunDir = (runDir: string): void => {
    const runId = path.basename(runDir);
    for (const spec of RECORDING_CELL_SPECS) {
      const key = cellKey(spec.client, spec.profileId);
      if (cells.has(key)) {
        continue;
      }
      const loaded = loadCellFromDir(runId, runDir, spec.client, spec.profileId);
      if (loaded) {
        cells.set(key, loaded);
      }
    }
  };

  if (fixtureRoot) {
    loadRunDir(fixtureRoot);
    return cells;
  }

  let primaryDir: string | undefined;
  try {
    primaryDir = resolveClientRoundFixtureRoot();
  } catch {
    primaryDir = undefined;
  }
  if (primaryDir) {
    loadRunDir(primaryDir);
  }

  const fixturesRoot = path.join(repoRoot, "scripts/gateway-http-round/fixtures");
  const supplementalRunDirs = readdirSync(fixturesRoot)
    .map((entry) => path.join(fixturesRoot, entry))
    .filter((full) => {
      try {
        return full !== primaryDir && statSync(full).isDirectory() && isFixtureRunDir(full);
      } catch {
        return false;
      }
    })
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);

  for (const runDir of supplementalRunDirs) {
    loadRunDir(runDir);
    if (cells.size >= RECORDING_CELL_SPECS.length) {
      break;
    }
  }

  return cells;
}

export function loadGatewayClientRoundCell(input: {
  client: GatewayClientId;
  profileId: GatewayProfileId;
  fixtureRoot?: string;
}): GatewayClientRoundCell {
  const cells = discoverGatewayClientRoundCells(input.fixtureRoot);
  const key = cellKey(input.client, input.profileId);
  const cell = cells.get(key);
  if (!cell) {
    throw new Error(`No recorded cell for ${key}. Run gateway-http-round:record:all`);
  }
  return cell;
}

export function loadAgentEventsFromCell(cell: GatewayClientRoundCell): AgentEvent[] {
  return readJsonlField<AgentEvent>(path.join(cell.dir, "agent-events.jsonl"), "event");
}

export function hasRpcLog(cell: GatewayClientRoundCell): boolean {
  return existsSync(path.join(cell.dir, "rpc-log.jsonl"));
}

/** User-facing protocol aliases → internal profileId (fixture dir name). */
export const GATEWAY_PROFILE_ALIASES: Record<string, GatewayProfileId> = {
  responses: "packy_responses",
  packy_responses: "packy_responses",
  messages: "packy_anthropic",
  anthropic: "packy_anthropic",
  packy_anthropic: "packy_anthropic",
  chat_completions: "longcat_chat",
  chat: "longcat_chat",
  longcat_chat: "longcat_chat",
};

export const GATEWAY_PROFILE_DISPLAY_NAMES: Record<GatewayProfileId, string> = {
  packy_responses: "responses",
  packy_anthropic: "messages",
  longcat_chat: "chat_completions",
};

export function resolveGatewayProfileId(raw: string): GatewayProfileId | undefined {
  const key = raw.trim().toLowerCase();
  return GATEWAY_PROFILE_ALIASES[key];
}

export function formatFeedReplaySelectorHelp(): string {
  return [
    "Selectors:",
    "  matrix | all | 9                    — all discovered 3×3 cells",
    "  <client>:<protocol>                 — e.g. claude:responses, codex/messages",
    "  <client>:<p1>/<p2>/<p3>             — e.g. claude:responses/messages/chat_completions",
    "  <client>                            — e.g. claude (all 3 protocols for that client)",
    "  <protocol>                          — e.g. responses (all clients on that protocol)",
    "",
    "Protocol aliases: responses, messages (anthropic), chat_completions (chat)",
    "Legacy names still work: packy_responses, packy_anthropic, longcat_chat",
  ].join("\n");
}

export type FeedReplaySelectorMode = "matrix" | "single" | "client-row" | "profile-column" | "client-all";

export interface FeedReplaySelectorParseResult {
  mode: FeedReplaySelectorMode;
  client?: GatewayClientId;
  profileId?: GatewayProfileId;
  profileIds?: GatewayProfileId[];
  fixtureRoot?: string;
}

export function parseFeedReplaySelector(raw: string | undefined): FeedReplaySelectorParseResult {
  const value = raw?.trim();
  if (!value || value === "matrix" || value === "all" || value === "9") {
    return { mode: "matrix" };
  }

  const fixtureRoot = process.env.ECO_DEMO_FEED_REPLAY_FIXTURE?.trim() || process.env.ECO_GATEWAY_CLIENT_ROUND_FIXTURE?.trim();
  const fixtureRootOpt = fixtureRoot ? { fixtureRoot } : {};

  const clientRowMatch = value.match(/^(codex|claude|pi)[:/](.+)$/i);
  if (clientRowMatch) {
    const client = clientRowMatch[1]!.toLowerCase() as GatewayClientId;
    const profileParts = clientRowMatch[2]!
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean);
    const profileIds = [
      ...new Set(
        profileParts
          .map((part) => resolveGatewayProfileId(part))
          .filter((profileId): profileId is GatewayProfileId => profileId != null),
      ),
    ];
    if (profileIds.length === 0) {
      throw new Error(
        `Unknown protocol in ${value}. Expected responses, messages, chat_completions.\n${formatFeedReplaySelectorHelp()}`,
      );
    }
    if (profileIds.length === 1) {
      const profileId = profileIds[0];
      if (!profileId) {
        throw new Error(`Unknown protocol in ${value}`);
      }
      return { mode: "single", client, profileId, ...fixtureRootOpt };
    }
    return { mode: "client-row", client, profileIds, ...fixtureRootOpt };
  }

  const clientOnlyMatch = value.match(/^(codex|claude|pi)$/i);
  if (clientOnlyMatch) {
    return {
      mode: "client-all",
      client: clientOnlyMatch[1]!.toLowerCase() as GatewayClientId,
      ...fixtureRootOpt,
    };
  }

  const profileOnly = resolveGatewayProfileId(value);
  if (profileOnly) {
    return { mode: "profile-column", profileId: profileOnly, ...fixtureRootOpt };
  }

  if (existsSync(value)) {
    return { mode: "matrix", fixtureRoot: value };
  }

  const under = path.join(repoRoot, "scripts/gateway-http-round/fixtures", value);
  if (existsSync(under)) {
    return { mode: "matrix", fixtureRoot: under };
  }

  throw new Error(`Invalid feed replay selector: ${value}\n${formatFeedReplaySelectorHelp()}`);
}
