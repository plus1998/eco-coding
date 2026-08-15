# Feed 工具行：ActionKind 统一图标 / 文案 / 组头

日期：2026-08-15  
状态：accepted  
相关：`docs/feed-event-catalog.md`（现状盘点，不是本 spec 的事实源）

## 问题

工具行的图标、行文案、组头摘要今天是三套分类：

1. **图标**：Desktop `categorizeTool`（10 个 `ToolCategory`）→ 9 个 `ActivityActionIcon`；Mobile `iconForToolName` 另写一份，且只匹配 PascalCase，PI 小写工具名全部落到 `file`。
2. **行文案**：Desktop `summarizeRunningActionBlock` / `summarizeCompletedActionBlock` / `formatToolGroupChildDetail` 三份 if 链；`activity.completed.*` 折叠行不带目标（「读取了文件」），`activity.detail.*` 带目标。WebFetch 没有自己的 key，走 `webSearch`。看图 / 浏览器走另一套 key 或硬编码中文。
3. **组头**：再数一遍桶；`webSearch`/`webFetch` 算进「已搜索代码」；MCP / 看图 / 浏览器的组头图标掉进最后一个 `file`。

另外：`TOOL_VERB_LABELS`、`MCP_TOOL_DISPLAY_LABELS`、卡内 “Read” / “Grepped” 硬编码；`resolveDesktopIcon` 是死代码且返回不在枚举内的值。

产品已锁定：折叠完成行要带目标，例如 **「读取了 auth.ts」**。

## 目标

1. 工具名（加 payload 提示）只分类一次，得到 **ActionKind**。图标、running/done 文案、组头桶、明细卡都从 Kind 推导。
2. 折叠完成行与组内子行用同一句 done 文案，带目标；组头仍用计数、不列文件名。
3. Desktop 与 Mobile 同一套 Kind、同一套语义图标、同一套 i18n key 名；各端只负责 Kind → glyph。
4. 新增工具：在别名表加一行（或新 Kind 时补 key + glyph）。渲染 if 链不再加分支。

## 非目标

- 不改用户气泡、思考、叙事、计划审批、Bash 授权卡、跟进队列。
- 不在本 spec 做 Dart←TS codegen；Desktop 一份表、Mobile 一份镜像，Kind 集合必须一致。
- 不改明细卡布局（diff / bash 终端 / 网页卡 / 看图预览），只把卡内铬文案纳入 i18n。
- 不把 `docs/feed-event-catalog.md` 当成实现依据；实现时再把它的 §3C / §6 改成指向本 spec。

## 方案

采用 **一张 ActionKind 表**（对话里的方案 B）。Kind 跟文案走，图标多对一。

```text
toolName（大小写归一）+ payload 提示
        │
        ▼
   resolveActionKind()          唯一分类
        ├── icon
        ├── i18n: running / done / done.fallback / summary bucket
        ├── card
        └── group bucket + 组头图标优先级
```

### 模块边界

| 单元 | 职责 | 位置 |
|---|---|---|
| Kind 表 + `resolveActionKind` | 别名、payload 覆盖、fallback | Desktop：`apps/desktop/src/shared/feed-action-kind.ts`；Mobile：`apps/mobile/lib/core/utils/feed_action_kind.dart` |
| 文案格式化 | 截断目标、选 running/done/fallback、组头拼接 | Desktop：同一 shared 模块导出 `formatActionLine` / `summarizeActionGroup`；Mobile：同名 Dart |
| glyph | Kind 已给出的 `ActivityActionIcon` → 字形 | Desktop：`ActivityLogView` 的 `actionIcons`；Mobile：`EcoIcons.activityAction` |
| i18n 字符串 | 只存文案 | Desktop `i18n-catalogs.ts`；Mobile `app_zh.arb` / `app_en.arb` |

`ActivityLogView.tsx` 与 `activity_feed.dart` 不再根据工具名写动词 if。`categorizeTool` / `iconForToolName` / 三份 summarize if 链删除或变成对 `resolveActionKind` 的薄封装。删除 `resolveDesktopIcon`。

### 分类顺序

`resolveActionKind({ toolName, payload })` 按此顺序，命中即停：

1. **payload 覆盖**（比工具名更可信）：`fileChange` → `edit`；`readTarget` → `read`；`grepTarget` → `search`；`webSearch.mode === "fetch"` 或 fetch 字段 → `webFetch`；其余 `webSearch` → `webSearch`；`mcpDiscovery.kind === "search"` → `mcpSearch`；`imageView` → `imageView`；`bashRun` → `command`。
2. **别名表**（大小写无关、精确匹配）：见下表。不含 `includes("skill")`。
3. **内置后缀**：`agent_browser_*` / `mcp__eco_ab_*` → `browser`；`create_image` / `eco_image_generation` → `imageCreate`；`view_image` / `eco_image_view` → `imageView`。
4. **`mcp__*` / `mcp` / `mcp_tool` / `mcpscript`** → `mcp`。
5. **技能启发式**：名称含 `skill`（且不是上一步 MCP）→ `skill`。
6. **其余** → `tool`。

