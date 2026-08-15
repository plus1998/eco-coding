# Cursor 核心外置开关与环境门禁设计

日期：2026-08-15  
状态：已确认，待写实现计划

## 问题

Cursor 通过本机 Cursor Agent CLI（`agent`）作为第四种 Agent 核心接入。它的模型/提供商机制与 Eco 内置的 provider → 编排 → role route 链路不兼容。若把 Cursor 与 Claude / Codex / π 一样常驻在可选核心里，容易误导用户，也跳过了环境前置（已安装 CLI、已登录、能拉到模型列表）。

## 目标

1. 用后缀 label **外置** / **External**，把 Cursor 与三个内置核心区分开。
2. 默认不出现在可选核心里。
3. 必须先打开独立开关，Cursor 才会进入核心选择器。
4. 只有环境探测通过（CLI 存在 + 能列出模型）时，才允许打开开关。
5. 若曾经开启、后来环境失效：自动关闭开关；若默认核心是 Cursor，回退为 Claude。
6. 已有 Cursor 线程仍可打开查看；续跑/开跑会再次校验开关 + 探测，失败时给出明确错误，修好后可继续。

## 非目标（本前置不做）

- 把 Composer 的 Eco 模型选择器改成 Cursor 模型。
- 向 Cursor 注入 Eco skills / MCP / providers。
- 单独做「Cursor 集成」设置页。
- 改动 Cursor CLI 流式映射 / session resume（本前置只加门禁）。

## 方案

在 workflow 设置中持久化 `cursorCoreEnabled`。加强 Cursor 可用性探测（不止检查可执行文件）。UI 与 main 进程的新建/续跑统一用：

```
showCursorCore = cursorCoreEnabled && cursor.available
```

## 数据模型

### Workflow 设置（`workflow_settings`）

| Key | 类型 | 默认 | 含义 |
|-----|------|------|------|
| `cursor_core_enabled` | boolean | `false` | 用户是否启用 Cursor 核心 |
| `cursor_model_id` | string（已有） | 未设置 | 可选的 Cursor CLI 模型 id |
| `default_core_kind` | CoreKind（已有） | `claude` | 新建线程默认核心 |

### 可用性快照

扩展 `coreAvailability.cursor`：`available` 表示**完整探测通过**，而不只是找到 `agent`：

1. 能解析到可执行文件（`CURSOR_AGENT_EXECUTABLE` 或默认路径 / PATH）。
2. `listCursorAgentModels()` 成功，且至少返回 1 个模型。

失败时：`available: false`，并带 i18n `reason`，覆盖：缺少 CLI、models 命令失败、空模型列表（含 CLI 暴露的未登录等问题）。

## 开关写入规则

- **打开（`true`）**：先探测；失败则拒绝写入并返回原因，不落库为 `true`。
- **关闭（`false`）**：立即落库。若 `defaultCoreKind === "cursor"`，同时改为 `"claude"`。
- **对账**：应用启动 / 加载 workflow / 打开默认 Agent 设置（以及刷新核心可用性）时，若库中 `cursorCoreEnabled === true` 但探测失败 → 强制改为 `false`，并做同样的默认核心回退。

## UI

### Label

- Cursor 显示名：`Cursor` + 后缀「外置」（zh-CN）/「External」（en-US）。
- 侧栏菜单、已锁定线程标题、默认 Agent 选项列表保持一致。
- 三个内置核心（Claude Code、Codex、π）不加后缀。

### 默认 Agent 设置

- 主单选列表默认只有 Claude / Codex / π。
- 单独控件：「启用 Cursor 核心（外置）」开关。
  - 探测中：开关禁用 + loading。
  - 探测失败：开关保持关且不可开；展示原因 +「重新检测」。
  - 探测成功：可打开；打开后主列表出现「Cursor · 外置」；当默认核心为 Cursor 时，保留现有模型下拉。
- 关闭开关：列表移出 Cursor；若默认是 Cursor，回退 Claude。

### 侧栏核心选择器

- 仅当 `showCursorCore` 为 true 时渲染 Cursor 项。
- 新建会话草稿：未展示则不可选 Cursor。
- 已绑定 `coreKind: "cursor"` 的历史线程：标题仍显示「Cursor · 外置」/「Cursor · External」（即使之后关了开关）。

## Main 进程门禁

- **新建线程**且 `coreKind === "cursor"`：必须 `cursorCoreEnabled && cursor.available`，否则抛出明确错误（不静默改核心）。
- **续跑 / 启动 Cursor run**：同一门禁；失败时用明确文案区分（未启用 / CLI 不可用 / 无法获取模型）。用户重新启用且探测通过后可再续跑。
- **只读历史 / 投影**：不因开关关闭而拦截。

## 错误与 i18n（最低要求）

- Cursor 不可用（缺少 CLI）— 可继续用现有 `native.cursorUnavailable`。
- 模型探测失败 / 空列表 — 按需新增文案。
- Cursor 核心未启用 — 新建/续跑在开关关闭时用新文案。
- 设置页开关说明 — 解释「外置」与 opt-in。

具体 catalog key 实现时再定；中英（zh-CN / en-US）都必须有。

## 测试

1. 默认：开关关 → 侧栏与默认 Agent 列表无 Cursor。
2. 探测失败 → 无法打开开关；原因可见。
3. 探测成功 → 可打开 → 侧栏与设置出现「Cursor · 外置」。
4. 开启后环境失效（或 mock 探测失败）→ 自动关开关 + `defaultCoreKind` Cursor→Claude。
5. 历史 Cursor 线程可打开查看；门禁未过时续跑有明确错误；重新启用且探测健康后可续跑。
6. 选择器显示名 / label 的中英覆盖测试。

## 预期改动落点

- `apps/desktop/src/main/workflow-settings-store.ts` — 持久化 `cursorCoreEnabled`
- `apps/desktop/src/shared/ipc.ts`（+ preload）— 设置字段与可用性语义
- `apps/desktop/src/main/index.ts` — 探测、对账、新建/续跑门禁
- `packages/runtime` — 复用 `listCursorAgentModels`（本门禁不需新 driver 协议）
- `DefaultAgentSettingsPanel.tsx`、`SidebarCoreSelector.tsx`、`App.tsx`、i18n、相关测试

## 已拍板决策（brainstorming）

- 门禁模型：**A** — 探测通过才能开开关；打开后才进选择器。
- Label：**外置** / **External**。
- 环境回退：自动关开关 + 默认核心回退。
- 已有线程：可打开查看；续跑再校验门禁（选项 B）。
