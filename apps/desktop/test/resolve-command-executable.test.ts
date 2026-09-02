import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
  buildShellCommandLine,
  buildWindowsCommandLine,
  pathDirectories,
  resolveCommandExecutable,
  shellQuoteArg,
  toSpawnEnv,
  windowsCmdQuoteArg,
} from "../src/main/resolve-command-executable";

test("shellQuoteArg quotes unsafe characters", () => {
  expect(shellQuoteArg("dev")).toBe("dev");
  expect(shellQuoteArg("a b")).toBe("'a b'");
  expect(shellQuoteArg("it's")).toBe("'it'\\''s'");
});

test("buildShellCommandLine joins quoted argv", () => {
  expect(buildShellCommandLine(["bun", "run", "dev"])).toBe("bun run dev");
  if (process.platform === "win32") {
    expect(buildShellCommandLine(["npm", "run", "test", "--", "--watch"])).toBe(
      "npm run test -- --watch",
    );
    expect(buildWindowsCommandLine(["C:\\Program Files\\nodejs\\npm.cmd", "run", "dev"])).toBe(
      '"C:\\Program Files\\nodejs\\npm.cmd" run dev',
    );
  } else {
    expect(buildShellCommandLine(["npm", "run", "test", "--", "--watch"])).toBe(
      "npm run test -- --watch",
    );
  }
});

test("windowsCmdQuoteArg quotes unsafe cmd characters", () => {
  expect(windowsCmdQuoteArg("dev")).toBe("dev");
  expect(windowsCmdQuoteArg("a b")).toBe('"a b"');
  expect(windowsCmdQuoteArg('say "hi"')).toBe('"say ""hi"""');
});

test("pathDirectories prepends common bin directories", () => {
  if (process.platform === "win32") {
    const directories = pathDirectories({ Path: "C:\\bin", USERPROFILE: "C:\\Users\\demo" });
    expect(directories).toContain("C:\\Program Files\\nodejs");
    expect(directories).toContain("C:\\bin");
    return;
  }
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

test("resolveCommandExecutable prefers npm.cmd over bash shim on Windows", () => {
  if (process.platform !== "win32") {
    return;
  }
  const resolved = resolveCommandExecutable("npm");
  expect(resolved.toLowerCase().endsWith(".cmd")).toBe(true);
});
