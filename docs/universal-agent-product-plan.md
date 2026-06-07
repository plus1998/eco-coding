# Universal Agent Product Plan

本文档记录 Eco 从“固定编程子代理流水线”升级为“商用级通用 multi-agent runtime”的长期实施计划。

后续推进规则：

- 如果调整范围、阶段顺序或验收标准，先更新本文档，再改代码。
- 每个阶段完成后，在本文件对应阶段标记完成状态，并补充实际落地差异。
- 默认体验仍然是编程，但系统架构不能再把编程角色作为核心约束。

## 背景

当前 Eco 的产品和代码模型把 `planner / explore / architect / coder / reviewer / tester` 作为固定角色集合：

- 子代理配置更像固定角色开关，而不是用户可声明的 agent library。
- “角色路由”要求固定角色都配置模型，限制了非编程场景。
- “编排模式”与“子代理启用状态”分散，概念上混合了 agent 声明、模型路由和 workflow 策略。
- Runtime prompt 大量硬编码编程计划/执行流水线，导致非编程场景会被 coding prompt 污染。

但 Claude Agent SDK 本身已经支持更通用的能力：

- `queryOptions.agents` 可程序化传入任意自定义子代理。
- 每个 `AgentDefinition` 可配置 `description`、`prompt`、`tools`、`disallowedTools`、`model`、`mcpServers`、`skills`。
- `systemPrompt` 可使用 `claude_code` preset，也可以完全使用自定义 prompt。

因此目标不是从零实现 multi-agent，而是把 Eco 自己的固定角色抽象升级为通用产品模型。

## 最终目标

把 Eco 建成一个通用 Agent 产品：

> 用户可以声明任意子代理，为每个子代理配置模型、工具、MCP、提示词和权限，然后选择由主 agent 自主编排，或按固定/半固定流程编排。

默认内置 Coding preset，但产品能力覆盖研究、写作、运营、数据分析、客服质检、法务审阅、产品规划等场景。

最终系统必须满足：

- 子代理是声明，不是固定开关。
- 编排是配置，不是固定角色路由。
- 编程只是默认预设，不是 runtime 的唯一世界观。
- 每个子代理可独立配置 prompt、模型、工具、MCP、skills 和权限。
- 主 agent 可自主编排，也可按固定 workflow graph 执行。
- 工具权限必须是硬约束，而不是只靠 prompt 约束。
- 成本、上下文、事件、失败、产物和审计日志都能按 agent / step / model 归因。
- 旧编程体验和历史线程必须兼容迁移。

## 核心术语

### 子代理库

子代理库是 agent template 和用户自定义 agent 的集合。

子代理只描述：

- 它是谁。
- 何时使用。
- 使用什么系统提示词。
- 默认使用什么模型。
- 允许使用哪些工具和 MCP。
- 输出结果应满足什么格式。
- 是否允许继续委派其他子代理。

### 子代理编排

子代理编排替代旧“角色路由”和“编排模式”。

它描述：

- 本次线程启用哪些子代理。
- 每个子代理使用什么模型。
- 每个子代理实际工具权限是什么。
- 主 agent 使用什么系统 prompt。
- 编排策略是自主、固定还是混合。
- 固定编排时每个 step 的依赖、输入、输出和失败策略。

### 主 Agent

主 Agent 是当前线程的协调者。

它不等同于旧 `planner`，而是通用 orchestrator。不同 preset 可以有不同主 agent prompt：

- Coding 主 Agent：保留代码工作流能力。
- Research 主 Agent：强调资料收集、验证、综合。
- Writing 主 Agent：强调结构、语气、编辑。
- Data 主 Agent：强调数据读取、分析、报告。
- Custom 主 Agent：用户自定义。

### Agent Key 与 Agent ID

- `agentKey`：配置中的稳定 key，例如 `research_lead`、`coder`、`editor`。
- `agentId`：运行时实例 ID，由 SDK 或 Eco 生命周期服务记录。

新系统中，展示、计费、投影和 resume 应优先依赖运行时 `agentId`，配置和 prompt 选择使用 `agentKey`。

## 非目标

本计划不要求一次性完成以下内容：

- 不要求第一阶段就替换全部 UI。
- 不要求第一阶段就实现 workflow DAG engine。
- 不要求立刻删除所有旧 `AgentRole` 类型。
- 不要求非编程 preset 第一版就覆盖所有行业场景。

但所有新增架构都必须朝通用模型演进，不能继续新增固定编程 role 依赖。

## 产品原则

1. 子代理声明与编排策略正交。
   同一个子代理可以被不同 profile 复用。

2. 主 agent 只注入 roster。
   主 agent 看到短描述、使用时机和输出约束；完整子代理 prompt 只注入该子代理自己的上下文。

3. 工具权限从配置生成，hook 强制执行。
   Prompt 里的“不要使用 Bash”不是权限控制。

4. Coding preset 是默认值，不是特殊代码路径。
   旧编程角色迁移为一组内置 agent template 和一个默认 orchestration profile。

5. 固定编排需要产品层 engine。
   如果只是 prompt 里要求按顺序执行，那只能算混合编排，不算固定编排。

6. 商用级必须可观测、可审计、可迁移、可评测。
   能跑通任务只是起点，不是完成标准。

## 目标架构

### 概念层

```text
Agent Template Library
  -> Agent Instance Config
    -> Orchestration Profile
      -> Thread Runtime Config
        -> SDK queryOptions.agents
        -> Main system prompt roster
        -> Tool permission hooks
        -> Billing / projection / audit
```

### Runtime 注入策略

主 agent system prompt 注入：

- 当前 preset 的主指令。
- 当前编排策略。
- 可用子代理 roster。
- 工具和权限摘要。
- 输出和审批规则。

子代理 definition 注入：

- 完整子代理 prompt。
- 子代理 description。
- 子代理 model。
- 子代理 tools / disallowedTools。
- 子代理 mcpServers。
- 子代理 skills。

主 agent 不注入全部子代理 prompt，避免 token 膨胀和角色污染。

