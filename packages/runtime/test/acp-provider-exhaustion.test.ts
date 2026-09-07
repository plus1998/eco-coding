import { expect, test } from "bun:test";
import {
  isAcpProviderExhaustionMessage,
  isAcpUnstartedProviderFailure,
  splitAcpProviderExhaustion,
} from "../src/acp-provider-exhaustion.js";

test("detects Cursor RetriableError / resource_exhausted envelopes", () => {
  expect(isAcpProviderExhaustionMessage("Error: RetriableError: [resource_exhausted] Error")).toBe(true);
  expect(isAcpProviderExhaustionMessage("ConnectError: [resource_exhausted] Error")).toBe(true);
  expect(isAcpProviderExhaustionMessage("Error: T: [resource_exhausted] Error")).toBe(true);
  expect(isAcpProviderExhaustionMessage("Working on your request.")).toBe(false);
});

test("detects HTTP/2 keepalive ping timeout RetriableError envelopes", () => {
  const message = "Error: RetriableError: [internal] HTTP/2 keepalive ping timed out after 5000ms";
  expect(isAcpProviderExhaustionMessage(message)).toBe(true);
  expect(
    isAcpUnstartedProviderFailure({
      agentText: message,
      sawTool: false,
      sawThought: false,
    }),
  ).toBe(true);
});

test("splits trailing exhaustion from a real assistant body", () => {
  expect(splitAcpProviderExhaustion("Error: RetriableError: [resource_exhausted] Error")).toEqual({
    body: "",
    envelope: "Error: RetriableError: [resource_exhausted] Error",
  });
  expect(
    splitAcpProviderExhaustion("I'll inspect the login page.\n\nError: T: [resource_exhausted] Error"),
  ).toEqual({
    body: "I'll inspect the login page.",
    envelope: "Error: T: [resource_exhausted] Error",
  });
  expect(splitAcpProviderExhaustion("I'll inspect the login page.")).toBeNull();
});

test("zero-output exhaustion is unstarted; tools, thoughts, or a real body are not", () => {
  expect(
    isAcpUnstartedProviderFailure({
      agentText: "Error: RetriableError: [resource_exhausted] Error",
      sawTool: false,
      sawThought: false,
    }),
  ).toBe(true);
  expect(
    isAcpUnstartedProviderFailure({
      agentText: "",
      sawTool: false,
      sawThought: false,
    }),
  ).toBe(true);
  expect(
    isAcpUnstartedProviderFailure({
      agentText: "Error: RetriableError: [resource_exhausted] Error",
      sawTool: true,
      sawThought: false,
    }),
  ).toBe(false);
  expect(
    isAcpUnstartedProviderFailure({
      agentText: "I'll inspect the login page.",
      sawTool: false,
      sawThought: false,
    }),
  ).toBe(false);
});