空工具名、未知名不得抛错，一律 `tool`。

### ActionKind 表

| Kind | 别名（归一后） | 图标 | 明细卡 | 组头桶 |
|---|---|---|---|---|
| `read` | `read`, `notebookread` | `read` | `readTarget` | `readFiles` |
| `write` | `write` | `edit` | `fileChange` | `writtenFiles` |
| `edit` | `edit`, `multiedit`, `notebookedit` | `edit` | `fileChange` | `editedFiles` |
| `search` | `grep`, `glob`, `find`, `ls` | `search` | `grepTarget` | `searches` |
| `webSearch` | `websearch` | `network` | `webSearch` | `web` |
| `webFetch` | `webfetch` | `network` | `webSearch` | `web` |
| `command` | `bash`, `shell`, `cmd`, `powershell` | `terminal` | `bash` | `commands` |
| `agent` | `agent`, `task`, `tasklist`, `taskoutput` | `agent` | none | `agents` |
| `taskCreate` | `taskcreate` | `edit` | none | `taskCreates` |
| `taskUpdate` | `taskupdate`, `todowrite` | `edit` | none | `taskUpdates` |
| `skill` | `skill`, `skills`, `readskill`（含 `skill` 的启发式见分类顺序第 5 步，且不得抢 MCP） | `file` | none | `skills` |
| `mcp` | `mcp`, `mcp_tool`, `mcpscript`, `mcp__*` | `network` | none | `mcpTools` |
| `mcpSearch` | payload `mcpDiscovery` | `network` | none | `mcpTools` |
| `imageView` | `viewimage`, `view_image`, eco 看图 | `image` | `imageView` | `images` |
| `imageCreate` | `create_image`, eco 生图 | `image` | none | `images` |
| `browser` | `agent_browser_*` | `browser` | none | `browser` |
| `tool` | 其余 | `tool`（新枚举值） | none | `otherTools` |

`write` 与 `edit` 必须分开（文案和组头都要区分），图标都用 `edit`。`webSearch` 与 `webFetch` 同理，图标都用 `network`，组头合成「已联网」。

浏览器、部分内置 MCP 另有 **专名**（打开网页、页面快照…），见文案节；Kind 仍是 `browser` / `imageCreate`，不是每个 suffix 一个 Kind。

### 目标（suffix）

用于 running / done 的目标，截断 ≤64 字符：

| Kind | 有目标时取 | 展示 |
|---|---|---|
| read / write / edit | 路径 | **文件名**（`auth.ts`），不是绝对路径 |
| search | grep pattern，否则 glob/query | 原文截断 |
| webSearch | query | 原文截断 |
| webFetch | url | host，否则截断 URL |
| command | 命令 | 截断后的命令（可与现网 bash 卡一致） |
| agent / skill / mcp / task* | 现有 label/名称里的目标段 | 截断 |
| browser `open` / `get_url` | url | host |
| 其余 named / image | 无则不用 | — |

格式化：有目标时 `suffix = " " + target`（「读取了 auth.ts」）；无目标走 fallback key，不要留下「读取了」空着。

### 文案

两套行模板 + 组头。**删除**作为独立层的 `activity.completed.*` 与 `activity.detail.*`（实现时把旧 key 迁到 `activity.done.*`，禁止两套并存）。

| key | 中文形状 | 何时用 |
|---|---|---|
| `activity.running.{kind}` | 正在读取{{suffix}} | 进行中 |
| `activity.done.{kind}` | 读取了{{suffix}} | 折叠完成行 **和** 组内子行 |
| `activity.done.{kind}.fallback` | 读取了文件 | 无目标 |
| `activity.summary.{bucket}` | 已读取 {{count}} 个文件 | 仅组头 |

Kind → key 名与上表 Kind 一致。未知工具 Kind 就是 `tool`，沿用现有 `activity.running.tool`，新增 `activity.done.tool` / `activity.done.tool.fallback`。

看图沿用已有 `activity.imageView.viewing` / `viewed` 映射到 running/done，不新造第三套句子。生图用 `activity.running.imageCreate` / `activity.done.imageCreate`（「正在生成图片」/「生成了图片」），字符串从今天的硬编码中文迁入 i18n。

**专名**（浏览器等）：`activity.named.{suffix}`，例如 `agent_browser_open` = 「打开网页」。running 与 done **都用这条专名**，进行中靠 lifecycle / shimmer，不拼「正在浏览器点击」（名词短语加「正在」会不成句）。仅 `open` / `get_url` 且有 host 时：running `activity.running.browserOpen`「正在打开{{suffix}}」，done `activity.done.browserOpen`「打开了{{suffix}}」。禁止再显示 `mcp__eco_agent_browser__agent_browser_open`。

