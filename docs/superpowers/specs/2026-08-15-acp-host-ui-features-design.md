# ACP 宿主 UI 功能对照表

日期：2026-08-15  
状态：draft  
相关：`docs/superpowers/specs/2026-08-15-acp-host-cursor-design.md`（ACP 宿主与 Cursor 接入；本 spec 不改运行时 `CoreCapabilities`）

## 问题

1. Cursor `agent acp` 不发送 ACP 标准的 `session/update` `usage_update`（`used` / `size`），`session/prompt` 的 `PromptResponse.usage` 也为空。Composer、会话信息浮层、移动端上下文环仍按内置核心去画用量和计费，Cursor 线程会一直停在空占位。
2. 现有 `ACP_CORE_CAPABILITIES` 按 `coreKind: "acp"` 整类描述运行时能力（compact、审批等），不能区分「这个 ACP Agent 缺上下文」和「下一个 Agent 只缺计费」。
3. 以后还会有其它 ACP Agent、其它宿主 UI 缺口。不能在 Composer / 浮层 / 移动端各自写 `acpAgentId === "cursor"`。

## 目标（MVP）

1. 在 runtime 建一张 **UI 宿主功能对照表**，按 `acpAgentId` 索引，与 `CoreCapabilities` 分开。
2. Cursor 行：`contextUsage` 与 `billing` 均为 `hide`。
3. 该线程所有用量/计费 UI 都遵守这张表：桌面 Composer 页脚、会话信息浮层、移动端上下文环及点开后的 sheet。
4. 表在读线程时现算，挂到 `ThreadSummary.hostUiFeatures` 下发。UI 只读该对象，不判断 agent 名。
5. `hide` 时不渲染对应 UI（含空占位）；不为被藏的列造 fallback 快照。若以后收到真实用量事件，仍入库，但表改成 `show` 之前不展示。

## 非目标（MVP）

- 不实现 Cursor `usage_update` → Eco 用量映射。
- 不改 `ACP_CORE_CAPABILITIES`，不把 compact / 审批 / MCP 等运行时能力迁进 UI 表。
- 不把现有 `coreKind !== "acp"` 分支（标题重生成、session mode、模型可用性等）迁进这张表。
- 不关 ContextWindowMonitor / 计费编排整条管道。
- 不把 `hostUiFeatures` 写入数据库。
- 不为落地页草稿核心单独下发（无活跃线程时本来就不画用量 pill）。

## 方案

TypeScript 单表，解析结果随线程下发（对话里的方案 2）。

```text
coreKind + acpAgentId
        │
        ▼
resolveAcpHostUiFeatures()     唯一查询
        │
        ▼
ThreadSummary.hostUiFeatures   桌面 / 移动端只读
        ├── contextUsage: show | hide
        └── billing: show | hide
```

运行时能力继续走 `CoreCapabilities`。本表只描述「宿主界面藏什么」。

## 数据模型

### 对照表（runtime，不入库）

位置：`packages/runtime/src/acp-host-ui-features.ts`（与 `AcpAgentId` / `ACP_CORE_CAPABILITIES` 并列，不并进后者）。

```ts
type AcpHostUiFeature = "contextUsage" | "billing";
type AcpHostUiVisibility = "show" | "hide";
type AcpHostUiFeatures = Record<AcpHostUiFeature, AcpHostUiVisibility>;

const DEFAULT_ACP_HOST_UI_FEATURES: AcpHostUiFeatures = {
  contextUsage: "show",
  billing: "show",
};

const ACP_HOST_UI_FEATURE_TABLE: Record<AcpAgentId, AcpHostUiFeatures> = {
  cursor: { contextUsage: "hide", billing: "hide" },
};
```

以后加缺陷只加列；加 Agent 只加一行。MVP 只含上述两列。

### 查询与回落（两个函数，不要混）

`resolveAcpHostUiFeatures({ coreKind, acpAgentId })` 从身份算表。`acpAgentId` 接受 `string | undefined`，**不抛**。未知字符串不当成 Cursor。

| 输入 | 结果 |
|---|---|
| `coreKind !== "acp"` | 全 `show`（Claude / Codex / Pi 不走这张表） |
| `acp` 且 `acpAgentId` 是表中的键 | 用该行 |
| `acp` 但未知 / 缺 `acpAgentId` | 全 `show`（不默认藏） |

`normalizeAcpHostUiFeatures(raw)` 只处理已下发的 JSON。缺整个对象、缺某一列、或列值不是 `"show" | "hide"`：只把缺/脏的列回落为 `show`，合法列保持原值。不把整张表打成 `hide`。

`isAcpHostUiFeatureVisible(features, feature)` 在 normalize 之后使用，返回 `features[feature] === "show"`。`features` 缺失时视为全 `show`。

未知 `acpAgentId` 不在上述函数抛错。Agent 进程起不来仍由现有 `Unsupported acpAgentId` 负责。

### 线程快照

`ThreadSummary` 增加：

