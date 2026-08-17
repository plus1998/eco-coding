# Cursor ACP session/delete 与本地回落 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除 Eco 的 Cursor ACP 对话时，先按能力调用 `session/delete`；当前 CLI 未实现则回落删除 `~/.cursor/acp-sessions/<sessionId>/`，失败不假装已删。

**Architecture:** Runtime 提供能力判断、路径校验、磁盘删除和短生命周期编排 `deleteCursorAcpSession`。`AcpClient.deleteSession` 仅在声明 `sessionCapabilities.delete` 为对象时发 RPC。Desktop `deleteThreadFully` 在删库前读取 `externalSessionId` 并调用编排。

**Tech Stack:** TypeScript, Bun tests, Node `fs/promises` `lstat`/`rm`, Cursor CLI `agent acp`（本机 `2026.08.11-e8db854` 无 `session/delete`）。

**Spec:** [docs/superpowers/specs/2026-08-17-acp-cursor-session-delete-design.md](../specs/2026-08-17-acp-cursor-session-delete-design.md)

## Global Constraints

- `sessionCapabilities.delete` 仅为对象（含 `{}`）才算支持；缺字段 / `null` / `true` 都不算。
- 未声明能力时 **不得** 发 `session/delete`。
- 协议成功 → 不删磁盘。未声明 / Method not found / 握手失败 → 磁盘回落。
- 其它 RPC 错误 → 抛出，不回落，Eco 对话保留。
- `sessionId` 必须匹配 `^[A-Za-z0-9._-]+$`；禁止 `/` `\` `..`；不跟随符号链接。
- POSIX：`$HOME/.cursor/acp-sessions`；Windows：`%USERPROFILE%` 或 `HOME` 下的 `.cursor/acp-sessions`。
- 不把磁盘回落写成「已对接 session/delete」。现有 toast「对话已删除。」不变。
- `AcpJsonRpcPeer` 把 RPC error 收成 `Error(message)`、不带 `code`。Method not found 用 `/method not found/i` 检测（与 `loadSession` 相同）。
- 用户未明确要求时不要 git commit。
- TDD：每个行为先失败测试再实现。

---

## File map

| File | Responsibility |
|------|----------------|
| Create `packages/runtime/src/acp-session-delete.ts` | 能力、路径、磁盘删除、编排 |
| Create `packages/runtime/test/acp-session-delete.test.ts` | 能力 / 路径 / 磁盘 / 编排 |
| Modify `packages/runtime/src/acp-types.ts` | `sessionDelete` 方法名；`ACP_SESSION_DELETE_UNSUPPORTED` |
| Modify `packages/runtime/src/acp-client.ts` | `deleteSession` |
| Modify `packages/runtime/test/acp-client.test.ts` | 有/无能力的 RPC 测例 |
| Modify `packages/runtime/src/index.ts` | 导出 |
| Modify `apps/desktop/src/main/index.ts` | `deleteThreadFully` 删库前调用 |
| Modify `apps/desktop/src/shared/i18n-catalogs.ts` + 测试 | 非法 id / 符号链接 / 非目录 / 协议失败 |

---

### Task 1: 能力判断、路径、磁盘删除

**Files:**
- Create: `packages/runtime/src/acp-session-delete.ts`（本任务只放纯函数 + 磁盘，不含 spawn 编排；编排在 Task 3 追加到同一文件）
- Create: `packages/runtime/test/acp-session-delete.test.ts`
- Modify: `packages/runtime/src/index.ts`（`export * from "./acp-session-delete.js"`）

**Interfaces:**
- Consumes: `node:fs/promises` `lstat`/`rm`；`node:path`；`node:os` 不直接用，路径只从 env 拼
- Produces:

```ts
export const ACP_SESSION_ID_INVALID = "ACP 会话 id 非法，拒绝删除本地目录。";
export const ACP_SESSION_DIR_SYMLINK = "ACP 会话目录是符号链接，拒绝删除。";
export const ACP_SESSION_PATH_NOT_DIR = "ACP 会话路径不是目录，拒绝删除。";
export const ACP_SESSION_HOME_MISSING = "ACP 会话目录无法解析：缺少 HOME / USERPROFILE。";

