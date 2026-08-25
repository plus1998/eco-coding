import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  AcpFsHandler,
  PathEscapesWorkspaceError,
  parseAcpFsReadRequest,
  parseAcpFsWriteRequest,
} from "../src/acp-fs.js";

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), "acp-fs-test-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

test("read returns full file content", async () => {
  const handler = new AcpFsHandler(workspace);
  await Bun.write(path.join(workspace, "a.txt"), "hello world");
  const result = await handler.read({ path: path.join(workspace, "a.txt") });
  expect(result).toEqual({ content: "hello world" });
});

test("read with line and limit slices lines", async () => {
  const handler = new AcpFsHandler(workspace);
  await Bun.write(path.join(workspace, "b.txt"), "L1\nL2\nL3\nL4\nL5");
  const result = await handler.read({ path: path.join(workspace, "b.txt"), line: 2, limit: 3 });
  expect(result).toEqual({ content: "L2\nL3\nL4", start_line: 2, end_line: 4 });
});

test("write creates file and returns path", async () => {
  const handler = new AcpFsHandler(workspace);
  const filePath = path.join(workspace, "sub", "c.txt");
  const result = await handler.write({ path: filePath, content: "written" });
  expect(result).toEqual({ path: filePath });
  expect(await readFile(filePath, "utf8")).toBe("written");
});

test("read rejects paths that escape the workspace", async () => {
  const handler = new AcpFsHandler(workspace);
  await expect(handler.read({ path: "/etc/hosts" })).rejects.toBeInstanceOf(PathEscapesWorkspaceError);
});

test("write rejects paths that escape the workspace", async () => {
  const handler = new AcpFsHandler(workspace);
  await expect(
    handler.write({ path: path.join(workspace, "..", "escape.txt"), content: "x" }),
  ).rejects.toBeInstanceOf(PathEscapesWorkspaceError);
});

test("parseAcpFsReadRequest requires a path", () => {
  expect(parseAcpFsReadRequest({})).toBeUndefined();
  expect(parseAcpFsReadRequest({ path: "   " })).toBeUndefined();
  expect(parseAcpFsReadRequest({ path: "/tmp/x.txt", line: 10, limit: 50 })).toEqual({
    path: "/tmp/x.txt",
    line: 10,
    limit: 50,
  });
});

test("parseAcpFsWriteRequest requires path and content", () => {
  expect(parseAcpFsWriteRequest({})).toBeUndefined();
  expect(parseAcpFsWriteRequest({ path: "/tmp/x.txt" })).toBeUndefined();
  expect(parseAcpFsWriteRequest({ path: "/tmp/x.txt", content: 123 })).toBeUndefined();
  expect(parseAcpFsWriteRequest({ path: "/tmp/x.txt", content: "hi" })).toEqual({
    path: "/tmp/x.txt",
    content: "hi",
  });
});