```ts
hostUiFeatures: AcpHostUiFeatures;
```

`rowToThread`（及任何其它组装 `ThreadSummary` 的路径）在已有 `coreKind` / `acpAgentId` 解析之后调用 `resolveAcpHostUiFeatures`，**始终写入**该字段（非 ACP 也是全 `show`）。不持久化。改表后旧 Cursor 线程下次读取即生效。

移动端 `ThreadSummary.fromJson` 用 `normalizeAcpHostUiFeatures` 解析同一字段。IPC 类型在桌面侧视为必填；移动端 JSON 可能缺字段，normalize 后仍得到完整两列。

## 数据流

1. 读库 → `upgradeLegacyCursorCore` → `resolveAcpThreadAgentId`（仅 `coreKind === "acp"`）→ `resolveAcpHostUiFeatures` → `ThreadSummary`。
2. 桌面 renderer 把 `activeThread.hostUiFeatures` 传给 Composer 页脚和会话信息浮层。
3. 移动端会话 Composer 从线程 JSON 读 `hostUiFeatures`，决定是否画环 / sheet 块。
4. `buildThreadUsageSummary` / `buildFallbackContextSnapshot`：对应列为 `hide` 时不为该列造 fallback（不用默认上下文窗口画假环，也不为计费补空快照）。
5. 后台若将来映射到真实 `usage_update`，仍按现有账本入库。UI 在表为 `hide` 时继续不展示；不删历史账本。
6. 本次不拆 ContextWindowMonitor / 计费编排；ACP 事件映射也不把未知 `session/update` 当成用量。

无活跃线程（落地页）不渲染用量 pill，草稿核心不必带 `hostUiFeatures`。

## UI

两列独立。UI 只读 `hostUiFeatures`，禁止再写 `acpAgentId === "cursor"`。

| 表面 | `contextUsage: hide` | `billing: hide` | 两列都 hide |
|---|---|---|---|
| 桌面 `ComposerThreadUsagePills` | 不画上下文环 / 空占位 | 不画计费 pill / 「费用累计中…」 | 整组不渲染 |
| 桌面 `ThreadInfoFloatStack` | 同上 | 同上 | 用量浮层不出现这两颗 pill |
| 移动端 `ComposerContextRing` + 上下文/计费 sheet | 环与 sheet 去掉上下文块 | sheet 去掉计费块 | 不画环、不提供该入口 |

`ThreadInfoFloatStack` 今日 `showContextFloat = true`，即使没有 context 数据也画占位。`hide` 时必须连占位一起去掉。

## 错误处理

- 未知 `acpAgentId`：UI 表全 `show`；运行时失败走现有 unsupported 错误。
- 快照缺字段 / 非法值：按列回落 `show`。
- 表为 `hide` 但账本已有真实用量：继续入库，UI 不展示，不删账。
- 若将来允许换 core：随新的 `coreKind` / `acpAgentId` 重算。当前 core 锁定后不可换，这条只是派生规则。

## 测试

1. `resolveAcpHostUiFeatures`：cursor → 两列 hide；`claude` / `codex` / `pi` → 全 show；未知 agent → 全 show；缺 `acpAgentId` 的 acp → 全 show。
2. `normalizeAcpHostUiFeatures`：缺整个对象 → 全 `show`；缺 `billing` 或值为 `"nope"` 时该列 `show`，另一列若为合法 `"hide"` 则保持 hide。
3. 桌面：Cursor 线程的 Composer 与 `ThreadInfoFloatStack` 不渲染对应 pill / 空占位；Claude 线程行为不变。
4. 移动端：`ThreadSummary.fromJson` 读出 `hostUiFeatures`；两列 hide 时不出现 `ComposerContextRing`。
5. 不测「收到真实 `usage_update` 后自动显示」——显示只跟表走。

## 预期改动落点

- `packages/runtime`：对照表、`resolveAcpHostUiFeatures`、`normalizeAcpHostUiFeatures`、`isAcpHostUiFeatureVisible`、导出。
- `apps/desktop`：`ThreadSummary` / `rowToThread`；`thread-usage-summary` 停止为 hide 列造 fallback；`ComposerThreadUsagePills`、`ThreadInfoFloatStack` 按列隐藏。
- `apps/mobile`：`ThreadSummary` JSON；Composer 环与 sheet 按列隐藏。

## 已拍板决策

- 隐藏范围：**B** — 该线程所有用量/计费 UI（Composer、会话信息浮层、移动端），不是只藏桌面 Composer 页脚。
- 表身份：**C** — 运行时仍用 `CoreCapabilities`；另加 UI 宿主功能表，按 `acpAgentId` 索引。
- 数据管道：**C** — UI 藏掉；真实用量仍入库；没有数据不造占位；显示只跟表走。
- 落地方式：方案 **2** — TypeScript 单表，解析结果随 `ThreadSummary` 下发。
- MVP 只含 `contextUsage` 与 `billing`。未知 agent 默认 `show`。