### 数据模型草案

```ts
type AgentDomain =
  | "coding"
  | "research"
  | "writing"
  | "product"
  | "data"
  | "ops"
  | "custom";

type AgentTemplate = {
  id: string;
  name: string;
  description: string;
  domain: AgentDomain;
  prompt: string;
  whenToUse: string;
  outputContract?: string;
  defaultTools: ToolPolicy;
  defaultModelRef?: ModelRef;
  mcpServers?: McpServerRef[];
  skills?: string[];
  allowDelegation: boolean;
  builtIn: boolean;
  version: number;
  updatedAt: string;
};

type AgentInstanceConfig = {
  agentKey: string;
  templateId: string;
  displayName?: string;
  modelRef: ModelRef;
  tools: ToolPolicy;
  mcpServers: McpServerRef[];
  skills?: string[];
  promptOverride?: string;
  enabled: boolean;
};

type OrchestrationProfile = {
  id: string;
  name: string;
  preset: AgentDomain;
  mainAgent: MainAgentConfig;
  agents: AgentInstanceConfig[];
  strategy: OrchestrationStrategy;
  version: number;
  updatedAt: string;
};
```

工具权限草案：

```ts
type ToolPolicy = {
  allowed: string[];
  disallowed: string[];
  bash?: {
    enabled: boolean;
    approval: "always" | "risky" | "never";
    commandAllowlist?: string[];
    commandDenylist?: string[];
  };
  mcp?: {
    allowedServers: string[];
    allowedTools: string[];
  };
  filesystem?: {
    read: "workspace" | "extra_dirs" | "none";
    write: "workspace" | "none";
  };
  network?: {
    webSearch: boolean;
    webFetch: boolean;
  };
};
```

编排策略草案：

```ts
type OrchestrationStrategy =
  | { kind: "autonomous"; guidancePrompt?: string }
  | { kind: "hybrid"; recommendedSteps: WorkflowStep[]; allowPlannerAdjustments: boolean }
  | { kind: "fixed"; steps: WorkflowStep[]; finalAggregator?: WorkflowStep };

type WorkflowStep = {
  id: string;
  agentKey: string;
  promptTemplate: string;
  dependsOn: string[];
  runMode: "sequential" | "parallel";
  required: boolean;
  outputKey: string;
  failurePolicy: "stop" | "retry" | "skip" | "ask_user";
};
```

## 阶段 0：概念重命名与边界校准

状态：已完成。

完成记录：

- 用户可见概念已从“角色路由 / 编排模式 / 子代理开关”收敛到“子代理编排 / 编排策略 / 子代理库”。
- 当前阶段只调整产品概念边界和错误提示，不迁移底层 schema；旧 `AgentRole`、route profile 字段仍作为阶段 1 之前的兼容实现存在。
- 验证：`bun test apps/desktop/test/orchestration-mode-ui.test.ts apps/desktop/test/thread-failure-message.test.ts` 通过；`bun run typecheck` 通过。

目标：先把产品语言和代码新增路径的方向改对，避免继续扩展固定角色模型。

工作项：

- 将产品概念从“子代理开关”调整为“子代理库”。
- 将“角色路由”调整为“子代理编排”。
- 将“编排模式”并入“子代理编排策略”。
- 将 `planner/coder/reviewer/tester` 等视为 Coding preset 的内置模板，而不是通用系统角色。
- 梳理旧 UI 文案和 IPC 字段的兼容命名。

主要代码落点：

- `apps/desktop/src/shared/thread-runtime-config.ts`
- `apps/desktop/src/shared/ipc.ts`
- `apps/desktop/src/renderer/ModelsSettingsPanel.tsx`
- `apps/desktop/src/renderer/SubagentSettingsSection.tsx`
- `apps/desktop/src/renderer/ComposerAgentModels.tsx`
- `apps/desktop/src/renderer/ComposerOrchestrationModeToggle.tsx`

验收标准：

- 新增文案不再把子代理描述为固定编程开关。
- 新增配置不再命名为 role route。
- 旧用户仍能看到默认编程配置。
- 暂不要求删除旧字段，但所有新字段必须使用新概念。

## 阶段 1：通用数据模型与兼容迁移

状态：已完成。

已完成子项：

- 新增通用 `AgentTemplate`、`AgentInstanceConfig`、`MainAgentConfig`、`OrchestrationProfile`、`ToolPolicy` 与 workflow step 类型。
- 新增内置 Coding agent template library，并提供从现有 route profile 生成默认 Coding orchestration profile 的迁移适配器。
- `ModelSettingsSnapshot` 已暴露 `agentTemplates` 与 `orchestrationProfiles`，ProviderStore settings 会返回内置模板和由 route profiles 生成的新编排配置。
- 验证：`bun test` 通过（961 pass / 20 skip / 0 fail）；`bun run typecheck` 通过；阶段目标文件 `bunx biome check ...` 通过。全仓 `bun run lint` 仍失败于既有 Biome 基线问题，本阶段未扩大处理范围。
- 新增 `AgentOrchestrationStore`，支持用户/项目级 agent templates 与 orchestration profiles 的持久化、删除和读取；内置/派生配置禁止写入用户 store。
- 默认 Coding profile builder 已支持 `subagentEnabled -> agents[].enabled`，并将 `manual/autonomous -> fixed/autonomous strategy`。
- 验证补充：`bun test` 通过（963 pass / 21 skip / 0 fail）；`bun run typecheck` 通过；阶段目标文件 `bunx biome check ...` 通过。

目标：建立通用 agent / profile 数据模型，并把旧编程配置迁移为默认 Coding profile。

工作项：

- 新增 `AgentTemplate`、`AgentInstanceConfig`、`OrchestrationProfile`、`ToolPolicy` 类型。
- 新增 store，用于持久化用户级和项目级 agent templates。
- 新增 store，用于持久化 orchestration profiles。
- 将现有 route profile 映射为 `Coding` orchestration profile。
- 将 `subagentEnabled` 映射为 `agents[].enabled`。
- 将 `orchestrationMode` 映射为 `strategy.kind`。
- 提供旧 schema reader，保证历史线程和历史设置可读。

