> **已取代：** 实现方向改为 ACP 宿主，见 `docs/superpowers/specs/2026-08-15-acp-host-cursor-design.md`。本 plan 不再执行。

# Cursor 核心外置开关与环境门禁 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cursor 默认不出现在可选核心里；设置里独立开关，仅环境探测通过（CLI + 可拉模型）才能打开；开启后显示「Cursor · 外置」；环境失效自动关开关并回退默认核心；历史线程可看，续跑再过门禁。

**Architecture:** `workflow_settings.cursor_core_enabled` 持久化 opt-in。抽出 `probeCursorCoreAvailability()`（可执行文件 + `listCursorAgentModels`）。`showCursorCore = cursorCoreEnabled && available`。侧栏/默认 Agent 按此过滤；main 在 save / 对账 / 新建 / 续跑处强制门禁。

**Tech Stack:** TypeScript, Bun tests, Electron main/renderer, 现有 `@eco/runtime/cursor-agent-models`。

**Spec:** [docs/superpowers/specs/2026-08-15-cursor-core-opt-in-design.md](../specs/2026-08-15-cursor-core-opt-in-design.md)

## Global Constraints

- Label 固定：**外置**（zh-CN）/ **External**（en-US）；内置三核心不加后缀。
- 门禁：`showCursorCore = cursorCoreEnabled && cursor.available`；`available` = CLI 存在 **且** models 列表非空成功。
- 打开开关必须先探测成功；失败不得落库 `true`。
- 环境回退：探测失败且曾启用 → 强制 `cursorCoreEnabled=false`；若 `defaultCoreKind==="cursor"` → `"claude"`。
- 历史 Cursor 线程：可打开查看；续跑/新建必须过门禁，明确报错，禁止静默改 core。
- 本前置不做 Composer Cursor 模型选择器、不做 skills/MCP 注入、不改 stream/resume。
- 用户未明确要求时不要 git commit。
- TDD：每个行为先写失败测试，再写实现。

---

## File map

| File | Responsibility |
|------|----------------|
| Modify `apps/desktop/src/main/workflow-settings-store.ts` | 持久化 `cursorCoreEnabled` |
| Modify `apps/desktop/src/shared/ipc.ts` | `WorkflowSettingsSnapshot.cursorCoreEnabled` |
| Create `apps/desktop/src/main/cursor-core-availability.ts` | 探测 + 对账纯逻辑（可测） |
| Modify `apps/desktop/src/main/index.ts` | availability IPC、save 门禁、对账、新建/续跑 assert |
| Modify `apps/desktop/src/renderer/SidebarCoreSelector.tsx` | label + `cursorEnabled` 过滤 |
| Modify `apps/desktop/src/renderer/DefaultAgentSettingsPanel.tsx` | 独立开关 + 条件显示 Cursor |
| Modify `apps/desktop/src/renderer/App.tsx` | 接线 showCursorCore / save 开关 / 刷新探测 |
| Modify `apps/desktop/src/shared/i18n-catalogs.ts` | 中英文案 |
| Modify `apps/desktop/src/renderer/styles.css` | 开关/外置 label 最小样式（若需要） |
| Tests listed per task | store / probe / UI / gate |

---

### Task 1: 持久化 `cursorCoreEnabled`

**Files:**
- Modify: `apps/desktop/src/main/workflow-settings-store.ts`
- Modify: `apps/desktop/src/shared/ipc.ts`（`WorkflowSettingsSnapshot`）
- Test: `apps/desktop/test/workflow-settings-store.test.ts`

**Interfaces:**
- Produces: `WorkflowSettingsSnapshot.cursorCoreEnabled?: boolean`（缺省视为 `false`；`get()` 可省略字段或显式 `false`，但 `normalize` 后读侧用 `=== true` 判断启用）
- DB key: `"cursor_core_enabled"`，JSON boolean

- [ ] **Step 1: Write the failing tests**

在 `apps/desktop/test/workflow-settings-store.test.ts` 追加：

