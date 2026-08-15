# Feed ActionKind Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 工具行只分类一次（ActionKind），由此推导图标、running/done 文案和组头；折叠完成行带目标（「读取了 auth.ts」）。

**Architecture:** 新增 Desktop `feed-action-kind.ts` 与 Mobile `feed_action_kind.dart` 镜像表。`resolveActionKind` 是唯一分类；`formatActionLine` / `summarizeActionGroup` 只吃 Kind + 目标 + `t()`。渲染层不再按工具名写动词 if。两端 `ActivityActionIcon` 增加 `tool`，glyph 对齐。

**Tech Stack:** TypeScript, Bun test, i18next catalogs；Dart / Flutter test / gen-l10n；lucide-react 与 lucide_icons_flutter。

**Spec:** [docs/superpowers/specs/2026-08-15-feed-action-kind-design.md](../specs/2026-08-15-feed-action-kind-design.md)

## Global Constraints

- 折叠完成行与组内子行同一句 done，带目标；组头只计数、不列文件名。
- **分类顺序锁定（澄清 spec）：先精确别名，再 payload，再内置后缀，再 `mcp__*`，再 `includes("skill")`，最后 `tool`。** `fileChange` 不得把已命中的 `write` 改成 `edit`。唯一的 payload 覆盖别名例外：`webSearch.mode === "fetch"` 把 `webSearch` 改成 `webFetch`；`mcpDiscovery.kind === "search"` 在别名之前命中 `mcpSearch`。
- Kind `tool` 的图标是新枚举值 `tool`，禁止再用 `file` 表示未知工具。
- 文案只来自 i18n。格式化函数里禁止中文/英文字符串兜底；缺 key 按现网 i18n 行为暴露。
- 删除 `activity.completed.*` 与 `activity.detail.*`，禁止与 `activity.done.*` 并存。
- 不改用户气泡、思考、叙事、计划审批、Bash 授权卡、跟进队列。
- 不做 Dart←TS codegen。
- 不把 `nonExecutionKind: cancelled` 显示成用户拒绝。
- TDD：每个行为先失败测试再实现。
- 用户未明确要求时不要 git commit（本计划仍写出 commit 步，执行时跳过除非用户要求）。

## File map

| File | Responsibility |
|------|----------------|
| Create `apps/desktop/src/shared/feed-action-kind.ts` | Kind / 图标 / 桶 / 目标 / 行文案 / 组头 |
| Create `apps/desktop/test/feed-action-kind.test.ts` | Desktop 分类与文案单测 |
| Modify `apps/desktop/src/shared/i18n-catalogs.ts` | `activity.done.*`、新 summary 桶、named、card verb；删 completed/detail |
| Modify `apps/desktop/src/renderer/activity-log.ts` | `ActivityActionIcon` 增加 `tool` 并改从 Kind 模块 re-export `iconForToolName`；删 `categorizeTool` / `resolveDesktopIcon` |
| Modify `apps/desktop/src/renderer/ActivityLogView.tsx` | 三份 summarize if 链改为 `formatActionLine`；组头改桶与优先级；glyph：`FileText` + `Wrench`；卡内 Read/Grepped 走 i18n |
| Modify `apps/desktop/src/shared/activity-display.ts` | 删 `TOOL_VERB_LABELS` / 硬编码 MCP 中文；`formatToolDisplayLabel` 吃 `t` 或 named key |
| Modify `apps/desktop/test/activity-log-view-loading.test.ts` | 「读取了文件」等断言改为带目标 |
| Modify `apps/desktop/test/activity-display.test.ts` | 标签不再依赖硬编码中文表 |
| Create `apps/mobile/lib/core/utils/feed_action_kind.dart` | Kind 镜像 |
| Create `apps/mobile/test/feed_action_kind_test.dart` | Mobile 分类与文案单测 |
| Modify `apps/mobile/lib/core/utils/activity_display.dart` | `ActivityActionIcon.tool`；`iconForToolName` 改走 Kind；大小写归一 |
| Modify `apps/mobile/lib/l10n/app_zh.arb` / `app_en.arb` | 与 Desktop 同语义的 done / named / summary |
| Modify `apps/mobile/lib/features/threads/activity_feed.dart` | 行文案与组头走 Kind；重连 Material 图标改 EcoIcons |
| Modify `apps/mobile/lib/core/theme/eco_icons.dart` | `pencil` / `wrench`；`activityAction` 含 `tool` |
| Modify `apps/mobile/test/activity_feed_test.dart` | 带目标文案与组头 |
| Modify `docs/feed-event-catalog.md` | §3C / §6 指向 spec |
| Modify spec 状态 `accepted` | 实现完成后 |

---

### Task 1: `resolveActionKind`（Desktop）

**Files:**
- Create: `apps/desktop/src/shared/feed-action-kind.ts`
- Create: `apps/desktop/test/feed-action-kind.test.ts`
- Modify: `apps/desktop/src/renderer/activity-log.ts`（本任务只 **re-export 类型**，暂不删 `iconForToolName` 实现，避免 UI 在没有 `tool` glyph 时崩溃）

**Interfaces:**