建议代码落点：

- `apps/desktop/src/shared/agent-templates.ts`
- `apps/desktop/src/shared/orchestration-profile.ts`
- `apps/desktop/src/main/agent-template-store.ts`
- `apps/desktop/src/main/orchestration-profile-store.ts`
- `apps/desktop/src/shared/thread-runtime-config.ts`
- `apps/desktop/src/main/provider-store.ts`

验收标准：

- 不再要求所有固定 role 都配置 route 才能启动新模型线程。
- 旧设置能生成一个等价的 Coding profile。
- 每个 agent instance 能单独绑定 provider/model。
- 迁移失败不丢旧配置，并能回退旧读取路径。

## 阶段 2：Agent Registry 子代理库

状态：已完成。

已完成子项：

- 内置 agent template registry 已从 Coding 扩展到 Research、Writing、Product、Data/Ops 第一批模板。
- 新增 Agent Registry IPC：子代理模板和编排配置均支持 list / save / delete。
- `modelSettingsGet` 已合并内置模板、派生 Coding profile、用户模板和用户编排配置。
- 用户 store 与 IPC 保存路径会保护内置模板和派生编排配置，禁止直接覆盖保留 ID。
- 验证：`bun run typecheck` 通过；`bun test apps/desktop/test/agent-orchestration.test.ts apps/desktop/test/agent-orchestration-store.test.ts apps/desktop/test/agent-registry-settings.test.ts apps/desktop/test/ipc.test.ts apps/desktop/test/provider-store.test.ts` 通过。
- 子代理库 UI 已支持创建、复制、编辑和删除用户/项目模板；内置模板只允许复制为用户模板。
- Prompt 编辑器已覆盖名称、领域、作用域、描述、使用时机、prompt、输出契约、默认模型、工具、MCP、skills 和委派开关。
- 验证补充：`bun run typecheck` 通过；`bun test apps/desktop/test/agent-template-form.test.ts apps/desktop/test/agent-orchestration.test.ts apps/desktop/test/agent-registry-settings.test.ts` 通过；`bun run --cwd apps/desktop build` 通过。
- 导入/导出 JSON 已支持 schema archive、数组和单模板对象；导入内置模板会重写为用户副本，避免覆盖内置 registry。
- 用户/项目模板保存会记录版本历史，UI 已支持查看历史和恢复旧版本；恢复会生成新的当前版本。
- 验证补充：`bun run typecheck` 通过；`bun test apps/desktop/test/agent-template-archive.test.ts apps/desktop/test/agent-template-form.test.ts apps/desktop/test/agent-orchestration-store.test.ts apps/desktop/test/ipc.test.ts` 通过；`bun run --cwd apps/desktop build` 通过。

目标：让用户可以创建、编辑、复制、导入、导出、版本化自己的子代理。

工作项：

- 内置 agent template registry。
- 用户自定义 agent template。
- 项目级 agent template。
- Prompt 编辑器。
- Template copy / reset / version history。
- Import / export JSON。
- 配置校验：agent key、prompt、tools、model、MCP、skills。
- 内置模板保护：不可直接破坏，只能复制或覆盖到用户版本。

第一批内置模板：

- Coding：
  - Explorer
  - Architect
  - Coder
  - Reviewer
  - Tester
- Research：
  - Researcher
  - Source Verifier
  - Synthesizer
- Writing：
  - Editor
  - Style Critic
  - Fact Checker
- Product：
  - PM Analyst
  - UX Reviewer
  - Spec Writer
- Data / Ops：
  - Data Analyst
  - SQL Reviewer
  - Incident Triage

验收标准：

- 用户能新增一个非编程子代理，只配置 prompt、description、tools 和 model。
- 新增子代理能被 profile 选择并进入 runtime。
- 内置模板可复制，不会被用户编辑直接覆盖原始默认模板。
- Export 后重新 import 能得到等价配置。

## 阶段 3：Runtime 动态 AgentDefinition 注入

状态：已完成。

已完成子项：

- 新增 runtime 通用 agent 编排解析层，可从 `OrchestrationProfile + AgentTemplate[]` 生成 SDK `agents`、agent key roster、主 agent system prompt 和主 agent 工具 allowlist。
- `AgentRuntimeRunInput` 与桌面 `buildSdkRunInput` 已支持 `agentRegistry`；问答、计划、执行、审批续跑、普通续聊和文件回滚入口都会解析当前线程 profile 并传入 runtime。
- `ClaudeAgentSdkDriver` 已优先使用动态 profile：主 agent model 来自 profile，子代理 `AgentDefinition` 来自 profile agents，完整子代理 prompt 只进入对应子代理 definition。
- Coding profile 仍保留 `claude_code` preset，并按当前 phase 过滤 `eco_explore / eco_architect / eco_coder / eco_reviewer / eco_tester`，避免默认编程行为退化。
- 非 Coding profile 走通用 system prompt 和 phase prompt，不再套用“仓库探索、diff、测试、实现计划”等编程专属包装。
- SDK hook 已支持动态 Eco agent key allowlist，`eco_researcher` 这类用户自定义 key 可被放行，未列入 roster 的 SDK 内置/陌生子代理仍会被拒绝。
- 验证：`bun run typecheck` 通过；`bun test` 通过（980 pass / 21 skip / 0 fail）；`bun run --cwd apps/desktop build` 通过（保留既有 Vite chunk size warning）。

目标：用当前 profile 动态生成 SDK `agents`，摆脱固定 `createExecutionAgentDefinitions` 路径。

工作项：

- 新增通用 `createAgentDefinitionsFromProfile(profile, routes)`。
- 为每个 agent instance 生成 SDK `AgentDefinition`。
- 支持 `tools`、`disallowedTools`、`model`、`mcpServers`、`skills`。
- 新增 `buildMainAgentRoster(profile)`。
- 新增非编程 custom system prompt 路径。
- Coding preset 继续可选择 `claude_code` preset。
- Research / Writing / Data 等 preset 使用自定义 system prompt，避免 coding prompt 污染。