export function agentSupportsSessionDelete(initializeResult: {
  agentCapabilities?: { sessionCapabilities?: unknown };
}): boolean;

export function resolveCursorAcpSessionsDir(env?: NodeJS.ProcessEnv): string;
export function resolveCursorAcpSessionDir(sessionId: string, env?: NodeJS.ProcessEnv): string;
export function acpSessionIdToDelete(session: {
  coreKind?: string;
  externalSessionId?: string;
} | undefined): string | undefined;

export async function removeCursorAcpSessionDir(
  sessionId: string,
  env?: NodeJS.ProcessEnv,
): Promise<void>;
```

- [ ] **Step 1: Write the failing test**

Create `packages/runtime/test/acp-session-delete.test.ts`:

```ts
import { expect, test } from "bun:test";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ACP_SESSION_DIR_SYMLINK,
  ACP_SESSION_HOME_MISSING,
  ACP_SESSION_ID_INVALID,
  ACP_SESSION_PATH_NOT_DIR,
  acpSessionIdToDelete,
  agentSupportsSessionDelete,
  removeCursorAcpSessionDir,
  resolveCursorAcpSessionDir,
  resolveCursorAcpSessionsDir,
} from "../src/acp-session-delete.js";

test("agentSupportsSessionDelete is true only for delete object", () => {
  expect(
    agentSupportsSessionDelete({ agentCapabilities: { sessionCapabilities: { delete: {} } } }),
  ).toBe(true);
  expect(agentSupportsSessionDelete({ agentCapabilities: { sessionCapabilities: { list: {} } } })).toBe(
    false,
  );
  expect(
    agentSupportsSessionDelete({ agentCapabilities: { sessionCapabilities: { delete: null } } }),
  ).toBe(false);
  expect(
    agentSupportsSessionDelete({ agentCapabilities: { sessionCapabilities: { delete: true } } }),
  ).toBe(false);
  expect(agentSupportsSessionDelete({})).toBe(false);
});

test("acpSessionIdToDelete only returns trimmed ids for acp sessions", () => {
  expect(acpSessionIdToDelete({ coreKind: "acp", externalSessionId: " sess-1 " })).toBe("sess-1");
  expect(acpSessionIdToDelete({ coreKind: "claude", externalSessionId: "sess-1" })).toBeUndefined();
  expect(acpSessionIdToDelete({ coreKind: "acp", externalSessionId: "  " })).toBeUndefined();
  expect(acpSessionIdToDelete(undefined)).toBeUndefined();
});

test("resolveCursorAcpSessionsDir uses HOME on POSIX and USERPROFILE on Windows", () => {
  expect(resolveCursorAcpSessionsDir({ HOME: "/tmp/home" })).toBe(
    path.join("/tmp/home", ".cursor", "acp-sessions"),
  );
  expect(resolveCursorAcpSessionsDir({ USERPROFILE: "C:\\Users\\a", HOME: "" })).toBe(
    path.join("C:\\Users\\a", ".cursor", "acp-sessions"),
  );
  expect(() => resolveCursorAcpSessionsDir({})).toThrow(ACP_SESSION_HOME_MISSING);
});

test("resolveCursorAcpSessionDir rejects path traversal and illegal characters", () => {
  const env = { HOME: "/tmp/home" };
  expect(resolveCursorAcpSessionDir("  abc-123  ", env)).toBe(
    path.join("/tmp/home", ".cursor", "acp-sessions", "abc-123"),
  );
  expect(() => resolveCursorAcpSessionDir("../x", env)).toThrow(ACP_SESSION_ID_INVALID);
  expect(() => resolveCursorAcpSessionDir("a/b", env)).toThrow(ACP_SESSION_ID_INVALID);
  expect(() => resolveCursorAcpSessionDir("a\\b", env)).toThrow(ACP_SESSION_ID_INVALID);
});

test("removeCursorAcpSessionDir deletes a real directory and treats missing as success", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "eco-acp-sess-"));
  const env = { HOME: root };
  const sessionId = "11111111-1111-1111-1111-111111111111";
  const dir = resolveCursorAcpSessionDir(sessionId, env);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "meta.json"), "{}");
  await removeCursorAcpSessionDir(sessionId, env);
  expect(await Bun.file(path.join(dir, "meta.json")).exists()).toBe(false);
  await removeCursorAcpSessionDir(sessionId, env);
});

