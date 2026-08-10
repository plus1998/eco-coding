const DEFAULT_GITHUB_REPOSITORY = "plus1998/eco-coding";
const GITHUB_REPOSITORY_PATTERN = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]+)$/;

export function resolveGitHubRepository(environment = process.env) {
  const value =
    environment.ECO_RELEASE_REPOSITORY?.trim() ||
    environment.GITHUB_REPOSITORY?.trim() ||
    DEFAULT_GITHUB_REPOSITORY;
  const match = GITHUB_REPOSITORY_PATTERN.exec(value);
  if (!match) {
    throw new Error(`Invalid GitHub repository: ${value}. Expected owner/repo.`);
  }
  return { slug: value, owner: match[1], repo: match[2] };
}

export function githubPublishArgs(repository) {
  return [`--config.publish.owner=${repository.owner}`, `--config.publish.repo=${repository.repo}`];
}
