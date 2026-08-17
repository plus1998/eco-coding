import { lstat, rm } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { AcpClient } from "./acp-client.js";
import { cursorAcpSpawnError, spawnCursorAcpProcess } from "./acp-cursor-agent.js";
import { AcpJsonRpcPeer } from "./acp-jsonrpc.js";

export const ACP_SESSION_ID_INVALID = "ACP 会话 id 非法，拒绝删除本地目录。";
export const ACP_SESSION_DIR_SYMLINK = "ACP 会话目录是符号链接，拒绝删除。";
export const ACP_SESSION_PATH_NOT_DIR = "ACP 会话路径不是目录，拒绝删除。";
export const ACP_SESSION_HOME_MISSING = "ACP 会话目录无法解析：缺少 HOME / USERPROFILE。";

const SESSION_ID_RE = /^[A-Za-z0-9._-]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function agentSupportsSessionDelete(initializeResult: {
  agentCapabilities?: { sessionCapabilities?: unknown };
}): boolean {
  const caps = initializeResult.agentCapabilities?.sessionCapabilities;
  return isRecord(caps) && isRecord(caps.delete);
}

export function acpSessionIdToDelete(session: {
  coreKind?: string;
  externalSessionId?: string;
} | undefined): string | undefined {
  if (session?.coreKind !== "acp") return undefined;
  const id = session.externalSessionId?.trim();
  return id ? id : undefined;
}

export function resolveCursorAcpSessionsDir(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.USERPROFILE?.trim() || env.HOME?.trim();
  if (!home) {
    throw new Error(ACP_SESSION_HOME_MISSING);
  }
  return path.join(home, ".cursor", "acp-sessions");
}

export function resolveCursorAcpSessionDir(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const id = sessionId.trim();
  if (!SESSION_ID_RE.test(id) || id === "." || id === "..") {
    throw new Error(ACP_SESSION_ID_INVALID);
  }
  const sessionsDir = resolveCursorAcpSessionsDir(env);
  const dir = path.join(sessionsDir, id);
  if (path.basename(dir) !== id || path.dirname(dir) !== sessionsDir) {
    throw new Error(ACP_SESSION_ID_INVALID);
  }
  return dir;
}

export async function removeCursorAcpSessionDir(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const dir = resolveCursorAcpSessionDir(sessionId, env);
  let st;
  try {
    st = await lstat(dir);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  if (st.isSymbolicLink()) {
    throw new Error(ACP_SESSION_DIR_SYMLINK);
  }
  if (!st.isDirectory()) {
    throw new Error(ACP_SESSION_PATH_NOT_DIR);
  }
  await rm(dir, { recursive: true, force: true });
}

export const ACP_SESSION_DELETE_FAILED_PREFIX = "ACP session/delete 失败：";
export const ACP_SESSION_DELETE_FALLBACK_LOG =
  "Cursor ACP 未声明 session/delete，改删本地会话目录。";

export function isAcpSessionDeleteMethodNotFound(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /method not found/i.test(message);
}

async function defaultTryProtocolDelete(
  sessionId: string,
  env?: NodeJS.ProcessEnv,
): Promise<"deleted" | "unsupported"> {
  const child = spawnCursorAcpProcess({ ...(env ? { env } : {}) });
  const spawnFailure = cursorAcpSpawnError(child);
  let peer: AcpJsonRpcPeer | undefined;
  let readlineClosed = false;
  try {
    if (!child.stdin || !child.stdout) {
      throw new Error("ACP process requires piped stdin/stdout");
    }
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    peer = new AcpJsonRpcPeer({
      write: (line) => {
        child.stdin!.write(line);
      },
      onLine: (cb) => {
        rl.on("line", cb);
      },
    });
    const closeRl = () => {
      if (readlineClosed) return;
      readlineClosed = true;
      rl.close();
    };
    child.once("exit", () => {
      peer?.dispose();
      closeRl();
    });
    const client = new AcpClient({
      peer,
      clientInfo: { name: "eco", version: "0.0.0" },
    });
    const handshake = (async () => {
      const init = await client.initialize();
      client.confInitialized();
      return init;
    })();
    // Same guard as cursorAcpSpawnError: if spawn ENOENT wins the race,
    // finally peer.dispose() rejects in-flight initialize — must not become
    // an unhandledRejection. Attach before race so the losing branch is observed.
    handshake.catch(() => {});
    const init = await Promise.race([handshake, spawnFailure]);
    if (!agentSupportsSessionDelete(init)) {
      return "unsupported";
    }
    try {
      await client.deleteSession({ sessionId });
      return "deleted";
    } catch (error) {
      if (isAcpSessionDeleteMethodNotFound(error)) {
        return "unsupported";
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${ACP_SESSION_DELETE_FAILED_PREFIX}${message}`);
    }
  } catch (error) {
    if (isAcpSessionDeleteMethodNotFound(error)) {
      return "unsupported";
    }
    if (error instanceof Error && error.message.startsWith(ACP_SESSION_DELETE_FAILED_PREFIX)) {
      throw error;
    }
    return "unsupported";
  } finally {
    peer?.dispose();
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill("SIGTERM");
      } catch {
        // process may already be gone
      }
    }
  }
}

export async function deleteCursorAcpSession(input: {
  sessionId: string;
  env?: NodeJS.ProcessEnv;
  tryProtocolDelete?: (sessionId: string) => Promise<"deleted" | "unsupported">;
  removeLocalSessionDir?: (sessionId: string) => Promise<void>;
  log?: (line: string) => void;
}): Promise<void> {
  const env = input.env;
  resolveCursorAcpSessionDir(input.sessionId, env);
  const tryProtocol =
    input.tryProtocolDelete ?? ((id) => defaultTryProtocolDelete(id, env));
  const removeDir =
    input.removeLocalSessionDir ?? ((id) => removeCursorAcpSessionDir(id, env));
  const log = input.log ?? ((line) => process.stderr.write(`[eco] ${line}\n`));

  let outcome: "deleted" | "unsupported";
  try {
    outcome = await tryProtocol(input.sessionId);
  } catch (error) {
    if (isAcpSessionDeleteMethodNotFound(error)) {
      outcome = "unsupported";
    } else {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith(ACP_SESSION_DELETE_FAILED_PREFIX)) {
        throw error;
      }
      throw new Error(`${ACP_SESSION_DELETE_FAILED_PREFIX}${message}`);
    }
  }
  if (outcome === "deleted") {
    return;
  }
  log(ACP_SESSION_DELETE_FALLBACK_LOG);
  await removeDir(input.sessionId);
}
