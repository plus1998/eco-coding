# Universal Agent Remediation Plan

本文档记录 Eco 通用 Agent 架构整改的推进计划。后续改动必须先对照本文档，避免继续把模板、运行配置、编排和旧编程兼容层混在一起。

## 当前问题

现有实现已经引入 `AgentTemplate`、`OrchestrationProfile` 和通用 agent runtime，但旧编程流水线的配置仍在主路径里：

- `AgentTemplate` 仍可携带旧默认模型引用，导致模板绑定供应商和具体模型。
- `ThreadRuntimeConfig` 同时保存 `agentProfileId`、`routeProfileId`、旧五角色 `subagentEnabled` 和旧 `orchestrationMode`。
- `SubagentEnabledSettings` 只认识 `explore / architect / coder / reviewer / tester`，却被 UI 文案包装成通用子代理开关。
- `workflow_settings.orchestration_mode` 仍会驱动 SDK driver 的主运行分支。
- `RouteProfile` 被动态派生成 `OrchestrationProfile`，新旧配置在设置页和 composer 中平级混用。

这些不是文案问题，而是事实源没有收口。

## 目标边界

### AgentTemplate

模板只描述 agent 能力和行为，不绑定供应商、模型、启用状态或编排步骤。

允许字段：

- 身份：`id`、`name`、`description`、`domain`
- 行为：`prompt`、`whenToUse`、`outputContract`
- 能力要求：`modelRequirements`
- 推荐能力：`defaultTools`、`mcpServers`、`skills`
- 元信息：`allowDelegation`、`builtIn`、`source`、`version`、`updatedAt`

禁止字段：

- `providerId`
- `modelId`
- 旧默认模型引用字段
- `enabled`
- workflow step
- route profile
- thread runtime override

### AgentProfile

Profile 是可运行装配单，负责绑定模型、工具权限、MCP、skills、主 Agent 和编排策略。

Profile 的 agent roster 应成为“启用哪些 agent”的主事实。长期目标是移除 `agents[].enabled`，用 roster 存在与否表达启用；编辑器草稿可以保留 UI 选中态，但不应写入持久化 Profile。

### ThreadRuntimeConfig

线程只保存本次选择的 Profile 和临时覆盖。

长期目标：

```ts
type ThreadRuntimeConfig = {
  profileId: string;
  overrides?: {
    strategy?: OrchestrationStrategy;
    agents?: Record<string, AgentRuntimeOverride>;
  };
};
```

旧字段 `routeProfileId`、`subagentEnabled`、`orchestrationMode` 只作为迁移兼容输入，不再作为通用 runtime 主事实。

### ResolvedRuntimeConfig

启动 SDK 前解析出的事实，包括：

- 主 agent 模型
- dynamic SDK agent definitions
- allowed agent keys
- tool permission policy
- workflow execution plan

该层不持久化。

## 执行阶段

### 阶段 1：模板供应商解耦

目标：移除模板上的旧默认模型引用，让模板完全供应商无关。

范围：

- shared/runtime 类型
- built-in template 生成
- 模板表单 UI
- 模板导入导出 normalize
- Profile 表单从模板创建 agent 时改用当前 provider 默认模型或已有 agent 模型
- 测试更新

验收：

- 旧默认模型引用字段只允许出现在 legacy migration 注释或兼容解析中。
- 新建/编辑模板不出现 Provider/模型字段。
- Profile agent 仍必须配置模型。
- 相关 agent template/profile 测试通过。

### 阶段 2：线程 runtime 配置收口

目标：新增 `profileId + overrides` 主结构，旧字段只做兼容解析。

范围：

- `ThreadRuntimeConfig`
- conversation store serialize/parse
- composer runtime config
- runtime route resolution

验收：

- 新线程只需 profile id 即可启动。
- 旧线程 JSON 能迁移到新结构。
- 通用 agent key 不受 `SubagentRole` 限制。

### 阶段 3：运行时以 Profile Strategy 为主控

目标：SDK driver 不再由独立 `workflow_settings.orchestrationMode` 决定主分支。

范围：