组头桶文案：

| 桶 | 中文 |
|---|---|
| `readFiles` | 已读取 {{count}} 个文件 |
| `writtenFiles` | 已写入 {{count}} 个文件 |
| `editedFiles` | 已编辑 {{count}} 个文件 |
| `searches` | 已搜索代码 {{count}} 次（现网无 count，本 spec 补上） |
| `web` | 已联网 {{count}} 次（新；webSearch + webFetch，**不再**算进 searches） |
| `commands` | 已运行 {{count}} 条命令 |
| `taskCreates` / `taskUpdates` | 现网句子保留 |
| `agents` / `skills` / `mcpTools` / `otherTools` | 现网句子保留 |
| `images` | 已处理 {{count}} 张图像（新） |
| `browser` | 已操作浏览器 {{count}} 次（新） |

组头拼接仍用 `activity.joinTwo` / `activity.joinMany`。单条未成组的完成行只用 done，不用 summary。

生命周期文案仍是 `activity.lifecycle.*`，叠加在图标上，不写进动词。

卡内铬（独立 key，不是行文案）：`activity.card.read.verb` = 「读取」（替换写死的 `Read`）；`activity.card.grep.verb` = 「搜索」（替换 `Grepped`）。

遗留 `Tool: Read · …` / `PROGRESS_PATTERNS` 只负责 **解析成 toolName + 目标**，再进 `resolveActionKind`。展示不得再读 `TOOL_VERB_LABELS` 硬编码中文；该表删除，动词只来自 i18n。

### 图标

`ActivityActionIcon` 增加 `tool`，专给 Kind `tool`。禁止再用 `file` 表示未知工具。

两端同一枚举值绑同一含义的 glyph（Mobile 改 `penLine` → `pencil`，Desktop `file` 改 `FileSearch` → `FileText`）：

| 语义 | Desktop lucide-react | Mobile lucide_icons_flutter |
|---|---|---|
| `search` | `Search` | `search` |
| `read` | `BookOpen` | `bookOpen` |
| `file` | `FileText` | `fileText` |
| `edit` | `Pencil` | `pencil` |
| `terminal` | `Terminal` | `terminal` |
| `agent` | `Bot` | `bot` |
| `context` | `Minimize2` | `minimize2` |
| `network` | `Globe2` | `globe2` |
| `image` | `Image` | `image` |
| `browser` | `AppWindow` | `appWindow` |
| `tool` | `Wrench` | `wrench` |

若某端 lucide 包没有 `pencil` / `wrench`，实现时在计划里写明改用的等价 glyph，不得静默回退到错误语义。

组头图标 = 组内出现过的 Kind 里 **优先级最高** 的那个图标，禁止「不认识就 `file`」：

```text
edit（write/edit/taskCreate/taskUpdate）
  > read
  > file（skill）
  > search
  > network（webSearch/webFetch/mcp/mcpSearch）
  > terminal
  > browser
  > image
  > agent
  > tool
```

行专用图标（思考 Sparkles、重连 RefreshCw 等）不进 `ActivityActionIcon`。Mobile 重连行改为 `EcoIcons.refresh` / `EcoIcons.error`，不再用 Material Icons。

### 错误与缺口

- 分类失败 → Kind `tool` + `tool` 图标 + `activity.done.tool`，Feed 不崩。
- i18n 缺 key：按现网 i18n 行为（露出 key 或英文），**禁止**在格式化函数里再写一套中文兜底。
- 本 spec 不把 `nonExecutionKind: cancelled` 显示成「用户拒绝」；那是 live 事件映射，不属于 ActionKind。

## 测试

1. **别名表**：PascalCase、小写、`mcp__…` 浏览器/看图/生图 → 期望 Kind；payload 覆盖优先于名字。
2. **文案**：有目标「读取了 auth.ts」；无目标「读取了文件」；running 带目标；WebFetch 不用 webSearch 句子；组头「已读取 2 个文件」且不含文件名。
3. **组头**：web 与 search 分桶；混合组图标走优先级（例如 read+mcp → `read`，仅 mcp → `network`，仅 browser → `browser`）。
4. **glyph**：每个 `ActivityActionIcon` 在两端 map 里都有值；`resolveDesktopIcon` 不存在。
5. **回归**：现有 projection / activity_feed 测试里依赖「读取了文件」无目标的断言，改为带目标或 fallback，不许删测试来过关。

## 实现顺序（给后续 plan 用，本 spec 不写步骤细节）

1. 落地 Kind 模块与 i18n key（含 fallback / 新 summary 桶 / named / card verb）。
2. Desktop 接线：删三份 if 链、`categorizeTool`、死代码；组头改桶与优先级。
3. Mobile 镜像表 + `iconForToolName` 大小写归一；重连图标。
4. 对齐 glyph；更新 `docs/feed-event-catalog.md` §3C / §6 为「指向本 spec」的现状说明。
