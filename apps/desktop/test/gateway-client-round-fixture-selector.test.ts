import { describe, expect, test } from "bun:test";
import {
  formatFeedReplaySelectorHelp,
  parseFeedReplaySelector,
  resolveGatewayProfileId,
} from "../src/feed-replay/gateway-client-round-fixture";

describe("gateway client-round feed replay selector", () => {
  test("resolves protocol aliases", () => {
    expect(resolveGatewayProfileId("responses")).toBe("packy_responses");
    expect(resolveGatewayProfileId("messages")).toBe("packy_anthropic");
    expect(resolveGatewayProfileId("anthropic")).toBe("packy_anthropic");
    expect(resolveGatewayProfileId("chat_completions")).toBe("longcat_chat");
    expect(resolveGatewayProfileId("chat")).toBe("longcat_chat");
  });

  test("parses single cell with protocol alias", () => {
    expect(parseFeedReplaySelector("claude:responses")).toEqual({
      mode: "single",
      client: "claude",
      profileId: "packy_responses",
    });
    expect(parseFeedReplaySelector("pi/messages")).toEqual({
      mode: "single",
      client: "pi",
      profileId: "packy_anthropic",
    });
  });

  test("parses client row with slash-separated protocols", () => {
    expect(parseFeedReplaySelector("claude:responses/messages/chat_completions")).toEqual({
      mode: "client-row",
      client: "claude",
      profileIds: ["packy_responses", "packy_anthropic", "longcat_chat"],
    });
  });

  test("parses client-all and profile-column shorthands", () => {
    expect(parseFeedReplaySelector("claude")).toEqual({ mode: "client-all", client: "claude" });
    expect(parseFeedReplaySelector("responses")).toEqual({
      mode: "profile-column",
      profileId: "packy_responses",
    });
  });

  test("help text mentions protocol aliases", () => {
    expect(formatFeedReplaySelectorHelp()).toContain("responses");
    expect(formatFeedReplaySelectorHelp()).toContain("chat_completions");
  });
});