- `ClaudeAgentSdkDriver.run`
- fixed/hybrid/autonomous strategy resolution
- legacy coding pipeline adapter
- hook allowed agent keys

验收：

- 任意 `fixed` profile 都走 workflow engine；如果 Coding preset 的 fixed workflow 暂不支持，就不要为该 preset 生成 fixed strategy。
- 未在 roster 的 Agent 调用被 hook 拒绝。
- 旧五角色 definitions 只服务 legacy coding adapter。

### 阶段 4：UI 信息架构拆分

目标：用户能明确区分模板库、Profile、旧编程路由。

范围：

- Settings tabs
- Agent Template editor
- Agent Profile editor
- Composer profile popover
- Save-as-profile flow

验收：

- 模板库没有供应商/模型绑定。
- 通用 profile 下没有旧五角色开关。
- 保存为 Profile 不再从旧 `subagentEnabled` 折回通用 Profile。

### 阶段 5：清理旧兼容层

目标：把旧字段和旧 UI 限定为 legacy-only，删除不再需要的派生路径。

范围：

- `SubagentEnabledSettings`
- `WorkflowSettingsSnapshot`
- route profile dynamic derivation
- deprecated tests

验收：

- 通用 agent 主路径不依赖旧五角色开关。
- route profile 只作为旧 coding migration 使用。
- 文档、测试和 UI 文案一致。

## 当前批次

当前执行阶段 1：模板供应商解耦。

具体任务：

1. 移除 shared/runtime 模板旧默认模型引用类型字段。
2. 模板表单删除 Provider/模型输入。
3. 模板保存不再要求 provider/model。
4. 模板列表不再显示默认模型，改为显示模型要求或“模型由 Profile 绑定”。
5. Profile 从模板新增 agent 时使用当前默认 provider/model，不从模板读取模型。
6. 更新相关测试。
7. 运行聚焦测试；如 typecheck 暴露旧基线问题，记录具体剩余缺口。

## 不做的事

当前批次不改 SDK driver 主分支，不整体迁移 `ThreadRuntimeConfig`。旧全局五角色默认开关已移除；线程级 `subagentEnabled` 仅保留给 composer 按线程切换子代理。

## 阶段 1 执行记录

执行日期：2026-06-08。

已完成：

1. `AgentTemplate` / runtime template 类型移除旧默认模型引用，新增供应商无关的 `modelRequirements`。
2. 模板表单删除 Provider 和模型字段；新建、复制、编辑模板不再依赖已配置 Provider。
3. 模板保存不再要求 provider/model，存储层会剥离历史 JSON 中残留的旧默认模型引用。
4. 模板列表改为显示模型要求；未声明模型要求时显示“模型由 Profile 绑定”。
5. Profile 从模板新增 agent 时使用当前默认 Provider 的默认模型；编辑模板不再覆盖 Profile agent 既有模型。
6. Agent Builder 设置页移除旧五角色“默认启用状态”开关；旧 `subagent-settings:get/save` IPC 和 `subagent_enabled` 存储读写已移除，composer 仍保留线程级子代理开关。
7. 移除子代理“必需”设定：coder 不再被 normalize 强制启用，composer 不再锁定 coder，preset eval 改用 `expectedAgentKeys` 表达测试期望。
8. coder 关闭时执行阶段改为主 Agent 直接实现，不再强制生成 `Coder Tasks` 或调用 `eco_coder`。
9. Provider 与代理桥配置集中到独立 Provider 设置菜单；设置侧边菜单新增 `Provider`，Agent Builder 内部 Tab 移除 Provider。
10. 相关文档和测试已同步。

已验证：