```typescript
test("workflow settings default cursorCoreEnabled is off", () => {
  const snapshot = normalizeWorkflowSettingsSnapshot({ sessionMode: "agent" });
  expect(snapshot.cursorCoreEnabled).toBeUndefined();
  expect(snapshot.cursorCoreEnabled === true).toBe(false);
});

test("workflow settings preserve cursorCoreEnabled true", () => {
  const snapshot = normalizeWorkflowSettingsSnapshot({
    sessionMode: "agent",
    cursorCoreEnabled: true,
  });
  expect(snapshot.cursorCoreEnabled).toBe(true);
  expect(isWorkflowSettingsSnapshot(snapshot)).toBe(true);
});

test("workflow settings reject non-boolean cursorCoreEnabled", () => {
  expect(
    isWorkflowSettingsSnapshot({
      sessionMode: "agent",
      cursorCoreEnabled: "yes",
    }),
  ).toBe(false);
});
```

再加 sqlite 往返（`test.skipIf(!sqliteAvailable)`）：

```typescript
test.skipIf(!sqliteAvailable)("persists cursorCoreEnabled round-trip", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-workflow-cursor-enabled-"));
  const store = await createWorkflowSettingsStore(path.join(dir, "settings.db"));
  store.save({ sessionMode: "agent", defaultCoreKind: "claude", cursorCoreEnabled: true });
  expect(store.get().cursorCoreEnabled).toBe(true);
  store.save({ sessionMode: "agent", defaultCoreKind: "claude", cursorCoreEnabled: false });
  expect(store.get().cursorCoreEnabled === true).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/desktop && bun test test/workflow-settings-store.test.ts`
Expected: FAIL（字段尚不存在 / 未持久化）

- [ ] **Step 3: Minimal implementation**

1. `ipc.ts` 的 `WorkflowSettingsSnapshot` 增加 `cursorCoreEnabled?: boolean`。
2. `workflow-settings-store.ts`：
   - 接口与 `defaultWorkflowSettings` 不默认写 `true`
   - `get()` / `save()` 读写 key `cursor_core_enabled`
   - `normalizeWorkflowSettingsSnapshot`：仅当 `record.cursorCoreEnabled === true` 时带上 `cursorCoreEnabled: true`；`false`/缺省省略
   - `isWorkflowSettingsSnapshot`：允许 `undefined | boolean`，拒绝其它类型

参考现有 `cursorModelId` 的 save/delete 模式：`true` 时 INSERT，非 true 时 DELETE 或写 `false`（二选一；推荐显式存 boolean，与 `default_core_kind` 一致更直观）。

推荐显式存储：

```typescript
.run("cursor_core_enabled", JSON.stringify(normalized.cursorCoreEnabled === true), now);
```

`get()`：

```typescript
const cursorCoreEnabled = this.readCursorCoreEnabled(); // boolean, default false
return {
  // ...
  ...(cursorCoreEnabled ? { cursorCoreEnabled: true } : {}),
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/desktop && bun test test/workflow-settings-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**（仅当用户要求）

```bash
git add apps/desktop/src/main/workflow-settings-store.ts apps/desktop/src/shared/ipc.ts apps/desktop/test/workflow-settings-store.test.ts
git commit -m "$(cat <<'EOF'
feat(desktop): 持久化 Cursor 核心启用开关

EOF
)"
```

---

### Task 2: Cursor 环境探测助手

**Files:**
- Create: `apps/desktop/src/main/cursor-core-availability.ts`
- Test: `apps/desktop/test/cursor-core-availability.test.ts`

**Interfaces:**
- Consumes: `listCursorAgentModels`（可注入）、`resolveCommandExecutable` / `existsSync`（可注入）
- Produces:

```typescript
export type CursorCoreProbeResult =
  | { available: true }
  | { available: false; reasonKey: "missingCli" | "modelsFailed"; detail?: string };

export interface CursorCoreProbeDeps {
  resolveExecutable: () => string;
  executableExists: (path: string) => boolean;
  listModels: () => Promise<unknown[]>;
}