test("removeCursorAcpSessionDir refuses symlinks and non-directories", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "eco-acp-sess-"));
  const env = { HOME: root };
  const sessions = resolveCursorAcpSessionsDir(env);
  await mkdir(sessions, { recursive: true });
  const linkId = "link-session-id";
  const fileId = "file-session-id";
  await symlink(sessions, path.join(sessions, linkId));
  await writeFile(path.join(sessions, fileId), "nope");
  await expect(removeCursorAcpSessionDir(linkId, env)).rejects.toThrow(ACP_SESSION_DIR_SYMLINK);
  await expect(removeCursorAcpSessionDir(fileId, env)).rejects.toThrow(ACP_SESSION_PATH_NOT_DIR);
});
```

Windows 上 `symlink` 可能需要权限：若 `symlink` 抛 `EPERM`，该测例用 `test.skipIf(process.platform === "win32")` 包住 symlink 分支，file 非目录分支仍要跑。实现时若在 win32 跳过 symlink 断言，在测试里写：

```ts
test.skipIf(process.platform === "win32")("removeCursorAcpSessionDir refuses symlinks", async () => { ... });
```

并把非目录测例拆成独立 test（上面第二个 test 拆开即可）。

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/runtime/test/acp-session-delete.test.ts`

Expected: FAIL — 模块不存在。

- [ ] **Step 3: Write minimal implementation**

Create `packages/runtime/src/acp-session-delete.ts`：

```ts
import { lstat, rm } from "node:fs/promises";
import path from "node:path";

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
  if (!SESSION_ID_RE.test(id)) {
    throw new Error(ACP_SESSION_ID_INVALID);
  }
  return path.join(resolveCursorAcpSessionsDir(env), id);
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
```

`resolveCursorAcpSessionsDir` 的 Windows 测例传入 `USERPROFILE` 且 `HOME: ""`：实现必须 **先** 看 `USERPROFILE`（trim 后非空），再看 `HOME`。空字符串不算。

在 `packages/runtime/src/index.ts` 增加 `export * from "./acp-session-delete.js"`。

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `bun test packages/runtime/test/acp-session-delete.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**（仅当用户要求）

```bash
git add packages/runtime/src/acp-session-delete.ts packages/runtime/test/acp-session-delete.test.ts packages/runtime/src/index.ts
git commit -m "feat(acp): 增加 Cursor ACP 会话目录删除与能力判断"
```

---

### Task 2: `AcpClient.deleteSession`

**Files:**
- Modify: `packages/runtime/src/acp-types.ts`
- Modify: `packages/runtime/src/acp-client.ts`
- Modify: `packages/runtime/test/acp-client.test.ts`

**Interfaces:**
- Consumes: `agentSupportsSessionDelete` from `acp-session-delete.ts`
- Produces:

```ts
// acp-types.ts
ACP_PROTOCOL.methods.sessionDelete = "session/delete"
export const ACP_SESSION_DELETE_UNSUPPORTED = "ACP_SESSION_DELETE_UNSUPPORTED";

// AcpClient
async deleteSession(input: { sessionId: string }): Promise<void>
```

- [ ] **Step 1: Write the failing tests**

在 `packages/runtime/test/acp-client.test.ts` 的 `ACP_METHODS` 增加 `sessionDelete: "session/delete"`。

追加：

```ts
test("deleteSession sends session/delete when capability is advertised", async () => {
  const { io, client } = createClient();
  const initPromise = client.initialize();
  const initReq = parseWrites(io.writes).at(-1)!;
  io.emit(
    encodeJsonRpcLine({
      jsonrpc: "2.0",
      id: initReq.id,
      result: {
        ...INIT_RESULT,
        agentCapabilities: {
          ...INIT_RESULT.agentCapabilities,
          sessionCapabilities: { list: {}, delete: {} },
        },
      },
    }),
  );
  await initPromise;
  client.confInitialized();

  const pending = client.deleteSession({ sessionId: "sess-del" });
  await waitMicro();
  const req = parseWrites(io.writes).at(-1)!;
  expect(req.method).toBe("session/delete");
  expect(req.params).toEqual({ sessionId: "sess-del" });
  io.emit(encodeJsonRpcLine({ jsonrpc: "2.0", id: req.id, result: {} }));
  await pending;
});