- `bun run typecheck`
- `bun test apps/desktop/test/ipc.test.ts apps/desktop/test/thread-runtime-config.test.ts apps/desktop/test/composer-agent-model-labels.test.ts apps/desktop/test/agent-preset-evals.test.ts apps/desktop/test/agent-preset-e2e.test.ts packages/runtime/test/claude-agent-sdk.test.ts packages/runtime/test/subagent-availability.test.ts`：80 pass，0 fail。
- `bun test packages/runtime/test/subagent-availability.test.ts packages/runtime/test/claude-agent-sdk.test.ts apps/desktop/test/composer-agent-model-labels.test.ts apps/desktop/test/thread-runtime-config.test.ts apps/desktop/test/conversation-store-runtime.test.ts apps/desktop/test/ipc.test.ts apps/desktop/test/agent-preset-evals.test.ts apps/desktop/test/agent-preset-e2e.test.ts apps/desktop/test/agent-orchestration.test.ts apps/desktop/test/agent-orchestration-store.test.ts apps/desktop/test/agent-template-form.test.ts apps/desktop/test/agent-template-archive.test.ts apps/desktop/test/agent-profile-form.test.ts`：107 pass，5 skip，0 fail。
- `bunx biome check packages/runtime/src/claude-agent-sdk.ts packages/runtime/src/subagent-availability.ts packages/runtime/src/prompts/subagent-pipeline.ts apps/desktop/src/shared/thread-runtime-config.ts apps/desktop/src/shared/ipc.ts apps/desktop/src/renderer/composer-agent-model-labels.ts apps/desktop/src/renderer/ComposerAgentModels.tsx apps/desktop/src/renderer/ProxyBridgeSettingsSection.tsx apps/desktop/src/shared/agent-preset-evals.ts apps/desktop/src/shared/agent-preset-e2e.ts apps/desktop/src/shared/agent-orchestration.ts packages/runtime/test/subagent-availability.test.ts packages/runtime/test/claude-agent-sdk.test.ts apps/desktop/test/composer-agent-model-labels.test.ts apps/desktop/test/thread-runtime-config.test.ts apps/desktop/test/conversation-store-runtime.test.ts apps/desktop/test/ipc.test.ts apps/desktop/test/agent-preset-evals.test.ts apps/desktop/test/agent-preset-e2e.test.ts apps/desktop/test/agent-orchestration.test.ts docs/universal-agent-remediation-plan.md docs/universal-agent-product-plan.md`
- 未重新跑全仓 `bun run lint`；此前全仓基线报告 527 errors、232 warnings、7 infos，主要来自 release 产物、`.codex-ref` 格式、既有 main/workspace 文件格式、未用 import 和非空断言。本批用上述窄范围 Biome 覆盖触达文件。
- `bunx biome check apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/ModelsSettingsPanel.tsx docs/universal-agent-remediation-plan.md` 仍失败在既有大文件基线：`App.tsx` 非空断言 / hooks 依赖、`ModelsSettingsPanel.tsx` modal a11y / label / index key 等。已执行安全修复清理导入排序，未把这些历史基线混入本批。

剩余缺口：

- 全仓 `bun run lint` 仍需单独处理历史基线问题；阶段 1 不把这些既有 a11y、hooks、release 产物格式问题混入。
- 阶段 2 之前，`ThreadRuntimeConfig` 仍然混有 `agentProfileId`、`routeProfileId`、composer 线程级子代理开关和旧编排模式字段；这不再来自全局设置。
- 阶段 3 之前，SDK driver 主运行分支仍然受旧 workflow settings 影响。
- workflow step 仍有 `required` 字段；这是步骤失败策略语义，不代表某个子代理必需。

## 下一阶段：通用 Agent 概念收敛重构计划

目标：把现有设计收敛成“子代理库 + Agent Profile + Provider 设置 + 系统预设导入”的单一通用 Agent 模型。Coding 只作为系统预设存在，不再作为独立 profile 类型污染主路径。

### 最终信息架构

1. `Provider` 设置菜单
   - 只管理上游模型服务、API Key、默认模型、API 兼容模式和代理桥上游请求头。
   - 不出现子代理库、编排步骤、工具权限。

2. `Agent Builder / 子代理库`
   - 只管理子代理模板。
   - 模板字段：名称、描述、领域、提示词、whenToUse、outputContract、默认工具建议、MCP、skills、模型能力要求。
   - 模板禁止保存 Provider、具体模型、启用状态、workflow step。

