import { expect, test } from "bun:test";
import {
  appendReviewerScopeToPrompt,
  createReviewerScopeToolHandler,
  formatReviewerScopeAppend,
  REVIEWER_SCOPE_SECTION_TITLE,
} from "../src/reviewer-scope";
import { ecoSubagentKeyForRole } from "../src/subagent-availability";

test("formatReviewerScopeAppend lists changed paths", () => {
  const block = formatReviewerScopeAppend(["app/service/corp.service.ts", "src/pages/Home/Corp.vue"]);
  expect(block).toContain(REVIEWER_SCOPE_SECTION_TITLE);
  expect(block).toContain("- app/service/corp.service.ts");
  expect(block).not.toContain("Do NOT");
  expect(block).not.toContain("Review ONLY");
});

test("createReviewerScopeToolHandler injects scope for Agent(reviewer) only", async () => {
  const handler = createReviewerScopeToolHandler(async () => ["a.ts"]);

  const reviewer = await handler({
    toolName: "Agent",
    input: { subagent_type: "reviewer", prompt: "Review the plan." },
    toolUseId: "tu_1",
    signal: new AbortController().signal,
  });
  expect(reviewer.behavior).toBe("allow");
  expect(reviewer.updatedInput?.subagent_type).toBe(ecoSubagentKeyForRole("reviewer"));
  expect(reviewer.updatedInput?.prompt).toContain(REVIEWER_SCOPE_SECTION_TITLE);
  expect(reviewer.updatedInput?.prompt).toContain("- a.ts");
  expect(reviewer.updatedInput?.prompt).toContain("Review the plan.");

  const coder = await handler({
    toolName: "Agent",
    input: { subagent_type: "coder", prompt: "Implement." },
    toolUseId: "tu_2",
    signal: new AbortController().signal,
  });
  expect(coder.updatedInput?.prompt).toBe("Implement.");
});

test("appendReviewerScopeToPrompt preserves delegation body", () => {
  expect(appendReviewerScopeToPrompt("", ["x.ts"])).toContain("- x.ts");
});
