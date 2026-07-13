import { expect, test } from "bun:test";
import { resolveStreamingDisplaySnapshot } from "../src/renderer/streaming-display-text";

test("resolveStreamingDisplaySnapshot passes through completed text when not streaming", () => {
  expect(resolveStreamingDisplaySnapshot("hello", false)).toEqual({
    displayText: "hello",
    pendingBlock: false,
  });
});

test("resolveStreamingDisplaySnapshot streams incomplete fenced code blocks immediately", () => {
  expect(
    resolveStreamingDisplaySnapshot("intro\n```bash\necho hi", true),
  ).toEqual({
    displayText: "intro\n```bash\necho hi",
    pendingBlock: false,
  });
});

test("resolveStreamingDisplaySnapshot releases completed fenced blocks", () => {
  expect(
    resolveStreamingDisplaySnapshot("intro\n```bash\necho hi\n```\n", true),
  ).toEqual({
    displayText: "intro\n```bash\necho hi\n```\n",
    pendingBlock: false,
  });
});

test("resolveStreamingDisplaySnapshot holds incomplete SEARCH/REPLACE blocks", () => {
  expect(
    resolveStreamingDisplaySnapshot("before\n<<<<<<< SEARCH\nold", true),
  ).toEqual({
    displayText: "before\n",
    pendingBlock: true,
  });
});

test("resolveStreamingDisplaySnapshot keeps plain prose visible while streaming", () => {
  expect(resolveStreamingDisplaySnapshot("正在分析项目结构", true)).toEqual({
    displayText: "正在分析项目结构",
    pendingBlock: false,
  });
});
