# ACP 宿主与 Cursor（ACP）接入设计

日期：2026-08-15  
状态：已实现（单元/集成测已绿；Electron 手动冒烟未跑）  
取代：`2026-08-15-cursor-core-opt-in-design.md`（「外置」+ stream-json Cursor 核心）相关产品方向；该前置中的 opt-in 门禁语义保留并迁移到 ACP/Cursor。

## 问题

1. 现有 Cursor 集成走 `agent --print --output-format stream-json`，与 Cursor 的 `agent acp`（Agent Client Protocol）不是同一路径，难统一做工具批准、计划模式等宿主能力。
2. 「外置」label 只表达「非内置」，不能表达「按 ACP 标准接入」；后续还会有其它 ACP agent，需要统一宿主与标识。
3. Eco 的模型/提供商机制与 Cursor 账号模型仍不兼容；Cursor 不得硬塞进 Eco provider 路由。

## 目标（MVP）

1. 在 `packages/runtime` 建立 **ACP 宿主**（stdio JSON-RPC，按 ACP v2 会话语义）。
2. 第一个 agent：`acpAgentId: "cursor"`，启动本机 `agent acp`。
3. 桌面侧核心改为 `coreKind: "acp"` + `acpAgentId`；UI 显示 **「Cursor · ACP」**（具体 agent 名 + **ACP** label）。
4. 将会话流映射为现有 `AgentEvent`，支持新建、续跑（若协议/实现支持）、取消。
5. 保留 **opt-in 门禁**：默认不进可选核心；探测通过才能打开对应 agent 开关；环境失效自动关闭并回退默认核心。
6. **全面替换并废弃** stream-json `CursorAgentDriver` 方案，不双轨。

## 非目标（MVP）

- 完整工具审批卡 / Plan 审批接到 ACP（仅 capability / hook 占位）。
- 实现第二个 ACP agent（只保证扩展点）。
- Composer 用 Eco provider 选择 Cursor 模型。
- 保留 stream-json 作为 fallback。

## 方案

采用 runtime 内 ACP 宿主 + 按 agent 的 adapter：

- Desktop 按 `acpAgentId` 选择 adapter（MVP 仅 `cursor`）。
- 映射层把 ACP 通知转为 Eco `AgentEvent`，复用现有投影 / `consumeSdkRunEvents`。
- 审批与 Plan 预留接口，MVP 诚实标注未支持或 planned。

## 废弃清单

| 废弃项 | 处理 |
|--------|------|
| `CursorAgentDriver`（`--print` + `stream-json`）及 NDJSON 映射 | 删除或移出主路径，测试改写/删除 |
| 一等 `coreKind: "cursor"` | 改为 `acp` + `acpAgentId: "cursor"` |
| UI label「外置」/「External」 | 改为「ACP」 |
| 仅检查可执行文件 / 仅 `agent models` 作为最终探测语义 | 升级为含 ACP 最小握手（实现可分阶段，见下） |

## 数据模型

### Core

- `CORE_KINDS`：`"claude" | "codex" | "pi" | "acp"`（移除一等 `"cursor"`）。
- 线程：`coreKind: "acp"` 时必有 `acpAgentId`（MVP：`"cursor"`）。
- 显示名：`{AgentDisplayName} · ACP`（zh/en 均用「ACP」缩写，不翻译协议名）。

### Workflow 设置

| Key / 字段 | 含义 | 默认 |
|------------|------|------|
| `acpAgentsEnabled` | 如 `{ cursor?: boolean }`，按 agent opt-in | 全关 |
| `acpCursorModelId`（或嵌在 agent 配置内） | Cursor 侧模型 id，非 Eco provider | 未设置 = Cursor 默认 |
| `defaultCoreKind` | 可为 `"acp"` | `claude` |
| `defaultAcpAgentId` | 当默认核心为 acp 时使用（MVP：`cursor`） | 未设置 |

旧字段 `cursorCoreEnabled` / `cursorModelId`：实现时迁移到上述结构后删除。

### 可用性与门禁

对 Cursor agent：

1. 能解析到 `agent`（`CURSOR_AGENT_EXECUTABLE` 或默认路径）。
2. **ACP 最小握手成功**（启动 `agent acp` + initialize / 等价成功）。

打开开关前必须探测通过。展示条件：

