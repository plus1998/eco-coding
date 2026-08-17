# Cursor ACP session/delete 与本地回落设计

日期：2026-08-17  
状态：draft  
相关：`docs/superpowers/specs/2026-08-15-acp-host-cursor-design.md`

## 问题

Eco 删除 Cursor ACP 对话时只清本地库，不清 Cursor 侧会话。`session/list` 会一直堆积旧会话。

ACP 已稳定 `session/delete`（能力门禁：`agentCapabilities.sessionCapabilities.delete` 为 `{}` 表示支持）。当前 Cursor CLI **没有实现该方法**。

## 真机依据（本机，2026-08-17）

对 `/Users/plus/.local/bin/agent`（`2026.08.11-e8db854`）实测：

- initialize：`sessionCapabilities: { list: {} }`，**没有** `delete`
- `session/delete`（真 id / 假 id）均 `-32601`：`"Method not found": session/delete`
- `session/list` 可用，会列出 `~/.cursor/acp-sessions/<sessionId>/` 下的会话
- 会话目录含 `meta.json`（`schemaVersion`, `cwd`, `title`）和 `store.db`
- 手工删除探测留下的目录 `~/.cursor/acp-sessions/2f0422e1-…/` 后，`session/list` 不再包含该 id

官方 ACP：未声明 `delete` 时客户端 **MUST NOT** 调用 `session/delete`。成功结果为 `{}`。已删除或不存在的会话 **SHOULD** 静默成功。

## 目标（MVP）

1. Eco 实现协议门禁：`AcpClient.deleteSession`；仅当 `sessionCapabilities.delete` 为对象（含 `{}`）时才发 `session/delete`。
2. 删除 Eco 的 ACP 线程时尝试协议删除。
3. 当前 CLI 未声明 / `-32601`：回落删除 `~/.cursor/acp-sessions/<sessionId>/`。
4. 协议其它错误或磁盘失败：明确抛错，不假装已删；Eco 对话保留。
5. 不把磁盘回落写成「已对接 session/delete」。

## 非目标（MVP）

- `session/list` UI / 从 Cursor 列表导入会话。
- 扫描并清理 Eco 没记下 id 的历史 Cursor 会话。
- 交互式 `agent` 终端里的其它删会话入口。
- 在 running/queued 时强删（沿用现有「先停止再删」）。
- 把删除能力写进 `ACP_CORE_CAPABILITIES` 或 `hostUiFeatures`。
- CI 必跑真机 `agent acp`。

## 方案

协议优先，磁盘回落（方案 C）。

```text
deleteThreadFully(threadId)
        │
        ├─ 在 conversationStore.deleteThread 之前读取 core session
        ├─ 非 acp / 无 externalSessionId → 跳过
        ▼
deleteCursorAcpSession(sessionId)
        │
        ├─ spawn agent acp → initialize
        ├─ 已声明 delete → session/delete { sessionId }
        │     成功 → 结束（不删磁盘）
        │     -32601 → 磁盘回落
        │     其它 RPC 错误 → 抛出
        └─ 未声明 delete，或握手失败 → 磁盘回落
              ~/.cursor/acp-sessions/<sessionId>/
```

短生命周期进程：只做 handshake + 可选 `session/delete`，不 `session/prompt`。不复用正在跑的 `AcpAgentDriver` 子进程（删线程时运行已被拦住）。

## 数据模型

### 能力

```ts
export function agentSupportsSessionDelete(initializeResult: {
  agentCapabilities?: { sessionCapabilities?: unknown };
}): boolean;
```

仅当 `sessionCapabilities` 是对象，且 `delete` 是对象（含 `{}`）时为 true。`delete` 缺失、`null`、`true`、其它非对象值均为 false。

与 ACP v1 文档一致：Supplying `{}` means the Agent supports the method.

### 协议

`ACP_PROTOCOL.methods.sessionDelete = "session/delete"`

```ts
async deleteSession(input: { sessionId: string }): Promise<void>
```

- 未声明能力：抛 `ACP_SESSION_DELETE_UNSUPPORTED`（不发 RPC）。
- 请求：`{ sessionId }`。
- 成功：`result` 为对象即可（空 `{}` 合法）；不要求额外字段。

### 磁盘路径

```ts
export function resolveCursorAcpSessionsDir(env?: NodeJS.ProcessEnv): string;
```

- POSIX：`path.join(HOME, ".cursor", "acp-sessions")`
- Windows：`path.join(USERPROFILE || HOME, ".cursor", "acp-sessions")`
- HOME/USERPROFILE 都缺：抛错，不猜路径。

```ts
export function resolveCursorAcpSessionDir(sessionId: string, env?: NodeJS.ProcessEnv): string;
```