```typescript
export type ActivityActionIcon =
  | "search"
  | "file"
  | "image"
  | "browser"
  | "edit"
  | "terminal"
  | "agent"
  | "context"
  | "network"
  | "tool";

export type ActionKind =
  | "read"
  | "write"
  | "edit"
  | "search"
  | "webSearch"
  | "webFetch"
  | "command"
  | "agent"
  | "taskCreate"
  | "taskUpdate"
  | "skill"
  | "mcp"
  | "mcpSearch"
  | "imageView"
  | "imageCreate"
  | "browser"
  | "tool";

export type ActionGroupBucket =
  | "readFiles"
  | "writtenFiles"
  | "editedFiles"
  | "searches"
  | "web"
  | "commands"
  | "taskCreates"
  | "taskUpdates"
  | "agents"
  | "skills"
  | "mcpTools"
  | "images"
  | "browser"
  | "otherTools";

export interface ActionKindPayload {
  fileChange?: { path?: string; fileName?: string };
  readTarget?: { filePath?: string; fileName?: string };
  grepTarget?: { path?: string; pattern?: string };
  webSearch?: { mode?: "search" | "fetch"; query?: string; url?: string };
  mcpDiscovery?: { kind?: "search" };
  imageView?: { path?: string };
  bashRun?: { command?: string };
}

export interface ResolvedAction {
  kind: ActionKind;
  icon: ActivityActionIcon;
  bucket: ActionGroupBucket;
  /** 浏览器等专名 key 的 suffix，如 `agent_browser_open` */
  namedSuffix?: string;
}

export function resolveActionKind(input: {
  toolName?: string;
  payload?: ActionKindPayload;
}): ResolvedAction;
```

- Consumes: `isEcoAgentBrowserToolName`（`apps/desktop/src/shared/browser.ts`）、`isEcoImageGenerationToolName`、`isEcoImageViewToolName`、`ecoAgentBrowserToolSuffix`（若已导出；否则在 Kind 模块内用同样规则取 suffix）
- Produces: 上列类型与 `resolveActionKind`

Kind → icon / bucket 固定映射（写进同一文件的 const，不要再 if）：

| kind | icon | bucket |
|---|---|---|
| read | file | readFiles |
| write | edit | writtenFiles |
| edit | edit | editedFiles |
| search | search | searches |
| webSearch / webFetch | network | web |
| command | terminal | commands |
| agent | agent | agents |
| taskCreate | edit | taskCreates |
| taskUpdate | edit | taskUpdates |
| skill | file | skills |
| mcp / mcpSearch | network | mcpTools |
| imageView / imageCreate | image | images |
| browser | browser | browser |
| tool | tool | otherTools |

- [ ] **Step 1: Write failing tests**

```typescript
import { expect, test } from "bun:test";
import { resolveActionKind } from "../src/shared/feed-action-kind";

test("resolveActionKind maps aliases case-insensitively", () => {
  expect(resolveActionKind({ toolName: "Read" }).kind).toBe("read");
  expect(resolveActionKind({ toolName: "read" }).kind).toBe("read");
  expect(resolveActionKind({ toolName: "Write" }).kind).toBe("write");
  expect(resolveActionKind({ toolName: "WebFetch" }).kind).toBe("webFetch");
  expect(resolveActionKind({ toolName: "webfetch" }).kind).toBe("webFetch");
  expect(resolveActionKind({ toolName: "Bash" }).icon).toBe("terminal");
  expect(resolveActionKind({ toolName: "bash" }).kind).toBe("command");
});

test("resolveActionKind keeps Write even when fileChange is present", () => {
  const resolved = resolveActionKind({
    toolName: "Write",
    payload: { fileChange: { path: "/repo/auth.ts", fileName: "auth.ts" } },
  });
  expect(resolved.kind).toBe("write");
  expect(resolved.bucket).toBe("writtenFiles");
});

test("resolveActionKind uses fileChange payload only when the name is unknown", () => {
  expect(
    resolveActionKind({
      toolName: "MysteryPatch",
      payload: { fileChange: { path: "/repo/a.ts" } },
    }).kind,
  ).toBe("edit");
});

test("resolveActionKind prefers mcpDiscovery before generic mcp", () => {
  expect(
    resolveActionKind({
      toolName: "mcp",
      payload: { mcpDiscovery: { kind: "search" } },
    }).kind,
  ).toBe("mcpSearch");
});

test("resolveActionKind upgrades webSearch payload mode fetch", () => {
  expect(
    resolveActionKind({
      toolName: "WebSearch",
      payload: { webSearch: { mode: "fetch", url: "https://example.com" } },
    }).kind,
  ).toBe("webFetch");
});

test("resolveActionKind classifies eco browser and image tools", () => {
  const click = resolveActionKind({
    toolName: "mcp__eco_agent_browser__agent_browser_click",
  });
  expect(click.kind).toBe("browser");
  expect(click.namedSuffix).toBe("agent_browser_click");
  expect(resolveActionKind({ toolName: "mcp__eco_ab_ea4a60abe66__agent_browser_open" }).kind).toBe(
    "browser",
  );
  expect(resolveActionKind({ toolName: "mcp__eco_image_generation__create_image" }).kind).toBe(
    "imageCreate",
  );
  expect(resolveActionKind({ toolName: "ViewImage" }).kind).toBe("imageView");
  expect(resolveActionKind({ toolName: "mcp__eco_image_view__view_image" }).kind).toBe("imageView");
});

test("resolveActionKind does not let skill heuristic steal mcp tools", () => {
  expect(resolveActionKind({ toolName: "mcp__foo__read_skill" }).kind).toBe("mcp");
  expect(resolveActionKind({ toolName: "ReadSkill" }).kind).toBe("skill");
  expect(resolveActionKind({ toolName: "custom_skill_loader" }).kind).toBe("skill");
});

test("resolveActionKind unknown tools use kind tool and icon tool", () => {
  const resolved = resolveActionKind({ toolName: "TotallyUnknown" });
  expect(resolved.kind).toBe("tool");
  expect(resolved.icon).toBe("tool");
  expect(resolved.bucket).toBe("otherTools");
  expect(resolveActionKind({ toolName: "" }).kind).toBe("tool");
  expect(resolveActionKind({}).kind).toBe("tool");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/desktop/test/feed-action-kind.test.ts`

