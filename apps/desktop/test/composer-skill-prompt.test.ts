import { expect, test } from "bun:test";
import {
  formatSkillChipLabel,
  parseComposerPromptSegments,
  skillTokenForName,
} from "../src/renderer/composer-skill-prompt";

test("parseComposerPromptSegments splits text and skill tokens", () => {
  expect(parseComposerPromptSegments("hello $vue-best $pdf end")).toEqual([
    { type: "text", value: "hello " },
    { type: "skill", name: "vue-best" },
    { type: "text", value: " " },
    { type: "skill", name: "pdf" },
    { type: "text", value: " end" },
  ]);
});

test("formatSkillChipLabel humanizes kebab-case names", () => {
  expect(formatSkillChipLabel("vue-testing-best-practices")).toBe("vue testing best practices");
  expect(formatSkillChipLabel("vue-testing", { name: "Vue Testing", description: "", source: "user", directory: "", skillFilePath: "", layout: "claude", sdkReady: true })).toBe(
    "Vue Testing",
  );
});

test("skillTokenForName", () => {
  expect(skillTokenForName("pdf")).toBe("$pdf");
});