主要代码落点：

- `packages/runtime/src/claude-agent-sdk.ts`
- `packages/runtime/src/prompts/`
- `packages/runtime/src/subagent-availability.ts`
- `packages/runtime/src/eco-sdk-hooks.ts`
- `apps/desktop/src/main/sdk-run-input.ts`
- `apps/desktop/src/main/thread-runtime-routes.ts`

验收标准：

- Coding profile 行为不退化。
- Research/Writing profile 的系统提示词不包含代码执行、diff、测试等编程专属规则。
- 子代理 prompt 修改后，下一次运行立即生效。
- 缺失模型或非法工具配置时，启动前给出清晰错误。
- 主 agent 只收到 roster，不收到完整子代理 prompt。

## 阶段 4：自主 / 混合 / 固定编排策略

状态：已完成。

已完成子项：

- 新增 runtime workflow 编排模块，可校验 fixed workflow DAG、展开 final aggregator、按依赖生成顺序/并行 batch，并渲染 `{{userPrompt}}`、`{{step.<id>}}`、`{{output.<key>}}`、`{{allOutputs}}` step 输入模板。
- 新增 hybrid workflow guidance 生成器，主 agent 偏离推荐步骤时必须说明原因。
- `ClaudeAgentSdkDriver` 已对非 Coding fixed profile 启用产品层 workflow engine：runtime 负责逐 step 执行，而不是只在 prompt 里要求“按顺序”。
- fixed workflow 每个 step 会限制 SDK `agents` 只暴露当前 step 指定的 Eco agent key；上一步 transcript 会作为后续 step 模板输入。
- fixed workflow 已支持依赖顺序、并行 batch、final aggregator、`stop / retry / skip / ask_user` failure policy 和 step start / complete / fail 事件。
- fixed workflow lifecycle 已接入桌面 activity bridge 和 run projection；主运行流会展示“固定编排开始/步骤开始/步骤完成/步骤失败/固定编排完成”，不会被普通 agent lifecycle 噪声过滤。
- 默认 Coding 手动审批流仍走旧成熟路径，避免破坏现有编程体验；Coding fixed workflow parity 与 UI 展示留在本阶段后续子项。
- 验证：`bun run typecheck` 通过；`bun test` 通过（988 pass / 21 skip / 0 fail）；`bun run --cwd apps/desktop build` 通过（保留既有 Vite chunk size warning）。

目标：让编排成为正式 runtime 能力，而不是一个 UI 开关。

### 自主编排

主 agent 根据 roster 自己决定调用哪些子代理。

工作项：

- 根据 profile 生成自主编排 guidance prompt。
- 强化“何时使用/何时不使用”规则。
- 记录主 agent 选择子代理的原因。

验收标准：

- 主 agent 能根据任务合理选择子代理。
- 不调用子代理时能解释原因。
- 子代理选择不会依赖固定 coding role。

### 混合编排

给主 agent 推荐流程，但允许它跳过、追加或重排，并要求说明原因。

工作项：

- 支持 recommended steps。
- 支持主 agent 输出调整理由。
- UI 展示实际执行流程与推荐流程差异。

验收标准：

- 推荐流程可以表达 Coding、Research、Writing 等 preset。
- 主 agent 调整流程时有结构化记录。

### 固定编排

由产品层 workflow engine 按 DAG 执行，而不是仅靠 prompt。

工作项：

- 新增 workflow step runner。
- 支持 step 输入模板。
- 支持 step 输出引用。
- 支持并行 step。
- 支持 failure policy：stop / retry / skip / ask_user。
- 支持 final aggregator step。

验收标准：

- Coding 可表达：Explore -> Plan -> parallel Coder -> Review -> Test -> Final。
- Research 可表达：parallel Research -> Verify -> Synthesize -> Editor。
- 固定编排中任一步失败有明确处理策略。
- 每一步产物可被后续步骤引用。

## 阶段 5：工具权限与安全硬约束

状态：进行中。

目标：商用级工具权限必须可配置、可解释、可审计、可强制执行。

工作项：

- 子代理级 `tools` 和 `disallowedTools`。
- 子代理级 `mcpServers`。
- MCP server/tool 白名单。
- Bash 命令策略。
- 文件读写策略。
- WebSearch/WebFetch 策略。
- PreToolUse hook 按当前 agent 实例 enforce。
- 权限拒绝事件进入 audit log。
- UI 展示每个 agent 的实际权限。

已完成：

- 新增运行时 `EcoRuntimeToolPermissionPolicy`，从通用 orchestration profile 和 agent template 生成主 agent / 子代理权限表。
- `allowedTools`、`disallowedTools`、MCP tool 白名单、MCP server 通配白名单统一归一为可执行的工具模式。
- SDK `PreToolUse` hook 已按当前 main agent / 子代理强制执行权限，拒绝时返回明确 `permissionDecisionReason`。
- 动态子代理支持 `eco_*` agent key 与未加前缀的运行时 agent type 回退，避免 SDK 事件命名差异导致误拒绝。
- `ClaudeAgentSdkDriver` 已在动态 agent registry 下把工具权限传入 SDK hooks；固定 workflow step 通过 step agent key 继承对应子代理权限。
- Coding 默认阶段工具会合并进入主 agent 权限，避免计划审批工具和阶段工具被通用权限层误拦截。
- 运行时 `ToolPolicy` 已镜像 `bash`、`filesystem`、`network` 结构化字段，不再只依赖工具名白/黑名单。
- Bash 策略已支持 `enabled`、`approval`、`commandAllowlist`、`commandDenylist`：`always/risky` 可返回 SDK `ask`，风险命令复用 Eco 命令风险规则，拒绝命令直接 deny。
- 文件系统策略已对 `Read/Glob/Grep/LS/NotebookRead` 和 `Write/Edit/MultiEdit/NotebookEdit` 做硬约束，支持禁读、禁写和 workspace 范围校验。
- 网络策略已对 `WebSearch/WebFetch` 做硬约束，即使工具名在 allowlist 中，结构化 `network` 关闭时也会拒绝。
- `ClaudeAgentSdkDriver` 已把当前线程 `workspacePath` 传入权限 hook，文件路径判断按线程工作区执行；runtime 权限逻辑不再把 Node-only workspace 模块拖入 renderer 构建图。
- 权限拒绝已进入运行审计链：`PreToolUse` deny 会生成 runtime `tool.failed` 事件，包含 `tool_name`、`tool_use_id`、actor、agent id/type、cwd 和拒绝原因；desktop activity bridge 和 run event normalizer 已保留结构化 tool metadata。
- 子代理模板列表已展示每个 agent 的实际权限摘要，包括 Bash 审批策略、文件读写范围、网络 Search/Fetch、MCP 白名单、命令白/黑名单和禁用工具。