test("deleteSession does not send RPC when delete capability is missing", async () => {
  const { io, client } = createClient();
  await handshake(io, client);
  const writesBefore = io.writes.length;
  await expect(client.deleteSession({ sessionId: "sess-del" })).rejects.toThrow(
    /ACP_SESSION_DELETE_UNSUPPORTED/,
  );
  expect(io.writes.length).toBe(writesBefore);
});
```

若文件里没有 `waitMicro`，用：

```ts
function waitMicro(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
```

现有 `loadSession` 测例怎么等写出请求，就怎么抄，不要发明第二种等待。

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/runtime/test/acp-client.test.ts`

Expected: FAIL — `deleteSession` 不存在。

- [ ] **Step 3: Write minimal implementation**

`packages/runtime/src/acp-types.ts`：

- `methods` 增加 `sessionDelete: "session/delete"`
- 增加 `export const ACP_SESSION_DELETE_UNSUPPORTED = "ACP_SESSION_DELETE_UNSUPPORTED";`

`packages/runtime/src/acp-client.ts`：import `ACP_SESSION_DELETE_UNSUPPORTED` 与 `agentSupportsSessionDelete`。

在 `cancel` 旁增加：

```ts
  async deleteSession(input: { sessionId: string }): Promise<void> {
    if (!agentSupportsSessionDelete(this.initializeResult ?? {})) {
      throw new Error(
        `${ACP_SESSION_DELETE_UNSUPPORTED}: agent did not advertise sessionCapabilities.delete`,
      );
    }
    await this.peer.request(ACP_PROTOCOL.methods.sessionDelete, {
      sessionId: input.sessionId,
    });
  }
```

未 initialize 时 `initializeResult` 为空 → 不支持 → 抛 UNSUPPORTED，不发 RPC。

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `bun test packages/runtime/test/acp-client.test.ts packages/runtime/test/acp-session-delete.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**（仅当用户要求）

```bash
git add packages/runtime/src/acp-types.ts packages/runtime/src/acp-client.ts packages/runtime/test/acp-client.test.ts
git commit -m "feat(acp): 按能力门禁实现 session/delete"
```

---

### Task 3: 编排 `deleteCursorAcpSession`

**Files:**
- Modify: `packages/runtime/src/acp-session-delete.ts`
- Modify: `packages/runtime/test/acp-session-delete.test.ts`

**Interfaces:**
- Consumes: Task 1 磁盘函数；Task 2 `AcpClient.deleteSession`；`spawnCursorAcpProcess` / `AcpJsonRpcPeer` / `cursorAcpSpawnError`（默认实现）
- Produces:

```ts
export const ACP_SESSION_DELETE_FAILED_PREFIX = "ACP session/delete 失败：";
export const ACP_SESSION_DELETE_FALLBACK_LOG =
  "Cursor ACP 未声明 session/delete，改删本地会话目录。";

export function isAcpSessionDeleteMethodNotFound(error: unknown): boolean;

export async function deleteCursorAcpSession(input: {
  sessionId: string;
  env?: NodeJS.ProcessEnv;
  tryProtocolDelete?: (sessionId: string) => Promise<"deleted" | "unsupported">;
  removeLocalSessionDir?: (sessionId: string) => Promise<void>;
  log?: (line: string) => void;
}): Promise<void>;
```

默认 `tryProtocolDelete`：spawn `agent acp` → initialize → `notifications/initialized` → 若无能力返回 `"unsupported"`；若有能力则 `deleteSession`，成功返回 `"deleted"`。进程在 `finally` 里 SIGTERM。握手抛错视为 `"unsupported"`（回落磁盘），不要把握手错误抛给 UI。

`deleteSession` 抛错：`isAcpSessionDeleteMethodNotFound` 为 true → `"unsupported"`；否则 `throw new Error(ACP_SESSION_DELETE_FAILED_PREFIX + message)`。

编排：

```
await resolveCursorAcpSessionDir(sessionId, env) // 非法 id 先抛，不 spawn
try {
  outcome = await tryProtocolDelete(sessionId)
} catch (e) {
  if (method not found) outcome = unsupported
  else throw e  // 已带 prefix 的协议错误
}
if (outcome === "deleted") return
log(ACP_SESSION_DELETE_FALLBACK_LOG)
await removeLocalSessionDir(sessionId)
```

- [ ] **Step 1: Write the failing tests**

追加到 `acp-session-delete.test.ts`：

```ts
import {
  ACP_SESSION_DELETE_FAILED_PREFIX,
  ACP_SESSION_DELETE_FALLBACK_LOG,
  deleteCursorAcpSession,
  isAcpSessionDeleteMethodNotFound,
} from "../src/acp-session-delete.js";

test("isAcpSessionDeleteMethodNotFound detects JSON-RPC method missing", () => {
  expect(isAcpSessionDeleteMethodNotFound(new Error('"Method not found": session/delete'))).toBe(
    true,
  );
  expect(isAcpSessionDeleteMethodNotFound(new Error("Method not found"))).toBe(true);
  expect(isAcpSessionDeleteMethodNotFound(new Error("not authenticated"))).toBe(false);
});

test("deleteCursorAcpSession skips disk after protocol success", async () => {
  const removed: string[] = [];
  const logs: string[] = [];
  await deleteCursorAcpSession({
    sessionId: "sess-ok",
    tryProtocolDelete: async () => "deleted",
    removeLocalSessionDir: async (id) => {
      removed.push(id);
    },
    log: (line) => logs.push(line),
  });
  expect(removed).toEqual([]);
  expect(logs).toEqual([]);
});

test("deleteCursorAcpSession falls back to disk when protocol is unsupported", async () => {
  const removed: string[] = [];
  const logs: string[] = [];
  await deleteCursorAcpSession({
    sessionId: "sess-fb",
    tryProtocolDelete: async () => "unsupported",
    removeLocalSessionDir: async (id) => {
      removed.push(id);
    },
    log: (line) => logs.push(line),
  });
  expect(removed).toEqual(["sess-fb"]);
  expect(logs).toEqual([ACP_SESSION_DELETE_FALLBACK_LOG]);
});

test("deleteCursorAcpSession falls back when protocol throws method not found", async () => {
  const removed: string[] = [];
  await deleteCursorAcpSession({
    sessionId: "sess-32601",
    tryProtocolDelete: async () => {
      throw new Error('"Method not found": session/delete');
    },
    removeLocalSessionDir: async (id) => {
      removed.push(id);
    },
    log: () => {},
  });
  expect(removed).toEqual(["sess-32601"]);
});

test("deleteCursorAcpSession does not touch disk on other protocol errors", async () => {
  const removed: string[] = [];
  await expect(
    deleteCursorAcpSession({
      sessionId: "sess-auth",
      tryProtocolDelete: async () => {
        throw new Error("not authenticated");
      },
      removeLocalSessionDir: async (id) => {
        removed.push(id);
      },
    }),
  ).rejects.toThrow(`${ACP_SESSION_DELETE_FAILED_PREFIX}not authenticated`);
  expect(removed).toEqual([]);
});

test("deleteCursorAcpSession rejects illegal ids before protocol", async () => {
  let protocolCalled = false;
  await expect(
    deleteCursorAcpSession({
      sessionId: "../x",
      tryProtocolDelete: async () => {
        protocolCalled = true;
        return "deleted";
      },
      removeLocalSessionDir: async () => {},
    }),
  ).rejects.toThrow(ACP_SESSION_ID_INVALID);
  expect(protocolCalled).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/runtime/test/acp-session-delete.test.ts`

Expected: FAIL — `deleteCursorAcpSession` 未导出。

- [ ] **Step 3: Write minimal implementation**

在 `acp-session-delete.ts` 追加 import：`createInterface` from `node:readline`；`AcpClient`、`AcpJsonRpcPeer`、`cursorAcpSpawnError`、`spawnCursorAcpProcess`。

```ts
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
      throw error;
    }
  }
  if (outcome === "deleted") {
    return;
  }
  log(ACP_SESSION_DELETE_FALLBACK_LOG);
  await removeDir(input.sessionId);
}
```

握手失败（ENOENT、timeout、invalid initialize）走外层 catch：不是 method-not-found、也没有 FAILED_PREFIX → 返回 `"unsupported"`。不要把握手错误抛给调用方。

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `bun test packages/runtime/test/acp-session-delete.test.ts packages/runtime/test/acp-client.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**（仅当用户要求）

