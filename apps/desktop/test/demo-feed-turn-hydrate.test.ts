import { describe, expect, test } from "bun:test";
import { hydrateDemoFeedReplayTurnDetails } from "../src/demo/feed-replay-turn-hydrate";
import { replayGatewayClientRoundCellFeed } from "../src/feed-replay/gateway-client-round-feed-replay";
import {
  discoverGatewayClientRoundCells,
  loadGatewayClientRoundCell,
} from "../src/feed-replay/gateway-client-round-fixture";
import { buildThreadRunProjectionViewModel } from "../src/renderer/thread-run-projection-view";
import { buildThreadRunTurnFeedSections } from "../src/renderer/thread-run-turn-feed";

function hasClaudeResponsesCell(): boolean {
  return discoverGatewayClientRoundCells().has("claude/packy_responses");
}

describe.skipIf(!hasClaudeResponsesCell())("demo feed replay turn hydrate", () => {
  test("hydrates Skill / file / MCP tool process entries for completed turn", async () => {
    const cell = loadGatewayClientRoundCell({ client: "claude", profileId: "packy_responses" });
    const result = await replayGatewayClientRoundCellFeed(cell);
    const hydrated = hydrateDemoFeedReplayTurnDetails(result.projection, result.fullProjection);

    const vm = buildThreadRunProjectionViewModel(hydrated, {
      id: result.threadId,
      prompt: cell.prompt,
    });
    const turnSections = buildThreadRunTurnFeedSections(vm.mainFeedEntries, hydrated).filter(
      (section) => section.kind === "turn",
    );
    expect(turnSections.length).toBe(1);

    const processTexts = turnSections[0]?.processEntries
      .flatMap((entry) => {
        if (entry.kind === "timeline" || entry.kind === "agent-echo") {
          return [entry.item.text];
        }
        if (entry.kind === "tool-group") {
          return entry.entries.map((child) => child.item.text);
        }
        return [];
      })
      .join("\n");

    expect(processTexts).toContain("smoke-skill");
    expect(processTexts).toContain("smoke-note.txt");
    expect(processTexts).toContain("smoke_ping");

    const detailLoaded = turnSections[0]?.processEntries.some(
      (entry) =>
        (entry.kind === "timeline" || entry.kind === "agent-echo") && entry.item.contentLoaded === true,
    );
    expect(detailLoaded).toBe(true);
  });

  test("longcat chat_completions keeps tool process entries visible after hydrate", async () => {
    const cell = loadGatewayClientRoundCell({ client: "claude", profileId: "longcat_chat" });
    const result = await replayGatewayClientRoundCellFeed(cell);
    const hydrated = hydrateDemoFeedReplayTurnDetails(result.projection, result.fullProjection);
    const vm = buildThreadRunProjectionViewModel(hydrated, {
      id: result.threadId,
      prompt: cell.prompt,
    });

    const processTexts = vm.mainFeedEntries
      .flatMap((entry) => {
        if (entry.kind === "timeline" || entry.kind === "agent-echo") {
          return [entry.item.text];
        }
        if (entry.kind === "tool-group") {
          return entry.entries.map((child) => child.item.text);
        }
        return [];
      })
      .join("\n");

    expect(processTexts.length).toBeGreaterThan(0);
  });
});