已验证：

- `bun run typecheck`
- `bun test packages/runtime/test/agent-orchestration.test.ts packages/runtime/test/eco-sdk-hooks.test.ts packages/runtime/test/claude-agent-sdk.test.ts packages/workspace/test/workspace.test.ts`
- `bun test apps/desktop/test/agent-template-form.test.ts`
- `bun test`：999 pass，21 skip，0 fail。
- `bun run --cwd apps/desktop build`

主要代码落点：

- `packages/runtime/src/eco-sdk-hooks.ts`
- `packages/runtime/src/claude-agent-sdk.ts`
- `apps/desktop/src/main/mcp-store.ts`
- `apps/desktop/src/shared/mcp.ts`
- `apps/desktop/src/main/agent-lifecycle-service.ts`
- `apps/desktop/src/renderer/agent-template-form.ts`
- `apps/desktop/src/renderer/SubagentSettingsSection.tsx`

验收标准：

- 禁用 Bash 的子代理绝不能执行 Bash。
- 只允许某 MCP server 的子代理不能调用其他 MCP。
- 只读 agent 不能写文件。
- 被拒绝的工具调用有清晰原因和审计记录。
- 权限策略测试覆盖主 agent、子代理、固定 workflow step。

## 阶段 6：UI 产品化

状态：进行中。

目标：把设置体验从开发者配置页升级为可商用的 agent builder。

页面结构：

- Agent Library：子代理库。
- Orchestration Profiles：编排配置。
- Model Routing：模型选择。
- Tool Permissions：工具权限。
- Presets：场景预设。
- Run Monitor：运行观察。
- Evaluation：效果评测。

线程启动入口：

- 默认选择 Coding。
- 可切换 Research / Writing / Product / Data / Ops / Custom。
- 启动前展示本次启用的子代理。
- 展示每个 agent 的模型和高风险工具。
- 支持保存为 profile。

已完成：

- 新增 renderer 侧 `agent-profile-summary`，把 `OrchestrationProfile + AgentTemplate + ThreadRuntimeConfig` 汇总成可复用 UI 摘要。
- Composer 入口已从“路由方案”升级为 “Agent Profile”，底层仍使用当前可运行的 `routeProfileId` 兼容线程运行链路。
- 启动前 profile popover 已展示场景、编排策略、启用子代理数量、主 agent 模型、高风险工具和启用子代理模型预览。
- 当前线程的手动子代理开关会参与 profile 摘要计算，用户看到的是本次实际启用的子代理。
- 设置页已升级为 Agent Builder 结构，包含 Agent Library、编排配置、模型路由、工具权限和场景预设。
- 编排配置列表已使用通用 Agent Profile 摘要展示场景、策略、主 agent、启用子代理和高风险工具，不再用固定 role 横排作为主要信息架构。
- 工具权限页已按 profile 展示主 agent 与每个子代理的实际权限 chip；场景预设页按 domain 汇总内置模板、profile 数量和可运行状态。
- 运行观察 UI 已根据当前线程绑定的 Agent Profile 生成 runtime display map，projection agent card、agent echo badge 与 Context 子代理条目会优先显示用户配置的 agent/template 名称，并继续保留 `agentId` 实例标识。

已验证：

- `bun test apps/desktop/test/agent-profile-summary.test.ts`
- `bun test apps/desktop/test/runtime-agent-display.test.ts apps/desktop/test/thread-run-projection-view.test.ts`
- `bun test apps/desktop/test/thread-run-projection-view.test.ts apps/desktop/test/activity-log.test.ts apps/desktop/test/activity-agent-id.test.ts apps/desktop/test/thread-run-event-normalizer.test.ts`
- `bun run typecheck`
- `bun run --cwd apps/desktop build`
- `bun test --reporter dot`：1004 pass，21 skip，0 fail。

运行中 UI：

- 主 agent 时间线。
- 子代理卡片按运行时 `agentId` 分组。
- 每个子代理展示任务、模型、工具调用、token/cost、输入摘要、输出结果、失败原因。
- 固定编排展示 step/DAG 状态。

验收标准：

- 普通用户不需要理解 role/router，也能选择或创建 profile。
- 高级用户能精确控制模型、工具、MCP 和 prompt。
- 非编程场景 UI 不显示编码、审查、测试等不相关术语。
- 运行状态可解释，不是黑盒。

## 阶段 7：计费、上下文与可观测

状态：进行中。

目标：每次运行的钱、上下文、失败和产物都能按 agent / step / model 归因。

工作项：

- 按主 agent / 子代理统计 token。
- 按 model 统计成本。
- 按 workflow step 统计成本。
- 子代理上下文占用。
- Prompt cache 命中情况。
- 失败率、平均耗时、工具调用次数、MCP 调用次数。
- Profile 历史表现。
- 企业审计日志导出。

已完成：