```bash
git add packages/runtime/src/acp-session-delete.ts packages/runtime/test/acp-session-delete.test.ts
git commit -m "feat(acp): 编排 session/delete 与本地目录回落"
```

---

### Task 4: Desktop `deleteThreadFully` + i18n

**Files:**
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/shared/i18n-catalogs.ts`
- Modify: `apps/desktop/test/i18n-catalogs.test.ts`
- Create: `apps/desktop/test/delete-acp-cursor-session.test.ts`（只测 `acpSessionIdToDelete` 的 Desktop 用法说明不够；改为测一个从 index 抽出的薄封装 **不要** 把 `deleteThreadFully` 整段搬进测试。Desktop 调用点用注释 + 直接调用 runtime 函数即可。）

Desktop 接线不抽新文件：在 `deleteThreadFully` 里直接调 runtime。Task 1 的 `acpSessionIdToDelete` 已覆盖「Claude 不删 / ACP 才删」。本任务测 i18n 映射，并在 `deleteThreadFully` 写入调用。

**Interfaces:**
- Consumes: `acpSessionIdToDelete`、`deleteCursorAcpSession` from `@eco/runtime`
- Produces: `deleteThreadFully` 在 `conversationStore.deleteThread` 之前：

```ts
  const coreSession = conversationStore.getThreadCoreSession(threadId);
  const acpSessionId = acpSessionIdToDelete(coreSession);
  if (acpSessionId) {
    await deleteCursorAcpSession({
      sessionId: acpSessionId,
      ...(resolveAcpCursorEnv ? { env: resolveAcpCursorEnv() } : {}),
    });
  }
