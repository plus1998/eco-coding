import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
  buildShellCommandLine,
  pathDirectories,
  resolveCommandExecutable,
  shellQuoteArg,
  toSpawnEnv,
} from "../src/main/resolve-command-executable";

test("shellQuoteArg quotes unsafe characters", () => {
  expect(shellQuoteArg("dev")).toBe("dev");
  expect(shellQuoteArg("a b")).toBe("'a b'");
  expect(shellQuoteArg("it's")).toBe("'it'\\''s'");
});

test("buildShellCommandLine joins quoted argv", () => {
  expect(buildShellCommandLine(["bun", "run", "dev"])).toBe("bun run dev");
  expect(buildShellCommandLine(["npm", "run", "test", "--", "--watch"])).toBe(
    "npm run test -- --watch",
  );
});

test("pathDirectories prepends common bin directories", () => {
  const directories = pathDirectories({ PATH: "/bin", HOME: "/Users/demo" });
  expect(directories).toContain("/opt/homebrew/bin");
  expect(directories).toContain("/Users/demo/.bun/bin");
  expect(directories).toContain("/bin");
});

test("toSpawnEnv keeps only string env values and sets TERM", () => {
  const env = toSpawnEnv({ PATH: "/bin", HOME: "/Users/demo", EMPTY: undefined });
  expect(env.PATH).toContain("/bin");
  expect(env.TERM).toBe("xterm-256color");
  expect(env.EMPTY).toBeUndefined();
});

test("resolveCommandExecutable prefers homebrew bun when present", () => {
  const candidate = "/opt/homebrew/bin/bun";
  if (!existsSync(candidate)) {
    return;
  }
  expect(resolveCommandExecutable("bun")).toBe(candidate);
});