`sessionId` 规范化：`trim()` 后必须非空，且匹配 `^[A-Za-z0-9._-]+$`（Cursor 现用 UUID，允许字母数字、点、下划线、连字符）。含 `/` `\` `..` 或其它字符：抛 `ACP 会话 id 非法，拒绝删除本地目录。`

返回 `path.join(sessionsDir, sessionId)`。调用方删除前：

1. `lstat`：不存在 → 成功返回。
2. 是符号链接 → 抛 `ACP 会话目录是符号链接，拒绝删除。`
3. 不是目录 → 抛 `ACP 会话路径不是目录，拒绝删除。`
4. `rm(dir, { recursive: true, force: true })`。

不解析、不跟随链接。不删除 `acp-sessions` 根目录。不按 title/cwd 扫描。

## 数据流

`deleteThreadFully` 在 `conversationStore.deleteThread` **之前**调用清理（否则 id 已丢）：

1. `getThreadCoreSession(threadId)`
2. `coreKind === "acp"` 且 `externalSessionId` 非空 → `await deleteCursorAcpSession({ sessionId, env: resolveAcpCursorEnv() })`
3. 然后现有 Claude SDK / PI / 网关 / `deleteThread` / Codex checkpoint

侧栏删除与存储清理都走 `deleteThreadFully`，不必再接一条 IPC。

无 session 行：跳过，不报错。

## 错误处理

| 情况 | 行为 |
|---|---|
| 非 ACP / 无 session id | 跳过 |
| 已声明 delete 且 RPC 成功 | 结束，不删磁盘 |
| 未声明 delete | 磁盘回落；stderr 诊断一行：当前 agent 未声明 session/delete，改删本地目录 |
| `-32601` | 磁盘回落；同样打诊断 |
| 握手失败 | 磁盘回落；磁盘成功则继续删 Eco 库 |
| 其它 RPC 错误 | 抛出，不回落，Eco 对话保留 |
| 目录 ENOENT | 成功 |
| 非法 id / 符号链接 / 非目录 | 抛出 |
| 磁盘 rm 失败 | 抛出，Eco 对话保留 |
| running/queued | 现有拦截，到不了本逻辑 |

抛出文案（进 i18n `expectedIpcErrorKey`）：

- `ACP 会话 id 非法，拒绝删除本地目录。`
- `ACP 会话目录是符号链接，拒绝删除。`
- `ACP 会话路径不是目录，拒绝删除。`
- `ACP session/delete 失败：` + RPC message（非 -32601）
- 磁盘 `rm` 失败：抛底层错误 message（ENOENT 除外），不改写成「已对接 session/delete」。
- 未声明 delete 且磁盘也失败：抛磁盘错误；stderr 已说明走了回落。

握手失败但磁盘成功：不向 UI 抛握手错误（回落已完成清理）。诊断写 stderr。

不得把磁盘回落的成功 toast 写成「已通过 session/delete 删除」。现有「对话已删除。」不变。

## 测试

1. `agentSupportsSessionDelete`：`{ delete: {} }` true；缺字段 / `null` / `true` false。
2. `AcpClient.deleteSession`：有能力则写出 `session/delete`；无能力抛 `ACP_SESSION_DELETE_UNSUPPORTED` 且无该 RPC。
3. 编排 mock：无能力 → 不发 delete、调用磁盘删除；`-32601` → 磁盘删除；其它 RPC 错误 → 不调用磁盘。
4. `resolveCursorAcpSessionDir` / 删除：合法 id 删子目录；`../x`、带 `/` 的 id 抛错且不删；目标不存在成功。
5. Desktop：ACP 线程 `deleteThreadFully` 会调清理（可用注入 seam）；Claude 线程不调。
6. 真机冒烟非 CI：当前 CLI 删 Eco ACP 对话后，`session/list` 不再有该 id。

## 预期改动落点

- `packages/runtime/src/acp-types.ts`：`sessionDelete` 方法名；`ACP_SESSION_DELETE_UNSUPPORTED`
- `packages/runtime/src/acp-client.ts`：`deleteSession`
- `packages/runtime/src/acp-session-delete.ts`（新）：能力判断、路径、磁盘删除、编排 `deleteCursorAcpSession`
- 对应 runtime 测试
- `apps/desktop/src/main/index.ts`：`deleteThreadFully` 在删库前调用
- `apps/desktop/src/shared/i18n-catalogs.ts` + 测试

## 已拍板决策

- 范围 **C**：协议门禁 + 当前 CLI 磁盘回落。
- 触发：删 Eco 对话（`deleteThreadFully`），不做 list UI。
- 协议成功不删磁盘；未声明 / `-32601` / 握手失败才删磁盘。
- 其它 RPC 错误不回落。
- 本机已验证：当前 CLI 无 `session/delete`；删对应目录后 `session/list` 会少该 id。