Expected: FAIL（模块不存在）

- [ ] **Step 3: Implement `resolveActionKind`**

在 `feed-action-kind.ts`：

1. 导出上列类型。
2. `const ALIASES: Record<string, ActionKind>` 精确名（全小写）：`read`/`notebookread` → `read`；`write` → `write`；`edit`/`multiedit`/`notebookedit` → `edit`；`grep`/`glob`/`find`/`ls` → `search`；`websearch` → `webSearch`；`webfetch` → `webFetch`；`bash`/`shell`/`cmd`/`powershell` → `command`；`agent`/`task`/`tasklist`/`taskoutput` → `agent`；`taskcreate` → `taskCreate`；`taskupdate`/`todowrite` → `taskUpdate`；`skill`/`skills`/`readskill` → `skill`；`mcp`/`mcp_tool`/`mcpscript` → `mcp`；`viewimage`/`view_image` → `imageView`。
3. `KIND_ICON` / `KIND_BUCKET` 两张 Record。
4. 函数体按 Global Constraints 顺序。`namedSuffix`：浏览器用 `ecoAgentBrowserToolSuffix` 的结果（无 `agent_browser_` 前缀重复）。空/未知不得 throw。

可从 `activity-log.ts` **额外 export** `type ActivityActionIcon` 为对 `feed-action-kind` 的 re-export（`export type { ActivityActionIcon } from "../shared/feed-action-kind"`），并在 renderer 的 union 上 **暂时**加 `"tool"`：把 `activity-log.ts` 里的 `export type ActivityActionIcon = ...` 整段换成 re-export。现有 `iconForToolName` 先留着，下一任务再删。若 TypeScript 因 `resolveDesktopIcon` 返回 `"list"` 等非法值报错：先给 `resolveDesktopIcon` 加 `as ActivityActionIcon` **不得**扩大枚举；Task 3 会删掉该函数。

- [ ] **Step 4: Run tests**

Run: `bun test apps/desktop/test/feed-action-kind.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**（用户未要求则跳过）

```bash
git add apps/desktop/src/shared/feed-action-kind.ts apps/desktop/test/feed-action-kind.test.ts apps/desktop/src/renderer/activity-log.ts
git commit -m "$(cat <<'EOF'
feat(desktop): 增加 Feed ActionKind 分类表

工具名只分类一次，后续文案和图标都从 Kind 推导。
EOF
)"
```

---

### Task 2: `formatActionLine` / `summarizeActionGroup` + i18n

**Files:**
- Modify: `apps/desktop/src/shared/feed-action-kind.ts`
- Modify: `apps/desktop/src/shared/i18n-catalogs.ts`（`zh-CN` 与 `en-US` 必须成对，`I18nKey` 取自 en-US）
- Modify: `apps/desktop/test/feed-action-kind.test.ts`

**Interfaces:**

```typescript
export type ActionKindTranslate = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

export function fileNameFromPath(filePath: string): string;

export function resolveActionTarget(
  resolved: ResolvedAction,
  input: { payload?: ActionKindPayload; rawTarget?: string },
): string | undefined;

export function formatActionLine(
  input: {
    resolved: ResolvedAction;
    phase: "running" | "done";
    rawTarget?: string;
    payload?: ActionKindPayload;
  },
  t: ActionKindTranslate,
): string;

export function summarizeActionGroup(
  items: readonly ResolvedAction[],
  t: ActionKindTranslate,
): { label: string; icon: ActivityActionIcon };

