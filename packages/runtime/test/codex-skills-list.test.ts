import { describe, expect, test } from "bun:test";
import {
  buildCodexSkillsListParams,
  CODEX_SKILLS_LIST_METHOD,
  listCodexSkills,
  parseCodexSkillsListResponse,
} from "../src/codex-skills-list";

function skill(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "review",
    description: "Review a change",
    shortDescription: "Review",
    interface: {
      displayName: "Review",
      shortDescription: "Review a change",
      iconSmall: "/repo/review/small.png",
      iconLarge: "/repo/review/large.png",
      brandColor: "#123456",
      defaultPrompt: "Review this change",
    },
    dependencies: {
      tools: [
        {
          type: "mcp",
          value: "github",
          description: "GitHub tools",
          transport: "stdio",
          command: "github-mcp",
          url: "https://example.test/mcp",
        },
      ],
    },
    path: "/repo/.codex/skills/review/SKILL.md",
    scope: "repo",
    enabled: true,
    ...overrides,
  };
}

describe("listCodexSkills", () => {
  test("sends cwds and forceReload and preserves cwd, path, scope, enabled, and errors", async () => {
    const requests: Array<{ method: string; params: unknown }> = [];
    const client = {
      async request<T>(method: string, params?: unknown): Promise<T> {
        requests.push({ method, params });
        return {
          data: [
            {
              cwd: "/repo",
              skills: [skill()],
              errors: [{ path: "/repo/.codex/skills/broken/SKILL.md", message: "invalid YAML" }],
            },
          ],
        } as T;
      },
    };

    await expect(listCodexSkills(client, { cwds: ["/repo", "/other"], forceReload: true })).resolves.toEqual([
      {
        cwd: "/repo",
        skills: [skill()],
        errors: [{ path: "/repo/.codex/skills/broken/SKILL.md", message: "invalid YAML" }],
      },
    ]);
    expect(requests).toEqual([
      {
        method: CODEX_SKILLS_LIST_METHOD,
        params: { cwds: ["/repo", "/other"], forceReload: true },
      },
    ]);
  });

  test("uses explicit protocol defaults", () => {
    expect(buildCodexSkillsListParams()).toEqual({ cwds: [], forceReload: false });
  });
});

describe("parseCodexSkillsListResponse", () => {
  test("accepts the 0.142.5 system-skill interface shape with explicit null fields", () => {
    const parsed = parseCodexSkillsListResponse({
      data: [
        {
          cwd: "/repo",
          skills: [
            skill({
              scope: "system",
              interface: {
                displayName: "Skill Creator",
                shortDescription: null,
                iconSmall: null,
                iconLarge: null,
                brandColor: null,
                defaultPrompt: null,
              },
            }),
          ],
          errors: [],
        },
      ],
    });

    expect(parsed[0]?.skills[0]?.interface).toEqual({
      displayName: "Skill Creator",
      shortDescription: null,
      iconSmall: null,
      iconLarge: null,
      brandColor: null,
      defaultPrompt: null,
    });
  });

  test("accepts nullable optional skill metadata and tool dependency fields", () => {
    const parsed = parseCodexSkillsListResponse({
      data: [
        {
          cwd: "/repo",
          skills: [
            skill({ shortDescription: null, interface: null, dependencies: null }),
            skill({
              dependencies: {
                tools: [
                  {
                    type: "mcp",
                    value: "github",
                    description: null,
                    transport: null,
                    command: null,
                    url: null,
                  },
                ],
              },
            }),
          ],
          errors: [],
        },
      ],
    });

    expect(parsed[0]?.skills[0]).toEqual(
      expect.objectContaining({ shortDescription: null, interface: null, dependencies: null }),
    );
    expect(parsed[0]?.skills[1]?.dependencies?.tools[0]).toEqual({
      type: "mcp",
      value: "github",
      description: null,
      transport: null,
      command: null,
      url: null,
    });
  });

  test("accepts omitted optional skill metadata", () => {
    const parsed = parseCodexSkillsListResponse({
      data: [
        {
          cwd: "/repo",
          skills: [
            {
              name: "review",
              description: "Review",
              path: "/repo/SKILL.md",
              scope: "repo",
              enabled: true,
            },
          ],
          errors: [],
        },
      ],
    });

    expect(parsed[0]?.skills[0]).toEqual({
      name: "review",
      description: "Review",
      path: "/repo/SKILL.md",
      scope: "repo",
      enabled: true,
    });
  });

  test("accepts every pinned skill scope", () => {
    expect(
      parseCodexSkillsListResponse({
        data: [
          {
            cwd: "/repo",
            skills: ["user", "repo", "system", "admin"].map((scope) => skill({ scope })),
            errors: [],
          },
        ],
      })[0]?.skills.map((entry) => entry.scope),
    ).toEqual(["user", "repo", "system", "admin"]);
  });

  for (const [name, payload, expected] of [
    ["non-object response", null, "response must be an object"],
    ["missing data", {}, "response.data must be an array"],
    [
      "invalid scope",
      { data: [{ cwd: "/repo", skills: [skill({ scope: "workspace" })], errors: [] }] },
      ".scope must be user, repo, system, or admin",
    ],
    [
      "missing enabled",
      {
        data: [
          {
            cwd: "/repo",
            skills: [
              {
                name: "review",
                description: "Review",
                path: "/repo/SKILL.md",
                scope: "repo",
              },
            ],
            errors: [],
          },
        ],
      },
      ".enabled must be a boolean",
    ],
    [
      "invalid interface type",
      { data: [{ cwd: "/repo", skills: [skill({ interface: 1 })], errors: [] }] },
      ".interface must be an object",
    ],
    [
      "invalid nullable dependency field",
      {
        data: [
          {
            cwd: "/repo",
            skills: [
              skill({
                dependencies: {
                  tools: [{ type: "mcp", value: "github", description: 1 }],
                },
              }),
            ],
            errors: [],
          },
        ],
      },
      ".description must be a string or null when present",
    ],
    [
      "malformed dependency",
      {
        data: [
          {
            cwd: "/repo",
            skills: [skill({ dependencies: { tools: [{ type: "mcp", value: 1 }] } })],
            errors: [],
          },
        ],
      },
      ".value must be a non-empty string",
    ],
  ] as const) {
    test(`rejects ${name}`, () => {
      expect(() => parseCodexSkillsListResponse(payload)).toThrow(expected);
    });
  }
});
