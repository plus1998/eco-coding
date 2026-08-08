import { expect, test } from "bun:test";
import {
  isStructuralStreamingTail,
  partitionStreamingMarkdown,
} from "../src/renderer/streaming-markdown-partition";

test("non-streaming keeps everything stable", () => {
  expect(partitionStreamingMarkdown("hello\n\nworld", false)).toEqual({
    stable: "hello\n\nworld",
    tail: "",
  });
});

test("single unfinished paragraph is all tail", () => {
  expect(partitionStreamingMarkdown("正在分析项目结构", true)).toEqual({
    stable: "",
    tail: "正在分析项目结构",
  });
});

test("unfinished prose tail is not structural", () => {
  expect(isStructuralStreamingTail("正在分析项目结构")).toBe(false);
  expect(isStructuralStreamingTail("- a\n- b\npartial")).toBe(false);
  expect(isStructuralStreamingTail("# Title still open")).toBe(false);
});

test("blank-line committed paragraph becomes stable", () => {
  expect(partitionStreamingMarkdown("done para\n\nworking", true)).toEqual({
    stable: "done para\n\n",
    tail: "working",
  });
  expect(isStructuralStreamingTail("working")).toBe(false);
});

test("heading followed by blank is stable before unfinished body", () => {
  expect(partitionStreamingMarkdown("# Title\n\nbody so far", true)).toEqual({
    stable: "# Title\n\n",
    tail: "body so far",
  });
});

test("incomplete fence holds from open fence and is structural", () => {
  expect(partitionStreamingMarkdown("intro\n```bash\necho hi", true)).toEqual({
    stable: "intro\n",
    tail: "```bash\necho hi",
  });
  expect(isStructuralStreamingTail("```bash\necho hi")).toBe(true);
});

test("completed fence with following unfinished prose splits after fence", () => {
  expect(
    partitionStreamingMarkdown("intro\n```bash\necho hi\n```\nnext", true),
  ).toEqual({
    stable: "intro\n```bash\necho hi\n```\n",
    tail: "next",
  });
  expect(isStructuralStreamingTail("next")).toBe(false);
});

test("completed fence closed at eof with no following unfinished block is stable", () => {
  // Ends mid-block after closed fence without trailing blank — fence itself is complete,
  // but no extra blank so if there's nothing after the fence line, completedThrough is EOF.
  expect(partitionStreamingMarkdown("intro\n```bash\necho hi\n```\n", true)).toEqual({
    stable: "intro\n```bash\necho hi\n```\n",
    tail: "",
  });
  expect(isStructuralStreamingTail("")).toBe(false);
});

test("incomplete GFM table stays in tail and is structural", () => {
  expect(partitionStreamingMarkdown("| a | b |\n| ---", true)).toEqual({
    stable: "",
    tail: "| a | b |\n| ---",
  });
  expect(isStructuralStreamingTail("| a | b |\n| ---")).toBe(true);
});

test("complete table then unfinished para", () => {
  const source = "| a | b |\n| --- | --- |\n| 1 | 2 |\n\nmore";
  expect(partitionStreamingMarkdown(source, true)).toEqual({
    stable: "| a | b |\n| --- | --- |\n| 1 | 2 |\n\n",
    tail: "more",
  });
});

test("incomplete SEARCH block holds into tail (with optional stable prefix)", () => {
  expect(partitionStreamingMarkdown("before\n<<<<<<< SEARCH\nold", true)).toEqual({
    stable: "before\n",
    tail: "<<<<<<< SEARCH\nold",
  });
  expect(isStructuralStreamingTail("<<<<<<< SEARCH\nold")).toBe(true);
});
