import { describe, expect, test } from "bun:test";
import {
  REASONING_FIELD_CATALOG,
  classifyChatMessageReasoning,
  classifyReasoningDetailType,
  classifyResponsesReasoningItem,
  classifiedToResponsesReasoningFields,
  selectChatFlatReasoningText,
  selectDisplayReasoningText,
} from "../src/reasoning-classify.js";

describe("reasoning-classify", () => {
  test("catalog covers summary/raw/opaque channels", () => {
    const channels = new Set(REASONING_FIELD_CATALOG.map((entry) => entry.channel));
    expect(channels.has("summary")).toBe(true);
    expect(channels.has("raw")).toBe(true);
    expect(channels.has("opaque")).toBe(true);
  });

  test("openrouter detail types classify correctly", () => {
    expect(classifyReasoningDetailType("reasoning.summary")).toBe("summary");
    expect(classifyReasoningDetailType("reasoning.text")).toBe("raw");
    expect(classifyReasoningDetailType("reasoning.encrypted")).toBe("opaque");
  });

  test("chat flat reasoning_content is raw, not summary", () => {
    const classified = classifyChatMessageReasoning({
      role: "assistant",
      reasoning_content: "full chain of thought",
    });
    expect(classified.rawText).toBe("full chain of thought");
    expect(classified.summaryText).toBe("");
    const fields = classifiedToResponsesReasoningFields(classified);
    expect(fields.summary).toEqual([]);
    expect(fields.content).toEqual([{ type: "reasoning_text", text: "full chain of thought" }]);
  });

  test("reasoning_details split summary and text", () => {
    const classified = classifyChatMessageReasoning({
      role: "assistant",
      reasoning_details: [
        { type: "reasoning.summary", text: "short summary" },
        { type: "reasoning.text", text: "raw body" },
        { type: "reasoning.encrypted", data: "cipher" },
      ],
    });
    expect(classified.summaryText).toBe("short summary");
    expect(classified.rawText).toBe("raw body");
    expect(classified.opaqueParts[0]?.data).toBe("cipher");
    expect(selectDisplayReasoningText(classified)).toBe("short summary");
    expect(selectChatFlatReasoningText(classified)).toBe("raw body");
  });

  test("responses item keeps summary and content separate", () => {
    const classified = classifyResponsesReasoningItem({
      summary: [{ type: "summary_text", text: "sum" }],
      content: [{ type: "reasoning_text", text: "raw" }],
      encrypted_content: "enc",
    });
    expect(selectDisplayReasoningText(classified)).toBe("sum");
    expect(selectChatFlatReasoningText(classified)).toBe("raw");
  });
});
