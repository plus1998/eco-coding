import { beforeEach, expect, test } from "bun:test";
import { i18n } from "../src/renderer/i18n";
import {
  beginWorkspaceGitAction,
  clearWorkspaceGitAction,
  getWorkspaceGitActionSnapshot,
  getWorkspaceGitCommitEntryLabel,
  planWorkspaceGitActionSettlement,
  resetWorkspaceGitActionStore,
  setWorkspaceGitActionPhase,
  subscribeWorkspaceGitAction,
} from "../src/renderer/workspace-git-action-store";

function requireOperationId(operationId: number | null): number {
  if (operationId === null) {
    throw new Error("Expected workspace git action to start");
  }
  return operationId;
}

beforeEach(async () => {
  await i18n.changeLanguage("en-US");
  resetWorkspaceGitActionStore();
});

test("labels map phases for the work panel entry", () => {
  expect(getWorkspaceGitCommitEntryLabel(undefined)).toBe("Commit or push");
  expect(getWorkspaceGitCommitEntryLabel(null)).toBe("Commit or push");
  expect(getWorkspaceGitCommitEntryLabel("generating")).toBe("Generating commit");
  expect(getWorkspaceGitCommitEntryLabel("committing")).toBe("Committing");
  expect(getWorkspaceGitCommitEntryLabel("pushing")).toBe("Pushing");
});

test("stores action phase per workspace path", () => {
  const a = requireOperationId(beginWorkspaceGitAction("/proj-a", "generating"));
  const b = requireOperationId(beginWorkspaceGitAction("/proj-b", "pushing"));
  expect(getWorkspaceGitActionSnapshot("/proj-a")).toEqual({
    phase: "generating",
    operationId: a,
  });
  expect(getWorkspaceGitActionSnapshot("/proj-b")).toEqual({
    phase: "pushing",
    operationId: b,
  });
  expect(getWorkspaceGitActionSnapshot("/proj-c")).toBeNull();
});

test("rejects a second begin while a workspace already has a phase", () => {
  requireOperationId(beginWorkspaceGitAction("/proj-a", "committing"));
  expect(beginWorkspaceGitAction("/proj-a", "pushing")).toBeNull();
  expect(getWorkspaceGitActionSnapshot("/proj-a")?.phase).toBe("committing");
});

test("snapshot identity stays stable until the phase changes", () => {
  const id = requireOperationId(beginWorkspaceGitAction("/proj-a", "generating"));
  const first = getWorkspaceGitActionSnapshot("/proj-a");
  const second = getWorkspaceGitActionSnapshot("/proj-a");
  expect(first).toBe(second);

  expect(setWorkspaceGitActionPhase("/proj-a", id, "generating")).toBe(true);
  expect(getWorkspaceGitActionSnapshot("/proj-a")).toBe(first);

  expect(setWorkspaceGitActionPhase("/proj-a", id, "committing")).toBe(true);
  const third = getWorkspaceGitActionSnapshot("/proj-a");
  expect(third).not.toBe(first);
  expect(third).toEqual({ phase: "committing", operationId: id });
});

test("clear only removes the matching operation token", () => {
  const first = requireOperationId(beginWorkspaceGitAction("/proj-a", "generating"));
  expect(clearWorkspaceGitAction("/proj-a", first + 99)).toBe(false);
  expect(getWorkspaceGitActionSnapshot("/proj-a")?.operationId).toBe(first);

  expect(clearWorkspaceGitAction("/proj-a", first)).toBe(true);
  expect(getWorkspaceGitActionSnapshot("/proj-a")).toBeNull();

  const second = requireOperationId(beginWorkspaceGitAction("/proj-a", "pushing"));
  expect(second).not.toBe(first);
  // A stale finally from the first operation must not clear the second.
  expect(clearWorkspaceGitAction("/proj-a", first)).toBe(false);
  expect(getWorkspaceGitActionSnapshot("/proj-a")?.operationId).toBe(second);
});

test("set phase ignores foreign operation tokens", () => {
  const id = requireOperationId(beginWorkspaceGitAction("/proj-a", "generating"));
  expect(setWorkspaceGitActionPhase("/proj-a", id + 1, "committing")).toBe(false);
  expect(getWorkspaceGitActionSnapshot("/proj-a")?.phase).toBe("generating");
});

test("subscribers are notified for the matching workspace only", () => {
  let aCount = 0;
  let bCount = 0;
  const unsubA = subscribeWorkspaceGitAction("/proj-a", () => {
    aCount += 1;
  });
  const unsubB = subscribeWorkspaceGitAction("/proj-b", () => {
    bCount += 1;
  });

  const id = requireOperationId(beginWorkspaceGitAction("/proj-a", "generating"));
  expect(aCount).toBe(1);
  expect(bCount).toBe(0);
  setWorkspaceGitActionPhase("/proj-a", id, "committing");
  expect(aCount).toBe(2);
  clearWorkspaceGitAction("/proj-a", id);
  expect(aCount).toBe(3);
  expect(bCount).toBe(0);

  unsubA();
  unsubB();
});

test("settlement refreshes and closes on full success", () => {
  expect(
    planWorkspaceGitActionSettlement({
      committedSuccessfully: true,
    }),
  ).toEqual({
    shouldRefresh: true,
    shouldClose: true,
  });
});

test("settlement refreshes once after commit when push fails and keeps the error", () => {
  expect(
    planWorkspaceGitActionSettlement({
      actionError: "push failed",
      committedSuccessfully: true,
    }),
  ).toEqual({
    shouldRefresh: true,
    shouldClose: false,
    errorMessage: "push failed",
  });
});

test("settlement does not refresh when the action fails before commit", () => {
  expect(
    planWorkspaceGitActionSettlement({
      actionError: "commit failed",
      committedSuccessfully: false,
    }),
  ).toEqual({
    shouldRefresh: false,
    shouldClose: false,
    errorMessage: "commit failed",
  });
});

test("settlement plans a single refresh even if callers later fail onSuccess", () => {
  // The helper itself only encodes one refresh decision; callers must not call onSuccess twice.
  const settlement = planWorkspaceGitActionSettlement({
    actionError: "push failed",
    committedSuccessfully: true,
  });
  let refreshCount = 0;
  if (settlement.shouldRefresh) {
    refreshCount += 1;
  }
  expect(refreshCount).toBe(1);
  expect(settlement.shouldClose).toBe(false);
  expect(settlement.errorMessage).toBe("push failed");
});
