import { describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  approvedPlanFilePath,
  formatApprovedPlanDocument,
  isWorktreeGitCwdError,
  parseApprovedPlanDocument,
  resolveWorktreePathHint,
  verifyApprovedPlanArtifact,
  writeApprovedPlanSnapshot,
} from "../src/main/worktree-lifecycle";

describe("isWorktreeGitCwdError", () => {
  test("detects missing cwd", () => {
    expect(
      isWorktreeGitCwdError(
        new Error("Failed to list untracked files: fatal: Unable to read current working directory"),
      ),
    ).toBe(true);
    expect(isWorktreeGitCwdError(new Error("Failed to list untracked files:"))).toBe(true);
  });

  test("ignores unrelated git errors", () => {
    expect(isWorktreeGitCwdError(new Error("Failed to list changed files: merge conflict"))).toBe(false);
  });
});

describe("approved plan snapshot", () => {
  test("builds stable file path and document", () => {
    expect(approvedPlanFilePath("/repo", "thr_1")).toBe("/repo/.eco/approved-plans/thr_1.md");
    const doc = formatApprovedPlanDocument({
      userPrompt: "fix bug",
      analysis: "root cause",
      plan: "## Steps\n1. patch",
      planUserEdited: true,
    });
    expect(doc).toContain("fix bug");
    expect(doc).toContain("## Steps");
    expect(doc).toContain("edited this plan");
    const parsed = parseApprovedPlanDocument(doc);
    expect(parsed?.plan).toBe("## Steps\n1. patch");
    expect(parsed?.planUserEdited).toBe(true);
  });

  test("keeps level-two headings inside the approved plan body", () => {
    const plan = [
      "# Eco image integration",
      "",
      "## Summary",
      "- Add image profiles.",
      "",
      "## Tests",
      "- Restore the full plan after restart.",
    ].join("\n");
    const doc = formatApprovedPlanDocument({
      userPrompt: "add image generation",
      analysis: "persist the approved plan",
      plan,
    });

    expect(parseApprovedPlanDocument(doc)?.plan).toBe(plan);
  });

  test("atomically writes a deterministic artifact and detects later content drift", async () => {
    const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "eco-plan-artifact-"));
    const artifact = await writeApprovedPlanSnapshot(workspacePath, "thread/unsafe", {
      userPrompt: "fix export",
      analysis: "missing handler",
      plan: "1. add route",
    });
    expect(artifact).toEqual({
      absolutePath: path.join(workspacePath, ".eco", "approved-plans", "thread-unsafe.md"),
      relativePath: ".eco/approved-plans/thread-unsafe.md",
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(
      verifyApprovedPlanArtifact({ workspacePath, threadId: "thread/unsafe", ...artifact }),
    ).toEqual({ ok: true });

    await fs.writeFile(artifact.absolutePath, "tampered\n", "utf8");
    expect(
      verifyApprovedPlanArtifact({ workspacePath, threadId: "thread/unsafe", ...artifact }),
    ).toMatchObject({ ok: false, reason: expect.stringContaining("content hash") });
  });
});

describe("resolveWorktreePathHint", () => {
  test("prefers active run path over pending and default", () => {
    expect(
      resolveWorktreePathHint({
        threadId: "thr_1",
        workspacePath: "/repo",
        activeWorktreePath: "/repo/.eco/worktrees/thr_1",
        pendingWorktreePath: "/repo/.eco/worktrees/old",
        sdkSessionCwd: "/repo",
      }),
    ).toBe("/repo/.eco/worktrees/thr_1");
  });

  test("falls back to default worktree path", () => {
    expect(
      resolveWorktreePathHint({
        threadId: "thr_2",
        workspacePath: "/repo",
      }),
    ).toBe("/repo/.eco/worktrees/thr_2");
  });

  test("uses the persisted Core session cwd when no active or SDK path exists", () => {
    expect(
      resolveWorktreePathHint({
        threadId: "thr_codex",
        workspacePath: "/repo",
        coreSessionCwd: "/repo/codex-session",
      }),
    ).toBe("/repo/codex-session");
  });
});
