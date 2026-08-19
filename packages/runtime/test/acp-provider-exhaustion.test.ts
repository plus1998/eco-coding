import { expect, test } from "bun:test";
import { isAcpProviderExhaustionMessage } from "../src/acp-provider-exhaustion.js";

test("detects Cursor RetriableError / resource_exhausted envelopes", () => {
  expect(isAcpProviderExhaustionMessage("Error: RetriableError: [resource_exhausted] Error")).toBe(
    true,
  );
  expect(isAcpProviderExhaustionMessage("ConnectError: [resource_exhausted] Error")).toBe(true);
  expect(isAcpProviderExhaustionMessage("Working on your request.")).toBe(false);
});