```

`resolveAcpCursorEnv` 已在 main 里用于 spawn；同一函数。若当前是 `resolveAcpCursorEnv()` 局部函数，直接调用。找不到则传 `undefined` env（runtime 用 `process.env`）。

- [ ] **Step 1: Write the failing i18n tests**

`apps/desktop/test/i18n-catalogs.test.ts` 的 ACP 测例数组增加：

```ts
    "ACP 会话 id 非法，拒绝删除本地目录。",
    "ACP 会话目录是符号链接，拒绝删除。",
    "ACP 会话路径不是目录，拒绝删除。",
    "ACP session/delete 失败：not authenticated",
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/desktop/test/i18n-catalogs.test.ts`

Expected: FAIL — 新文案没有 `expectedIpcErrorKey`。该文件里若仍有既有失败 `"导入文件没有包含智能体配置。"`，**不要改那条**；只保证新 key 的断言失败原因是缺映射。可把新文案放进单独 test：

```ts
test("ACP session delete IPC errors localize without raw Chinese in en-US", () => {
  const messages = [
    "ACP 会话 id 非法，拒绝删除本地目录。",
    "ACP 会话目录是符号链接，拒绝删除。",
    "ACP 会话路径不是目录，拒绝删除。",
    "ACP session/delete 失败：not authenticated",
  ];
  for (const message of messages) {
    const key = expectedIpcErrorKey(message);
    expect(key).toBeDefined();
    expect(translateCatalog("en-US", key!)).not.toMatch(/[\u3400-\u9fff]/);
  }
});
```

- [ ] **Step 3: Write minimal implementation**

i18n zh-CN（紧挨现有 acp 键）：

```ts
      "native.acpSessionIdInvalid": "ACP 会话 id 非法，拒绝删除本地目录。",
      "native.acpSessionDirSymlink": "ACP 会话目录是符号链接，拒绝删除。",
      "native.acpSessionPathNotDir": "ACP 会话路径不是目录，拒绝删除。",
      "native.acpSessionDeleteFailed": "ACP session/delete 失败：{{detail}}",
