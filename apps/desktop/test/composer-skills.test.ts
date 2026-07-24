import { expect, test } from "bun:test";
import {
  applySlashSkillSelection,
  formatSkillDisplayName,
  parsePromptSegments,
  parseSlashQuery,
  skillToken,
} from "../src/renderer/composer-skills";
import { skillScopeLabel } from "../src/renderer/composer-skills-ui";
import { i18n } from "../src/renderer/i18n";

test("parseSlashQuery finds slash token before cursor", () => {
  expect(parseSlashQuery("/uT", 3)).toEqual({ start: 0, query: "uT" });
  expect(parseSlashQuery("hello /vue", 10)).toEqual({ start: 6, query: "vue" });
  expect(parseSlashQuery("no slash", 8)).toBeNull();
});

test("parseSlashQuery returns null when cursor is before slash token", () => {
  expect(parseSlashQuery("/vue", 0)).toBeNull();
});

test("applySlashSkillSelection inserts $skill-name token", () => {
  const result = applySlashSkillSelection("prefix /ut suffix", { start: 7, end: 10 }, "utools-plugin-dev");
  expect(result.next).toBe("prefix $utools-plugin-dev  suffix");
  expect(result.cursor).toBe(7 + "$utools-plugin-dev ".length);
});

test("parsePromptSegments splits text and skill tokens", () => {
  expect(parsePromptSegments("hello $vue-best $pdf end")).toEqual([
    { type: "text", value: "hello " },
    { type: "skill", name: "vue-best" },
    { type: "text", value: " " },
    { type: "skill", name: "pdf" },
    { type: "text", value: " end" },
  ]);
});

test("skillToken", () => {
  expect(skillToken("pdf")).toBe("$pdf");
});

test("formatSkillDisplayName humanizes kebab-case ids", () => {
  expect(formatSkillDisplayName("vue-router-best-practices")).toBe("Vue Router Best Practices");
  expect(formatSkillDisplayName("pdf")).toBe("pdf");
});

test("skillScopeLabel follows the active locale", async () => {
  await i18n.changeLanguage("en-US");
  expect(skillScopeLabel("project")).toBe("Project");
  expect(skillScopeLabel("user")).toBe("Personal");
});

test("slash menu highlights query on display label", async () => {
  const { highlightQueryInLabel } = await import("../src/renderer/skill-fuzzy");
  const parts = highlightQueryInLabel("vr", "Vue Router Best Practices");
  expect(parts.some((part) => part.match)).toBe(true);
  expect(parts.map((part) => part.text).join("")).toBe("Vue Router Best Practices");
});
