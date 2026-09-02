import { expect, test } from "bun:test";
import { mergeStreamText } from "../src/stream-text";

test("appends stream deltas within a word", () => {
  expect(mergeStreamText("hel", "lo")).toBe("hello");
});

test("accepts cumulative snapshots", () => {
  expect(mergeStreamText("No", "No markdown")).toBe("No markdown");
  expect(mergeStreamText("Let me also", "Let me also check")).toBe("Let me also check");
});

test("does not insert spaces between CJK stream chunks", () => {
  expect(mergeStreamText("分析", "结果")).toBe("分析结果");
  expect(mergeStreamText("##", "分析结果")).toBe("##分析结果");
});

test("preserves explicit spaces in deltas", () => {
  expect(mergeStreamText("No", " markdown")).toBe("No markdown");
  expect(mergeStreamText("Let me also", " check")).toBe("Let me also check");
  expect(mergeStreamText("go", " to")).toBe("go to");
});

test("does not mutate lowercase or identifier chunks (append-only)", () => {
  expect(mergeStreamText("s", "orter")).toBe("sorter");
  expect(mergeStreamText("sort", "er")).toBe("sorter");
  expect(mergeStreamText("mod", "ulo")).toBe("modulo");
  expect(mergeStreamText("新增 s", "orter: true")).toBe("新增 sorter: true");

  let text = "";
  for (const chunk of ["s", "ort", "er"]) {
    text = mergeStreamText(text, chunk);
  }
  expect(text).toBe("sorter");
});

test("does not split camelCase or PascalCase identifiers across stream chunks", () => {
  expect(mergeStreamText("is", "Ad")).toBe("isAd");
  expect(mergeStreamText("isAd", "qx")).toBe("isAdqx");
  expect(mergeStreamText("isAdqx", "K")).toBe("isAdqxK");
  expect(mergeStreamText("isAdqxK", "efu")).toBe("isAdqxKefu");
  expect(mergeStreamText("isAdqxKefu", "Enabled")).toBe("isAdqxKefuEnabled");
  expect(mergeStreamText("isAdqxKefuEnabled", ":true")).toBe("isAdqxKefuEnabled:true");
  expect(mergeStreamText("Corp", "Service")).toBe("CorpService");
  expect(mergeStreamText("update", "Corp")).toBe("updateCorp");
  expect(mergeStreamText("updateCorp", "Roles")).toBe("updateCorpRoles");
});

test("merges overlapping phrase deltas without stutter", () => {
  expect(mergeStreamText("Let me look at the details of ", "of how the text")).toBe(
    "Let me look at the details of how the text",
  );
  expect(mergeStreamText("how the text is rendered and ", "and how similar")).toBe(
    "how the text is rendered and how similar",
  );
});

test("appends repeated single-char deltas", () => {
  expect(mergeStreamText("160", "0")).toBe("1600");
  expect(mergeStreamText("1600x120", "0")).toBe("1600x1200");

  let text = "";
  for (const chunk of "1600x1200".split("")) {
    text = mergeStreamText(text, chunk);
  }
  expect(text).toBe("1600x1200");

  text = "";
  for (const chunk of "aaaa".split("")) {
    text = mergeStreamText(text, chunk);
  }
  expect(text).toBe("aaaa");
});

test("reconstructs a realistic identifier-heavy plan sentence", () => {
  let text = "";
  for (const chunk of ["is", "Ad", "qx", "K", "efu", "Enabled", ":true"]) {
    text = mergeStreamText(text, chunk);
  }
  expect(text).toBe("isAdqxKefuEnabled:true");

  text = "";
  for (const chunk of ["Corp", "Service", ".update", "Corp", "Roles"]) {
    text = mergeStreamText(text, chunk);
  }
  expect(text).toBe("CorpService.updateCorpRoles");
});