3. `Agent Builder / Agent Profile`
   - 配置主 Agent 的 prompt、模型、工具权限、MCP 和 skills，用于定义主要任务和编排边界。
   - 从子代理库选择模板，并给被选中的子代理绑定 Provider 和模型。
   - 不在 Profile 内编辑子代理 prompt、工具权限、MCP、skills、显示名称、agent key、启用状态或 workflow step。
   - 不提供设置内编排模式切换；当前对话的固定 / 自主切换在 Composer 完成。
   - 不区分 `coding profile` / `agent profile`；只有 `Agent Profile`。

4. `Agent Builder / 场景预设`
   - 系统预设是一组内置子代理模板 + 一个 Agent Profile 蓝图。
   - 用户点击使用后，写入用户子代理库和 Agent Profile。
   - 用户之后编辑自己的副本，不直接改系统预设。

5. 工具权限
   - 不作为独立 Tab。
   - 模板里展示“默认工具建议”。
   - Agent Profile 里展示主 Agent 配置和每个选中子代理的模板摘要 / Provider / 模型绑定。
   - 如未来需要独立入口，只能用于全局安全策略，不用于普通 Profile 配置。

### 数据模型调整

1. `AgentTemplate`
   - 保持供应商无关。
   - 保留默认工具建议，但这些只是模板建议，不是运行时最终权限。
   - 继续支持版本、导入导出、复制内置模板。

2. `AgentProfile`
   - `mainAgent`：主 Agent prompt、模型、工具权限、MCP、skills。
   - `agents[]`：只保存模板引用和 Provider / 模型绑定；历史 `displayName`、权限、MCP、skills 字段仅作兼容保留，新 UI 不再编辑。
   - `agents[]` 不保存模板 prompt / whenToUse / outputContract 的可编辑副本。
   - `strategy`：`autonomous | fixed`。固定编排步骤只引用 profile roster 中的 agent key。

3. `Preset`
   - 内置 preset 存储为 `{ templates, profileBlueprint }`。
   - “使用 preset”时执行导入流程：
     - 为内置模板创建用户副本或复用已导入副本。
     - 用副本 template id 重写 profileBlueprint 的 agent 引用。
     - 为 Profile 绑定当前默认 Provider 的默认模型。
     - 保存为用户 Agent Profile。

4. Legacy
   - `RouteProfile` 只作为历史迁移输入和旧 Coding 兼容。
   - `coding` 不再是 Profile 类型，只是一个 built-in preset。
   - `ThreadRuntimeConfig.routeProfileId`、旧 `subagentEnabled`、旧 `orchestrationMode` 后续迁移为兼容字段。

### 执行阶段

#### 阶段 A：Profile 编辑器去模板编辑能力

范围：

- Agent Profile modal / form state。
- 从 Profile agent editor 中移除对子代理 prompt、whenToUse、outputContract、template tools 的直接编辑。
- 保留模板选择和 Provider / 模型绑定；子代理 displayName、工具权限、MCP、skills 回到子代理库维护。

验收：

- 在 Profile 编辑器里不能修改模板提示词。
- 修改模板必须回到子代理库。
- 已有 Profile 加载时仍能显示模板摘要和最终权限。

#### 阶段 B：工具权限归属收敛

范围：

- 移除 Agent Builder 内独立“工具权限”Tab。
- 在 Profile 编辑器中展示：
  - 主 Agent 工具权限。
  - 每个选中子代理的模板摘要和 Provider / 模型绑定。
- 子代理工具权限、MCP、skills 只在子代理库模板中维护。

验收：

- 用户能在 Profile 内配置主 Agent 工具权限。
- 用户不能在 Profile 内编辑子代理工具权限。
- 不再有孤立工具权限 Tab。
- 模板库负责维护子代理能力建议和权限边界。

#### 阶段 C：统一 Agent Profile，不再区分 Coding Profile

范围：

- UI 文案、类型命名、测试 fixture。
- `coding` 改为系统 preset。
- 旧 route profile 入口标记为 legacy/migration，不能作为新建主路径。

验收：

- 设置页只出现 `Agent Profile` 概念。
- 新建 Profile 不要求完整 coding route。
- Coding preset 通过“场景预设”导入成为普通 Agent Profile。

#### 阶段 D：场景预设导入为模板 + Profile

范围：

- preset catalog 数据结构。
- preset 使用流程。
- 导入冲突处理。
- 测试覆盖导入后模板和 Profile 的引用关系。

