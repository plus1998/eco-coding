#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const tag = process.env.GITHUB_REF_NAME?.trim();
const eventName = process.env.GITHUB_EVENT_NAME?.trim();
const headSha = git(["rev-parse", "HEAD"]);
const sha = eventName === "workflow_dispatch" ? headSha : process.env.GITHUB_SHA?.trim();
if (!tag || !sha) {
  throw new Error("GITHUB_REF_NAME and a resolvable commit SHA are required.");
}

const betaMatch = /^v(\d+\.\d+\.\d+)-beta\.(\d+)$/.exec(tag);
const stableMatch = /^v(\d+\.\d+\.\d+)$/.exec(tag);
const channel = betaMatch ? "beta" : stableMatch ? "latest" : undefined;
const version = betaMatch ? `${betaMatch[1]}-beta.${betaMatch[2]}` : stableMatch?.[1];
const branch = channel === "beta" ? "beta" : channel === "latest" ? "main" : undefined;

if (!channel || !version || !branch) {
  throw new Error(`Unsupported release tag: ${tag}. Expected vX.Y.Z or vX.Y.Z-beta.N.`);
}

const taggedSha = git(["rev-parse", `${tag}^{commit}`]);
if (taggedSha !== sha) {
  throw new Error(`Tag ${tag} resolves to ${taggedSha}, but GITHUB_SHA is ${sha}.`);
}

const branchRef = `origin/${branch}`;
try {
  git(["merge-base", "--is-ancestor", sha, branchRef]);
} catch {
  throw new Error(`Tag ${tag} is not reachable from ${branchRef}.`);
}

const output = process.env.GITHUB_OUTPUT;
if (output) {
  appendFileSync(output, `tag=${tag}\nversion=${version}\nchannel=${channel}\nbranch=${branch}\n`, "utf8");
}
console.log(`Validated ${tag}: version=${version}, channel=${channel}, branch=${branch}`);

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}