export async function probeCursorCoreAvailability(
  deps: CursorCoreProbeDeps,
): Promise<CursorCoreProbeResult>;

/** 若 enabled 但 probe 失败，返回应写入的 workflow 补丁；否则 undefined */
export function reconcileCursorCoreEnabled(input: {
  cursorCoreEnabled: boolean;
  defaultCoreKind?: string;
  probe: CursorCoreProbeResult;
}): { cursorCoreEnabled: false; defaultCoreKind?: "claude" } | undefined;

/** 新建/续跑门禁；失败抛 Error（message 由调用方用 i18n 包装或直接用 reason） */
export function assertCursorCoreRunnable(input: {
  cursorCoreEnabled: boolean;
  probe: CursorCoreProbeResult;
  notEnabledMessage: string;
  unavailableMessage: string;
}): void;
```

- [ ] **Step 1: Write the failing tests**

```typescript
import { expect, test } from "bun:test";
import {
  assertCursorCoreRunnable,
  probeCursorCoreAvailability,
  reconcileCursorCoreEnabled,
} from "../src/main/cursor-core-availability";

test("probe fails when executable missing", async () => {
  const result = await probeCursorCoreAvailability({
    resolveExecutable: () => "/missing/agent",
    executableExists: () => false,
    listModels: async () => [{ id: "x" }],
  });
  expect(result).toEqual({ available: false, reasonKey: "missingCli" });
});

test("probe fails when models empty", async () => {
  const result = await probeCursorCoreAvailability({
    resolveExecutable: () => "/bin/agent",
    executableExists: () => true,
    listModels: async () => [],
  });
  expect(result.available).toBe(false);
  if (!result.available) expect(result.reasonKey).toBe("modelsFailed");
});

test("probe fails when listModels throws", async () => {
  const result = await probeCursorCoreAvailability({
    resolveExecutable: () => "/bin/agent",
    executableExists: () => true,
    listModels: async () => {
      throw new Error("not logged in");
    },
  });
  expect(result.available).toBe(false);
  if (!result.available) {
    expect(result.reasonKey).toBe("modelsFailed");
    expect(result.detail).toContain("not logged in");
  }
});

test("probe succeeds with models", async () => {
  const result = await probeCursorCoreAvailability({
    resolveExecutable: () => "/bin/agent",
    executableExists: () => true,
    listModels: async () => [{ id: "a" }],
  });
  expect(result).toEqual({ available: true });
});

test("reconcile clears enabled and falls back default core", () => {
  expect(
    reconcileCursorCoreEnabled({
      cursorCoreEnabled: true,
      defaultCoreKind: "cursor",
      probe: { available: false, reasonKey: "missingCli" },
    }),
  ).toEqual({ cursorCoreEnabled: false, defaultCoreKind: "claude" });
});

test("reconcile no-op when healthy", () => {
  expect(
    reconcileCursorCoreEnabled({
      cursorCoreEnabled: true,
      defaultCoreKind: "cursor",
      probe: { available: true },
    }),
  ).toBeUndefined();
});

