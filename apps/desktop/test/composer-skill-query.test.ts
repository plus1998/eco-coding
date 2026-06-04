import { expect, test } from "bun:test";
import {
  applyComposerSkillSelection,
  parseComposerSkillSlashQuery,
} from "../src/renderer/composer-skill-query";

test("parseComposerSkillSlashQuery finds slash token before cursor", () => {
  expect(parseComposerSkillSlashQuery("/uT", 3)).toEqual({ start: 0, query: "uT" });
  expect(parseComposerSkillSlashQuery("hello /vue", 10)).toEqual({ start: 6, query: "vue" });
  expect(parseComposerSkillSlashQuery("no slash", 8)).toBeNull();
});

test("applyComposerSkillSelection inserts $skill-name token", () => {
  const result = applyComposerSkillSelection("prefix /ut suffix", { start: 7, end: 10 }, "utools-plugin-dev");
  expect(result.next).toBe("prefix $utools-plugin-dev  suffix");
  expect(result.cursor).toBe(7 + "$utools-plugin-dev ".length);
});