```

en-US：

```ts
      "native.acpSessionIdInvalid": "ACP session id is invalid; refusing to delete the local directory.",
      "native.acpSessionDirSymlink": "ACP session path is a symbolic link; refusing to delete.",
      "native.acpSessionPathNotDir": "ACP session path is not a directory; refusing to delete.",
      "native.acpSessionDeleteFailed": "ACP session/delete failed: {{detail}}",
```

`expectedIpcErrorKey`：

```ts
  if (message === "ACP 会话 id 非法，拒绝删除本地目录。") {
    return "native.acpSessionIdInvalid";
  }
  if (message === "ACP 会话目录是符号链接，拒绝删除。") {
    return "native.acpSessionDirSymlink";
  }
  if (message === "ACP 会话路径不是目录，拒绝删除。") {
    return "native.acpSessionPathNotDir";
  }
  if (message.startsWith("ACP session/delete 失败：")) {
    return "native.acpSessionDeleteFailed";
  }
```

`translateCatalog` 对 `native.acpSessionDeleteFailed` 需要 `detail`。现有 `expectedIpcErrorKey` 只返回 key；renderer 如何把 prefix 后的片段填进 `{{detail}}` 若已有通用 startsWith 处理则跟随。若没有，检查 `localizeExpectedIpcError` / 同类函数：对 `acpLoadSessionFailed` 怎么抽 detail，session/delete 同样抽 `message.slice("ACP session/delete 失败：".length)`。

在 `index.ts`：

1. import：

```ts
import { acpSessionIdToDelete, deleteCursorAcpSession } from "@eco/runtime";
```

2. `deleteThreadFully` 在 `conversationStore.deleteThread(threadId)` **之前**插入：

```ts
  const acpSessionId = acpSessionIdToDelete(conversationStore.getThreadCoreSession(threadId));
  if (acpSessionId) {
    await deleteCursorAcpSession({
      sessionId: acpSessionId,
      env: resolveAcpCursorEnv(),
    });
  }
```

`resolveAcpCursorEnv` 若返回 `{}` 也可以。不要放在 `deleteThread` 之后。

- [ ] **Step 4: Run the tests and make sure they pass**

Run:

```
bun test packages/runtime/test/acp-session-delete.test.ts packages/runtime/test/acp-client.test.ts apps/desktop/test/i18n-catalogs.test.ts
```

Expected：本任务新增 ACP session delete i18n test PASS。既有 `"导入文件没有包含智能体配置。"` 失败若仍在，记为缺口，不在本任务修复。

确认 `index.ts` 调用在 `deleteThread` 之前：`rg -n "deleteCursorAcpSession|deleteThread\\(" apps/desktop/src/main/index.ts`

- [ ] **Step 5: Commit**（仅当用户要求）

```bash
git add apps/desktop/src/main/index.ts apps/desktop/src/shared/i18n-catalogs.ts apps/desktop/test/i18n-catalogs.test.ts
git commit -m "feat(acp): 删除对话时清理 Cursor ACP 会话"
```

---

## 验收（非 CI）

当前 CLI 无 `session/delete`。手动：建一条 Cursor ACP 对话 → 记下 `externalSessionId` → 删 Eco 对话 → `session/list` 不再包含该 id；`~/.cursor/acp-sessions/<id>` 不存在。stderr 可有「未声明 session/delete，改删本地会话目录」。UI 仍是「对话已删除。」

---

## Spec coverage

| Spec 项 | Task |
|---------|------|
| `agentSupportsSessionDelete` | Task 1 |
| 路径 / 非法 id / 符号链接 / ENOENT | Task 1 |
| `acpSessionIdToDelete` | Task 1 |
| `AcpClient.deleteSession` 门禁 | Task 2 |
| 编排：成功不删盘；unsupported / -32601 回落；其它错误不回落 | Task 3 |
| 握手失败回落 | Task 3 默认实现 catch → unsupported |
| `deleteThreadFully` 删库前调用 | Task 4 |
| i18n | Task 4 |
| 真机冒烟 | 验收节 |
