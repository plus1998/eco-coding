# Claude Core 基线

> 基线提交：`origin/main@b05d308`  
> 分支：`session-core-integration`  
> 记录日期：2026-07-14  
> 目的：在引入多 Core 协调层前，固定 Claude 主路径的可重复回归门禁，并如实记录尚未验证或已有失败。  
> 现行 SDK 锁定：以 workspace `package.json` / `bun.lock` 为准；当前为 `@anthropic-ai/claude-agent-sdk@0.3.223`（2026-08-06 升级）。下文「固定环境」中的 `0.3.205` 为当时基线盘点值，保留作历史对照。

## 固定环境

- Bun：`1.3.14`
- Claude Agent SDK：锁文件版本 `0.3.223`（基线盘点时曾为 `0.3.205`）
- 安装命令：`bun install --frozen-lockfile`
- 类型检查：`bun run typecheck`
- Claude 回归：`bun run test -- --claude-regression`
- SQLite：`bun run test -- --sqlite`（实际由系统 `node --test` 执行）
- Desktop 构建：`bun run build`

必须先执行 frozen install。首次盘点时 `bun.lock` 指向 `0.3.205`，但本地磁盘实际安装为 `0.3.168`，导致 streaming input control surface 契约失败。重新安装后契约通过。本地验证必须使用 frozen lock，避免把依赖漂移误判为产品回归。

## Claude 回归范围

`test:claude-regression` 固定覆盖：

- Claude SDK start、Agent/Plan/Ask、continue、resume、interrupt；
- `ExitPlanMode`、Plan 审批与批准后执行；
- SDK hooks、工具权限、Bash/文件审批和权限红队用例；
- SDK stream 到公共事件的归一化；
- Anthropic proxy 路由和 usage 提取；
- Thread continue routing、run input、session binding 读写；
- projection/feed、context snapshot、usage ledger；
- Claude SDK 安装版本所需的 V2 控制面契约。

该集合是多 Core 改造期间每个阶段必须保持通过的门禁。它不是 live E2E 的替代品。

## 当前结果

| 检查 | 结果 | 说明 |
|---|---|---|
| Frozen install | 通过 | 实际 SDK 已校准为 `0.3.223`（基线盘点时为 `0.3.205`） |
| TypeScript typecheck | 通过 | `bun run typecheck` |
| Claude regression gate | 通过 | 333 pass / 0 fail / 16 SQLite skip |
| Node SQLite contract | 通过 | 5 pass / 0 fail；含 Core migration、跨 Core 拒绝和 compact binding 一致性 |
| Desktop build | 通过 | renderer、main、preload 均完成；存在 chunk size warning |
| 全量 Bun tests | 未通过 | 1908 pass / 24 fail / 46 skip；失败均来自未认证的 server MongoDB 测试 |
| Biome lint | 未通过 | 当前配置扫描 Flutter pub cache，产生大量仓库外诊断，不能作为有效门禁 |
| Flutter analyze | 未通过 | 5 个既有 issue |
| Claude live E2E | 未执行 | 本轮没有发起真实模型请求，不能宣称 live 可用性已验证 |

## 已知缺口

### Claude Agent SDK 历史改写（显式 fork）

`v0.3.223` 的 `sdk.d.ts` / `sdk.mjs` 导出 `resumeDropsTurn`（CLI `--resume-drops-turn`），配合 `resumeSessionAt` 声明截断 resume 拟丢弃的 turn。

Eco 仍支持 SDK 的 `resumeSessionAt` / `resumeDropsTurn` 参数，供通用运行时兼容和契约测试使用；但历史改写路径不再把这组参数交给异步 query。原因是 SDK 官方文档明确规定，校验拒绝后不得重试同一组参数，而本地历史可能已经发生变化。

Eco rewind（Claude）在 `prepareThreadRewindForContinue` 中先执行：

- `getSessionMessages`：定位目标 user 之前的最后一条 chain entry UUID（kept turn 尾，不仅是 assistant）
- `forkSession({ upToMessageId })`：在远端先创建新的 transcript 分支
- 远端分支成功后，才恢复 Eco 文件检查点并裁剪本地 activity/run-event 历史

远端 fork 失败时本地历史和工作区保持不变；如果 fork 成功但后续运行没有收到 `session.captured`，Eco 会在运行收尾删除未接管的远端分支并保留明确错误。


### SQLite 测试被跳过

当前 Bun `1.3.14` 不提供 `node:sqlite`，导致 conversation store 等 46 个持久化测试在全量测试中跳过。系统 Node `v24.5.0` 可以加载 `node:sqlite`，但现有用例依赖 `bun:test`，不能直接切换运行器。仓库因此新增独立的 `node:test` 入口，覆盖建库、Thread/Claude session 持久化、legacy activity migration、Core 归属迁移、跨 Core 拒绝和 compact binding 一致性。Bun 中的其他 skip 仍不能视为通过。

### Server 测试依赖本机 MongoDB 凭据

本机存在 MongoDB 地址，但测试连接没有有效认证，`createIndexes` 返回 `Unauthorized`，导致 server HTTP 测试失败。这不属于 Claude Desktop 回归集合，但全量测试仍是红色。后续本地运行 server tests 时必须提供隔离测试库和显式凭据，不能自动连接开发者日常数据库。

### Lint 范围无效

当前 `biome check .` 会进入 Flutter `.dart_tool` 引用的 pub cache，报告仓库外 package example 文件。需要单独修正 Biome include 边界，再处理仓库自身 lint；本阶段不把这些诊断改写成通过。

### Flutter analyze 既有问题

当前有 5 个问题，位于：

- `lib/core/utils/activity_display.dart`
- `lib/features/threads/projection_activity_feed.dart`

多 Core Mobile 改造前应先消除或登记这些问题，避免新增问题混入基线。

### Live E2E 未验证

单元测试使用 SDK mock，Desktop build 只验证可构建。本轮没有真实 Claude Provider 凭据、模型响应、MCP、审批和重启恢复证据，因此 Phase 0 尚未完成 live smoke 签字。

## Phase 0 出口条件

- `bun run test -- --claude-regression` 持续通过；
- 类型检查和 Desktop build 通过；
- SQLite migration tests 在真实 SQLite 实现上执行，不再 skip；
- 完成至少一次 Claude Agent、Plan、Ask、审批、continue 和重启恢复 live smoke；
- 每个未执行项明确标记，不能用 mock 或构建结果替代。