- Phase 7.1 盘点完成：现有 `UsageLedgerCoordinator`、billing projector、SubAgent metrics projection、context snapshot scheduler、thread-run projection 已经能提供按 `agentId`/role/model 的用量、成本、context 和 timeline 底座。
- 现有运行观察已在 Phase 6 接入 runtime display map，但用量汇总入口仍分散在 billing/context/activity 三块，需要合并为 profile/agent 可解释摘要。
- Phase 7.2 已完成：`UsageBreakdownPanel` 的按 Agent / 按模型用量明细接入运行时 Agent Profile 显示名，主 agent、子代理实例和模型归因都会显示用户配置的 agent 名称，并保留 `agentId` 前缀用于区分并发实例。
- Phase 7.2 验证：`bun test apps/desktop/test/usage-breakdown-panel.test.ts`、`bun run typecheck`。
- Phase 7.3 已完成：SDK workflow 生命周期事件会把 `ecoWorkflow`/`ecoWorkflowStep` 结构化 metadata 写入 run projection；`thread-run-projection-view` 聚合固定编排 step，展示 profile、agent、output key、批次、尝试次数、状态、耗时和失败原因；活动日志新增“子代理编排”摘要，并隐藏结构化 step 生命周期的重复时间线行。
- Phase 7.3 验证：`bun test apps/desktop/test/sdk-stream-activity.test.ts apps/desktop/test/thread-run-event-normalizer.test.ts apps/desktop/test/thread-run-projection-view.test.ts`、`bun run typecheck`。
- Phase 7.4 已完成：固定 workflow step 的 SDK 事件会携带 `ecoWorkflowStepContext`，SDK usage billing 会把 step metadata 传入 assistant fallback、stream partial 和 final run 三条链路；usage ledger metadata 记录 `ecoWorkflowStep`，billing projector 聚合每个 step 的 token、cost 和 modelIds，活动日志的“子代理编排”摘要会显示每步 token/cost。
- Phase 7.4 验证：`bun test packages/runtime/test/claude-agent-sdk.test.ts apps/desktop/test/sdk-event-usage-billing.test.ts apps/desktop/test/usage-billing-artifacts.test.ts apps/desktop/test/usage-billing-effects.test.ts apps/desktop/test/billing-projector.test.ts apps/desktop/test/thread-run-projection-view.test.ts`。
- Phase 7.5 已完成：新增 Agent Profile 历史表现聚合，按 profile 汇总运行次数、成功率、平均耗时、token、成本、最近运行、模型和 workflow step 成本；Agent Builder 的“编排配置”列表展示每个 profile 的历史表现，并提供刷新入口。旧线程若没有 usage ledger，仍会进入运行次数统计，但不做旧格式 billing 兜底。
- Phase 7.5 验证：`bun test apps/desktop/test/agent-profile-performance.test.ts apps/desktop/test/ipc.test.ts`。
- Phase 7.6 已完成：新增 Agent 审计 JSON 导出，schema 为 `eco.agent-audit.v1`，包含 orchestration profiles、agent templates、profile performance、thread summary、billing、run projection、activity、run attempts、agent instances 和 usage ledger events；Agent Builder 的“编排配置”页提供导出入口。
- Phase 7.6 验证：`bun test apps/desktop/test/agent-audit-export.test.ts apps/desktop/test/ipc.test.ts`。

与既有计划关系：

- Token/cost 归因延续 `docs/agent-billing-refactor-plan.md` 的 ledger/projection 方向。
- Agent card 和 timeline 归因延续 `docs/thread-run-projection-refactor-plan.md` 的 `agentId` 主键方向。
- 本计划要求这些投影不再依赖固定 role 文案或固定 role 枚举。

验收标准：

- 用户能看到一次运行总成本和分 agent 成本。
- 用户能看到每个 workflow step 的耗时、成本和失败状态。
- 子代理并发时不会串卡、串账、串上下文。
- 非编程 agent 也能正确显示，不依赖 `coder/reviewer` 文案。

## 阶段 8：预设场景打磨

状态：进行中。

目标：不是只支持自定义，而是内置场景真的可用。

第一批商用 preset：

### Coding

适合软件开发、代码修改、审查、测试。

默认 agents：

- Explorer
- Architect
- Coder
- Reviewer
- Tester

### Research

适合市场研究、技术调研、竞品分析、资料汇总。

默认 agents：

- Researcher
- Source Verifier
- Synthesizer

### Writing

适合长文、文档、邮件、PRD、品牌内容。

默认 agents：

- Editor
- Style Critic
- Fact Checker

### Product

适合需求分析、用户故事、方案设计、roadmap。

默认 agents：

- PM Analyst
- UX Reviewer
- Spec Writer

### Data

适合 CSV/SQL/指标分析、报告生成。

默认 agents：

- Data Analyst
- SQL Reviewer
- Report Writer

### Ops

适合事故分析、日志检查、runbook 执行。

默认 agents：

- Incident Triage
- Log Analyst
- Runbook Executor

每个 preset 必须包含：

- Main agent prompt。
- 子代理集合。
- 默认工具权限。
- 默认模型建议。
- 自主/混合/固定编排建议。
- 示例任务。
- Evals。

已完成：

- Phase 8.1 已完成：新增结构化内置 preset catalog，覆盖 Coding、Research、Writing、Product、Data、Ops 六个商用场景；每个 preset 均包含 main agent prompt、默认子代理集合、主 agent 工具权限、模型建议、自主/混合/固定编排建议、3 个示例任务和 3 个 eval case。
- Phase 8.1 已补齐 Data/Ops 缺失内置模板：Data Report Writer、Ops Log Analyst、Ops Runbook Executor，确保 Phase 8 默认 agents 全部有真实 template 可引用。
- Agent Builder 的“场景预设”页已从 domain 计数升级为 preset 规格展示，显示默认策略、主 agent prompt 摘要、默认子代理、示例任务、eval 覆盖和模型建议。
- Phase 8.1 验证：`bun test apps/desktop/test/agent-orchestration.test.ts`。
- Phase 8.2 已完成：新增 preset -> user orchestration profile builder，按当前默认 provider/model 生成完整可运行 profile；Agent Builder 的“场景预设”页支持一键“复制为 Profile”，保存后刷新设置并进入“编排配置”页。
- Phase 8.2 验证：`bun test apps/desktop/test/agent-orchestration.test.ts`。
- Phase 8.3 已完成：新增内置 preset eval suite，把 catalog 中 18 个 eval case 展开为本地可验证场景，校验 profile 可生成、必需 agent 启用、workflow step 引用有效、模型绑定完整，并防止非 Coding main prompt 出现 coding-only 术语污染。
- Phase 8.3 验证：`bun test apps/desktop/test/agent-preset-evals.test.ts apps/desktop/test/agent-orchestration.test.ts`。

