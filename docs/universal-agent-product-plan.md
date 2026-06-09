# Universal Agent 产品计划

## 当前边界

Universal Agent 只保留一个产品入口：Agent Profile。

Profile 负责提供：

- 主代理提示词与任务边界
- 可用 Agent roster
- 每个 Agent 的模型、工具、MCP、技能和权限
- 主代理的委派指导
- 商业场景 preset、eval、E2E 覆盖
- 计费、上下文、运行投影和审计数据

主代理负责真实决策。产品层不再提供硬性步骤、DAG、步骤依赖、步骤产物传递或步骤失败策略。Agent 的协作顺序只能通过主代理提示词、roster 描述、权限边界和 eval 约束来表达。

## 运行路线

1. Composer 选择 Agent Profile。
2. Runtime 根据 Profile 构建主代理 system prompt。
3. Runtime 根据启用的 roster 生成 SDK Agent definitions。
4. Tool permission policy 按主代理和各 Agent 的权限配置执行。
5. 主代理在对话中自行决定是否、何时、如何调用 Agent。
6. 运行投影、活动日志、计费和审计按主代理、子代理、请求、模型维度归因。

## Profile Schema

Profile 的核心结构保持收敛：

- `mainAgent`：主代理提示词、模型、工具、MCP、技能。
- `agents[]`：可委派 Agent 的 key、template、模型、权限和启用状态。
- `strategy`：仅表达主代理委派指导，形态为 `{ kind: "autonomous"; guidancePrompt?: string }`。

不得在 Profile 中加入硬性步骤结构、步骤依赖、步骤输出 key、步骤批次、步骤重试策略或步骤生命周期事件。

## Preset

内置 preset 覆盖 Coding、Research、Writing、Product、Data、Ops 六类场景。

每个 preset 必须包含：

- 主代理提示词
- 默认 Agent roster
- 主代理工具权限
- Agent 模板权限
- 模型建议
- 委派指导
- 示例任务
- eval case

Preset 生成 Profile 时只生成 roster 与委派指导，不生成硬性路线。

## 质量门槛

商业质量闸门覆盖：

- Profile 可构建
- 主代理 prompt 可构建
- Agent definitions 可生成
- 工具权限策略可生成
- 主代理 prompt 不泄露子代理完整系统提示词
- 预期 Agent 都在 roster 中启用
- E2E 任务可产生 deterministic artifact
- 计费可按角色、模型、Agent 维度归因
- 运行投影和审计导出保留可解释数据

任何新增能力如果需要产品层硬性路线，必须先重新评估 Agent 设定是否仍成立。
