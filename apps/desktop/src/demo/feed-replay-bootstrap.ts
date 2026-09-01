import type { ThreadSummary } from "../shared/ipc";
import type { ThreadRunProjectionSnapshot } from "../shared/thread-run-projection";
import { DEMO_WORKSPACE_PATH } from "./constants";
import { demoLog } from "./demo-log";
import { GATEWAY_PROFILE_DISPLAY_NAMES } from "../feed-replay/gateway-client-round-fixture";
import { replayGatewayClientRoundFeedSelector } from "../feed-replay/gateway-client-round-feed-replay";
import { hydrateDemoFeedReplayTurnDetails } from "./feed-replay-turn-hydrate";

export interface DemoFeedReplayState {
  enabled: boolean;
  threads: ThreadSummary[];
  /** Feed skeleton projections (`mode: feed`). */
  projections: Map<string, ThreadRunProjectionSnapshot>;
  /** Full projections for detail RPC (subagent drawer). */
  fullProjections: Map<string, ThreadRunProjectionSnapshot>;
  defaultThreadId?: string;
  loadError?: string;
}

let cachedState: DemoFeedReplayState | undefined;

export function resetDemoFeedReplayStateForTests(): void {
  cachedState = undefined;
}

export function getDemoFeedReplayState(): DemoFeedReplayState {
  if (cachedState) {
    return cachedState;
  }

  if (!process.env.ECO_DEMO_FEED_REPLAY?.trim()) {
    cachedState = { enabled: false, threads: [], projections: new Map(), fullProjections: new Map() };
    return cachedState;
  }

  throw new Error(
    "Feed replay state not initialized. Call initDemoFeedReplayState() before registering demo IPC handlers.",
  );
}

export async function initDemoFeedReplayState(): Promise<DemoFeedReplayState> {
  if (cachedState) {
    return cachedState;
  }

  if (!process.env.ECO_DEMO_FEED_REPLAY?.trim()) {
    cachedState = { enabled: false, threads: [], projections: new Map(), fullProjections: new Map() };
    return cachedState;
  }

  try {
    const results = await replayGatewayClientRoundFeedSelector();
    if (results.length === 0) {
      cachedState = {
        enabled: true,
        threads: [],
        projections: new Map(),
        fullProjections: new Map(),
        loadError: "No gateway client-round cells found for feed replay.",
      };
      return cachedState;
    }

    const threads: ThreadSummary[] = [];
    const projections = new Map<string, ThreadRunProjectionSnapshot>();
    const fullProjections = new Map<string, ThreadRunProjectionSnapshot>();
    const now = new Date().toISOString();

    for (const result of results) {
      const title = `Replay · ${result.cell.client} · ${GATEWAY_PROFILE_DISPLAY_NAMES[result.cell.profileId]}`;
      threads.push({
        id: result.threadId,
        title,
        prompt: result.cell.prompt.split("\n")[0] ?? title,
        workspacePath: DEMO_WORKSPACE_PATH,
        status: "idle",
        message: result.scenarioChecklistOk ? "replay ok" : `replay checklist: ${result.scenarioFailed.join(", ")}`,
        createdAt: now,
        updatedAt: now,
      });
      fullProjections.set(result.threadId, result.fullProjection);
      projections.set(
        result.threadId,
        hydrateDemoFeedReplayTurnDetails(result.projection, result.fullProjection, {
          codex: result.cell.client === "codex",
        }),
      );
    }

    const defaultThreadId = threads[0]?.id;
    cachedState = {
      enabled: true,
      threads,
      projections,
      fullProjections,
      ...(defaultThreadId ? { defaultThreadId } : {}),
    };
    demoLog(
      `[eco-demo] feed replay loaded ${results.length} cell(s): ${results.map((row) => `${row.cell.client}/${row.cell.profileId}`).join(", ")}`,
    );
    return cachedState;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedState: DemoFeedReplayState = {
      enabled: true,
      threads: [],
      projections: new Map(),
      fullProjections: new Map(),
      loadError: message,
    };
    cachedState = failedState;
    demoLog(`[eco-demo] feed replay failed: ${message}`);
    return failedState;
  }
}

export function resolveDemoFeedReplayProjection(threadId: string): ThreadRunProjectionSnapshot | undefined {
  return getDemoFeedReplayState().projections.get(threadId);
}

export function resolveDemoFeedReplayFullProjection(threadId: string): ThreadRunProjectionSnapshot | undefined {
  return getDemoFeedReplayState().fullProjections.get(threadId);
}