export const ACTION_GROUP_ICON_PRIORITY: readonly ActivityActionIcon[];
```

组头图标优先级（高 → 低）：

`edit, file, search, network, terminal, browser, image, agent, tool`

`summarizeActionGroup`：按 `bucket` 计数（`readFiles`/`writtenFiles`/`editedFiles` 用 Set 去重时，本函数只收 Kind 列表则按出现次数计；**去重文件名在 Task 3 调用方做**，本函数对 bucket 用 `items.filter` 计数即可）。label 用 `activity.joinTwo` / `activity.joinMany` 时需要 locale：`t` 无法提供「顿号 vs 逗号」。组头拼接 **仍留在 `ActivityLogView.joinChineseClauses`**。本函数只返回 **clauses 数组对应的已翻译字符串列表**，再 `join` 成 label 的简单实现：

若只有 1 个 clause，label = 该句；2 个 = `t("activity.joinTwo", { first, second })`；更多 = `t("activity.joinMany", { head: clauses.slice(0,-1).join("、"), last })`。单测只用 zh 的 `t` stub，`joinMany` 的 head 用 `、`。不要在 Kind 模块读 `i18n.language`。

- Consumes: Task 1 的 `ResolvedAction` / `resolveActionKind`
- Produces: 上列函数；i18n key 如下（**不要**再写 `activity.completed.*` / `activity.detail.*` 新用法）

**zh-CN 新增/替换（插在现有 `activity.running.*` 块旁）：**

```text
activity.running.webFetch = 正在获取{{suffix}}
activity.running.imageCreate = 正在生成图片
activity.running.browserOpen = 正在打开{{suffix}}
activity.done.read = 读取了{{suffix}}
activity.done.read.fallback = 读取了文件
activity.done.write = 写入了{{suffix}}
activity.done.write.fallback = 写入了文件
activity.done.edit = 编辑了{{suffix}}
activity.done.edit.fallback = 编辑了文件
activity.done.search = 搜索了{{suffix}}
activity.done.search.fallback = 搜索了代码
activity.done.webSearch = 联网搜索了{{suffix}}
activity.done.webSearch.fallback = 联网搜索了
activity.done.webFetch = 获取了{{suffix}}
activity.done.webFetch.fallback = 获取了网页
activity.done.command = 运行了{{suffix}}
activity.done.command.fallback = 运行了命令
activity.done.agent = 调用了子代理{{suffix}}
activity.done.agent.fallback = 调用了子代理
activity.done.taskCreate = 创建了任务{{suffix}}
activity.done.taskCreate.fallback = 创建了任务
activity.done.taskUpdate = 更新了任务{{suffix}}
activity.done.taskUpdate.fallback = 更新了任务
activity.done.skill = 读取了技能{{suffix}}
activity.done.skill.fallback = 读取了技能
activity.done.mcp = 调用了 MCP{{suffix}}
activity.done.mcp.fallback = 调用了 MCP 工具
activity.done.mcpSearch = 查找 MCP 工具
activity.done.tool = 执行了{{suffix}}
activity.done.tool.fallback = 执行了工具
activity.done.imageCreate = 生成了图片
activity.done.browserOpen = 打开了{{suffix}}
activity.summary.searched = 已搜索代码 {{count}} 次
activity.summary.web = 已联网 {{count}} 次
activity.summary.images = 已处理 {{count}} 张图像
activity.summary.browser = 已操作浏览器 {{count}} 次
activity.named.finalize_plan = 提交计划
activity.named.create_image = 生成图片
activity.named.view_image = 查看图像
activity.named.agent_browser_open = 打开网页
activity.named.agent_browser_snapshot = 页面快照
activity.named.agent_browser_click = 浏览器点击
activity.named.agent_browser_fill = 填写表单
activity.named.agent_browser_screenshot = 网页截图
activity.named.agent_browser_get_url = 读取网址
activity.named.agent_browser_tab_list = 列出标签页
activity.named.agent_browser_tab_new = 新建标签页
activity.named.agent_browser_tab_switch = 切换标签页
activity.card.read.verb = 读取
activity.card.grep.verb = 搜索
```

**en-US 对应（必须存在，否则 `I18nKey` 裂）：**

```text
activity.running.webFetch = Fetching{{suffix}}
activity.running.imageCreate = Generating image
activity.running.browserOpen = Opening{{suffix}}
activity.done.read = Read{{suffix}}
activity.done.read.fallback = Read a file
activity.done.write = Wrote{{suffix}}
activity.done.write.fallback = Wrote a file
activity.done.edit = Edited{{suffix}}
activity.done.edit.fallback = Edited a file
activity.done.search = Searched{{suffix}}
activity.done.search.fallback = Searched code
activity.done.webSearch = Searched the web{{suffix}}
activity.done.webSearch.fallback = Searched the web
activity.done.webFetch = Fetched{{suffix}}
activity.done.webFetch.fallback = Fetched a page
activity.done.command = Ran{{suffix}}
activity.done.command.fallback = Ran a command
activity.done.agent = Called subagent{{suffix}}
activity.done.agent.fallback = Called a subagent
activity.done.taskCreate = Created task{{suffix}}
activity.done.taskCreate.fallback = Created a task
activity.done.taskUpdate = Updated task{{suffix}}
activity.done.taskUpdate.fallback = Updated a task
activity.done.skill = Read skill{{suffix}}
activity.done.skill.fallback = Read a skill
activity.done.mcp = Called MCP{{suffix}}
activity.done.mcp.fallback = Called an MCP tool
activity.done.mcpSearch = Searched MCP tools
activity.done.tool = Executed{{suffix}}
activity.done.tool.fallback = Executed a tool
activity.done.imageCreate = Generated an image
activity.done.browserOpen = Opened{{suffix}}
activity.summary.searched = Searched code {{count}} times
activity.summary.web = Used the web {{count}} times
activity.summary.images = Processed {{count}} images
activity.summary.browser = Used the browser {{count}} times
activity.named.* = 与现网 MCP 英文含义对应的短名（Open page / Snapshot / Browser click / …）
activity.card.read.verb = Read
activity.card.grep.verb = Searched
```

`formatActionLine` 规则：

1. `imageView`：running → `activity.imageView.viewing`；done → `activity.imageView.viewed`（已有 key）。
2. `imageCreate`：running/done 用 `activity.running.imageCreate` / `activity.done.imageCreate`。
3. `mcpSearch`：running `activity.running.mcpSearch`；done `activity.done.mcpSearch`。
4. `browser`：若 `namedSuffix === "agent_browser_open"` 或 `"agent_browser_get_url"` 且 `resolveActionTarget` 有 host → running `activity.running.browserOpen` / done `activity.done.browserOpen`；否则 `t("activity.named." + namedSuffix)`，缺 suffix 时 `t("activity.named.agent_browser_open")` 不得瞎编中文，用 `activity.done.tool.fallback`。
5. 其余：`target = resolveActionTarget(...)`；有目标则 `suffix = " " + clamp64(target)`，key = `activity.{phase}.{kind}`；无目标且 phase===`done` 用 `activity.done.{kind}.fallback`；无目标且 running 用 `activity.running.{kind}` 且 `suffix=""`。
6. `fileNameFromPath`：把 `\` 换成 `/`，取最后一段。URL host：`try new URL(value).host`，失败则截断原串。

本任务 **先不删** catalogs 里的 `activity.completed.*` / `activity.detail.*`（Task 3 切完调用点再删，避免 `I18nKey` 与 ActivityLogView 同时红）。

测试用的 `t`：

```typescript
import { i18nCatalogs } from "../src/shared/i18n-catalogs";

