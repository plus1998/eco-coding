# FEED 事件规范目录（Feed Event Catalog）

> 适用范围：Eco Desktop（Electron + React）与 Eco Mobile（Flutter）的会话 Feed。
> 目的：统一回答三个问题 —— Feed 上会出现哪些事件、事件文案怎么写、用什么组件 + 什么图标展示。
> 工具行动（ActionKind、行文案、组头、语义图标）以 [`docs/superpowers/specs/2026-08-15-feed-action-kind-design.md`](superpowers/specs/2026-08-15-feed-action-kind-design.md) 为准；本文 §3C / §6 指向该 spec，不另维护一份动词表。其它事件类型仍以本文清单为准。

## 1. 数据流（事件的唯一来源）

```
运行时事件 ThreadRunEventType
  apps/desktop/src/shared/thread-run-events.ts
  message.delta/final · thinking.delta/final · tool.started/completed/failed
  request.* · run.attempt.* · context.compaction.* · api.error · diagnostic …
        │
        ▼
主进程 projection（thread-run-projection*.ts）→ ThreadRunProjectionTimelineItem
        │
        ├── Desktop 渲染端
        │     projectionItemToDetailBlock()          thread-run-projection-view.ts
        │     → ActivityDetailBlock
        │     → ActivityLogView.tsx 按 kind 分派渲染
        │     工具行动：resolveActionKind / formatActionLine / summarizeActionGroup
        │       （apps/desktop/src/shared/feed-action-kind.ts）
        │
        └── Mobile 渲染端
              projection_activity_feed.dart
              → ActivityFeedEntry / ActivityFeedKind
              → activity_feed.dart 按 kind 分派渲染
              工具行动：同名 API（apps/mobile/lib/core/utils/feed_action_kind.dart）
```

两端复用的共享契约：

- **工具分类**：ActionKind（Desktop `feed-action-kind.ts` 与 Mobile `feed_action_kind.dart` 镜像；见 spec）。
- **文案**：i18n（Desktop `apps/desktop/src/shared/i18n-catalogs.ts` 的 `activity.*`；Mobile `apps/mobile/lib/l10n/app_zh.arb` / `app_en.arb` 的 `activity*`）。工具行用 `activity.running.*` / `activity.done.*` / `activity.summary.*`，不再使用已删除的 `activity.completed.*` / `activity.detail.*`。
- **图标**：语义枚举 `ActivityActionIcon`（含 `tool`；两端各自维护同名单元组，见 §2）。

## 2. 图标规范

### 2.1 语义图标枚举（跨端契约）

| 语义图标 | 含义 | Desktop 字形（lucide-react） | Mobile 字形（EcoIcons → lucide_icons_flutter） |
|---|---|---|---|
| `search` | 代码搜索（Grep/Glob/Find/ls） | `Search` | `LucideIcons.search` |
| `file` | 文件读取（Read） | `FileText` | `LucideIcons.fileText` |
| `edit` | 写入/编辑（Write/Edit/MultiEdit/任务类） | `Pencil` | `LucideIcons.pencil` |
| `terminal` | 命令（Bash/Shell） | `Terminal` | `LucideIcons.terminal` |
| `agent` | 子代理（Agent/Task） | `Bot` | `LucideIcons.bot` |
| `context` | 上下文压缩 | `Minimize2` | `LucideIcons.minimize2` |
| `network` | 联网（WebSearch/WebFetch/MCP 工具） | `Globe2` | `LucideIcons.globe2` |
| `image` | 图像查看/生成 | `Image` | `LucideIcons.image` |
| `browser` | 浏览器自动化（agent_browser_*） | `AppWindow` | `LucideIcons.appWindow` |
| `tool` | 未知/其余工具（Kind `tool`） | `Wrench` | `LucideIcons.wrench` |

未知工具必须用 `tool`，禁止再用 `file` 表示未知。Kind → 图标多对一，完整表见 spec。

映射代码位置：

- Desktop：`actionIcons`（`ActivityLogView.tsx`）、`iconForToolName` → `resolveActionKind`（`activity-log.ts` / `feed-action-kind.ts`）。
- Mobile：`EcoIcons.activityAction`（`eco_icons.dart`）、`iconForToolName` → `resolveActionKind`（`activity_display.dart` / `feed_action_kind.dart`）。

### 2.2 生命周期叠加图标（与语义图标叠加显示，不占枚举）