验收标准：

- 每个 preset 都能独立完成至少 3 个真实端到端任务。
- 非 Coding preset 不出现编程语气污染。
- Preset 可以复制成用户自定义 profile。

## 阶段 9：评测与质量体系

状态：进行中。

目标：防止产品变成“看起来能用，但不可控、不稳定”。

评测类型：

- 编程任务 eval。
- 研究引用质量 eval。
- 写作结构和风格 eval。
- 数据分析正确性 eval。
- 工具权限安全 eval。
- 子代理选择准确率 eval。
- 固定编排完成率 eval。
- 成本回归 eval。
- 长上下文稳定性 eval。

已完成：

- Phase 9.1 已完成：Agent Builder 新增“效果评测”页，读取内置 preset eval suite，按 preset 展示配置级 eval 总数、通过/失败状态、case prompt、必需 agent 和失败原因。
- Phase 9.1 验证：`bun test apps/desktop/test/agent-preset-evals.test.ts`、`bun run typecheck`、`bun run --cwd apps/desktop build`。
- Phase 9.2 已完成：根目录新增 `bun run test:agent-presets`，一条命令覆盖 preset catalog、本地 eval suite、runtime dynamic agent definition、workflow orchestration 和工具权限 hook。
- Phase 9.2 验证：`bun run test:agent-presets`。

发布前测试要求：

- 单元测试。
- Runtime 集成测试。
- SDK agents 注入测试。
- 权限拦截测试。
- UI smoke test。
- 至少 3 个 preset 的端到端任务。

验收标准：

- Preset prompt 改动不能无测试上线。
- 权限策略有红队测试。
- 成本和 token 异常有明显提示或诊断日志。
- 子代理选择错误率能被观察和回归。

## 阶段 10：迁移与兼容收敛

状态：进行中。

目标：让 Agent Profile 成为新线程主路径，旧 `routeProfile` 只保留为 Coding preset 的路由代理字段。按当前产品决策，不为历史数据做额外兜底；遇到兼容冲突时优先收敛到新 schema。

迁移映射：

- 旧 `routeProfile` -> Coding `OrchestrationProfile`。
- 旧 `planner` route -> `mainAgent.modelRef`。
- 旧 `explore/architect/coder/reviewer/tester` routes -> Coding agent instances。
- 旧 `subagentEnabled` -> `agents[].enabled`。
- 旧 `orchestrationMode` -> `strategy.kind`。
- 旧 role label -> Coding template display label。

收敛步骤：

1. 新线程使用 `agentProfileId` 作为选择主键，`routeProfileId` 降级为 legacy/proxy 字段。
2. Runtime config 解析支持 `agentProfileId` only payload。
3. Coding profile 继续要求完整 `planner/explore/architect/coder/reviewer/tester` 路由。
4. 非 Coding / Custom profile 不再要求完整编程路由，只要求 profile 能解析出至少一个可用模型路由。
5. 新 projection 支持动态 agent key。
6. 删除新路径上的固定 role 依赖。

已完成：

- Phase 10.1 已完成：`ThreadRuntimeConfig` 新增 `agentProfileId`，默认线程配置优先选择 `OrchestrationProfile`，并支持只包含 `agentProfileId` 的 JSON payload。
- Phase 10.1 主进程已收敛：线程启动、继续、批准计划、重试、上下文压缩和 SDK driver 都通过线程的 Agent Profile 决定 runtime 校验规则；Coding profile 仍要求完整编程角色，非 Coding profile 使用 profile 主模型/可映射 agent 模型生成运行路由。
- Phase 10.1 renderer 已收敛：Composer 的 Agent Profile popover 使用 Profile ID 作为选择值，自定义/复制出的非 route-backed profile 可以被选择；发送可用状态按选中 profile 的模型/provider 就绪判断，不再硬性要求全部编程 role。
- Phase 10.1 测试已覆盖：默认 profile 选择、agentProfileId-only payload、自定义 profile 可选、generic profile partial routes、Coding 默认完整路由校验。
- Phase 10.2 已完成：activity/projection 展示层从固定 `SubagentRole` 判断扩展为动态 agent display role；`researcher`、`source_verifier`、`eco_source_verifier` 等自定义/SDK agent key 会被归入子代理运行卡片、参与 active delegation、run bounds、耗时计算，并优先使用 Agent Profile display map 展示名称。
- Phase 10.2 保留边界：runtime SDK 内部的 Coding prompt、旧 subagent resume、route/model billing 仍有固定 role 依赖，后续阶段继续削减；本点只完成运行观察和活动日志的动态 key 主路径。
- Phase 10.3 已完成：IPC 中 billing、context、subagent timing/metrics/live event 的 role 字段收敛为 `RuntimeAgentRole`，用量拆解、用量摘要、上下文窗口监控和 renderer 活动模型映射都能保留动态 agent key。
- Phase 10.3 上下文主路径已支持自定义 role 汇总与动态实例：`ContextWindowMonitor` 会按固定 Coding role 优先、动态 role 字母序补充排序；带 `agentId` 的非 planner agent 会作为独立实例记录，清理子代理状态时统一保留 planner、清掉其他 agent。
- Phase 10.4 已完成：usage ledger、usage ledger adapters、billing projector、thread usage accumulator、SDK/proxy billing attribution、active run billing state、subagent metrics projection/persistence 的运行期 role 字段改为 `RuntimeAgentRole`，动态 agent key 从事件生成、归因、账单投影到 metrics 持久化不会再被固定 Coding role 类型截断。
- Phase 10.4 行为收敛：有 `agentId` 的动态子代理可进入 billing observations、legacy metrics fallback 和 subagent billing snapshot；metrics record target 不再因为 role 不是固定 Coding 子代理而丢弃 resolver 已确认的 agent。
- Phase 10.5 已完成：SDK `eco_*` agent key、subagent resume/capture hook、stream activity、session hooks、Agent lifecycle service、Subagent metrics registry 和 OTel billing role 统一支持 `RuntimeAgentRole`，动态 Agent 可以启动、停止、恢复、归因父 tool_use、进入活动日志和生命周期事件。
- Phase 10.5 保留边界：`planner/system/thinking/tool/user` 等非 Agent role 仍不会被 resolver 当成子代理实例；内置 Coding role 的 legacy `Explore`/`eco_coder` 等映射保持可用，自定义 Agent 通过 `eco_${agentKey}` 进入 runtime。