验收：

- 点击使用 preset 后，用户子代理库出现对应模板副本。
- 同时生成一个可运行 Agent Profile。
- Profile 引用用户模板副本，而不是直接引用内置模板。
- 再次使用 preset 时有明确策略：复用已导入副本或生成新副本，不能静默覆盖用户改动。

#### 阶段 E：运行时事实源收口

范围：

- `ThreadRuntimeConfig` 收敛到 `profileId + overrides`。
- SDK driver 以解析后的 Agent Profile 为事实源注册 dynamic agents。
- hook 只允许调用 profile roster 中的 agent key。

验收：

- 新线程只保存 Agent Profile 选择。
- composer 子代理开关是线程级 override，不是全局设置。
- 未在 Profile 中选择的子代理无法被 Agent 工具调用。

### 不做的事

- 不再新增 `coding profile` 类型。
- 不把 Provider 或模型绑定放回 `AgentTemplate`。
- 不在 Agent Profile 里编辑模板 prompt。
- 不用隐藏开关兜底概念缺口；如果旧字段仍存在，必须标记为 legacy/migration。

### 建议下一批执行顺序

第一批先做 UI 和数据边界，避免继续扩大混乱：

1. Profile 编辑器移除模板 prompt/tools 源字段编辑，只保留选择模板和模型绑定。
2. 工具权限 Tab 合并进 Profile 编辑器。
3. Agent Builder Tab 重命名/收敛：`子代理库`、`Agent Profile`、`场景预设`、`效果评测`。
4. 场景预设点击使用时写入用户模板副本 + 用户 Agent Profile。
5. 再进入 runtime config 和 SDK driver 收口。

## 当前执行批次：Profile 装配边界收敛

执行日期：2026-06-08。

本批目标：

1. `Agent Profile` 编辑器不能编辑子代理模板内容，只能从子代理库选择模板。
2. `Agent Profile` 内允许配置主 Agent；已选子代理只能绑定 Provider 和模型。
3. 移除 Agent Builder 内独立“工具权限”Tab；子代理工具权限归属到子代理库模板，主 Agent 工具权限归属到 Profile。
4. Agent Builder Tab 收敛为：`子代理库`、`Agent Profile`、`场景预设`、`效果评测`。
5. 场景预设“使用”后写入用户模板副本和用户 Agent Profile，不能直接让用户编辑系统 preset。

本批不做：

- 不迁移 `ThreadRuntimeConfig` 主结构。
- 不重写 SDK driver 主运行分支。
- 不删除旧 route profile 数据表；只限制它继续污染新 UI。
- 不用隐藏 UI 兜底数据模型缺口。

本批验收：

- Profile 编辑器里没有子代理 prompt / whenToUse / outputContract 的编辑输入。
- Profile 编辑器可以配置主 Agent；子代理行只显示模板摘要和 Provider / 模型绑定。
- Agent Builder 不再显示独立“工具权限”Tab。
- Coding 只作为系统场景预设出现，不作为新建 Profile 类型。
- 相关类型检查和聚焦测试通过；如全文件 lint 命中历史基线，记录具体缺口。

本批已执行：

