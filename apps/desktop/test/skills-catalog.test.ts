import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  clearSkillsLeaderboardCacheForTests,
  installCatalogSkill,
  listSkillsLeaderboard,
  searchSkillsCatalog,
} from "../src/main/skills-catalog";

test("maps the public skills.sh leaderboard payload", async () => {
  const flightFrame = [
    1,
    `47:${JSON.stringify(["$", "$L4e", null, {
      initialSkills: [
        { source: "owner/repo", skillId: "popular", name: "popular", installs: 900 },
        { source: "owner/repo", skillId: "second", name: "second", installs: 500 },
      ],
    }])}\n`,
  ];
  const result = await listSkillsLeaderboard({
    limit: 1,
    cache: false,
    fetch: async () =>
      new Response(`<html><body><script>self.__next_f.push(${JSON.stringify(flightFrame)})</script></body></html>`),
  });

  expect(result.entries).toEqual([
    {
      id: "owner/repo/popular",
      skillId: "popular",
      name: "popular",
      source: "owner/repo",
      installs: 900,
      url: "https://skills.sh/owner/repo/popular",
    },
  ]);
});

test("caches the skills.sh leaderboard for one hour", async () => {
  clearSkillsLeaderboardCacheForTests();
  let requests = 0;
  const flightFrame = [
    1,
    `47:${JSON.stringify(["$", "$L4e", null, {
      initialSkills: [{ source: "owner/repo", skillId: "popular", name: "popular", installs: 9 }],
    }])}\n`,
  ];
  const fetch = async () => {
    requests += 1;
    return new Response(
      `<html><script>self.__next_f.push(${JSON.stringify(flightFrame)})</script></html>`,
    );
  };

  await listSkillsLeaderboard({ fetch, now: 1_000 });
  await listSkillsLeaderboard({ fetch, now: 1_000 + 60 * 60 * 1000 - 1 });
  expect(requests).toBe(1);
  await listSkillsLeaderboard({ fetch, now: 1_000 + 60 * 60 * 1000 });
  expect(requests).toBe(2);
  clearSkillsLeaderboardCacheForTests();
});

test("maps skills.sh catalog search results", async () => {
  const result = await searchSkillsCatalog("react", {
    fetch: async () =>
      new Response(
        JSON.stringify({
          query: "react",
          searchType: "fuzzy",
          skills: [
            {
              id: "vercel-labs/agent-skills/vercel-react-best-practices",
              skillId: "vercel-react-best-practices",
              name: "vercel-react-best-practices",
              source: "vercel-labs/agent-skills",
              installs: 1234,
            },
          ],
          duration_ms: 12,
        }),
        { status: 200 },
      ),
  });

  expect(result.entries).toEqual([
    {
      id: "vercel-labs/agent-skills/vercel-react-best-practices",
      skillId: "vercel-react-best-practices",
      name: "vercel-react-best-practices",
      source: "vercel-labs/agent-skills",
      installs: 1234,
      url: "https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices",
    },
  ]);
});

test("installs downloaded Skill files into the selected layout", async () => {
  const homedir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-skill-catalog-"));
  try {
    const result = await installCatalogSkill(
      {
        source: "vercel-labs/agent-skills",
        skillId: "demo-skill",
        layout: "codex",
      },
      {
        homedir,
        fetch: async () =>
          new Response(
            JSON.stringify({
              files: [
                { path: "SKILL.md", contents: "---\nname: demo-skill\n---\n" },
                { path: "rules/demo.md", contents: "Demo" },
              ],
            }),
            { status: 200 },
          ),
      },
    );

    expect(result.fileCount).toBe(2);
    expect(await fs.readFile(path.join(result.directory, "rules", "demo.md"), "utf8")).toBe("Demo");
    const lock = JSON.parse(
      await fs.readFile(path.join(homedir, ".codex", ".skill-lock.json"), "utf8"),
    );
    expect(lock.skills["demo-skill"]).toMatchObject({
      source: "vercel-labs/agent-skills",
      skillId: "demo-skill",
    });
  } finally {
    await fs.rm(homedir, { recursive: true, force: true });
  }
});

test("rejects traversal paths from a downloaded Skill", async () => {
  const homedir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-skill-catalog-"));
  try {
    await expect(
      installCatalogSkill(
        { source: "owner/repo", skillId: "unsafe", layout: "agents" },
        {
          homedir,
          fetch: async () =>
            new Response(JSON.stringify({ files: [{ path: "../escape", contents: "bad" }] }), {
              status: 200,
            }),
        },
      ),
    ).rejects.toThrow("越界文件路径");
  } finally {
    await fs.rm(homedir, { recursive: true, force: true });
  }
});