| lifecycle | Desktop 图标 | 说明 |
|---|---|---|
| `approval-pending` | `Shield` | Bash 审批等待 |
| `approval-approved` | `ShieldCheck` | Bash 已批准 |
| `approval-rejected` | `ShieldAlert` | Bash 已拒绝/未通过 |
| `running` / `completed` / `failed` | 无叠加图标 | running 用文案 Shimmer，failed 用红色文字态 |

文案 key：`activity.lifecycle.*`。

### 2.3 行专用图标（不属于语义枚举，按行固定）

| 行 | Desktop | Mobile |
|---|---|---|
| 思考（thinking） | `Sparkles` | `EcoIcons.sparkles` |
| 等待思考 / 模型请求 | 无图标（Shimmer 文案） | 无图标（`_WaitingThinkingLine`） |
| 未知事件（unknown-item） | `CircleHelp` | — |
| 重连中 / 连接失败 | `RefreshCw`（旋转）/ `CircleAlert` | `EcoIcons.refresh` / `EcoIcons.error` |
| 用量徽标（narrative meta） | `CircleDollarSign` | — |
| 子代理头/卡片 | `Bot` | `EcoIcons.agent` |
| 澄清回答 | `CircleHelp` | — |

## 3. 事件清单

### A. 会话事件

| # | 事件 | 触发（eventType / role） | 文案示例 | Desktop 组件 | 图标 | Mobile 组件 |
|---|---|---|---|---|---|---|
| A1 | 用户提问 | `message`（role=user）/ `thread.user_prompt` | 用户原文（可编辑气泡，含图片附件） | `UserPromptBlock` | 无 | `_UserPromptTile` |
| A2 | 助手回复 | `message.delta` / `message.final` | Markdown 叙事（流式 + 尾随 usage 徽标） | `RunLogNarrative` / `StreamingMarkdownContent` | 无前导图标（role 标签） | `_AssistantNarrativeTile` / `_StreamingFeedMarkdown` |
| A3 | 澄清回答 | clarification 答案 | “澄清回答：…” | `ClarificationAnswersCard` | `CircleHelp` | `_ClarificationAnswerTile` |

### B. 思考与等待

| # | 事件 | 触发 | 文案 | Desktop 组件 | 图标 | Mobile 组件 |
|---|---|---|---|---|---|---|
| B1 | 思考 | `thinking.delta` / `thinking.final` | “正在思考” / “已思考 Ns”（可展开正文） | `ThinkingBlock` | `Sparkles` | `_ThinkingTile` |
| B2 | 推理阶段 | Codex reasoning summary（`reasoning-stage`） | 单行阶段状态（流式） | `WaitingThinkingBlock` | 无 | reasoningStage 行 |
| B3 | 等待模型 | `request.started`（main / agent scope） | “正在思考…” | `WaitingThinkingBlock` | 无 | `_WaitingThinkingLine` |

### C. 工具动作事件（`action`）

工具名（加 payload 提示）只分类一次，得到 **ActionKind**。图标、running/done 文案、组头桶、明细卡都从 Kind 推导。

**以 ActionKind spec 为准，不在本目录另维护动词表或 webFetch 文案：** [`docs/superpowers/specs/2026-08-15-feed-action-kind-design.md`](superpowers/specs/2026-08-15-feed-action-kind-design.md)

已落地（细节、Kind 表、i18n key、组头优先级见 spec）：

- 折叠完成行与组内子行用同一句 `activity.done.{kind}`，带目标（例如「读取了 auth.ts」）；无目标走 `activity.done.{kind}.fallback`。
- 组头用 `activity.summary.{bucket}` 计数、不列文件名；`webSearch` / `webFetch` 进 `web` 桶，**不再**算进 searches。
- `webFetch` 有独立文案 key，不用 `webSearch` 句子。
- 未知工具 Kind 与 `ActivityActionIcon` 均为 `tool`。
- 已删除作为独立层的 `activity.completed.*` 与 `activity.detail.*`。
- Read / Grep 展开子行与其它工具一样：ICON + `formatActionLine`（例如「读取了 ActivityLogView.tsx L120-159」），不再有无图标的「读取 / Grepped」专用行。

统一结构：**语义图标 + 生命周期态 + running/done 文案 + 可展开明细卡片**。`{{suffix}}` 为截断后的目标（文件名/命令/query，≤64 字符）。

Desktop：`resolveActionKind` / `formatActionLine` / `summarizeActionGroup`（`apps/desktop/src/shared/feed-action-kind.ts`），由 `ActivityLogView.tsx` 消费。
Mobile：同名 API（`apps/mobile/lib/core/utils/feed_action_kind.dart`），由 `activity_feed.dart` 消费。