- 渲染层 `AgentProfileAgentFormState` 移除 `promptOverride`，Profile 编辑器不再能覆盖子代理模板 prompt。
- shared/runtime `AgentInstanceConfig` 移除 `promptOverride`，SDK 动态子代理定义只使用模板库 prompt。
- Agent Builder Tab 收敛为 `Agent Library`、`Agent Profile`、`场景预设`、`效果评测`；Provider 设置菜单拆为 `Provider` 和 `代理桥` 两个页签。
- Agent Builder 移除独立“工具权限”Tab 和旧 Route Profile / Coding Profile 编辑入口；Profile 列表内保留最终权限摘要。
- 场景预设“使用”改为先写入用户子代理模板副本，再用这些副本创建用户 Agent Profile；重复使用会复用已有用户/项目副本。
- Provider 设置菜单拆成 `Provider` 和 `代理桥` 两个页签，代理桥标题和字段文案不再混写 User-Agent。
- Agent Builder 的子代理库页移除全局编排策略开关；默认自主编排，当前对话只在 Composer 中切换固定/自主。
- Agent Profile modal 移除设置内编排策略 / Workflow Steps 编辑区；默认新建 Profile 为自主编排，当前对话固定/自主只在 Composer 切换。
- 新对话、切换项目、激活 workspace、删除当前线程后都会把 Composer 默认 runtime 重置为自主编排，避免继承上一条线程的固定编排状态。
- Agent Profile modal 的子 Agent 区域改为“从子代理库选择”，不再编辑 agent key、显示名称或模板本体；要换子代理必须移除后重新从库选择。
- Agent Profile modal 保留主 Agent 配置；子代理行移除工具权限、MCP、skills、启停和排序编辑，只能绑定 Provider / 模型。
- `buildOrchestrationProfileFromForm` 只从 Profile 表单保存主 Agent 配置和模型绑定；子代理工具权限、MCP、skills 改为继承已有配置或子代理库模板，不再接受 Profile 表单覆盖。

本批仍未触碰：

- main/preload/store 层的旧 route profile IPC 和数据表仍保留，服务历史派生 profile 和兼容运行链路；后续删除必须先做迁移方案。
- `OrchestrationProfile.strategy` schema 和运行侧 fixed workflow 仍保留；当前批次只移除设置侧切换/编辑入口。后续要把固定编排步骤迁到 Composer，需要同步改 SDK fixed workflow 对 active fixed profile 的依赖。

本批已验证：

- `bunx biome check --write apps/desktop/src/renderer/ModelsSettingsPanel.tsx apps/desktop/src/renderer/agent-profile-form.ts apps/desktop/src/renderer/preset-import.ts apps/desktop/test/preset-import.test.ts apps/desktop/src/shared/agent-orchestration.ts packages/runtime/src/agent-orchestration.ts`
- `bun run typecheck`
- `bun test apps/desktop/test/agent-profile-form.test.ts apps/desktop/test/preset-import.test.ts apps/desktop/test/agent-orchestration.test.ts packages/runtime/test/agent-orchestration.test.ts apps/desktop/test/agent-preset-evals.test.ts apps/desktop/test/agent-preset-e2e.test.ts`
- `bunx biome check --write apps/desktop/src/renderer/ModelsSettingsPanel.tsx apps/desktop/src/renderer/ProxyBridgeSettingsSection.tsx apps/desktop/src/renderer/agent-profile-form.ts apps/desktop/src/renderer/preset-import.ts apps/desktop/test/preset-import.test.ts apps/desktop/src/shared/agent-orchestration.ts packages/runtime/src/agent-orchestration.ts`
- `bun test apps/desktop/test/agent-profile-form.test.ts apps/desktop/test/preset-import.test.ts apps/desktop/test/agent-orchestration.test.ts packages/runtime/test/agent-orchestration.test.ts apps/desktop/test/agent-preset-evals.test.ts apps/desktop/test/agent-preset-e2e.test.ts apps/desktop/test/orchestration-mode-ui.test.ts apps/desktop/test/thread-runtime-config.test.ts apps/desktop/test/composer-profile-save.test.ts`
- `bunx biome check --write apps/desktop/src/renderer/ModelsSettingsPanel.tsx apps/desktop/src/renderer/ProxyBridgeSettingsSection.tsx apps/desktop/scripts/agent-ui-smoke.mjs docs/universal-agent-remediation-plan.md docs/universal-agent-product-plan.md`
- `bun run typecheck`
- `bun run test:agent-ui-smoke`

本批未通过的历史检查：

- `bunx biome check --write apps/desktop/src/renderer/ModelsSettingsPanel.tsx apps/desktop/src/renderer/ProxyBridgeSettingsSection.tsx apps/desktop/src/renderer/App.tsx apps/desktop/scripts/agent-ui-smoke.mjs docs/universal-agent-remediation-plan.md docs/universal-agent-product-plan.md` 仍命中 `App.tsx` 既有 hook dependency / non-null assertion 基线；本批新增的 App 未使用 import/state 已清理。此前包含 `styles.css` 的宽范围检查也会命中既有 specificity / `!important` 基线。
