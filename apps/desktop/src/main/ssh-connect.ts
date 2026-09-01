import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import type { InteractiveTerminalManager } from "./interactive-terminal-manager";
import { resolveCommandExecutable } from "./resolve-command-executable";
import type { SshBookmarkPublic } from "../shared/ssh-bookmarks";
import { SSH_DEFAULT_PORT } from "../shared/ssh-bookmarks";

export interface SshConnectSecrets {
  password?: string;
  storedKey?: string;
}

export interface SshConnectInput {
  workspacePath: string;
  bookmark: SshBookmarkPublic;
  secrets: SshConnectSecrets;
  userDataDir: string;
}

export interface SshConnectResult {
  sessionId: string;
  label: string;
  passwordAutoInject: boolean;
}

function splitExtraArgs(extraArgs: string | undefined): string[] {
  if (!extraArgs?.trim()) {
    return [];
  }
  return extraArgs.trim().split(/\s+/).filter(Boolean);
}

export function buildSshArgv(
  bookmark: SshBookmarkPublic,
  identityFilePath?: string,
): string[] {
  const ssh = resolveCommandExecutable(process.platform === "win32" ? "ssh.exe" : "ssh");
  const args = [ssh, "-p", String(bookmark.port || SSH_DEFAULT_PORT), "-o", "StrictHostKeyChecking=accept-new"];
  if (identityFilePath) {
    args.push("-i", identityFilePath);
  }
  args.push(...splitExtraArgs(bookmark.extraArgs));
  args.push(`${bookmark.username}@${bookmark.host}`);
  return args;
}

async function ensureStoredKeyFile(userDataDir: string, bookmarkId: string, keyContent: string): Promise<string> {
  const keyDir = path.join(userDataDir, "ssh-keys");
  await fsPromises.mkdir(keyDir, { recursive: true });
  const keyPath = path.join(keyDir, bookmarkId);
  await fsPromises.writeFile(keyPath, keyContent.endsWith("\n") ? keyContent : `${keyContent}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return keyPath;
}

function resolveIdentityFilePath(
  bookmark: SshBookmarkPublic,
  secrets: SshConnectSecrets,
  userDataDir: string,
): Promise<string | undefined> {
  if (bookmark.authType !== "key") {
    return Promise.resolve(undefined);
  }
  if (bookmark.keySource === "path") {
    const keyPath = bookmark.keyPath?.trim();
    if (!keyPath) {
      throw new Error("SSH key path is required.");
    }
    if (!fs.existsSync(keyPath)) {
      throw new Error(`SSH key file not found: ${keyPath}`);
    }
    return Promise.resolve(keyPath);
  }
  const storedKey = secrets.storedKey?.trim();
  if (!storedKey) {
    throw new Error("Stored SSH private key is missing.");
  }
  return ensureStoredKeyFile(userDataDir, bookmark.id, storedKey);
}

function createAskpassScript(userDataDir: string): string {
  const scriptsDir = path.join(userDataDir, "ssh-askpass");
  fs.mkdirSync(scriptsDir, { recursive: true });
  if (process.platform === "win32") {
    const scriptPath = path.join(scriptsDir, "eco-ssh-askpass.cmd");
    if (!fs.existsSync(scriptPath)) {
      fs.writeFileSync(
        scriptPath,
        "@echo off\r\nif defined ECO_SSH_PASSWORD echo %ECO_SSH_PASSWORD%\r\n",
        "utf8",
      );
    }
    return scriptPath;
  }
  const scriptPath = path.join(scriptsDir, "eco-ssh-askpass.sh");
  if (!fs.existsSync(scriptPath)) {
    fs.writeFileSync(scriptPath, "#!/bin/sh\nprintf '%s\\n' \"$ECO_SSH_PASSWORD\"\n", {
      encoding: "utf8",
      mode: 0o700,
    });
  } else {
    try {
      fs.chmodSync(scriptPath, 0o700);
    } catch {
      // ignore chmod failures on exotic filesystems
    }
  }
  return scriptPath;
}

function buildPasswordSpawnEnv(password: string, userDataDir: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  env.ECO_SSH_PASSWORD = password;
  env.SSH_ASKPASS = createAskpassScript(userDataDir);
  env.SSH_ASKPASS_REQUIRE = "force";
  if (process.platform === "win32") {
    env.WT_SESSION = env.WT_SESSION ?? "1";
  } else {
    env.DISPLAY = env.DISPLAY ?? ":0";
  }
  return env;
}

export async function connectSshBookmark(
  manager: InteractiveTerminalManager,
  input: SshConnectInput,
): Promise<SshConnectResult> {
  const workspacePath = input.workspacePath.trim();
  if (!workspacePath) {
    throw new Error("Workspace path is required.");
  }
  if (!fs.existsSync(workspacePath)) {
    throw new Error(`Workspace directory does not exist: ${workspacePath}`);
  }

  const identityFilePath = await resolveIdentityFilePath(input.bookmark, input.secrets, input.userDataDir);
  const command = buildSshArgv(input.bookmark, identityFilePath);
  const executable = command[0];
  const args = command.slice(1);
  if (!executable) {
    throw new Error("SSH executable is required.");
  }

  const label = input.bookmark.name.trim() || `${input.bookmark.username}@${input.bookmark.host}`;
  const password = input.secrets.password?.trim();
  const passwordAutoInject = input.bookmark.authType === "password" && Boolean(password);

  if (passwordAutoInject && password) {
    const sessionId = manager.spawnCommandWithEnv(
      workspacePath,
      executable,
      args,
      buildPasswordSpawnEnv(password, input.userDataDir),
    ).sessionId;
    return { sessionId, label, passwordAutoInject: true };
  }

  const { sessionId } = manager.spawnCommand(workspacePath, command);
  return { sessionId, label, passwordAutoInject: false };
}
