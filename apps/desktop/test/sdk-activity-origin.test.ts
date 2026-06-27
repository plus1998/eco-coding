import { expect, test } from "bun:test";
import { classifySdkStreamMessageOrigin } from "../src/main/sdk-activity-origin";

test("classifySdkStreamMessageOrigin tags SDK stream errors at emit boundary", () => {
  expect(
    classifySdkStreamMessageOrigin(
      "API Error: 503 Loading model. This is a server-side issue, usually temporary — try again in a moment.",
    ),
  ).toBe("sdk.upstream_error");
  expect(
    classifySdkStreamMessageOrigin(
      "Claude Code returned an error result: API Error: 503 Loading model.",
    ),
  ).toBe("sdk.run_failure");
  expect(classifySdkStreamMessageOrigin("Working on your request.")).toBeUndefined();
});
