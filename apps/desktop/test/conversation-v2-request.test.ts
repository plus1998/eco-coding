import { describe, expect, test } from "bun:test";
import { CONVERSATION_V2_ERROR } from "@eco/shared";
import {
  buildAcceptedConversationMessageSchedule,
  parseConversationV2Request,
  readOptionalConversationV2String,
  requiredConversationV2Integer,
} from "../src/main/conversation-v2-request";

describe("conversation V2 request validation", () => {
  test("preserves numeric sync cursors while normalizing string fields", () => {
    const request = parseConversationV2Request(
      {
        conversationId: " thread-1 ",
        storeEpoch: " epoch-1 ",
        afterSeq: 12,
      },
      ["conversationId", "storeEpoch", "afterSeq"],
      ["conversationId", "storeEpoch"],
    );

    expect(request).toMatchObject({
      conversationId: "thread-1",
      storeEpoch: "epoch-1",
      afterSeq: 12,
    });
    expect(requiredConversationV2Integer(request.afterSeq, "afterSeq")).toBe(12);
  });

  test("rejects a string cursor instead of silently coercing it", () => {
    expect(() => requiredConversationV2Integer("12", "afterSeq")).toThrow(
      expect.objectContaining({ code: CONVERSATION_V2_ERROR.invalidParams }),
    );
  });

  test("rejects missing required fields", () => {
    expect(() =>
      parseConversationV2Request(
        { conversationId: "thread-1" },
        ["conversationId", "storeEpoch", "afterSeq"],
        ["conversationId", "storeEpoch"],
      ),
    ).toThrow(expect.objectContaining({ code: CONVERSATION_V2_ERROR.invalidParams }));
  });

  test("rejects malformed optional fields instead of dropping them", () => {
    expect(() => readOptionalConversationV2String(42, "beforeCursor")).toThrow(
      expect.objectContaining({ code: CONVERSATION_V2_ERROR.invalidParams }),
    );
    expect(() => readOptionalConversationV2String("   ", "beforeCursor")).toThrow(
      expect.objectContaining({ code: CONVERSATION_V2_ERROR.invalidParams }),
    );
    expect(readOptionalConversationV2String(undefined, "beforeCursor")).toBeUndefined();
  });

  test("rejects unsafe integer cursors", () => {
    expect(() => requiredConversationV2Integer(Number.MAX_SAFE_INTEGER + 1, "afterSeq")).toThrow(
      expect.objectContaining({ code: CONVERSATION_V2_ERROR.invalidParams }),
    );
  });

  test("restores queued image attachments into the runtime scheduling input", () => {
    expect(
      buildAcceptedConversationMessageSchedule({
        messageId: "message_1",
        conversationId: "thread_1",
        turnId: "turn_1",
        role: "user",
        channel: "answer",
        createdSeq: 1,
        versionSeq: 1,
        contentVersion: 0,
        body: "inspect both images",
        status: "queued",
        isDeleted: false,
        attachments: [
          { mediaType: "image/png", path: " /tmp/image.png " },
          { mediaType: "image/jpeg", data: " YWJj " },
        ],
      }),
    ).toEqual({
      conversationId: "thread_1",
      messageId: "message_1",
      turnId: "turn_1",
      text: "inspect both images",
      attachments: [
        { mediaType: "image/png", path: "/tmp/image.png" },
        { mediaType: "image/jpeg", data: "YWJj" },
      ],
    });
  });

  test("rejects a damaged queued attachment instead of resuming as text-only", () => {
    expect(() =>
      buildAcceptedConversationMessageSchedule({
        messageId: "message_1",
        conversationId: "thread_1",
        turnId: "turn_1",
        role: "user",
        channel: "answer",
        createdSeq: 1,
        versionSeq: 1,
        contentVersion: 0,
        body: "do not hide the missing image",
        status: "queued",
        isDeleted: false,
        attachments: [{ mediaType: "image/png", path: "" }],
      }),
    ).toThrow(expect.objectContaining({ code: CONVERSATION_V2_ERROR.integrityFailure }));
  });
});