```
showAcpCursor = acpAgentsEnabled.cursor === true && cursorAcp.available
```

- 新建 / 续跑：`coreKind === "acp" && acpAgentId === "cursor"` 时要求 `showAcpCursor` 语义成立。
- 历史线程可打开查看；续跑再过门禁。
- 环境失效：自动关闭对应 enabled；若默认核心指向该 ACP agent，回退 `claude`。

**探测实现取舍：** 若握手过重，可先用「可执行文件 + `agent models`」作过渡探测，但必须在实现计划中标为技术债，并以握手为验收目标。

### 线程迁移

已有 `coreKind: "cursor"` 的线程：读取时**静默升级**为 `coreKind: "acp"` + `acpAgentId: "cursor"`。无法升级的脏数据明确报错，不静默当成 Claude。

## ACP 宿主与 Cursor 适配

### Runtime 分层

| 模块 | 职责 |
|------|------|
| ACP session client / host | stdio JSON-RPC：initialize、session、prompt、cancel、通知 |
| ACP → Eco event map | 更新 / 工具 / 结束 → `AgentEvent`（保留 `raw`） |
| `acp-agents/cursor` | 启动 `agent acp`；声明该 agent 能力 |
| Desktop `acp-runtime-run` | 替代 `cursor-runtime-run`；按 `acpAgentId` 选 adapter |

### 会话语义（MVP）

- **新建：** 创建 ACP session → 发 prompt → 消费流式事件至结束。
- **续跑：** 使用已存 `externalSessionId`；若 Cursor ACP 不支持 resume，**明确报缺口**，不假装续跑成功。
- **取消：** ACP cancel 与/或终止子进程。
- **mode（agent / plan / ask）：** 能映射则传；不能则记为已知缺口，不静默宣称已支持。

### 审批 / Plan（占位）

- Capability 诚实标注（如 `toolApproval: "unsupported"` 或 `"planned"`）。
- 宿主预留 permission request → 将来接入 `bash-approval-bridge` 的钩子；MVP **不**实现完整弹卡。

## UI

- 侧栏：仅 `showAcpCursor` 时出现「Cursor · ACP」。
- 默认 Agent 设置：独立「启用 Cursor（ACP）」开关；探测失败不可开；开启后可选为默认核心。
- 模型下拉：仅在启用且默认/当前为 Cursor ACP 时显示（沿用 Cursor 账号模型列表来源，经 ACP 或临时 CLI `models`，实现计划写清）。
- 删除「外置」文案与 stream-json 相关 UI。

## Main 进程门禁

- 创建 `acp`+`cursor` 线程：未启用或探测失败 → 明确错误。
- 续跑同门禁。
- 只读历史 / 投影不因开关关闭而拦截。
- `workflowSettingsSave`：仅 **false→true** 时硬拒绝失败探测；已启用后探测失败应对账关闭并尽量继续保存其它字段（沿用 opt-in 设计中已确认的 save 语义）。

## 测试（MVP）

1. ACP→Eco 事件映射纯函数。
2. `acpAgentsEnabled` 持久化与 rising-edge 门禁。
3. Cursor adapter 启动参数（mock spawn）。
4. UI：未启用不出现；启用后「Cursor · ACP」；锁定历史线程标题仍带 ACP。
5. 旧 `cursor` coreKind 静默升级。
6. 删除/不再依赖旧 stream-json driver 测试。

## 预期改动落点

- `packages/runtime`：ACP host、event map、cursor adapter；从 `CORE_KINDS` 移除一等 `cursor`；删除 stream-json driver。
- `apps/desktop`：`acp-runtime-run`、settings/IPC、Sidebar、Default Agent、App 接线、i18n、迁移与测试。
- Spec/plan：本文件；原「外置」opt-in design 标注为被本方向取代（门禁语义迁移）。

## 已拍板决策

- 建 ACP 宿主抽象；Cursor 走 `agent acp`（方案 B → 实现方案 1）。
- **全面替换**，废弃 stream-json，不双轨。
- MVP：**A**（宿主 + 会话流 + ACP label + opt-in；审批/Plan 占位）。
- 模型：**B** — `coreKind: "acp"` + `acpAgentId`（如 `"cursor"`）。
- Label：**ACP**（不再用「外置」）。
