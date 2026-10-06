#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

const version = process.env.ECO_RELEASE_VERSION?.trim();
if (!version) {
  throw new Error("ECO_RELEASE_VERSION is required.");
}

const changelogPath = process.env.CHANGELOG_PATH?.trim() || "CHANGELOG.md";
const outputPath = process.env.RELEASE_NOTES_OUTPUT?.trim() || "release-notes.md";

const changelog = await readFile(changelogPath, "utf8");
const notes = extractSection(changelog, version);
if (!notes) {
  throw new Error(
    `${changelogPath} has no notes for ${version}. Add a "## v${version}" section before tagging the release.`,
  );
}

await writeFile(outputPath, `${notes}\n`, "utf8");
console.log(`Wrote release notes for ${version} to ${outputPath} (${notes.length} characters).`);

function extractSection(markdown, target) {
  const lines = markdown.split(/\r?\n/);
  let start = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const heading = /^##\s+(v?[\w.+-]+)\s*$/.exec(lines[index]);
    if (!heading) {
      continue;
    }

    const sectionVersion = heading[1].replace(/^v/, "");
    if (start === -1) {
      if (sectionVersion === target) {
        start = index + 1;
      }
      continue;
    }

    return lines.slice(start, index).join("\n").trim();
  }

  return start === -1 ? "" : lines.slice(start).join("\n").trim();
}