Phase 10.1 验证：

- `bun test apps/desktop/test/thread-runtime-config.test.ts apps/desktop/test/agent-profile-summary.test.ts apps/desktop/test/thread-runtime-routes.test.ts`
- `bun run typecheck`

Phase 10.2 验证：

- `bun test apps/desktop/test/activity-log.test.ts apps/desktop/test/thread-run-projection-view.test.ts`
- `bun run typecheck`

Phase 10.3 验证：

- `bun test apps/desktop/test/context-window-monitor.test.ts apps/desktop/test/billing-token-breakdown.test.ts apps/desktop/test/thread-usage-summary.test.ts apps/desktop/test/usage-breakdown-panel.test.ts`
- `bun run typecheck`

Phase 10.4 验证：

- `bun test apps/desktop/test/thread-usage-accumulator.test.ts apps/desktop/test/billing-projector.test.ts apps/desktop/test/subagent-metrics-record-target.test.ts apps/desktop/test/sdk-run-billing-resolution.test.ts apps/desktop/test/sdk-event-usage-billing.test.ts apps/desktop/test/proxy-usage-billing.test.ts`
- `bun run typecheck`

Phase 10.5 验证：

- `bun test packages/runtime/test/subagent-resume.test.ts packages/runtime/test/eco-sdk-hooks.test.ts packages/runtime/test/sdk-stream-events.test.ts apps/desktop/test/activity-agent-id.test.ts apps/desktop/test/agent-lifecycle-service.test.ts apps/desktop/test/subagent-session-store.test.ts apps/desktop/test/subagent-metrics-registry.test.ts apps/desktop/test/subagent-agent-resolver.test.ts apps/desktop/test/otel-usage-billing.test.ts`
- `bun run typecheck`

验收标准：

- 新线程不再依赖固定 role 作为 Profile 选择主键。
- 非 Coding profile 不再要求固定 role 完整配置。
- Coding profile 的旧路由体验保持可用。
- UI、runtime 校验、审计和投影使用同一个 Agent Profile 选择结果。

## 技术主线优先级

### P0：先移除新路径固定角色依赖

目标：

- 用动态 `agentKey` / `agentId` 替代新路径上的固定 `AgentRole`。
- 旧 `AgentRole` 只作为 legacy 和 Coding preset 兼容存在。

关键文件：

- `packages/shared/src/index.ts`
- `packages/runtime/src/subagent-availability.ts`
- `packages/runtime/src/claude-agent-sdk.ts`
- `apps/desktop/src/shared/subagent-roles.ts`
- `apps/desktop/src/main/thread-runtime-routes.ts`

### P1：动态 AgentDefinition

目标：

- Profile -> SDK agents。
- Profile -> main roster prompt。
- Profile -> tool permission policy。

### P2：UI 重构

目标：

- Agent Library。
- Orchestration Profile editor。
- Preset selector。
- Run monitor dynamic labels。

### P3：固定编排 engine

目标：

- Workflow DAG。
- Step runner。
- Artifact passing。
- Failure policy。

## 关键风险

### 风险：Prompt 污染非编程场景

缓解：

- 非 Coding preset 不使用 `claude_code` preset。
- 主 agent prompt 与 Coding workflow prompt 分离。
- Evals 检查非编程场景是否出现 coding-only 指令。

### 风险：固定编排只停留在 prompt

缓解：

- 明确区分 autonomous / hybrid / fixed。
- Fixed 必须由产品层 engine 执行。
- Prompt 推荐流程只能算 hybrid。

### 风险：权限只靠提示词

缓解：

- `ToolPolicy` 映射 SDK tools/disallowedTools。
- PreToolUse hook 做二次 enforce。
- 审计日志记录 allow/deny。

### 风险：计费和 UI 仍依赖固定 role

缓解：

- Projection 主键使用 `agentId`。
- 配置展示使用 `agentKey`。
- Role 只作为 legacy label fallback。

### 风险：配置复杂度过高

缓解：

- 默认 preset 保持简单。
- 高级配置折叠。
- 内置模板可复制修改。
- 启动前展示风险摘要。

## 商用级完成定义

本计划完成时，系统必须达到：

- 用户能创建任意场景 agent profile。
- 每个子代理能独立配置 prompt、模型、工具、MCP、skills。
- 主 agent 能自主编排，也能按固定流程执行。
- 默认 Coding 体验不弱于现有版本。
- 非编程场景没有编程系统提示词污染。
- 工具权限是硬约束。
- 成本、日志、失败、上下文都可观测。
- 配置可导入导出、可版本化、可迁移。
- 内置 preset 有真实 eval 兜底。
- 历史线程和历史配置可兼容读取。

## 推荐推进顺序

1. 建立新类型和 migration adapter。
2. 把旧 Coding 配置迁移为默认 profile。
3. 实现 profile -> dynamic SDK agents。
4. 让 Coding preset 跑在新模型上，确保不退化。
5. 加入 Research 和 Writing preset，验证非编程 prompt。
6. 实现 tool policy enforce。
7. 重构 UI 为 agent library + orchestration profile。
8. 加入 hybrid/fixed workflow engine。
9. 建立 eval 和 commercial observability。
10. 收敛旧固定 role 路径。