**遗留纯文本协议**（SDK 流式行，只负责解析成 toolName + 目标，再进 `resolveActionKind`）：

- `Reading <path> · Read` / `Writing …` / `Editing …` / `Searching …` / `Running …` → `PROGRESS_PATTERNS`（`shared/activity-display.ts`）。
- `Tool: <name> · <detail>` / `Tool: <name> (1.2s)` → `TOOL_LINE_PATTERN`。
- `TOOL_VERB_LABELS` / `MCP_TOOL_DISPLAY_LABELS` 已删除；展示动词只来自 i18n。

### D. 失败事件

| # | 事件 | 触发 | 文案 | Desktop 组件 | 图标 | Mobile 组件 |
|---|---|---|---|---|---|---|
| D1 | 工具失败 | `tool.failed` | 该工具动词文案 + 错误详情 | `ToolFailedBlock` | 该工具语义图标（failed 态） | `_ActionTile` failed / `_ErrorTile` |
| D2 | API 错误 | `api.error` | 错误信息（含 HTTP 码） | `ApiErrorBlock` | 无前导图标 | `_ErrorTile` |

### E. 系统相位事件

| # | 事件 | 触发 | 文案 | Desktop 组件 | 图标 | Mobile 组件 |
|---|---|---|---|---|---|---|
| E1 | 连接失败 | `proxy.connection_error` | “连接失败 · HTTP 502” | `PhaseBlock`(reconnect) | `CircleAlert` | `_ReconnectPhaseTile` |
| E2 | 重连中 | `sdk.api_retry` | “重连 1/3” | `PhaseBlock`(reconnect) | `RefreshCw`（旋转） | `_ReconnectPhaseTile`（`EcoIcons.refresh`） |
| E3 | 上下文压缩 | `context.compaction.*` | “压缩上下文中…” | `RunLogAction`（icon=context） | `Minimize2` | `_PhaseTile` |
| E4 | Prompt cache 提示 | `context.cache_*` / `billing.cache_hit_dropped` | Prompt cache 时间线 | `PromptCacheNoticeDivider` / `PromptCacheTimelineBlock` | — | — |
| E5 | Worktree 合并 | worktree-merge 消息 | 合并摘要 | `WorkspaceChangesCard` | — | — |
| E6 | 未知事件 | 未投影的 Codex item | “未知类型 · xxx” | `UnknownItemBlock` | `CircleHelp` | — |
| E7 | 轮次启停 | `run.attempt.*` | “你停止了” / “运行停止了”（轮次头，含用时） | `RunLogTurnSection` 头部 | — | `_TurnFeedTile` |

### F. 子代理事件

| # | 事件 | 触发 | 文案 | Desktop 组件 | 图标 | Mobile 组件 |
|---|---|---|---|---|---|---|
| F1 | 子代理任务下发 | `agent.started`（含 delegation 元数据） | “任务目标” + summary（可展开 prompt） | `SubagentMissionBlock` | 组内 `Bot`（卡片头） | `_SubagentMissionTile`（`EcoIcons.agent`） |
| F2 | 子代理 prompt | 子代理 user 消息 | prompt 文本 | `UserPromptBlock`（subagent 变体） | 无 | — |
| F3 | 子代理动作 | 子代理 timeline 的 action 项 | 同 §C 动词体系 | `DetailBlock`（同一映射） | 同语义图标 | `_SubagentTimelineRow`（`EcoIcons.activityAction`） |
| F4 | 子代理运行卡片 | agent 状态 | 状态/用时/指标 | `SubagentRunCardButton` / `ProjectionSubagentRunInstanceStrip` | `Bot` | `_SubagentMissionTile` |

## 4. 现有代码分布

**Desktop**

| 职责 | 文件 |
|---|---|
| 事件类型定义 | `apps/desktop/src/shared/thread-run-events.ts` |
| ActionKind 分类 / 行文案 / 组头 | `apps/desktop/src/shared/feed-action-kind.ts` |
| 共享文案/标签/遗留协议解析 | `apps/desktop/src/shared/activity-display.ts` |
| i18n 文案 | `apps/desktop/src/shared/i18n-catalogs.ts`（`activity.*`） |
| Block 模型 + 语义图标 re-export + `iconForToolName` | `apps/desktop/src/renderer/activity-log.ts` |
| 事件 → Block 映射 | `apps/desktop/src/renderer/thread-run-projection-view.ts`（`projectionItemToDetailBlock`） |
| 渲染 + 字形映射 | `apps/desktop/src/renderer/ActivityLogView.tsx` |
| 轮次分组 | `apps/desktop/src/renderer/thread-run-turn-feed.ts` |

