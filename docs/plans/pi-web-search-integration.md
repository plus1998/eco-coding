# PI Web Search 集成计划

> 状态：实施完成（Phase 1）  
> 更新：2026-09-02  
> 范围：PI runtime + 模型能力配置 + Integrated 搜索（Tavily / 豆包 / Brave）  
> 不在本计划：Claude/Codex driver 改造、native 失败自动降级、models.dev 字段

## 背景

- PI 核心内置工具仅有 `read/bash/edit/write/...`，**无** Web Search。
- Eco PI driver 使用 `noExtensions: true`，未注入任何搜索 extension；allowlist 也无 `web_search`。
- 上游 provider-native 搜索需通过 [pi-web-search](https://pi.dev/packages/pi-web-search)（或等价实现）：工具触发 → 独立 API 请求（Anthropic `web_search_*` / OpenAI Responses `web_search` / Gemini grounding）。
- models.dev **无** `web_search` 能力字段；不依赖 catalog 推断。

## 产品规则

### 三层开关

| 层级 | 配置 | 作用 |
|------|------|------|
| 编排 | `orchestration.network.webSearch` | 线程总闸：false 则 PI 不暴露搜索工具 |
| 模型 | `RouteManualSpec.supportsNativeWebSearch` | 是否走 provider-native（pi-web-search） |
| 平台 | `IntegratedWebSearchSettings` | 第三方搜索后端（Tavily / 豆包 / Brave） |

### 决策表

| `network.webSearch` | `supportsNativeWebSearch` | Integrated 已配置 | 暴露 `web_search` | 后端 |
|---------------------|---------------------------|-----------------|-------------------|------|
| false | * | * | ❌ | — |
| true | **true（默认）** | * | ✅ | pi-web-search（当前主模型 side call） |
| true | false | ✅ | ✅ | Eco integrated tool → Tavily / 豆包 / Brave |
| true | false | ❌ | ❌ | — |

约定：

- **`supportsNativeWebSearch` 未写入 manualSpec 时视为 `true`**（默认全开；用户关掉才知道是否支持）。
- Native 与 Integrated **互斥**：同一 session 只注入一种 backend，工具名统一为 `web_search`。
- Native 调用失败 **Phase 1 不自动降级**到 Integrated（tool 返回错误）；自动降级留 Phase 2。

### 与 Claude/Codex 的关系

- Claude SDK / Codex 已有各自 WebSearch 路径，**本计划不修改**。
- Integrated 设置先服务 PI；后续可对齐 Claude/Codex 的第三方搜索。

## 架构

```
orchestration.network.webSearch
        +
RouteManualSpec.supportsNativeWebSearch (default true)
        +
IntegratedWebSearchSettings
        │
        ▼
resolvePiWebSearchPlan()  →  native | integrated | none
        │
        ├─ native    → pi-web-search extension + allowlist
        ├─ integrated → eco-pi-integrated-web-search extension + allowlist
        └─ none      → 不注入 extension，allowlist 不含 web_search
```

## 工作包

### WP0 — 类型与配置 Schema（~0.5d）

**模型 / 路由（沿用 `RouteManualSpec`）**

| 文件 | 改动 |
|------|------|
| `apps/desktop/src/shared/ipc.ts` | `RouteManualSpec.supportsNativeWebSearch?: boolean` |
| `apps/desktop/src/renderer/agent-resource-manual-spec-form.ts` | 表单字段；缺省解析为 `true` |
| `apps/desktop/src/renderer/ModelManualSpecPanel.tsx` | 勾选「支持 Provider 原生 Web Search」 |
| `apps/desktop/src/renderer/ModelSpecSummary.tsx` | 能力 chip |
| `apps/desktop/src/main/index.ts` | merge/resolve（对齐 `supportsImageInput`） |

**全局 Integrated 设置**

```typescript
interface IntegratedWebSearchSettings {
  enabled: boolean;      // 默认 false
  provider: "tavily" | "doubao" | "brave";     // 默认 tavily
  apiKey?: string;       // keyring；View 用 hasApiKey
}
```

| 文件 | 改动 |
|------|------|
| `apps/desktop/src/shared/ipc.ts` | 类型 + Settings snapshot |
| 持久化 store + 设置 UI | provider + API key |
| `apps/desktop/src/shared/i18n-catalogs.ts` | 中英文 |

**Resolved 视图（建议）**

- `CandidateModelView.resolvedSupportsNativeWebSearch`（默认 true）
- 运行时预览 `webSearchBackend: "native" | "integrated" | "none"`（不持久化）

---

### WP1 — 解析层（~0.5d）

新建 `packages/runtime/src/pi-web-search-plan.ts`：

```typescript
export type PiWebSearchBackend = "native" | "integrated" | "none";

export function resolvePiWebSearchPlan(input: {
  networkWebSearch: boolean | undefined;
  supportsNativeWebSearch: boolean;       // default true
  integratedSearchConfigured: boolean;
}): PiWebSearchBackend;
```

**运行时输入来源**

| 字段 | 来源 |
|------|------|
| `networkWebSearch` | materialized `agentRegistry.main.tools.network.webSearch` |
| `supportsNativeWebSearch` | planner route `manualSpec`（merge candidate），缺省 `true` |
| `integratedSearchConfigured` | `IntegratedWebSearchSettings.enabled && hasApiKey` |

扩展 `PiSessionOptions` / `pi-runtime-run.ts` 传入 `webSearchPlan` 或等价字段。

---

### WP2 — pi-web-search（Native）（~1.5d）

| 文件 | 改动 |
|------|------|
| `packages/runtime/package.json` | `pi-web-search@^1.4.0` |
| `packages/runtime/src/pi-web-search-factory.ts` | 动态 import |
| `packages/runtime/src/pi-coding-agent-driver.ts` | `backend === "native"` 注入 + allowlist |
| `packages/runtime/src/pi-session-mode.ts` | allowlist 含 `web_search` |
| `packages/runtime/src/pi-subagent.ts` | 子代理 allowlist |
| `packages/runtime/src/pi-tool-approval.ts` | `web_search` → `WebSearch` |
| `packages/runtime/src/pi-event-adapter.ts` | Feed WebSearch 卡片 |
| `packages/runtime/src/index.ts` | export |

**Eco 细节**

- 保持 `noExtensions: true`，仅 `extensionFactories` 注入。
- 可选：`PI_WEB_SEARCH_CONFIG = agentDir/web-search.json`（Phase 1 可不配 dedicated search model）。
- **Session fingerprint**：`webSearchBackend` 变化 → rebuild PI session（同 MCP drift）。

**Ask/Plan**

- `network.webSearch === true` 且 backend ≠ none：Ask/Plan 暴露 `web_search`。
- `createPiModeAwareToolPermissionHandler` 放行 `web_search`（对齐 read 或 orchestration）。

---

### WP3 — Integrated Web Search（~1.5d）

新建：

- `packages/runtime/src/pi-integrated-web-search.ts` — Tavily / 豆包（Global）/ Brave API 调用
- `packages/runtime/src/pi-integrated-web-search-factory.ts` — extension factory

要求：

- 工具名 **`web_search`**（与 native 互斥，只注册一个）。
- Schema：`{ query: string }`；输出格式便于 Feed 复用。
- API key 由 desktop 注入 run 上下文，**不**写入 `pi-agent/` 磁盘。

---

### WP4 — Gateway 验证（~0.5d）

| 场景 | 验证 |
|------|------|
| Anthropic | Bridge `/v1/messages` + `web_search_20250305` 透传 |
| OpenAI Responses | `/v1/responses` + `web_search` tool |
| chat-completions 主模型 + native 默认开 | tool 报错（预期）；关 native + 配 Brave 可搜 |

---

### WP5 — 测试（~1d）

| 测试文件 | 内容 |
|----------|------|
| `pi-web-search-plan.test.ts` | 决策表 + 默认 true |
| `pi-coding-agent-driver` 相关 | 三种 backend 的 extension/allowlist |
| `agent-resource-manual-spec-form` | 默认 native 开 |
| `pi-tool-approval` | 工具名映射 |
| 可选 smoke | 真实 responses/anthropic 路由 |

---

### WP6 — 用户文档（~0.25d）

更新 `docs/USER_GUIDE.md` PI 小节：

- 搜索能力说明
- 模型「原生 Web Search」勾选（默认开）
- Integrated（Tavily / 豆包 / Brave）配置
- LongCat / chat-completions：关 native 或配 Integrated

## 实施顺序

```
1. WP0 Schema + 设置 UI
2. WP1 resolvePiWebSearchPlan
3. WP2 pi-web-search（native 打通）
4. WP3 Integrated Brave
5. WP4 Gateway smoke
6. WP5 测试
7. WP6 文档
```

预估：**4–6 人日**。

## 验收标准

- [ ] 编排开 + native 默认开：PI Agent 可调用 `web_search`，Feed 有 WebSearch 卡片
- [ ] 关 native + 配 Brave：走 integrated，可搜
- [ ] 关 native + 未配 integrated：工具不可见
- [ ] 编排关 `network.webSearch`：不暴露工具
- [ ] 子代理按各自 route manualSpec 决定 backend
- [ ] 切换 backend / integrated 配置后 session rebuild 正确

## 明确不做（本迭代）

- models.dev / apiCompat 智能默认
- native 失败 → integrated 自动降级
- Tavily、Exa 等多 provider
- Claude/Codex 接入 Integrated 设置
- Gemini `url_context`
- 专用搜索模型 UI（`web-search.json` 路由选择）
- Phase 2：`tools.web.search.fallbacks` 链式降级

## 风险

| 风险 | 缓解 |
|------|------|
| Gateway 未透传 native search | WP4 阻塞；UI 提示检查 apiCompat |
| 默认 native 开 + chat-completions 报错 | 文档；用户关 native 并配 Brave |
| 双 extension 同名冲突 | driver 只注入一个 backend |
| permission 误拦 | `web_search` → `WebSearch` + orchestration 测试 |

## 参考

- [pi-web-search](https://pi.dev/packages/pi-web-search)
- OpenClaw web search：`tools.web.search.provider` + native OpenAI/Codex 例外（[docs.openclaw.ai/tools/web](https://docs.openclaw.ai/tools/web)）
- Eco 现有：`RouteManualSpec.supportsImageInput` / `supportsReasoning` 模式
- PI driver：`packages/runtime/src/pi-coding-agent-driver.ts`（`noExtensions: true`）
