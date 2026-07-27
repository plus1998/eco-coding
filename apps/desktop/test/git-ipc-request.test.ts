import { expect, test } from "bun:test";
import { parseGitListCommitModelOptionsRequest } from "../src/shared/ipc";

test("parseGitListCommitModelOptionsRequest accepts mainAgentConfigId", () => {
  expect(parseGitListCommitModelOptionsRequest({ mainAgentConfigId: "main-1" })).toEqual({
    mainAgentConfigId: "main-1",
  });
});

test("parseGitListCommitModelOptionsRequest rejects legacy profileId", () => {
  expect(() => parseGitListCommitModelOptionsRequest({ profileId: "legacy-profile" })).toThrow(
    "Invalid git list commit model options request.",
  );
});

test("parseGitListCommitModelOptionsRequest rejects empty payload", () => {
  expect(() => parseGitListCommitModelOptionsRequest({})).toThrow(
    "Invalid git list commit model options request.",
  );
});