function tZh(key: string, vars?: Record<string, string | number>): string {
  const catalog = i18nCatalogs["zh-CN"].translation as Record<string, string>;
  let template = catalog[key];
  if (!template) {
    throw new Error(`missing i18n key ${key}`);
  }
  for (const [name, value] of Object.entries(vars ?? {})) {
    template = template.replaceAll(`{{${name}}}`, String(value));
  }
  return template;
}
```

- [ ] **Step 1: Write failing tests**（追加到 `feed-action-kind.test.ts`）

```typescript
test("formatActionLine done includes basename target", () => {
  const resolved = resolveActionKind({ toolName: "Read" });
  expect(
    formatActionLine(
      { resolved, phase: "done", rawTarget: "/repo/src/auth.ts" },
      tZh,
    ),
  ).toBe("读取了 auth.ts");
});

test("formatActionLine done falls back without target", () => {
  const resolved = resolveActionKind({ toolName: "Read" });
  expect(formatActionLine({ resolved, phase: "done" }, tZh)).toBe("读取了文件");
});

test("formatActionLine running includes target", () => {
  const resolved = resolveActionKind({ toolName: "Read" });
  expect(
    formatActionLine(
      { resolved, phase: "running", rawTarget: "auth.ts" },
      tZh,
    ),
  ).toBe("正在读取 auth.ts");
});

test("formatActionLine webFetch does not use webSearch copy", () => {
  const resolved = resolveActionKind({ toolName: "WebFetch" });
  expect(
    formatActionLine(
      {
        resolved,
        phase: "done",
        payload: { webSearch: { mode: "fetch", url: "https://huggingface.co/docs" } },
      },
      tZh,
    ),
  ).toBe("获取了 huggingface.co");
});

test("summarizeActionGroup counts without filenames and splits web from search", () => {
  const items = [
    resolveActionKind({ toolName: "Read" }),
    resolveActionKind({ toolName: "Read" }),
    resolveActionKind({ toolName: "WebFetch" }),
    resolveActionKind({ toolName: "Grep" }),
  ];
  const summary = summarizeActionGroup(items, tZh);
  expect(summary.label).toContain("已读取 2 个文件");
  expect(summary.label).not.toContain("auth.ts");
  expect(summary.label).toContain("已联网 1 次");
  expect(summary.label).toContain("已搜索代码 1 次");
  expect(summary.label).not.toMatch(/已搜索代码(?! \d)/);
  expect(summary.icon).toBe("file");
});

