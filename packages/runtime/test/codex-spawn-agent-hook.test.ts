import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { syncCodexSpawnAgentHook } from "../src/codex-spawn-agent-hook.js";
import { codexSpawnPayloadPath, codexSpawnRoleQueuePath } from "../src/codex-spawn-role-queue.js";

test("syncCodexSpawnAgentHook writes hooks.json and injects fork_turns=none", async () => {
  const codexHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-spawn-hook-"));
  const { hooksPath, scriptPath, trustKey, trustHash, trustTomlBlock } =
    await syncCodexSpawnAgentHook(codexHomeDir);

  const hooks = JSON.parse(await fs.readFile(hooksPath, "utf8")) as {
    hooks: { PreToolUse: Array<{ matcher: string }> };
  };
  expect(hooks.hooks.PreToolUse[0]?.matcher).toBe(
    "spawn_agent|collaborationspawn_agent|collaboration__spawn_agent",
  );
  expect(await fs.readFile(scriptPath, "utf8")).toContain('fork_turns = "none"');
  expect(trustKey.endsWith(":pre_tool_use:0:0")).toBe(true);
  expect(trustHash.startsWith("sha256:")).toBe(true);
  expect(trustTomlBlock).toContain("trusted_hash");

  const proc = Bun.spawn({
    cmd: ["node", scriptPath],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CODEX_HOME: codexHomeDir },
  });
  // MultiAgentV2 hook stdin uses flat_tool_name: "collaboration" + "spawn_agent".
  proc.stdin.write(
    JSON.stringify({
      tool_name: "collaborationspawn_agent",
      tool_use_id: "call_weather_gz",
      tool_input: {
        agent_type: "explore",
        message: "check weather",
        task_name: "weather_gz",
      },
    }),
  );
  proc.stdin.end();
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;

  const output = JSON.parse(stdout) as {
    hookSpecificOutput: {
      permissionDecision: string;
      updatedInput: { fork_turns: string; agent_type: string; model?: string };
    };
  };
  expect(output.hookSpecificOutput.permissionDecision).toBe("allow");
  expect(output.hookSpecificOutput.updatedInput.fork_turns).toBe("none");
  expect(output.hookSpecificOutput.updatedInput.agent_type).toBe("explore");
  expect(output.hookSpecificOutput.updatedInput.message).toBe("check weather");
  expect(output.hookSpecificOutput.updatedInput.task_name).toBe("weather_gz");
  expect(output.hookSpecificOutput.updatedInput.model).toBeUndefined();
  expect(
    JSON.parse(await fs.readFile(codexSpawnPayloadPath(codexHomeDir, "call_weather_gz"), "utf8")),
  ).toMatchObject({
    agentRole: "explore",
    tool_use_id: "call_weather_gz",
  });
});

test("spawn hook does not infer Profile role from task_name when agent_type is absent", async () => {
  const codexHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-spawn-hook-role-"));
  await fs.mkdir(path.join(codexHomeDir, "agents"), { recursive: true });
  await fs.writeFile(path.join(codexHomeDir, "agents", "explore.toml"), "# fixture\n", "utf8");
  const { scriptPath } = await syncCodexSpawnAgentHook(codexHomeDir);
  const proc = Bun.spawn({
    cmd: ["node", scriptPath],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CODEX_HOME: codexHomeDir },
  });
  proc.stdin.write(
    JSON.stringify({
      tool_name: "collaborationspawn_agent",
      tool_use_id: "call_explore_auth",
      tool_input: {
        message: "scan auth module entry points",
        task_name: "explore",
      },
    }),
  );
  proc.stdin.end();
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;

  const output = JSON.parse(stdout) as {
    hookSpecificOutput: {
      permissionDecision: string;
      updatedInput: { fork_turns: string; message: string; task_name: string };
    };
  };
  expect(output.hookSpecificOutput.permissionDecision).toBe("allow");
  expect(output.hookSpecificOutput.updatedInput.fork_turns).toBe("none");
  expect(output.hookSpecificOutput.updatedInput.task_name).toBe("explore");

  expect(
    await fs
      .stat(codexSpawnRoleQueuePath(codexHomeDir))
      .then(() => true)
      .catch(() => false),
  ).toBe(false);
});

test("spawn hook injects fork_turns when live input has agent_type without task_name", async () => {
  const codexHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-spawn-hook-live-"));
  const { scriptPath } = await syncCodexSpawnAgentHook(codexHomeDir);
  const proc = Bun.spawn({
    cmd: ["node", scriptPath],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CODEX_HOME: codexHomeDir },
  });
  proc.stdin.write(
    JSON.stringify({
      tool_name: "spawn_agent",
      tool_use_id: "call_coder_live",
      tool_input: {
        agent_type: "coder",
        message: "Suggest an implementation approach without editing files.",
      },
    }),
  );
  proc.stdin.end();
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;

  const output = JSON.parse(stdout) as {
    hookSpecificOutput: {
      permissionDecision: string;
      updatedInput: { fork_turns: string; agent_type: string; message: string; task_name?: string };
    };
  };
  expect(output.hookSpecificOutput.permissionDecision).toBe("allow");
  expect(output.hookSpecificOutput.updatedInput.fork_turns).toBe("none");
  expect(output.hookSpecificOutput.updatedInput.agent_type).toBe("coder");
  expect(output.hookSpecificOutput.updatedInput.task_name).toBeUndefined();

  const queued = JSON.parse(
    await fs.readFile(codexSpawnPayloadPath(codexHomeDir, "call_coder_live"), "utf8"),
  ) as {
    agentRole?: string;
    task_name?: string;
  };
  expect(queued.agentRole).toBe("coder");
  expect(queued.task_name).toBe("coder");
});

test("spawn hook fail-open preserves spawn args when tool_input lacks message", async () => {
  const codexHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-spawn-hook-"));
  const { scriptPath } = await syncCodexSpawnAgentHook(codexHomeDir);
  const proc = Bun.spawn({
    cmd: ["node", scriptPath],
    stdin: "pipe",
    stdout: "pipe",
  });
  proc.stdin.write(
    JSON.stringify({
      tool_name: "collaborationspawn_agent",
      tool_input: {
        agent_type: "explore",
        task_name: "weather_gz",
      },
    }),
  );
  proc.stdin.end();
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;

  const output = JSON.parse(stdout) as {
    hookSpecificOutput: {
      permissionDecision: string;
      updatedInput?: unknown;
    };
  };
  expect(output.hookSpecificOutput.permissionDecision).toBe("allow");
  expect(output.hookSpecificOutput.updatedInput).toBeUndefined();
});
