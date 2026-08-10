import { expect, test } from "bun:test";
import { githubPublishArgs, resolveGitHubRepository } from "../scripts/release-repository.mjs";

test("release repository follows the current GitHub Actions repository", () => {
  const repository = resolveGitHubRepository({ GITHUB_REPOSITORY: "example/eco-coding-fork" });

  expect(repository).toEqual({
    slug: "example/eco-coding-fork",
    owner: "example",
    repo: "eco-coding-fork",
  });
  expect(githubPublishArgs(repository)).toEqual([
    "--config.publish.owner=example",
    "--config.publish.repo=eco-coding-fork",
  ]);
});

test("explicit release repository overrides the GitHub Actions repository", () => {
  expect(
    resolveGitHubRepository({
      ECO_RELEASE_REPOSITORY: "release-owner/release-repo",
      GITHUB_REPOSITORY: "example/eco-coding-fork",
    }).slug,
  ).toBe("release-owner/release-repo");
});

test("invalid release repository is rejected", () => {
  expect(() => resolveGitHubRepository({ ECO_RELEASE_REPOSITORY: "missing-slash" })).toThrow(
    "Expected owner/repo",
  );
});
