import { describe, expect, test } from "bun:test";
import {
  CODEX_TURN_METADATA_HEADER,
  parseCodexTurnMetadataHeader,
} from "../src/codex-turn-metadata.js";

function headersWithMetadata(metadata: unknown): Headers {
  return new Headers({
    [CODEX_TURN_METADATA_HEADER]: JSON.stringify(metadata),
  });
}

describe("Codex turn metadata", () => {
  test("parses the 0.142.5 root turn header", () => {
    expect(
      parseCodexTurnMetadataHeader(
        headersWithMetadata({
          session_id: "session_1",
          thread_id: "codex_root",
          turn_id: "turn_1",
          request_kind: "turn",
        }),
      ),
    ).toEqual({
      threadId: "codex_root",
      turnId: "turn_1",
      requestKind: "turn",
    });
  });

  test("preserves child thread, parent, and subagent identity", () => {
    expect(
      parseCodexTurnMetadataHeader(
        headersWithMetadata({
          thread_id: "codex_child",
          turn_id: "turn_child",
          parent_thread_id: "codex_root",
          subagent_kind: "collab_spawn",
          request_kind: "turn",
        }),
      ),
    ).toEqual({
      threadId: "codex_child",
      turnId: "turn_child",
      parentThreadId: "codex_root",
      subagentKind: "collab_spawn",
      requestKind: "turn",
    });
  });

  test("rejects malformed JSON and missing turn identity", () => {
    expect(
      parseCodexTurnMetadataHeader(
        new Headers({ [CODEX_TURN_METADATA_HEADER]: "{not-json" }),
      ),
    ).toBeUndefined();
    expect(
      parseCodexTurnMetadataHeader(
        headersWithMetadata({ thread_id: "codex_root", request_kind: "turn" }),
      ),
    ).toBeUndefined();
    expect(
      parseCodexTurnMetadataHeader(
        headersWithMetadata({ thread_id: " ", turn_id: "turn_1", request_kind: "turn" }),
      ),
    ).toBeUndefined();
    expect(
      parseCodexTurnMetadataHeader(
        headersWithMetadata({ thread_id: "codex_root", turn_id: "turn_1" }),
      ),
    ).toBeUndefined();
  });

  test("rejects invalid optional fields and unsupported request kinds", () => {
    for (const [key, value] of [
      ["parent_thread_id", ""],
      ["parent_thread_id", null],
      ["subagent_kind", 7],
      ["subagent_kind", "   "],
      ["request_kind", false],
      ["request_kind", "memory"],
      ["request_kind", "subagent_turn"],
    ] as const) {
      expect(
        parseCodexTurnMetadataHeader(
          headersWithMetadata({
            thread_id: "codex_root",
            turn_id: "turn_1",
            request_kind: "turn",
            [key]: value,
          }),
        ),
      ).toBeUndefined();
    }
  });

  test("accepts every request kind that carries Codex turn identity", () => {
    for (const requestKind of ["turn", "prewarm", "compaction"] as const) {
      expect(
        parseCodexTurnMetadataHeader(
          headersWithMetadata({
            thread_id: "codex_root",
            turn_id: `turn_${requestKind}`,
            request_kind: requestKind,
          }),
        )?.requestKind,
      ).toBe(requestKind);
    }
  });
});
