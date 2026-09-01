---
name: eco-dev-cdp
description: >-
  Eco dev exposes CDP on port 9333 for the main app window. Agents should use
  the repo-local `playwright cli` (playwright-cli) to attach and operate the UI
  step-by-step (snapshot, click, fill). Same @playwright/test as Electron e2e.
---

# Eco Dev CDP + Playwright CLI（Agent）

`bun run dev` 时 Eco 开启 **Electron 主窗口 CDP**（默认 `9333`）。Eco **只负责开端口**。

Agent **不要只写一次性脚本**；应像人工调试一样，用仓库内的 **`playwright-cli`**（`@playwright/test` 自带的 `playwright cli` 子命令）**一步一步** attach → snapshot → click/fill → 再 snapshot。

| 项 | 值 |
| --- | --- |
| CLI | `bunx playwright cli …` 或 `cd apps/desktop && bun run playwright-cli -- …` |
| 包 | `@playwright/test`（与 [`apps/desktop/e2e`](apps/desktop/e2e) 相同） |
| CDP | `http://127.0.0.1:9333`（`ECO_DEV_CDP_PORT`，勿用 `9222`） |
| 关闭 | `ECO_DEV_CDP=0` |

Composer 中勾选本 Skill（`.agents/skills/eco-dev-cdp`）。

## 标准流程（逐步操作）

**1. 确认 dev + CDP**

```powershell
# 仓库根目录
bun run dev
# 另开终端
curl http://127.0.0.1:9333/json/version
```

**2. Attach（每个 agent 会话做一次）**

```powershell
cd apps/desktop
bun run playwright-cli -- attach --cdp=http://127.0.0.1:9333
# 或指定 session 名，避免并行冲突：
bun run playwright-cli -- -s=eco-dev attach --cdp=http://127.0.0.1:9333
```

**3. 交互循环（每步一条命令，看 snapshot 再决定下一步）**

```powershell
bun run playwright-cli -- snapshot
bun run playwright-cli -- click e27          # ref 来自 snapshot YAML
bun run playwright-cli -- fill eXX "你好"    # 可编辑元素
bun run playwright-cli -- screenshot --filename=.smoke-artifacts/step.png
bun run playwright-cli -- eval "typeof window.eco"
bun run playwright-cli -- tab-list
```

带 session：

```powershell
bun run playwright-cli -- -s=eco-dev snapshot
bun run playwright-cli -- -s=eco-dev click e27
```

**4. 结束**

```powershell
bun run playwright-cli -- detach    # 仅断开 CLI，不关闭 Eco
# bun run playwright-cli -- close   # 会关 browser，dev 场景一般不用
```

## 常用 playwright-cli 命令

| 命令 | 用途 |
| --- | --- |
| `snapshot` | 获取页面 YAML + 元素 `ref=eN`（**每步操作前先 snapshot**） |
| `click <ref>` | 点击 |
| `fill <ref> <text>` | 输入框填字 |
| `type <text>` | 向焦点元素打字 |
| `screenshot` | 截图 |
| `eval <js>` | 执行 JS（如 `typeof window.eco`） |
| `find <text>` | 在 snapshot 里搜文案 |
| `console` | 看控制台 |
| `go-back` / `reload` | 导航 |

完整列表：`bun run playwright-cli -- --help`

## 与 e2e / 脚本的关系

| 方式 | 何时用 |
| --- | --- |
| **`playwright-cli` 逐步命令** | **Agent 探查、演示、交互式冒烟（首选）** |
| `_electron.launch` + spec | CI、`bun run test:e2e`（见 `e2e/fixtures/electron-app.ts`） |
| 一次性 `.mjs` 脚本 | 仅固定回归；`smoke:cdp-probe` / `smoke:cdp-demo` 可参考 |

e2e 辅助函数（在 spec 里 import，非 CLI）：[`e2e/helpers/eco-page.ts`](apps/desktop/e2e/helpers/eco-page.ts) 的 `waitForEcoReady`、`fillComposer`。

首次缺 Chromium：`cd apps/desktop && bunx playwright install chromium`

## 禁止事项

- **不要**只丢一段长脚本代替逐步 snapshot/click（refs 会变）
- **不要**用全局 `npx playwright` 另装一套；用 **`apps/desktop` 本地依赖**
- **不要**把 dev CDP `9333` 与内置浏览器 **thread CDP**（`getBrowserState().cdpPort`）混用
- **不要**用 `9222`；**不要**在打包版期望 CDP

## 回复用户

说明 dev/CDP 是否可达、attach 是否成功、每步 snapshot/操作结果；失败贴 `playwright-cli` 输出。
