import { expect, test } from "bun:test";
import {
  filterExplicitUserSkillNames,
  mergeSkillNames,
  parseExplicitSkillNames,
} from "../src/shared/skills";

test("parseExplicitSkillNames extracts $skill tokens", () => {
  expect(parseExplicitSkillNames("请用 $pdf-processing 处理附件")).toEqual(["pdf-processing"]);
  expect(parseExplicitSkillNames("$a $b $a")).toEqual(["a", "b"]);
  expect(parseExplicitSkillNames(undefined)).toEqual([]);
});

test("filterExplicitUserSkillNames keeps only known user skills", () => {
  const userSkills = [{ name: "vue-best-practices" }, { name: "pdf" }];
  expect(filterExplicitUserSkillNames("$vue-best-practices 帮忙", userSkills)).toEqual([
    "vue-best-practices",
  ]);
  expect(filterExplicitUserSkillNames("$unknown", userSkills)).toEqual([]);
});

test("mergeSkillNames dedupes and sorts", () => {
  expect(mergeSkillNames(["b", "a"], ["a", "c"])).toEqual(["a", "b", "c"]);
});
