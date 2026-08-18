import { expect, test } from "bun:test";
import { transformRemoteInvokeResult } from "../src/main/event-center";
import {
  REMOTE_THREAD_LIST_MESSAGE_MAX_CHARS,
  REMOTE_THREAD_LIST_PROMPT_MAX_CHARS,
  summarizeThreadForRemoteList,
} from "../src/main/remote-thread-list";
import { IPC_CHANNELS, type ThreadSummary } from "../src/shared/ipc";
import type { WorkspaceDiffResult } from "../src/main/git-operations";

const thread: ThreadSummary = {
  id: "thr_1",
  title: "Title",
  prompt: "p".repeat(REMOTE_THREAD_LIST_PROMPT_MAX_CHARS + 40),
  workspacePath: "/tmp/ws",
  status: "idle",
  createdAt: "t0",
  updatedAt: "t1",
  message: "m".repeat(REMOTE_THREAD_LIST_MESSAGE_MAX_CHARS + 10),
  runtimeConfig: {
    sessionMode: "execution",
  } as ThreadSummary["runtimeConfig"],
  sdkSessionId: "sess",
  sdkCwd: "/tmp/ws",
};

test("summarizeThreadForRemoteList keeps live cancelling overlay", () => {
  const summarized = summarizeThreadForRemoteList({
    ...thread,
    status: "running",
    cancelling: true,
  });
  expect(summarized.cancelling).toBe(true);
  expect(summarizeThreadForRemoteList(thread).cancelling).toBeUndefined();
});

test("summarizeThreadForRemoteList truncates prompt/message and drops heavy fields", () => {
  const summarized = summarizeThreadForRemoteList(thread);
  expect(summarized.prompt).toHaveLength(REMOTE_THREAD_LIST_PROMPT_MAX_CHARS);
  expect(summarized.message).toHaveLength(REMOTE_THREAD_LIST_MESSAGE_MAX_CHARS);
  expect(summarized.runtimeConfig).toBeUndefined();
  expect(summarized.sdkSessionId).toBeUndefined();
  expect(summarized.sdkCwd).toBeUndefined();
});

test("remote thread list keeps hostUiFeatures", () => {
  const summarized = summarizeThreadForRemoteList({
    ...thread,
    coreKind: "acp",
    acpAgentId: "cursor",
    hostUiFeatures: { contextUsage: "hide", billing: "hide" },
  });
  expect(summarized.hostUiFeatures).toEqual({ contextUsage: "hide", billing: "hide" });
  expect(summarized.runtimeConfig).toBeUndefined();
});

test("transformRemoteInvokeResult reshapes list/git payloads", () => {
  const listed = transformRemoteInvokeResult(IPC_CHANNELS.threadList, [
    {
      id: "thr_1",
      title: "T",
      prompt: "x".repeat(500),
      workspacePath: "/w",
      status: "idle",
      createdAt: "a",
      updatedAt: "b",
      message: "ok",
      sdkSessionId: "s",
    },
  ]);
  expect(Array.isArray(listed)).toBe(true);
  expect((listed as ThreadSummary[])[0]?.prompt.length).toBe(REMOTE_THREAD_LIST_PROMPT_MAX_CHARS);
  expect((listed as ThreadSummary[])[0]?.sdkSessionId).toBeUndefined();

  const diff: WorkspaceDiffResult = {
    workspacePath: "/w",
    patch: "huge patch body",
    patchTruncated: true,
    fileCount: 1,
    files: [
      {
        path: "a.ts",
        additions: 1,
        deletions: 0,
        status: "modified",
        originalContent: "old",
        currentContent: "new",
      },
    ],
    totalAdditions: 1,
    totalDeletions: 0,
  };
  const remoteDiff = transformRemoteInvokeResult(
    IPC_CHANNELS.gitGetWorkspaceDiff,
    diff,
  ) as WorkspaceDiffResult;
  expect(remoteDiff.patch).toBe("");
  expect(remoteDiff.files[0]?.originalContent).toBe("");
  expect(remoteDiff.files[0]?.currentContent).toBe("");
  expect(remoteDiff.files[0]?.path).toBe("a.ts");
});

test("transformRemoteInvokeResult keeps workspace file diff patch for lazy review", () => {
  const fileDiff = {
    path: "a.ts",
    patch: "diff --git a/a.ts b/a.ts\n+hello\n",
    patchTruncated: false,
    additions: 1,
    deletions: 0,
    status: "modified" as const,
  };
  const remote = transformRemoteInvokeResult(IPC_CHANNELS.gitGetWorkspaceFileDiff, fileDiff);
  expect(remote).toEqual(fileDiff);
});
