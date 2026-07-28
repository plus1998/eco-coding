import { describe, expect, test } from "bun:test";
import {
  decodeWorkspaceFileReference,
  encodeWorkspaceFileReference,
  isWorkspacePathContained,
  linkifyWorkspaceFileReferences,
  parseWorkspaceFileReference,
  parseWorkspaceFileReferenceHref,
  workspaceFileReferenceRemarkPlugin,
} from "../src/renderer/workspace-file-reference";

describe("workspace file references", () => {
  test("parses unix and windows paths with positive locations", () => {
    expect(parseWorkspaceFileReference("/tmp/example.ts:12:4")).toEqual({
      path: "/tmp/example.ts",
      line: 12,
      column: 4,
    });
    expect(parseWorkspaceFileReference(String.raw`C:\work\example.ts:8`)).toEqual({
      path: String.raw`C:\work\example.ts`,
      line: 8,
    });
    expect(parseWorkspaceFileReference("/tmp/example.ts:0")).toBeUndefined();
  });

  test("round trips encoded references and rejects urls", () => {
    const reference = { path: "/tmp/example.ts", line: 2, column: 3 };
    expect(decodeWorkspaceFileReference(encodeWorkspaceFileReference(reference))).toEqual(reference);
    expect(parseWorkspaceFileReference("https://example.com/a.ts")).toBeUndefined();
    expect(parseWorkspaceFileReference("file:///tmp/example.ts")).toBeUndefined();
  });

  test("recognizes encoded absolute markdown hrefs without intercepting web links", () => {
    expect(parseWorkspaceFileReferenceHref("/repo/My%20File.ts:12:3")).toEqual({
      path: "/repo/My File.ts",
      line: 12,
      column: 3,
    });
    expect(parseWorkspaceFileReferenceHref(String.raw`C:\repo\App.tsx:8`)).toEqual({
      path: String.raw`C:\repo\App.tsx`,
      line: 8,
    });
    expect(parseWorkspaceFileReferenceHref("https://example.com/a.ts")).toBeUndefined();
    expect(parseWorkspaceFileReferenceHref("//example.com/a.ts")).toBeUndefined();
    expect(parseWorkspaceFileReferenceHref("%E0%A4%A")).toBeUndefined();
  });

  test("linkifies text while preserving punctuation", () => {
    expect(linkifyWorkspaceFileReferences("See /tmp/example.ts:7, then continue.")).toEqual([
      { type: "text", value: "See " },
      {
        type: "link",
        value: "/tmp/example.ts:7",
        reference: { path: "/tmp/example.ts", line: 7 },
      },
      { type: "text", value: ", then continue." },
    ]);
    expect(linkifyWorkspaceFileReferences("https://example.com/a.ts file:///tmp/a.ts")).toEqual([
      { type: "text", value: "https://example.com/a.ts file:///tmp/a.ts" },
    ]);
  });

  test("checks lexical workspace containment across separators", () => {
    expect(isWorkspacePathContained("/workspace/project", "/workspace/project/src/a.ts")).toBe(true);
    expect(isWorkspacePathContained("/workspace/project", "/workspace/project-old/a.ts")).toBe(false);
    expect(isWorkspacePathContained(String.raw`C:\Project`, String.raw`c:\project\src\a.ts`)).toBe(true);
  });

  test("only transforms ordinary text nodes in the markdown AST", () => {
    const text = { type: "text", value: "See /tmp/example.ts:7" };
    const inlineCode = { type: "inlineCode", value: "/tmp/inline.ts" };
    const code = { type: "code", value: "/tmp/fenced.ts" };
    const link = { type: "link", url: "https://example.com", children: [{ type: "text", value: "/tmp/linked.ts" }] };
    const tree = { type: "root", children: [text, inlineCode, code, link] };

    workspaceFileReferenceRemarkPlugin()(tree);

    expect(tree.children.some((node) => node.type === "link" && node.url?.startsWith("eco-file:"))).toBe(true);
    expect(tree.children.find((node) => node.type === "inlineCode")).toEqual(inlineCode);
    expect(tree.children.find((node) => node.type === "code")).toEqual(code);
    expect(tree.children.find((node) => node.type === "link" && node.url === link.url)).toEqual(link);
  });

  test("rejects malicious encoded references", () => {
    const payload = encodeURIComponent(JSON.stringify({ path: "javascript:alert(1)", line: 1 }));
    expect(decodeWorkspaceFileReference(payload)).toBeUndefined();
    expect(decodeWorkspaceFileReference(encodeURIComponent(JSON.stringify({ path: "/tmp/a", line: 0 })))).toBeUndefined();
  });
});
