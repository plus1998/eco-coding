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

- 任意 `fixed` profile 都走 workflow engine；如果 coding fixed 暂不支持，就不要生成 fixed coding profile。
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
9. Provider、代理桥和 User-Agent 配置集中到独立 Provider 设置菜单；设置侧边菜单新增 `Provider`，Agent Builder 内部 Tab 移除 Provider。
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