test("summarizeActionGroup icon priority uses network for mcp-only and browser for browser-only", () => {
  expect(summarizeActionGroup([resolveActionKind({ toolName: "mcp" })], tZh).icon).toBe(
    "network",
  );
  expect(
    summarizeActionGroup(
      [resolveActionKind({ toolName: "mcp__eco_agent_browser__agent_browser_click" })],
      tZh,
    ).icon,
  ).toBe("browser");
  expect(
    summarizeActionGroup(
      [
        resolveActionKind({ toolName: "Read" }),
        resolveActionKind({ toolName: "mcp" }),
      ],
      tZh,
    ).icon,
  ).toBe("file");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/desktop/test/feed-action-kind.test.ts`

Expected: FAIL（`formatActionLine` 未定义或 key 缺失）

- [ ] **Step 3: Add i18n keys and implement formatters**

`fileNameFromPath` 不要 import `activity-display`（避免以后 `activity-display` → Kind 的循环）。

- [ ] **Step 4: Run tests**

Run: `bun test apps/desktop/test/feed-action-kind.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**（用户未要求则跳过）

```bash
git add apps/desktop/src/shared/feed-action-kind.ts apps/desktop/src/shared/i18n-catalogs.ts apps/desktop/test/feed-action-kind.test.ts
git commit -m "$(cat <<'EOF'
feat(desktop): ActionKind 行文案与组头走 i18n

折叠完成行带目标；组头只计数，WebFetch 不再算进代码搜索。
EOF
)"
```

---

### Task 3: Desktop Feed 接线 + glyph + 删死代码

**Files:**
- Modify: `apps/desktop/src/renderer/ActivityLogView.tsx`
- Modify: `apps/desktop/src/renderer/activity-log.ts`
- Modify: `apps/desktop/src/shared/i18n-catalogs.ts`（删除 `activity.completed.*` 与 `activity.detail.*` 两套 key，zh+en）
- Modify: `apps/desktop/test/activity-log-view-loading.test.ts`
- Modify: `apps/desktop/src/renderer/thread-run-projection-view.ts`（若仍 `iconForToolName` from activity-log，改为继续 re-export 即可）

**Interfaces:**

- Consumes: `resolveActionKind`, `formatActionLine`, `summarizeActionGroup`, `icon` from `ResolvedAction`
- Produces: Feed 折叠行「读取了 auth.ts」；组头新桶；`actionIcons.tool = Wrench`；`file: FileText`；`iconForToolName` 变为 Kind 包装；无 `resolveDesktopIcon` / `categorizeTool`

把 `activity-log.ts` 的 `categorizeTool` / `iconForToolCategory` / `iconForToolName` 实现删掉，改为：

```typescript
export { iconForToolName, type ActivityActionIcon } from "../shared/feed-action-kind";

export function iconForToolName(toolName: string): ActivityActionIcon {
  return resolveActionKind({ toolName }).icon;
}
```

不要同时 export 与 function 同名。只保留：

```typescript
export type { ActivityActionIcon } from "../shared/feed-action-kind";
export function iconForToolName(toolName: string): ActivityActionIcon {
  return resolveActionKind({ toolName }).icon;
}
```

删除整个 `resolveDesktopIcon`。

`ActivityLogView.tsx`：

1. import `FileText`, `Wrench`（lucide-react）。`file: FileText`，增加 `tool: Wrench`。去掉 `FileSearch`。
2. 用 helper（放在 summarize 函数原址）：

```typescript
function resolveBlockAction(
  block: Extract<ActivityDetailBlock, { kind: "action" }>,
): ResolvedAction {
  return resolveActionKind({
    toolName: block.toolName,
    payload: {
      ...(block.fileChange && { fileChange: block.fileChange }),
      ...(block.readTarget && { readTarget: block.readTarget }),
      ...(block.grepTarget && { grepTarget: block.grepTarget }),
      ...(block.webSearch && { webSearch: block.webSearch }),
      ...(block.mcpDiscovery && { mcpDiscovery: block.mcpDiscovery }),
      ...(block.imageView && { imageView: block.imageView }),
      ...(block.bashRun && { bashRun: block.bashRun }),
    },
  });
}

function formatBlockActionLine(
  block: Extract<ActivityDetailBlock, { kind: "action" }>,
  phase: "running" | "done",
): string {
  return formatActionLine(
    {
      resolved: resolveBlockAction(block),
      phase,
      rawTarget: actionBlockTargetKey(block),
      payload: {
        ...(block.fileChange && { fileChange: block.fileChange }),
        ...(block.readTarget && { readTarget: block.readTarget }),
        ...(block.grepTarget && { grepTarget: block.grepTarget }),
        ...(block.webSearch && { webSearch: block.webSearch }),
        ...(block.bashRun && { bashRun: block.bashRun }),
        ...(block.imageView && { imageView: block.imageView }),
      },
    },
    (key, vars) => i18n.t(key, vars),
  );
}
```

3. `summarizeRunningActionBlock` → `formatBlockActionLine(block, "running")`。
4. `summarizeCompletedActionBlock` 与 `formatToolGroupChildDetail` → `formatBlockActionLine(block, "done")`。command 子行不再特例返回 raw command；统一「运行了 bun test」。
5. `summarizeActionBlocks` 多条时：对每个 action 调 `resolveBlockAction`，文件桶用 `actionBlockTargetKey` 做 Set 去重后 **按 Set.size 造假 Kind 列表**（每个 unique path push 一次对应 Kind），再 `summarizeActionGroup`。不要再手写 `editedFiles.size > 0 ? "edit" : readFiles...`。
6. `RunLogReadTargetLine` / `RunLogGrepTargetLine`：`Read` / `Grepped` 换成 `i18n.t("activity.card.read.verb")` / `i18n.t("activity.card.grep.verb")`。

**必须改的现网断言**（`activity-log-view-loading.test.ts`，不许删测试）：

| 现网 | 改为 |
|---|---|
| `{ name: "Read", detail: "src/App.tsx", expected: "读取了文件" }` | `expected: "读取了 App.tsx"` |
| `{ name: "Edit", detail: "src/App.tsx", expected: "编辑了文件" }` | `expected: "编辑了 App.tsx"` |
| `{ name: "Bash", detail: "bun test", expected: "运行了命令" }` | `expected: "运行了 bun test"`（若 `actionBlockTargetKey` 拿到整句命令则「运行了 bun test」；以实际 target 为准，断言必须含命令目标） |
| 其它 `toContain("读取了文件")` / `编辑了文件` / 单条 `运行了命令` | 改为带目标或 fallback；组头仍可含「已运行 N 条命令」 |
| `iconForToolName("Read")` 仍为 `"file"`；补 `iconForToolName("TotallyUnknown") === "tool"` |

Grep `activity.completed` / `activity.detail` / `读取了文件` 全仓库，改完再删 catalogs 旧 key。

- [ ] **Step 1: Write/update failing UI tests**（先改 `activity-log-view-loading.test.ts` 的 expected）

- [ ] **Step 2: Run to verify fail**

Run: `bun test apps/desktop/test/activity-log-view-loading.test.ts`

Expected: FAIL（仍渲染「读取了文件」）

- [ ] **Step 3: Wire ActivityLogView + glyphs + delete dead code + delete old i18n keys**

- [ ] **Step 4: Run tests**

Run:

```bash
bun test apps/desktop/test/feed-action-kind.test.ts apps/desktop/test/activity-log-view-loading.test.ts
```

Expected: PASS

再跑：`bunx tsc -b --pretty false` 若项目习惯对 desktop 做引用检查；至少保证无 `activity.completed` 残留引用。

- [ ] **Step 5: Commit**（用户未要求则跳过）

```bash
git add apps/desktop/src/renderer/ActivityLogView.tsx apps/desktop/src/renderer/activity-log.ts apps/desktop/src/shared/i18n-catalogs.ts apps/desktop/test/activity-log-view-loading.test.ts
git commit -m "$(cat <<'EOF'
feat(desktop): Feed 工具行改走 ActionKind

折叠行显示「读取了 auth.ts」；未知工具用 tool 图标，不再冒充文件。
EOF
)"
```

---

### Task 4: 去掉硬编码动词表与 MCP 中文

**Files:**
- Modify: `apps/desktop/src/shared/activity-display.ts`
- Modify: `apps/desktop/test/activity-display.test.ts`
- Modify: `apps/desktop/src/renderer/thread-run-projection-view.ts`（`formatToolDisplayLabel` 若需 `t`，传入 `i18n.t`）

**Interfaces:**

```typescript
export function formatToolDisplayLabel(
  toolName: string,
  detail: string | undefined,
  t: ActionKindTranslate,
): string;
```

所有现有调用点补上 `t`。禁止默认参数里写中文。

行为保持：有 detail 时多数情况仍返回 detail（路径/命令）；无 detail 时用 `formatActionLine({ resolved, phase: "done" }, t)` 的 fallback 或 `t("activity.named." + suffix)`，**删除** `TOOL_VERB_LABELS` 与 `MCP_TOOL_DISPLAY_LABELS` 对象。`PROGRESS_PATTERNS` 的 `verb` 字段若只用于解析，可改成 kind 或不在展示路径读取中文 verb。

`formatToolStatusPreview("WebSearch", "flutter keyboard dismiss")` 现网期望 `"联网搜索 · flutter keyboard dismiss"`。改为 `t("activity.running.webSearch" 不适用)`：用 named/done webSearch 动词 + ` · ` + detail。zh 单测继续期望 `联网搜索 · flutter keyboard dismiss`（`tZh("activity.done.webSearch.fallback")` 是「联网搜索了」，对不上）。**锁定：** 无目标 WebSearch 短标签 = `t("activity.named.web_search")` 新增 key：zh「联网搜索」、en「Web search」；有 query 则 `联网搜索 · {query}`。在 catalogs 加 `activity.named.web_search` / `activity.named.web_fetch`（zh「获取网页」）。

- [ ] **Step 1: Update `activity-display.test.ts` 调用签名并保持期望字符串**

现有测试不传 `t` 会编译失败。先改测试传 `tZh`（从 feed-action-kind 测试抽到 `apps/desktop/test/i18n-zh-stub.ts` 以免复制，或在本测试文件内写同样 stub）。

- [ ] **Step 2: Run to verify fail**

Run: `bun test apps/desktop/test/activity-display.test.ts`

Expected: FAIL（缺第三参或仍靠旧表）

- [ ] **Step 3: Implement i18n labels; grep 确认 `TOOL_VERB_LABELS` / `MCP_TOOL_DISPLAY_LABELS` 删除**

- [ ] **Step 4: Run tests**

Run:

```bash
bun test apps/desktop/test/activity-display.test.ts apps/desktop/test/feed-action-kind.test.ts apps/desktop/test/activity-log-view-loading.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**（用户未要求则跳过）

```bash
git add apps/desktop/src/shared/activity-display.ts apps/desktop/src/renderer/thread-run-projection-view.ts apps/desktop/test/activity-display.test.ts apps/desktop/src/shared/i18n-catalogs.ts
git commit -m "$(cat <<'EOF'
fix(desktop): 工具展示标签改走 i18n

删除 TOOL_VERB_LABELS 与 MCP 中文硬编码表。
EOF
)"
```

---

### Task 5: Mobile `feed_action_kind` 镜像

**Files:**
- Create: `apps/mobile/lib/core/utils/feed_action_kind.dart`
- Create: `apps/mobile/test/feed_action_kind_test.dart`
- Modify: `apps/mobile/lib/core/utils/activity_display.dart`（`enum ActivityActionIcon` 增加 `tool`；`iconForToolName` 暂可留，本任务先让新模块独立通过测试）
- Modify: `apps/mobile/lib/l10n/app_zh.arb`、`apps/mobile/lib/l10n/app_en.arb`

**Interfaces:**

```dart
enum ActionLinePhase { running, done }

enum ActionKind { read, write, edit, search, webSearch, webFetch, command, agent, taskCreate, taskUpdate, skill, mcp, mcpSearch, imageView, imageCreate, browser, tool }

class ResolvedAction {
  const ResolvedAction({required this.kind, required this.icon, required this.bucket, this.namedSuffix});
  final ActionKind kind;
  final ActivityActionIcon icon;
  final ActionGroupBucket bucket;
  final String? namedSuffix;
}

ResolvedAction resolveActionKind({String? toolName, ActionKindPayload? payload});
String formatActionLine({required ResolvedAction resolved, required ActionLinePhase phase, String? rawTarget, ActionKindPayload? payload, required AppLocalizations l10n});
({String label, ActivityActionIcon icon}) summarizeActionGroup(List<ResolvedAction> items, AppLocalizations l10n);
```

分类规则与 Desktop **逐条相同**（含 Write+fileChange 仍为 write、小写 bash、mcp 不让 skill 启发式抢走）。

arb 用 camelCase，语义对齐 Desktop：

- `activityDoneRead` = `读取了{suffix}`
- `activityDoneReadFallback` = `读取了文件`
- 其余 kind 同理
- `activitySummarySearchedTimes` 可复用已有 `activitySearchedCodeTimes`
- `activitySummaryWeb` = `已联网 {count} 次`（已有 `activityWebSearches` 则复用，不要第二套）
- `activitySummaryImages` / `activitySummaryBrowser` 新增
- named：已有硬编码中文迁到 arb（`activityNamedAgentBrowserOpen` 等）

改 arb 后必须生成：

```bash
cd apps/mobile && flutter gen-l10n
```

测试：

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:eco_mobile/l10n/generated/app_localizations.dart';
import 'package:eco_mobile/core/utils/feed_action_kind.dart';

void main() {
  final l10n = lookupAppLocalizations(const Locale('zh'));

  test('lowercase PI tool names classify', () {
    expect(resolveActionKind(toolName: 'bash').kind, ActionKind.command);
    expect(resolveActionKind(toolName: 'read').kind, ActionKind.read);
  });

  test('done line includes basename', () {
    expect(
      formatActionLine(
        resolved: resolveActionKind(toolName: 'Read'),
        phase: ActionLinePhase.done,
        rawTarget: '/repo/auth.ts',
        l10n: l10n,
      ),
      '读取了 auth.ts',
    );
  });
}
```

再补与 Desktop Task 1/2 对等的 Write+fileChange、WebFetch、组头分桶、未知 → `ActivityActionIcon.tool`。

- [ ] **Step 1: Write failing Dart tests**
- [ ] **Step 2: Run** `cd apps/mobile && flutter test test/feed_action_kind_test.dart` — Expected: FAIL
- [ ] **Step 3: arb + gen-l10n + implement Dart module**
- [ ] **Step 4: Run** `cd apps/mobile && flutter test test/feed_action_kind_test.dart` — Expected: PASS
- [ ] **Step 5: Commit**（用户未要求则跳过）

---

### Task 6: Mobile Feed 接线 + glyph + 重连图标

**Files:**
- Modify: `apps/mobile/lib/core/utils/activity_display.dart` — `iconForToolName` 改为 `resolveActionKind(toolName: toolName).icon`；switch 删掉；大小写不再是问题
- Modify: `apps/mobile/lib/features/threads/activity_feed.dart` — 单行文案与组头改 `formatActionLine` / `summarizeActionGroup`；`_ReconnectPhaseTile` 里 `Icons.error_outline` / `Icons.refresh` 改为 `EcoIcons.error` / `EcoIcons.refresh`
- Modify: `apps/mobile/lib/core/theme/eco_icons.dart` — `edit: LucideIcons.pencil`（若 analyzer 报没有 `pencil`，用 `LucideIcons.pen` 并在 PR 说明，**禁止**继续 `penLine` 而不记录）；增加 `tool: LucideIcons.wrench`；`activityAction` 加 `ActivityActionIcon.tool`
- Modify: `apps/mobile/test/activity_feed_test.dart`

**必须改的断言：**

| 现网 | 改为 |
|---|---|
| `expect(edit.single.text, '编辑了文件')` | 带文件名，如 `编辑了 App.tsx`（按 fixture 路径 basename） |
| `expect(command.single.text, '运行了命令')` 及 widget `find.text('运行了命令')` | 有命令则 `运行了 …`；组头仍「已运行 N 条命令」 |
| `'已读取 1 个文件、已编辑 1 个文件和已搜索代码'` | 搜索句改为带次数的 `已搜索代码 1 次`（若 join 逻辑把 1 次也带 count；与 `summarizeActionGroup` 一致，Desktop 组头永远带 `{{count}}`） |

`iconForToolName('WebSearch')` 仍为 network；补小写 `'bash'` → terminal、未知 → tool。

- [ ] **Step 1: Update activity_feed_test expected strings**
- [ ] **Step 2: Run** `cd apps/mobile && flutter test test/activity_feed_test.dart test/feed_action_kind_test.dart` — Expected: FAIL
- [ ] **Step 3: Wire feed + icons**
- [ ] **Step 4: Run same tests** — Expected: PASS。Grep `Icons.refresh` / `Icons.error_outline` 在 `activity_feed.dart` 应为 0。
- [ ] **Step 5: Commit**（用户未要求则跳过）

---

### Task 7: 文档与 spec 状态

**Files:**
- Modify: `docs/feed-event-catalog.md`
- Modify: `docs/superpowers/specs/2026-08-15-feed-action-kind-design.md` 状态 `draft` → `accepted`

**Interfaces:** 无代码接口。

catalog §1 的「13 种 kind」改成准确数字或删掉易过期计数。§3C 改成「工具行动以 ActionKind spec 为准」并链到 spec；删掉把 webFetch 独立文案写成现状的表，或标明「已落地见 spec」。§6 目标形态改为「已按 spec 落地」或删除与代码重复的愿望表。§5 里已修复的项（死代码 `resolveDesktopIcon`、Mobile 小写、Grepped、Material 重连图标、glyph）标 **done**，未做的（codegen）保留。

- [ ] **Step 1: 编辑两份文档**
- [ ] **Step 2: 对照 spec 目标 1–4 与非目标，确认每条都有任务落地或明确非目标**
- [ ] **Step 3: Commit**（用户未要求则跳过）

```bash
git add docs/feed-event-catalog.md docs/superpowers/specs/2026-08-15-feed-action-kind-design.md
git commit -m "$(cat <<'EOF'
docs: Feed ActionKind 目录改指向已落地 spec
EOF
)"
```

---

## Spec coverage（自检）

| Spec 要求 | 任务 |
|---|---|
| 唯一 ActionKind 分类 | 1, 5 |
| 先别名再 payload、Write 不被 fileChange 改成 edit | 1 Global Constraints |
| done 带目标；组头计数 | 2, 3, 6 |
| webFetch ≠ webSearch 文案；web 与 search 分桶 | 2, 3, 6 |
| 新图标 `tool`；file≠未知 | 1, 3, 6 |
| glyph FileText / pencil / wrench | 3, 6 |
| 组头优先级含 network/browser/image | 2, 3, 6 |
| 删 completed/detail 两套 key | 3 |
| 删 TOOL_VERB_LABELS / MCP 中文表 | 4 |
| 卡内 Read/Grepped i18n | 3 |
| Mobile 小写工具名 | 5, 6 |
| 重连 Material → EcoIcons | 6 |
| 不改授权/计划/跟进 | 全局 |
| catalog 指向 spec | 7 |
| 回归测试改断言不删测试 | 3, 6 |
