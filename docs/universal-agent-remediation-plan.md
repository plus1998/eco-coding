# Universal Agent 收敛计划

## 目标

把 Universal Agent 收敛为主代理驱动的 Agent Profile 系统。

产品层只提供主代理提示词、Agent roster、权限和质量评估。主代理在运行中自行判断是否委派、委派给谁、以什么顺序完成任务。

## 已收敛范围

- Profile strategy 只保留 `{ kind: "autonomous"; guidancePrompt?: string }`。
- Preset 只生成 roster、权限、模型建议和委派指导。
- Runtime 只构建主代理 prompt、Agent definitions 和权限 policy。
- SDK driver 只启动一次主代理 run，不拆分产品层步骤。
- Billing projector 只按 source、role、model、Agent、run attempt 归因。
- Run projection 和 Activity Log 只展示主线、请求、工具和子代理活动。
- Profile performance 只聚合 Profile 级历史表现。
- E2E 和商业质量门槛只验证 Profile、roster、权限、prompt、artifact 和 Agent 维度成本。

## 禁止回流

以下结构不得重新进入 Profile、Runtime、UI、测试或文档：

- 产品层步骤列表
- 步骤依赖图
- 步骤批次
- 步骤输出 key
- 步骤失败策略
- 步骤生命周期事件
- 步骤级计费或性能聚合
- 通过历史 profile kind 做兼容分支

如果需要更强的协作约束，只能通过主代理提示词、Agent 描述、权限、eval 和 E2E case 表达。

## 验收扫描

实现完成后需要验证：

- `OrchestrationStrategy` 没有多分支 kind。
- Profile form 不包含步骤编辑状态。
- Runtime 不导出产品层步骤执行工具。
- SDK driver 没有按 profile 拆分多次 run 的分支。
- IPC 快照没有步骤级 billing 或 performance 字段。
- Renderer 没有步骤面板、步骤编辑器或步骤级展示。
- Tests 不再构造历史 profile kind。
- Docs 不再描述硬性产品层路线。

## 验证命令

推荐运行：

```sh
bun run typecheck
bun test apps/desktop/test/agent-profile-form.test.ts apps/desktop/test/agent-orchestration.test.ts apps/desktop/test/agent-preset-evals.test.ts apps/desktop/test/agent-preset-e2e.test.ts apps/desktop/test/agent-commercial-quality-gate.test.ts apps/desktop/test/agent-profile-performance.test.ts apps/desktop/test/billing-projector.test.ts apps/desktop/test/thread-run-projection-view.test.ts apps/desktop/test/sdk-event-usage-billing.test.ts apps/desktop/test/usage-billing-artifacts.test.ts apps/desktop/test/usage-billing-effects.test.ts packages/runtime/test/agent-orchestration.test.ts packages/runtime/test/claude-agent-sdk.test.ts packages/runtime/test/agent-permission-redteam.test.ts
```
