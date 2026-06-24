import { expect, test } from "bun:test";
import { GitAutoFetcher } from "../src/main/git-autofetch";

test("GitAutoFetcher fetches when workspace is set and window is focused", async () => {
  const fetchCalls: string[] = [];
  const fetched: string[] = [];
  const fetcher = new GitAutoFetcher({
    run: async (args, cwd) => {
      fetchCalls.push(cwd);
      const key = args.join(" ");
      if (key === "git remote get-url origin") {
        return { exitCode: 0, stdout: "git@github.com:eco/repo.git", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    },
    onFetched: (workspacePath) => {
      fetched.push(workspacePath);
    },
    isGitBusy: () => false,
  });

  fetcher.configure({ enabled: true, periodSeconds: 30 });
  fetcher.setWindowFocused(true);
  fetcher.setWorkspace("/tmp/repo");

  await new Promise((resolve) => setTimeout(resolve, 100));
  fetcher.dispose();

  expect(fetchCalls.length).toBeGreaterThan(0);
  expect(fetchCalls[0]).toBe("/tmp/repo");
  expect(fetched).toContain("/tmp/repo");
});

test("GitAutoFetcher does not fetch when disabled", async () => {
  const fetchCalls: string[] = [];
  const fetcher = new GitAutoFetcher({
    run: async (_args, cwd) => {
      fetchCalls.push(cwd);
      return { exitCode: 0, stdout: "", stderr: "" };
    },
    isGitBusy: () => false,
  });

  fetcher.configure({ enabled: false });
  fetcher.setWindowFocused(true);
  fetcher.setWorkspace("/tmp/repo");

  await new Promise((resolve) => setTimeout(resolve, 100));
  fetcher.dispose();

  expect(fetchCalls).toEqual([]);
});
