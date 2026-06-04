import { expect, test } from "bun:test";
import {
  dedupeSkillsByName,
  filterExplicitUserSkillNames,
  listSdkReadyProjectSkills,
  mergeSkillNames,
  parseExplicitSkillNames,
  promptIncludesSkillName,
  type SkillInfo,
} from "../src/shared/skills";

test("parseExplicitSkillNames extracts $skill tokens", () => {
  expect(parseExplicitSkillNames("请用 $pdf-processing 处理附件")).toEqual(["pdf-processing"]);
  expect(parseExplicitSkillNames("$a $b $a")).toEqual(["a", "b"]);
  expect(parseExplicitSkillNames(undefined)).toEqual([]);
});

test("filterExplicitUserSkillNames keeps only sdk-ready user skills", () => {
  const userSkills = [
    { name: "vue-best-practices", sdkReady: true },
    { name: "pdf", sdkReady: false },
  ];
  expect(filterExplicitUserSkillNames("$vue-best-practices 帮忙", userSkills)).toEqual([
    "vue-best-practices",
  ]);
  expect(filterExplicitUserSkillNames("$pdf", userSkills)).toEqual([]);
  expect(filterExplicitUserSkillNames("$unknown", userSkills)).toEqual([]);
});

test("promptIncludesSkillName detects explicit tokens", () => {
  expect(promptIncludesSkillName("use $vue-best  ", "vue-best")).toBe(true);
  expect(promptIncludesSkillName("use $vue-best", "other")).toBe(false);
});

test("mergeSkillNames dedupes and sorts", () => {
  expect(mergeSkillNames(["b", "a"], ["a", "c"])).toEqual(["a", "b", "c"]);
});

test("listSdkReadyProjectSkills dedupes by name and prefers claude layout", () => {
  const base = (layout: SkillInfo["layout"], sdkReady: boolean): SkillInfo => ({
    name: "dup",
    description: "",
    source: "project",
    directory: layout === "claude" ? "/p/.claude/skills/dup" : "/p/.agents/skills/dup",
    skillFilePath: "/p/SKILL.md",
    layout,
    sdkReady,
  });
  const ready = listSdkReadyProjectSkills([base("agents", true), base("claude", true)]);
  expect(ready).toHaveLength(1);
  expect(ready[0]?.layout).toBe("claude");
  expect(dedupeSkillsByName([base("agents", false), base("claude", true)])).toHaveLength(1);
});