**Mobile**

| 职责 | 文件 |
|---|---|
| ActionKind 分类 / 行文案 / 组头 | `apps/mobile/lib/core/utils/feed_action_kind.dart` |
| 共享文案/标签/工具→图标包装 | `apps/mobile/lib/core/utils/activity_display.dart` |
| i18n 文案 | `apps/mobile/lib/l10n/app_zh.arb` / `app_en.arb`（`activity*`） |
| 语义图标 → Lucide 字形 | `apps/mobile/lib/core/theme/eco_icons.dart`（`EcoIcons.activityAction`） |
| 事件 → Entry 映射 | `apps/mobile/lib/features/threads/projection_activity_feed.dart` |
| 渲染（全部 Tile/Card 组件） | `apps/mobile/lib/features/threads/activity_feed.dart` |

## 5. 不一致清单（统一治理对象）

| # | 级别 | 问题 | 位置 | 状态 |
|---|---|---|---|---|
| 1 | P0 | `resolveDesktopIcon` 是死代码，且返回不在 `ActivityActionIcon` 内的值 | `activity-log.ts` | **done** — 已删除 |
| 2 | P0 | `TOOL_VERB_LABELS` / `MCP_TOOL_DISPLAY_LABELS` 硬编码中文 | `shared/activity-display.ts` | **done** — 表已删除；展示走 i18n / `resolveActionKind` |
| 7 | P1 | Read/Grep 展开子行是无图标的「读取/Grepped」专用行 | `RunLogReadTargetLine` / `RunLogGrepTargetLine` | **done** — 已删除；与其它工具一样走 ICON + `formatActionLine` |
| 3 | P1 | 工具→图标映射重复 3 处；Mobile 只匹配 PascalCase，小写工具名落到 `file` | Desktop `categorizeTool` / Mobile `iconForToolName` / `resolveDesktopIcon` | **done** — 两端 `resolveActionKind`（大小写归一）；未知 → `tool` |
| 4 | P1 | 两端 glyph 不一致：`file` FileSearch vs fileText；`edit` Pencil vs penLine | `ActivityLogView.tsx` `actionIcons` / `eco_icons.dart` | **done** — `file`=`FileText`/`fileText`，`edit`=`Pencil`/`pencil`，并补 `tool`=`Wrench`/`wrench` |
| 5 | P2 | Mobile 重连行用 Material Icons | `activity_feed.dart` `_ReconnectPhaseTile` | **done** — `EcoIcons.refresh` / `EcoIcons.error` |
| 6 | P2 | 动词类别解析 if 链在 Desktop 重复 4 份 | `ActivityLogView.tsx` summarize* | **done** — `formatActionLine` / `summarizeActionGroup` |
| 8 | P2 | Dart←TS codegen：两端 Kind 表靠人工镜像 | `feed-action-kind.ts` ↔ `feed_action_kind.dart` | **remaining** — spec 明确非目标；Kind 集合必须一致，新增 Kind 时两端都要改 |

## 6. 统一治理目标形态

**已按 spec 落地。** 工具行动的事实源是 [`docs/superpowers/specs/2026-08-15-feed-action-kind-design.md`](superpowers/specs/2026-08-15-feed-action-kind-design.md)，不要在本目录再维护一份 Kind / 文案 / 组头愿望表。

实现位置：

- Desktop：`apps/desktop/src/shared/feed-action-kind.ts`（`resolveActionKind` / `formatActionLine` / `summarizeActionGroup`）+ `ActivityLogView.tsx` 的 `actionIcons`
- Mobile：`apps/mobile/lib/core/utils/feed_action_kind.dart`（同名 API）+ `EcoIcons.activityAction`

规则（与 spec 一致，细节以 spec 为准）：

1. **图标**：Feed 行动图标取自 §2.1 的语义值（含 `tool`）；行专用图标（§2.3）按行注册。
2. **文案**：动词文案来自 i18n（`activity.running.*` / `activity.done.*` / `activity.summary.*` / `activity.named.*`），禁止在逻辑层硬编码自然语言。
3. **新增工具**：在两端别名表加一行（或新 Kind 时补 key + glyph）。不在渲染 if 链加分支。
4. **镜像**：本 spec 不做 Dart←TS codegen；两端 Kind 集合必须人工保持一致。
