import { describe, expect, test } from "bun:test";
import { applyUpstreamUserAgent, DEFAULT_UPSTREAM_USER_AGENT } from "../src/upstream/user-agent.js";

describe("applyUpstreamUserAgent", () => {
  test("global override wins over client UA", () => {
    const headers: Record<string, string> = {};
    applyUpstreamUserAgent(headers, new Headers({ "user-agent": "codex/1" }), "custom-gateway/9");
    expect(headers["user-agent"]).toBe("custom-gateway/9");
  });

  test("passthrough client UA when override unset", () => {
    const headers: Record<string, string> = {};
    applyUpstreamUserAgent(headers, new Headers({ "user-agent": "codex/2" }));
    expect(headers["user-agent"]).toBe("codex/2");
  });

  test("falls back to Eco default when neither override nor client UA", () => {
    const headers: Record<string, string> = {};
    applyUpstreamUserAgent(headers, new Headers());
    expect(headers["user-agent"]).toBe(DEFAULT_UPSTREAM_USER_AGENT);
  });

  test("blank override falls through to client UA", () => {
    const headers: Record<string, string> = {};
    applyUpstreamUserAgent(headers, new Headers({ "user-agent": "codex/3" }), "  ");
    expect(headers["user-agent"]).toBe("codex/3");
  });
});
