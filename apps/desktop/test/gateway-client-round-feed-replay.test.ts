import { describe, expect, test } from "bun:test";
import {
  RECORDING_CELL_SPECS,
  cellKey,
  discoverGatewayClientRoundCells,
  loadGatewayClientRoundCell,
} from "../src/feed-replay/gateway-client-round-fixture";
import { replayGatewayClientRoundCellFeed, replayGatewayClientRoundFeedSelector, listDiscoveredMatrixCells } from "../src/feed-replay/gateway-client-round-feed-replay";
import { hydrateDemoFeedReplayTurnDetails } from "../src/demo/feed-replay-turn-hydrate";

function hasAnyClientRoundCells(): boolean {
  return discoverGatewayClientRoundCells().size > 0;
}

describe.skipIf(!hasAnyClientRoundCells())("gateway client-round feed replay", () => {
  test("discovers recorded matrix cells", () => {
    const cells = listDiscoveredMatrixCells();
    expect(cells.length).toBeGreaterThan(0);
    console.log(
      `discovered ${cells.length}/${RECORDING_CELL_SPECS.length} cells: ${cells.map((cell) => cellKey(cell.client, cell.profileId)).join(", ")}`,
    );
  });

  test("replays each discovered cell into a non-empty feed projection", async () => {
    const cells = listDiscoveredMatrixCells();
    for (const cell of cells) {
      const result = await replayGatewayClientRoundCellFeed(cell);
      expect(result.persistedEvents.length, `${cellKey(cell.client, cell.profileId)} events`).toBeGreaterThan(2);
      expect(result.projection.timeline.length, `${cellKey(cell.client, cell.profileId)} timeline`).toBeGreaterThan(0);
      expect(result.feedTimelineIds.length).toBeGreaterThan(0);
      expect(cell.checklistOk, `${cellKey(cell.client, cell.profileId)} recorded checklist`).toBe(true);
      expect(
        result.scenarioChecklistOk,
        `${cellKey(cell.client, cell.profileId)} replay checklist: ${result.scenarioFailed.join(", ")}`,
      ).toBe(true);

      const joined = result.persistedEvents.map((event) => event.message).join("\n");
      expect(
        joined.includes(cell.marker) ||
          joined.includes(`SMOKE_DONE:${cell.marker}`) ||
          joined.includes(`SMOKE_CHILD:${cell.marker}`),
      ).toBe(true);
      expect(result.persistedEvents.some((event) => event.eventType === "message.final")).toBe(true);
      const hasToolProcess = result.persistedEvents.some(
        (event) => event.eventType === "tool.started" || event.eventType === "tool.completed",
      );
      if (cell.client === "codex" && cell.profileId === "longcat_chat" && !hasToolProcess) {
        expect.fail(`${cellKey(cell.client, cell.profileId)} replay missing tool process events (${cell.runId})`);
      }
      expect(hasToolProcess).toBe(true);
    }
  }, 120_000);

  test("claude packy_responses replay uses one turn section and closes subagent lifecycle", async () => {
    const cell = loadGatewayClientRoundCell({ client: "claude", profileId: "packy_responses" });
    const result = await replayGatewayClientRoundCellFeed(cell);
    const { buildThreadRunProjectionViewModel } = await import("../src/renderer/thread-run-projection-view");
    const { buildThreadRunTurnFeedSections } = await import("../src/renderer/thread-run-turn-feed");
    const vm = buildThreadRunProjectionViewModel(result.projection, {
      id: result.threadId,
      prompt: cell.prompt,
    });
    const turnSections = buildThreadRunTurnFeedSections(vm.mainFeedEntries, result.projection).filter(
      (section) => section.kind === "turn",
    );
    expect(turnSections.length).toBe(1);
    expect(result.projection.agents.some((agent) => agent.status === "stopped")).toBe(true);
    expect(result.persistedEvents.some((event) => event.eventType === "agent.stopped")).toBe(true);
  });

  test("codex responses closes subagent lifecycle and hydrates subagent timeline", async () => {
    const cell = loadGatewayClientRoundCell({ client: "codex", profileId: "packy_responses" });
    const result = await replayGatewayClientRoundCellFeed(cell);
    const hydrated = hydrateDemoFeedReplayTurnDetails(result.projection, result.fullProjection, { codex: true });
    const subagent = hydrated.agents.find((agent) => agent.kind === "subagent");
    expect(subagent?.status).toBe("stopped");
    expect(subagent?.timeline.length).toBeGreaterThan(0);
    expect(result.persistedEvents.some((event) => event.eventType === "agent.stopped")).toBe(true);
    expect(hydrated.agents.some((agent) => agent.timeline.some((item) => item.text.includes("SMOKE_CHILD")))).toBe(
      true,
    );
    const { buildThreadRunProjectionViewModel } = await import("../src/renderer/thread-run-projection-view");
    const vm = buildThreadRunProjectionViewModel(hydrated, {
      id: result.threadId,
      prompt: cell.prompt,
    });
    const cardIndex = vm.mainFeedEntries.findIndex((entry) => entry.kind === "agent-card");
    const doneEntries = vm.mainFeedEntries.filter(
      (entry): entry is Extract<typeof entry, { kind: "timeline" }> =>
        entry.kind === "timeline" && /^SMOKE_DONE:/.test(entry.item.text.trim()),
    );
    expect(cardIndex).toBeGreaterThanOrEqual(0);
    expect(doneEntries.length).toBeGreaterThan(0);
    const doneEntry = doneEntries[doneEntries.length - 1];
    expect(vm.mainFeedEntries.indexOf(doneEntry!)).toBeGreaterThan(cardIndex);
    const cardEntry = vm.mainFeedEntries[cardIndex];
    if (cardEntry?.kind === "agent-card" && doneEntry) {
      expect(cardEntry.at.localeCompare(doneEntry.at)).toBeLessThanOrEqual(0);
    }
  });

  test("pi packy_responses closes subagent lifecycle and hydrates subagent timeline", async () => {
    const cell = loadGatewayClientRoundCell({ client: "pi", profileId: "packy_responses" });
    const result = await replayGatewayClientRoundCellFeed(cell);
    const hydrated = hydrateDemoFeedReplayTurnDetails(result.projection, result.fullProjection);
    const subagent = hydrated.agents.find((agent) => agent.kind === "subagent");
    expect(subagent?.status).toBe("stopped");
    expect(subagent?.timeline.length).toBeGreaterThan(0);
    expect(result.persistedEvents.some((event) => event.eventType === "agent.stopped")).toBe(true);
    expect(hydrated.agents.some((agent) => agent.timeline.some((item) => item.text.includes("SMOKE_CHILD")))).toBe(
      true,
    );
    const { buildThreadRunProjectionViewModel } = await import("../src/renderer/thread-run-projection-view");
    const vm = buildThreadRunProjectionViewModel(hydrated, {
      id: result.threadId,
      prompt: cell.prompt,
    });
    const cardIndex = vm.mainFeedEntries.findIndex((entry) => entry.kind === "agent-card");
    const doneEntries = vm.mainFeedEntries.filter(
      (entry): entry is Extract<typeof entry, { kind: "timeline" }> =>
        entry.kind === "timeline" && /^SMOKE_DONE:/.test(entry.item.text.trim()),
    );
    expect(cardIndex).toBeGreaterThanOrEqual(0);
    expect(doneEntries.length).toBeGreaterThan(0);
    const doneEntry = doneEntries[doneEntries.length - 1];
    expect(vm.mainFeedEntries.indexOf(doneEntry!)).toBeGreaterThan(cardIndex);
    const cardEntry = vm.mainFeedEntries[cardIndex];
    if (cardEntry?.kind === "agent-card" && doneEntry) {
      expect(cardEntry.at.localeCompare(doneEntry.at)).toBeLessThanOrEqual(0);
    }
  });

  test("codex longcat_chat replay emits tool process events from rpc-log", async () => {
    const cell = loadGatewayClientRoundCell({ client: "codex", profileId: "longcat_chat" });
    const result = await replayGatewayClientRoundCellFeed(cell);
    expect(result.persistedEvents.some((event) => event.eventType === "tool.started")).toBe(true);
    expect(result.persistedEvents.some((event) => event.eventType.startsWith("agent."))).toBe(true);
  });

  test("codex responses feed sections stay in chronological order", async () => {
    const cells = discoverGatewayClientRoundCells();
    const cell = cells.get("codex/packy_responses");
    if (!cell) {
      return;
    }
    const result = await replayGatewayClientRoundCellFeed(cell);
    const hydrated = hydrateDemoFeedReplayTurnDetails(result.projection, result.fullProjection, { codex: true });
    const { buildThreadRunProjectionViewModel } = await import("../src/renderer/thread-run-projection-view");
    const { buildThreadRunTurnFeedSections } = await import("../src/renderer/thread-run-turn-feed");
    const vm = buildThreadRunProjectionViewModel(hydrated, {
      id: result.threadId,
      prompt: cell.prompt,
    });
    const sections = buildThreadRunTurnFeedSections(vm.mainFeedEntries, hydrated);
    const sectionSortKeys = sections.map((section) => {
      if (section.kind === "entry") {
        return { at: section.entry.at, sequence: section.entry.sequence };
      }
      const entries = [
        ...section.processEntries,
        ...(section.finalEntry ? [section.finalEntry] : []),
      ];
      const first = entries.reduce(
        (earliest, entry) =>
          !earliest || entry.at.localeCompare(earliest.at) < 0 ? entry : earliest,
        undefined as (typeof entries)[number] | undefined,
      );
      return { at: first?.at ?? section.attempt.startedAt, sequence: first?.sequence ?? 0 };
    });
    for (let index = 1; index < sectionSortKeys.length; index += 1) {
      const left = sectionSortKeys[index - 1];
      const right = sectionSortKeys[index];
      if (!left || !right) {
        continue;
      }
      expect(right.at.localeCompare(left.at)).toBeGreaterThanOrEqual(0);
    }
    const firstEntry = sections[0];
    expect(firstEntry?.kind).toBe("entry");
    if (firstEntry?.kind === "entry" && firstEntry.entry.kind === "timeline") {
      expect(firstEntry.entry.item.text).toContain("conversation-round scenario smoke");
    }
  });

  test("selector replay returns at least one result", async () => {
    const results = await replayGatewayClientRoundFeedSelector("matrix");
    expect(results.length).toBeGreaterThan(0);
  }, 120_000);
});
