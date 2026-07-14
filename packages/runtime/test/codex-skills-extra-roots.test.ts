import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  buildCodexSkillsExtraRootsSetParams,
  CODEX_SKILLS_EXTRA_ROOTS_SET_METHOD,
  setCodexSkillsExtraRoots,
} from "../src/codex-skills-extra-roots";

describe("Codex skills extra roots", () => {
  test("sends normalized absolute roots and removes exact duplicates", async () => {
    const requests: Array<{ method: string; params: unknown }> = [];
    const client = {
      async request<T>(method: string, params?: unknown): Promise<T> {
        requests.push({ method, params });
        return {} as T;
      },
    };
    const root = path.resolve("/tmp/eco-skills");

    await setCodexSkillsExtraRoots(client, [root, `${root}${path.sep}`]);

    expect(requests).toEqual([
      {
        method: CODEX_SKILLS_EXTRA_ROOTS_SET_METHOD,
        params: { extraRoots: [root] },
      },
    ]);
  });

  test("rejects relative or blank roots instead of resolving them implicitly", () => {
    expect(() => buildCodexSkillsExtraRootsSetParams(["relative/skills"])).toThrow(
      "must be an absolute path",
    );
    expect(() => buildCodexSkillsExtraRootsSetParams([" "])).toThrow("must be a non-empty absolute path");
  });

  test("rejects a malformed response", async () => {
    const client = {
      async request<T>(): Promise<T> {
        return { accepted: true } as T;
      },
    };
    await expect(setCodexSkillsExtraRoots(client, [path.resolve("/tmp/eco-skills")])).rejects.toThrow(
      "response must be an empty object",
    );
  });
});