test("assertCursorCoreRunnable throws when switch off", () => {
  expect(() =>
    assertCursorCoreRunnable({
      cursorCoreEnabled: false,
      probe: { available: true },
      notEnabledMessage: "not-enabled",
      unavailableMessage: "unavailable",
    }),
  ).toThrow("not-enabled");
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd apps/desktop && bun test test/cursor-core-availability.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: Implement `cursor-core-availability.ts`**

按上面接口实现；`modelsFailed` 在 empty 与 throw 时都用；`detail` 可选截断到合理长度（如 500）。

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/desktop && bun test test/cursor-core-availability.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**（仅当用户要求）

---

### Task 3: Main 接线 — availability、save 门禁、对账、新建/续跑

**Files:**
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/shared/i18n-catalogs.ts`（mainText 用到的 key）
- Test: `apps/desktop/test/cursor-core-gate.test.ts`（对纯函数包装/提取的 gate 行为；若逻辑已在 Task 2，本任务测「workflow save 关闭时回退 defaultCoreKind」的 normalize 辅助即可；Electron IPC 可不启，用抽出来的 `applyCursorCoreEnableSave`）

**Interfaces:**
- 在 `cursor-core-availability.ts` 追加（若尚未在 Task 2）：

```typescript
export function applyCursorCoreEnableSave(input: {
  nextEnabled: boolean;
  current: { cursorCoreEnabled?: boolean; defaultCoreKind?: string };
  probe: CursorCoreProbeResult;
  probeFailedMessage: string;
}): {
  cursorCoreEnabled: boolean;
  defaultCoreKind?: string;
} {
  // nextEnabled true + !probe.available → throw Error(probeFailedMessage)
  // nextEnabled false + current.defaultCoreKind === "cursor" → defaultCoreKind "claude"
  // else keep defaultCoreKind
}
```

- [ ] **Step 1: Failing test for `applyCursorCoreEnableSave`**

```typescript
test("enable rejected when probe failed", () => {
  expect(() =>
    applyCursorCoreEnableSave({
      nextEnabled: true,
      current: {},
      probe: { available: false, reasonKey: "modelsFailed", detail: "auth" },
      probeFailedMessage: "probe-failed",
    }),
  ).toThrow("probe-failed");
});

test("disable falls back default core from cursor", () => {
  expect(
    applyCursorCoreEnableSave({
      nextEnabled: false,
      current: { cursorCoreEnabled: true, defaultCoreKind: "cursor" },
      probe: { available: true },
      probeFailedMessage: "probe-failed",
    }),
  ).toEqual({ cursorCoreEnabled: false, defaultCoreKind: "claude" });
});
```

- [ ] **Step 2: Run fail → implement → pass**

- [ ] **Step 3: Wire `index.ts`**

1. `async function probeCursorCoreForMain(): Promise<CursorCoreProbeResult>`  
   用真实 `resolveCommandExecutable("agent", "CURSOR_AGENT_EXECUTABLE")`、`existsSync`、`() => listCursorAgentModels()`。

2. `coreAvailabilityGet`：用 probe 结果填 `cursor.available` / `reason`（`mainText` 映射 `missingCli` → `native.cursorUnavailable`；`modelsFailed` → 新 key `native.cursorModelsUnavailable`，可插 `{{detail}}`）。

3. `workflowSettingsSave`（找到现有 handler）：在 normalize 后、落库前：
   - 若请求把 `cursorCoreEnabled` 设为 true：先 `probeCursorCoreForMain()`，再 `applyCursorCoreEnableSave`；失败 throw。
   - 若设为 false：`applyCursorCoreEnableSave` 处理 defaultCore 回退。
   - 保存后可选再 reconcile（防御）。

4. 启动/加载 workflow 后调用 `reconcileCursorCoreAgainstProbe()`：读 store → probe → 若需补丁则 `store.save({...get(), ...patch})`。

5. 新建线程 `coreKind === "cursor"`：`assertCursorCoreRunnable`（读 store + 最新 probe），替代「仅 existsSync」。

6. `startCursorThreadRun` / continuation 入口同样 `assertCursorCoreRunnable`（在 `requireThreadCore` 之后）。

新增 i18n（zh + en）：

- `native.cursorModelsUnavailable`
- `native.cursorCoreNotEnabled`
- `settings.defaultAgent.cursorExternalLabel` → `外置` / `External`
- `settings.defaultAgent.cursorEnable` / `cursorEnableHint` / `cursorProbeFailed` / `cursorReprobe`

- [ ] **Step 4: Run related tests**

Run: `cd apps/desktop && bun test test/cursor-core-availability.test.ts test/workflow-settings-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**（仅当用户要求）

---

### Task 4: 侧栏 — 外置 label + 条件显示

**Files:**
- Modify: `apps/desktop/src/renderer/SidebarCoreSelector.tsx`
- Modify: `apps/desktop/test/sidebar-core-selector.test.tsx`
- Modify: `apps/desktop/src/shared/i18n-catalogs.ts`（若 label 走 i18n：`sidebar.cursorExternal`）

**Interfaces:**
- Props 增加：`cursorCoreVisible?: boolean`（即 `showCursorCore`；默认 `false`）
- `coreDisplayName(coreKind, t?)`：cursor → `Cursor · ${t("sidebar.cursorExternal")}`；无 i18n 时测试可用固定中文或注入

推荐：

```typescript
export function coreDisplayName(coreKind: CoreKind | undefined): string {
  if (coreKind === "cursor") {
    return `Cursor · ${i18n.t("sidebar.cursorExternal")}`;
  }
  // ...
}
```

菜单项：从 `coreOptions` filter：`option.kind !== "cursor" || cursorCoreVisible`。  
注意：已锁定线程 `coreKind===cursor` 时 heading 仍显示带 label 的名字，即使 `cursorCoreVisible===false`。

- [ ] **Step 1: Failing tests**

```typescript
test("Cursor display name includes External label", async () => {
  await i18n.changeLanguage("zh-CN");
  expect(coreDisplayName("cursor")).toBe("Cursor · 外置");
  await i18n.changeLanguage("en-US");
  expect(coreDisplayName("cursor")).toBe("Cursor · External");
});

test("Cursor menu option hidden unless cursorCoreVisible", () => {
  const hidden = renderLocalized(
    createElement(SidebarCoreSelector, {
      coreKind: "claude",
      locked: false,
      busy: false,
      codexAvailable: true,
      cursorCoreVisible: false,
      attentionItems: [],
      onChange: () => undefined,
      onOpenSearch: () => undefined,
      onSelectAttentionThread: () => undefined,
    }),
    "zh-CN",
  );
  // open menu by checking options aren't in initial tree — render with open state if needed
  // 若组件内部 open state，可断言初始 markup 不含 Cursor；或导出 filter helper
  expect(hidden).not.toContain("外置");
});
```

若「打开菜单」难测，抽出：

```typescript
export function visibleCoreOptions(cursorCoreVisible: boolean): typeof coreOptions
```

测 filter 即可，再测 display name。

- [ ] **Step 2–4: 实现 + 测试通过**

- [ ] **Step 5: Commit**（仅当用户要求）

---

### Task 5: 默认 Agent 设置 — 独立开关 + 条件列表

**Files:**
- Modify: `apps/desktop/src/renderer/DefaultAgentSettingsPanel.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`（`.default-agent-cursor-enable` 等最小样式）
- Create or Modify test: `apps/desktop/test/default-agent-settings-panel.test.tsx`（若尚无，新建）

**Interfaces:**
- Props：
  - `cursorCoreEnabled: boolean`
  - `cursorProbeAvailable: boolean`
  - `cursorProbeReason?: string`
  - `cursorProbeLoading?: boolean`
  - `onCursorCoreEnabledChange: (enabled: boolean) => void`
  - `onReprobeCursor?: () => void`
  - 保留 `cursorModelId` / models 等，仅当 `cursorCoreEnabled && defaultCoreKind==="cursor"` 显示模型区
- `agentOptions`：内置三项常驻；Cursor 项仅当 `cursorCoreEnabled` 时追加，label 为 `Cursor · ${t("settings.defaultAgent.cursorExternalLabel")}`

开关 UI（在 radiogroup 外）：

```tsx
<div className="default-agent-cursor-enable">
  <label>
    <input
      type="checkbox"
      checked={cursorCoreEnabled}
      disabled={busy || cursorProbeLoading || (!cursorProbeAvailable && !cursorCoreEnabled)}
      onChange={(e) => onCursorCoreEnabledChange(e.target.checked)}
    />
    {t("settings.defaultAgent.cursorEnable")}
  </label>
  <p>{t("settings.defaultAgent.cursorEnableHint")}</p>
  {!cursorProbeAvailable ? <small>{cursorProbeReason}</small> : null}
  {onReprobeCursor ? (
    <button type="button" onClick={onReprobeCursor} disabled={busy || cursorProbeLoading}>
      {t("settings.defaultAgent.cursorReprobe")}
    </button>
  ) : null}
</div>
```

说明：`disabled` 在「探测失败且当前未启用」时禁止打开；已启用时仍允许关掉（即使探测已失败，与自动对账配合）。

- [ ] **Step 1: Failing render tests** — 未启用时 markup 无 Cursor radio；启用后有「外置」；开关文案存在。

- [ ] **Step 2–4: 实现 + PASS**

- [ ] **Step 5: Commit**（仅当用户要求）

---

### Task 6: App 接线

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/preload/index.ts`（仅当 IPC API 表面需暴露新方法；本计划复用 `getCoreAvailability` + `saveWorkflowSettings`，通常无需新 channel）

**Behavior:**

```typescript
const showCursorCore =
  workflowSettings.cursorCoreEnabled === true &&
  coreAvailability?.cursor.available === true;
```

1. `SidebarCoreSelector`：传 `cursorCoreVisible={showCursorCore}`；可去掉仅靠 `cursorAvailable` 灰掉但仍展示的旧行为。
2. `DefaultAgentSettingsPanel`：传开关状态、probe、`onCursorCoreEnabledChange` → `saveWorkflowSettings({...workflowSettings, cursorCoreEnabled, ...(enabled?{}:{defaultCoreKind fallback已由main做}) })`；失败 `setError`。
3. 打开默认 Agent 设置或刷新 availability 时：`getCoreAvailability()`；若 main 已对账，随后 `getWorkflowSettings()` 同步本地 state。
4. `refreshCursorModels`：仅当 `showCursorCore`（或至少 `cursor.available`）时拉模型。
5. 若本地 `newThreadCoreKind==="cursor"` 但 `!showCursorCore`：回退到 `workflowSettings.defaultCoreKind ?? "claude"`（避免草稿卡在不可选项）。

- [ ] **Step 1:** 若有现成 App 级测试则补一条；否则手动验收清单写入 PR/自测注释，并保证 Task 4–5 组件测覆盖主路径。

- [ ] **Step 2: 实现接线**

- [ ] **Step 3: 跑相关测试**

```bash
cd apps/desktop && bun test test/workflow-settings-store.test.ts test/cursor-core-availability.test.ts test/sidebar-core-selector.test.tsx test/default-agent-settings-panel.test.tsx
```

Expected: PASS

- [ ] **Step 4: 手动冒烟（实现者执行）**

1. 新配置：侧栏无 Cursor。  
2. 设置页：探测失败无法开。  
3. CLI+登录正常：可开 → 侧栏出现「Cursor · 外置」。  
4. 关开关 → 消失；默认若为 Cursor 变 Claude。  
5. （可选）断 CLI 后刷新：自动关开关。

- [ ] **Step 5: Commit**（仅当用户要求）

---

## Spec coverage checklist

| Spec 要求 | Task |
|-----------|------|
| 外置 / External label | 4, 5 |
| 默认不在可选核心 | 4, 5, 6 |
| 独立开关 | 1, 5, 6 |
| 探测通过才能开 | 2, 3, 5 |
| CLI + models | 2, 3 |
| 环境失效自动关 + 默认回退 | 2, 3 |
| 历史可看、续跑门禁 | 3 |
| i18n 中英 | 3, 4, 5 |
| 非目标未膨胀 | Global Constraints |

## Placeholder / consistency self-review

- 无 TBD；函数名统一 `probeCursorCoreAvailability` / `reconcileCursorCoreEnabled` / `assertCursorCoreRunnable` / `applyCursorCoreEnableSave`。
- `cursorCoreEnabled` 字段名全链路一致；DB key `cursor_core_enabled`。
- `showCursorCore` 仅 UI 派生，不落库。
