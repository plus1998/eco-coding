import { expect, test } from "bun:test";
import { partitionStreamingMarkdown } from "../src/renderer/streaming-markdown-partition";

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

test("blank-line committed paragraph becomes stable", () => {
  expect(partitionStreamingMarkdown("done para\n\nworking", true)).toEqual({
    stable: "done para\n\n",
    tail: "working",
  });
});

test("heading followed by blank is stable before unfinished body", () => {
  expect(partitionStreamingMarkdown("# Title\n\nbody so far", true)).toEqual({
    stable: "# Title\n\n",
    tail: "body so far",
  });
});

test("incomplete fence holds from open fence", () => {
  expect(partitionStreamingMarkdown("intro\n```bash\necho hi", true)).toEqual({
    stable: "intro\n",
    tail: "```bash\necho hi",
  });
});

test("completed fence with following unfinished prose splits after fence", () => {
  expect(
    partitionStreamingMarkdown("intro\n```bash\necho hi\n```\nnext", true),
  ).toEqual({
    stable: "intro\n```bash\necho hi\n```\n",
    tail: "next",
  });
});

test("completed fence closed at eof with no following unfinished block is stable", () => {
  // Ends mid-block after closed fence without trailing blank — fence itself is complete,
  // but no extra blank so if there's nothing after the fence line, completedThrough is EOF.
  expect(partitionStreamingMarkdown("intro\n```bash\necho hi\n```\n", true)).toEqual({
    stable: "intro\n```bash\necho hi\n```\n",
    tail: "",
  });
});

test("incomplete GFM table stays in tail", () => {
  expect(partitionStreamingMarkdown("| a | b |\n| ---", true)).toEqual({
    stable: "",
    tail: "| a | b |\n| ---",
  });
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
});
