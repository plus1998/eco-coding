# 会话级多 Core 集成推进计划

> 基线分支：`session-core-integration`（从 `origin/main@b05d308` 创建）  
> 当前范围：Claude Code Core + Codex Core  
> 首要约束：先保证现有 Claude 主路径可用，再逐步开放 Codex；任何能力缺口必须显式暴露，不允许静默降级。  
> 文档状态：架构基线 + 当前实施验收记录。

当前进度（2026-07-15）：Phase 0-3 主路径和 Phase 5 会话级选择已实现；Phase 4 已完成 Codex approval、Ask/Plan、compact、context、Responses gateway、精确 usage/计费，以及 MCP、Skills、图片、rewind 和子代理接入，上述能力已完成 Electron/CDP 实测。Mobile Codex 路径尚未完成，因此不能按整体正式发布完成处理。详见 [claude-core-baseline.md](./claude-core-baseline.md)。

当前实现事实：

- `ThreadRuntimeCoordinator` 按 Thread 的不可变 Core 绑定路由 start/continue/cancel；Claude 与 Codex 可在不同 Thread 并发，无需重启。
- `thread_core_sessions` 是 Codex external thread binding 的唯一真相；start、continue、重启恢复和 compact 已用真实 app-server 验证。
- Codex CLI probe 同时在 UI 和 main admission 生效；CLI 不可用时不回落 Claude。
- Gateway usage 进入统一 ledger、billing 和 context 管线；根 turn、continue 与 compaction 均使用持久化 attribution，首次 binding 竞态会缓冲后再结算。
- Codex 主代理 Profile prompt/tool sandbox 已接入；Profile agent role 会按会话配置物化，子代理事件归因到父 Eco Thread。
- Composer 执行确认映射为 `always -> untrusted`、`auto -> on-request`、`allow_all -> never`。Codex 没有“每条命令强制弹窗”的原生策略，`untrusted` 仍可能自动执行 Codex 判定为可信的命令，这一语义差异不能写成完全等价。
- Codex MCP 按全局启用、会话选择与 Profile 分配做权限交集；Skills 只为 prompt 中显式 `$skill` 生成结构化输入；图片落入 turn scoped 临时目录并校验格式/大小；rewind 同步 app-server history、Eco projection 与本地文件 checkpoint。

## 1. 结论与实施策略

采用**会话级 Core 绑定**：每个 Eco Thread 在首次运行前选择一个 Core，首次运行后 Core 不可原地修改。不同 Thread 可以同时运行 Claude Code Core 和 Codex Core，无需重启 Electron。

实施顺序不是直接合并 `main` 与 `codex` 的最终代码，而是：

1. 以当前稳定的 `main` 为产品基线，建立 Claude 回归基准。
2. 引入 Core 契约、线程绑定和协调层，但第一阶段只注册 Claude。
3. 让 Claude 完整通过新协调层，确认行为、数据、计费和 UI 无回归。
4. 从 `codex` 分支按模块和测试选择性迁入 Codex 实现，保留 Claude 路径。
5. Codex 达到最小发布门槛后，才在新会话界面开放 Core 选择。

不直接合并整个 `codex` 分支，原因是该分支的目标是“Codex 为唯一运行时”，已经删除或改写大量 Claude SDK、hook、stream/session 和 proxy 代码。直接合并会把“保住 Claude”变成大规模冲突后的人工重建，风险不可控。

## 2. 产品语义

### 2.1 Core 选择规则

- 新建 Thread 时使用用户选择的 Core；未手动选择时使用应用设置中的 `defaultCore`。
- `defaultCore` 只影响以后创建的 Thread，不改变已有 Thread。
- 空白草稿在第一次运行前可以切换 Core。
- Thread 第一次运行后锁定 Core，后续继续、重试、压缩、回退、审批都路由到同一 Core。
- 不允许把 Claude session 原地交给 Codex resume，也不允许反向操作。
- 跨 Core 继续应创建新 Thread；“携带摘要迁移”可以后续单独设计，不属于首版。
- Thread 列表、详情页和运行界面必须展示实际 Core，不能只展示全局默认值。

### 2.2 并发语义

Claude 和 Codex 可以在不同 Thread 中同时运行：

```text
Thread A (core=claude) -> ClaudeCoreAdapter -> Claude Agent SDK session
Thread B (core=codex)  -> CodexCoreAdapter  -> Codex app-server thread/turn
```

取消、审批、pending plan、usage、context、运行状态必须以 Eco `threadId + runAttemptId` 隔离。全局 Codex app-server 进程可以服务多个 Codex Thread，但不能让一个 Thread 的通知、审批或计费归因到另一个 Thread。

### 2.3 不允许的隐式行为

- Core 不支持某能力时，不自动改用另一个 Core。
- Codex Plan 不等价于 Claude `ExitPlanMode` 时，不伪造成完全一致。
- 事件归一化失败时，不丢弃原始事件后继续显示“成功”。
- 无法判断历史 Thread 所属 Core 时，不默认归为 Claude 或 Codex。
- Core 进程或依赖缺失时，不自动回落到 Claude；应阻止启动并给出可操作错误。
- 计费来源不完整时，不用本地估算覆盖精确 usage 并标记为精确值。

## 3. 目标架构

```text
Desktop / Mobile UI
        |
        v
Thread Application Services
        |
        v
ThreadRuntimeCoordinator -----> CoreRegistry
        |                           |-- ClaudeCoreAdapter
        |                           `-- CodexCoreAdapter
        |
        +--> ConversationStore / ThreadCoreBinding
        +--> normalized ThreadRunEvent / ApprovalRequest
        +--> UsageLedger / ContextSnapshot
```

### 3.1 分层职责

#### ThreadRuntimeCoordinator

协调层是唯一按 Thread 选择 Core 的位置，负责：

- 读取并校验 Thread 的不可变 Core 绑定；
- 从 `CoreRegistry` 获取对应 Adapter；
- 建立和恢复 Core session；
- 管理 run attempt、取消、审批和清理的生命周期；
- 将 Core 事件送入现有 projection、activity、usage 和 context 管线；
- 在调用可选能力前检查 capability；
- 拒绝 Core 与已有 session binding 不一致的请求。

协调层不解析 Claude SDK message，也不解析 Codex JSON-RPC item；这些属于各自 Adapter。

#### CoreAdapter

公共接口只保留所有 Core 都必须具备的最小生命周期：

```ts
export type CoreKind = "claude" | "codex";

export interface CoreDescriptor {
  kind: CoreKind;
  displayName: string;
  version: string;
}

export interface CoreAdapter {
  readonly descriptor: CoreDescriptor;

  probe(): Promise<CoreProbeResult>;
  getCapabilities(input: CoreCapabilityContext): Promise<CoreCapabilities>;
  startTurn(input: CoreTurnInput): AsyncIterable<CoreEvent>;
  continueTurn(input: CoreContinuationInput): AsyncIterable<CoreEvent>;
  cancel(input: CoreCancelInput): Promise<void>;
  disposeThread(threadId: string): Promise<void>;
}
```

Compact、rewind、plan approval、tool approval、skills、MCP、models 等不应为了接口整齐而假设语义相同。它们通过能力接口提供：

```ts
export interface CoreCapabilities {
  sessionModes: ReadonlySet<"agent" | "plan" | "ask">;
  compact: "native" | "eco" | "unsupported";
  rewindFiles: "native" | "eco-checkpoint" | "unsupported";
  toolApproval: "interactive" | "policy-only" | "unsupported";
  planApproval: "native" | "eco-handoff" | "unsupported";
  mcp: "native" | "materialized" | "unsupported";
  skills: "native" | "materialized" | "unsupported";
  subagents: "native" | "thread-handoff" | "unsupported";
}
```

具体操作由窄接口承载，例如 `CompactCapability`、`RewindCapability`、`ApprovalCapability`。注册 capability 与实际实现不一致应视为程序错误，并由契约测试阻止发布。

#### CoreRegistry

Registry 只负责 Core 的注册、探测与查找，不持有 Thread 业务状态：

```ts
registry.register(claudeCoreAdapter);
registry.register(codexCoreAdapter);
registry.require(thread.coreKind);
```

未来增加 Kimi/Mimo 时，需要新增 Adapter、事件映射、能力声明和契约测试，但不应修改 Thread 协调流程。当前 `CoreKind` 只包含 `claude | codex`；等第三个 Core 真正接入时再扩展联合类型和 UI，不提前加入不可运行的占位选项。

### 3.2 Core 私有边界

Claude 私有实现保留：

- `ClaudeAgentSdkDriver`；
- Claude session ID / cwd；
- SDK hooks、`ExitPlanMode`、permission mode；
- Anthropic proxy 与现有 provider bridge；
- Claude SDK message 到公共事件的映射。

Codex 私有实现包括：

- app-server 进程和 JSON-RPC client；
- Codex thread ID / turn ID；
- `CODEX_HOME`、config、skills、MCP materialization；
- Codex approval bridge；
- `item/*`、`turn/*`、token usage 事件映射；
- Codex gateway 与 Responses 协议适配。

禁止业务层直接 import `ClaudeAgentSdkDriver` 或 `CodexAppServerDriver`。主进程只能通过协调层和能力接口访问 Core。

### 3.3 公共事件契约

现有 `ThreadRunEvent` / projection 继续作为 Desktop 和 Mobile 的公共展示协议。每个事件至少携带：

- `threadId`
- `runAttemptId`
- `coreKind`
- Core 内部关联 ID（可选且命名明确，例如 `sdkMessageId`、`codexItemId`）
- 标准事件类型和 payload
- 无法标准化但诊断必要的原始事件引用

标准事件表达产品事实，例如文本增量、工具调用、审批、计划、文件变更、usage、完成和失败。Core 特有事件不能硬映射成错误的公共类型；应增加带命名空间的扩展事件，或明确标记 UI 暂不支持。

## 4. 会话级数据模型

### 4.1 Thread 归属

在 `threads` 增加独立字段：

```sql
ALTER TABLE threads ADD COLUMN core_kind TEXT;
ALTER TABLE threads ADD COLUMN core_locked_at TEXT;
```

规则：

- 新 Thread 创建时必须写入 `core_kind`，`core_locked_at` 初始为 `NULL`。
- 首次 run 在同一事务中校验 Core、写入 `core_locked_at` 并建立 run attempt；锁定后禁止修改。
- 空草稿只允许通过 `UPDATE ... WHERE core_locked_at IS NULL` 修改 Core；更新未命中时必须报告已锁定，不能覆盖。
- `core_kind` 不放入可编辑的 `runtime_config_json`。
- 数据库暂不使用只允许两个值的 `CHECK`，避免未来新增 Core 必须重建表；应用层通过受控 registry 校验值。
- 迁移期允许 `NULL` 表示 `unknown`，但 `unknown` Thread 不得继续运行，必须完成可靠归属或由用户显式处理。

### 4.2 Core session binding

新增统一绑定表，替代业务层读取 Core 专属列或 map：

```sql
CREATE TABLE thread_core_sessions (
  thread_id TEXT PRIMARY KEY,
  core_kind TEXT NOT NULL,
  external_session_id TEXT NOT NULL,
  cwd TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
);
```

- `threads.core_kind` 是产品归属真相；绑定表是外部运行时定位信息。
- 两处 `core_kind` 必须一致，不一致时拒绝 resume 并报数据完整性错误。
- `metadata_json` 只保存版本化、非查询关键的 Core 私有数据，必须包含 schema version；关键 ID 应使用明确列。
- 一个 Eco Thread 首版只允许一个 Core session binding。
- Claude 现有 `sdk_session_id/sdk_cwd` 在兼容迁移完成前保留只读，迁移稳定后再单独删除，不能在第一步破坏回滚能力。
- Codex 现有产品数据中的 thread map 需要迁入该表，不能在运行时长期维持第二套真相。

### 4.3 迁移判定

只接受有证据的迁移：

| 历史证据 | 归属 | 动作 |
|---|---|---|
| 数据库来自多 Core 发布前的 `main` schema/version，且产品元数据为 Claude 版 | Claude | 写入 `core_kind=claude`，迁移 SDK binding |
| 存在有效 Codex thread map，且产品元数据为 Codex 版 | Codex | 写入 `core_kind=codex`，迁移 Codex binding |
| 同一 Thread 同时存在 Claude 与 Codex binding | 冲突 | 标为 unknown，阻止运行并记录诊断 |
| 无 session binding，只有未运行草稿 | 未锁定 | 根据明确的产品来源或用户选择赋值 |
| 无法确定来源 | unknown | 不猜测，不自动继续 |

迁移必须事务化、幂等，并写 migration audit：迁移版本、判定依据、Thread 数量、冲突数量。迁移前不得删除旧字段或旧 map。

### 4.4 设置模型

应用设置新增：

```ts
interface CorePreferences {
  defaultCore: CoreKind;
}
```

`defaultCore` 不是运行时路由开关。运行请求永远读取 `threads.core_kind`，不能读取当前全局默认值决定已有 Thread 的 Core。

## 5. Claude 优先保护方案

### 5.1 先建立行为基线

在引入 Codex 代码前冻结并验证以下 Claude 主路径：

- 新建 Thread、首次发送、流式文本、继续会话；
- Agent / Plan / Ask 三种模式；
- Plan 提交、用户修改、批准后执行；
- Bash 与普通工具审批、拒绝、取消；
- MCP、Skills、Profile、子代理；
- compact、context usage、rewind / checkpoint；
- provider 路由、proxy 转换、usage/计费归因；
- Desktop feed、Mobile feed 与审批；
- 应用重启后的 session resume；
- 同 Thread 防重入，不同 Thread 并发。

基线包含自动测试清单和至少一组可重复的 Claude live smoke 记录。没有基线结果，不进入协调层改造。

### 5.2 Claude Adapter 落地原则

第一阶段只做包装和依赖倒置，不重写 Claude 行为：

- 现有 Claude driver、hooks、proxy 和事件映射保持实现不变；
- 将 `index.ts` 中直接调用逐步收口到 `ClaudeCoreAdapter`；
- 每迁移一个入口就补 coordinator contract test；
- Claude-only 状态下 UI 和数据库行为应与 `main` 等价；
- 所有 Claude 回归门禁通过后，才注册 Codex Adapter。

## 6. Codex 迁入策略

`codex` 分支是重要实现来源，但不作为整体合并源。按依赖分组迁入，并保留对应测试：

1. **协议底座**：app-server client、schema/version pin、进程生命周期、`CODEX_HOME` 隔离。
2. **会话与事件**：driver、thread/turn resume、event adapter、projection fixture。
3. **控制面**：cancel、approval、plan handoff、compact、rollback。
4. **资源面**：model list、provider config、skills、MCP。
5. **网关与计费**：Responses gateway、协议转换、usage 唯一归因入口。
6. **多代理**：只在单代理主路径稳定后迁入 thread handoff / spawn 能力。
7. **UI 与 Mobile**：最后迁入必要的 Core 展示和差异化交互，不覆盖 `main` 的新样式优化。

每组迁入时需要：

- 对照 `main..codex` 手工确认删除项，禁止把 Claude 文件删除带入；
- 迁入生产代码与对应测试、fixture；
- 替换 Codex 分支中的全局单 Core 假设；
- 接入 `ThreadRuntimeCoordinator`，禁止在 IPC handler 中直接 new Codex driver；
- 完成 Claude 回归 + 本组 Codex 测试后再进入下一组。

## 7. 能力矩阵与发布要求

以下表格是必须验证的目标，不代表当前已经具备：

| 能力 | Claude 目标 | Codex 首版目标 | 缺口处理 |
|---|---|---|---|
| Agent 模式 | 保持现状 | 必须 | 未通过则不开放 Codex |
| Ask 模式 | 保持现状 | 已实现并完成只读 live 验收 | 无工具调用，completed 后保留 app-server 事件证据 |
| Plan 模式 | 保持 ExitPlanMode 流程 | 已实现 Eco handoff 并完成 live 验收 | 原生 plan item 必须持久化 pending plan，不伪装为 Claude ExitPlanMode |
| 继续/重启恢复 | 必须 | 已真实验收 | binding 缺失时阻止继续 |
| 取消 | 必须 | 已接入，自动测试覆盖 | 正式发布前补 live 取消 |
| 工具审批 | 必须 | 已真实验收 command approval | `always` 仅能映射为 Codex `untrusted` |
| MCP | 必须 | 已接入并实测 | 会话选择与 Profile 分配取交集 |
| Skills | 必须 | 已接入并实测 | 只注入显式 `$skill` |
| Compact | 保持现状 | 原生 compact，已真实验收 | 不用摘要续写冒充原生成功 |
| 文件回退 | 保持现状 | 已接入并实测 | 配置预备后依次同步 app-server、文件 checkpoint 与投影 |
| 图片输入 | 保持现状 | 已接入并实测 | 解码校验、10 张/单张 20 MB 上限、turn 后清理 |
| 子代理 | 保持现状 | 已接入并实测 | Profile role、会话开关与父子事件归因 |
| 精确 usage | 必须 | 已真实验收 | attribution/route 不完整时拒绝结算 |
| Mobile feed/审批 | 必须 | 未实现/未验收 | Codex 正式发布前门禁 |

能力判断可依赖 Core 版本、当前 session mode、provider 和平台。UI 必须使用运行时 capability 结果，不能只按 `coreKind` 写死。

## 8. 分阶段推进

### Phase 0：基线与保护网

状态：本地自动门禁已建立；Claude 自动回归已通过，最终提交前重跑。Claude live smoke 仍需在正式发布记录中单列。

任务：

- 记录 `main@b05d308` 基线和 Claude live smoke 环境；
- 汇总现有单元、集成、Desktop、Mobile 测试；
- 增加关键 Claude 主路径契约测试和可重复 smoke；
- 建立可重复执行的本地 `claude-regression` 门禁；
- 确认 Codex 版本、app-server schema 和依赖许可。

出口条件：Claude 基线全绿，失败项有明确缺陷记录；不能把已有失败写成“可忽略”。

### Phase 1：数据模型与 Core 契约

状态：完成。

任务：

- 增加 `CoreKind`、descriptor、capabilities 和 registry；
- 增加 `threads.core_kind/core_locked_at`、`thread_core_sessions` 和迁移 audit；
- 新 Thread 默认写 `claude`，UI 暂不展示 Codex；
- 对历史 `main` 数据执行有来源证明的 Claude 迁移；
- 增加不变式测试：Core 锁定、binding 一致、unknown 阻断。

出口条件：产品仍只有 Claude 可用，现有 Claude 数据可启动、继续和回滚迁移。

### Phase 2：Claude 收口到协调层

状态：start/continue/cancel 已由协调层路由；Claude 其余能力继续沿现有专用 handler，未为了接口整齐重写稳定路径。

任务：

- 实现 `ThreadRuntimeCoordinator` 和 `ClaudeCoreAdapter`；
- 收口 start/continue/cancel/approval/plan/compact/rewind；
- 清除主进程业务入口对具体 driver 的直接依赖；
- 保持现有 Claude session、proxy、hooks 和 billing 行为；
- 完成双 Thread Claude 并发和重启恢复测试。

出口条件：Claude 功能矩阵与 Phase 0 一致，live smoke 通过；未达到时不开始 UI 双 Core 开关。

### Phase 3：Codex 单会话主路径

状态：完成主路径；真实验证 start、同 binding continue、重启后 resume、Claude/Codex 混合并发。cancel 有自动测试，仍需正式发布 live 记录。

任务：

- 迁入 app-server client、生命周期和版本探测；
- 实现 `CodexCoreAdapter` 的 start/continue/cancel；
- 建立 Eco Thread 与 Codex thread/turn 的持久映射；
- 接入 Codex event adapter 和 golden fixtures；
- 隔离 `CODEX_HOME`，验证多个 Codex Thread 并发；
- 完成 Claude Thread 与 Codex Thread 同时运行的隔离测试。

出口条件：Codex Agent 模式可稳定完成、取消、恢复；事件无串线；Claude 全量回归保持通过。

### Phase 4：Codex 产品能力补齐

状态：部分完成。approval、Ask/Plan、compact、context、gateway、usage/billing、MCP、Skills、图片、rollback/rewind 和子代理已接入并真实验证；Mobile 尚未完成。

任务：

- 审批、Plan/Ask、compact、rollback；
- Provider/Model、Responses gateway、usage/计费；
- MCP、Skills、context usage；
- 按能力矩阵决定子代理是否进入首版；
- 完成 Desktop 与 Mobile 事件、审批和错误态。

出口条件：能力矩阵逐项签字；所有 unsupported 能力在 capability 和 UI 中一致呈现。

### Phase 5：开放会话级选择

状态：Desktop 完成。新会话可选 Claude/Codex，首次运行后锁定，历史列表展示 Core，Codex 不可用时 probe 禁用入口；应用级 `defaultCore` 设置仍未实现。

任务：

- 新会话 Composer 增加 Core segmented control；
- 设置页增加 `defaultCore`；
- Thread 列表/详情显示实际 Core；
- 空草稿允许切换，首次运行后锁定；
- Core 不可用时展示 probe 结果和修复动作；
- 增加 Claude/Codex/混合并发三组 E2E。

出口条件：不重启应用即可创建并同时运行两种 Core 的 Thread；切换默认 Core 不影响历史 Thread。

### Phase 6：灰度与清理

任务：

- 默认仍为 Claude，Codex 先通过实验开关开放；
- 收集 crash、resume、审批超时、事件归因和 usage 对账指标；
- 完成 Codex 数据迁移演练和回滚演练；
- 稳定后删除已完成迁移的旧 session 字段和临时兼容代码；
- 再评估是否让新安装用户选择默认 Core。

出口条件：连续灰度周期无阻断级数据问题；旧路径删除有独立变更和迁移验证。

## 9. 测试矩阵

### 9.1 Core 契约测试

同一套 contract tests 对每个 Adapter 执行：

- start -> events -> completed；
- continue 使用同一 binding；
- cancel 只影响目标 Thread；
- 进程异常产生明确 failed，不产生 completed；
- capability 声明与方法实现一致；
- event 必含正确 `threadId/runAttemptId/coreKind`；
- session binding 不匹配时拒绝运行。

### 9.2 组合测试

至少覆盖：

| Thread A | Thread B | 验证重点 |
|---|---|---|
| Claude | Claude | 原有并发不回归 |
| Codex | Codex | app-server 多 thread 隔离 |
| Claude | Codex | 进程、取消、审批、usage 不串线 |
| Claude Plan | Codex Agent | pending plan 与运行态隔离 |
| Claude approval | Codex approval | 审批 ID 和响应路由隔离 |

### 9.3 数据与升级测试

- `main` 旧数据库 -> 多 Core schema；
- Codex 产品数据库 -> 多 Core schema；
- 空草稿、有 Claude session、有 Codex map、冲突和 unknown；
- 迁移中断后重试；
- 新版本数据库禁止被旧版本写坏；
- 备份恢复后 external session 仍可定位。

### 9.4 发布门禁

- TypeScript 类型检查、runtime/desktop/shared/gateway 测试；
- Desktop UI smoke 与打包运行；
- Flutter analyze、unit/widget test；
- Claude live E2E；
- Codex pinned-version live E2E；
- 混合并发 E2E；
- migration dry-run 和 usage 对账。

任何 live E2E 因缺少凭据未执行时，发布记录必须写“未验证”，不能用 mock 测试替代其结论。

### 9.5 2026-07-15 本地真实验收记录

目标 Eco Thread：`thr_1784033330912`；持久 Codex Thread：`019f60ac-48b0-7ed2-b07c-962aa161cbe6`。

- start 返回 `CODEX_BILLING_OK`；usage 为 input `475`、output `10`、cache read `10112`、cache creation `768`，UI 成本 `$0.0063`，context `11365 / 258400`。
- continue 保持同一 Codex Thread ID，返回 `CODEX_CONTINUE_BILLING_OK`；两轮累计 input `985`、output `22`、cache read `19840`、cache creation `1920`，UI 累计成本 `$0.0138`，SQLite ledger 为两笔独立事件。
- 重启应用后按需执行 `thread/read -> thread/resume`，随后原生 compact 成功；最新一次压缩到 `5900 tokens`，新增 ledger event `ule_e619ccb3846b4ef732412882` 为 `source=codex`、`role=planner`、`attributionStatus=attributed`。
- command approval live smoke 产生 pending approval `call_QnRqAW6ns5AZFjqL7UfFYqI5`，批准 `/bin/zsh -lc 'sleep 2 && printf CODEX_APPROVAL_LIVE_OK'` 后同一会话完成并返回 marker。
- 主 Profile 与 Profile agent roles 已应用；真实 smoke 已创建 `explore` child thread，并在父 Thread Feed 中完成归因。
- Electron CDP capability smoke 验证 Codex 新会话 MCP 为 `0/1` 且配置可编辑，子代理为 `3/3` 且三个角色可编辑；另用显式 `$Bun` 完成结构化 Skill 输入实测。
- Ask live smoke：Eco Thread `thr_1784087228184` 使用 `sessionMode=ask`，返回 marker `CODEX_ASK_LIVE_OK_1784087227339`，终态 `completed`，投影含原生 app-server 事件且无工具调用。
- Plan live smoke：Eco Thread `thr_1784087232512` 使用 `sessionMode=plan`，原生 `itemType=plan` 返回 marker `CODEX_PLAN_LIVE_OK_1784087227339`；Desktop 持久化 pending plan 并停在 `awaiting_plan`，无工具调用、未批准执行。
- Responses-native 三代理对照：Eco Thread `thr_1784089827238` 的 `explore/coder/tester` 均产生独立 session、ledger 和 context instance；`contextOccupied` 分别为 `10005/10493/10493`，用于确认 Codex 原生多代理归因链路本身可工作。
- 实际 Profile 三代理验收：Eco Thread `thr_1784090586107` 使用 `user.custom.profile` 的 Anthropic-compatible `deepseek-v4-flash` 子代理；三个角色均包含 `agent.started -> child events -> agent.stopped`，并返回各自唯一 marker。
- `explore`：input `54`、output `45`、cache read `11008`、context `11062 / 258000`、成本 `$0.00009104`。
- `coder`：input `92`、output `44`、cache read `10880`、context `10972 / 258000`、成本 `$0.0000994`。
- `tester`：input `92`、output `42`、cache read `10880`、context `10972 / 258000`、成本 `$0.0000984`。
- Node SQLite 强校验确认 `thread_agent_instances`、`thread_subagent_sessions`、`thread_subagent_metrics` 各有 3 行，agentId、角色、stopped 终态、非零 context 与成本均一致。可用 `bun run --cwd apps/desktop smoke:codex-multi-agent` 重复执行；该脚本只用于本地门禁，不提交 CI 配置。
- 历史测试库仍保留修复前的 unattributed event `ule_27702e1343dade7435d393b3`。新代码不再产生同类事件，但本次不隐式改写历史 ledger。

最终本地自动门禁：Claude regression 通过；Node SQLite `5/5`；Desktop `1375 pass / 46 skip / 0 fail`；Runtime/Gateway/Bridge/Persistence/Shared/Router `814 pass / 2 skip / 0 fail`；TypeScript、Desktop build、`git diff --check` 均通过。所有 SQLite 执行均走 Node 专用门禁，不把 `node:sqlite` 测试交给 Bun。

本轮多代理修复门禁：相关 Desktop/Runtime/Gateway/Bridge 定向测试 `104 pass / 2 skip / 0 fail`；Claude regression `333 pass / 16 skip / 0 fail`；Node SQLite `5/5`；TypeScript 与 Desktop build 通过。带本地 Mongo/Redis 凭据执行全仓测试时得到 `2280 pass / 48 skip`，但 server 测试共享 Mongo 连接在并行套件中出现一次 `MongoNotConnectedError`，汇总仍有 `2 fail / 1 error`；同一失败用例单独重跑为 `1 pass / 0 fail`，因此不能把本轮全仓并行测试记录为全绿。

## 10. 可观测性与错误模型

日志和诊断统一增加：

- `coreKind`
- `threadId`
- `runAttemptId`
- `externalSessionId` / `turnId`（脱敏规则不变）
- adapter/core version
- capability snapshot version

核心错误使用结构化 code：

- `CORE_NOT_INSTALLED`
- `CORE_VERSION_UNSUPPORTED`
- `CORE_CAPABILITY_UNSUPPORTED`
- `CORE_BINDING_MISMATCH`
- `CORE_SESSION_NOT_FOUND`
- `CORE_EVENT_MAPPING_FAILED`
- `CORE_PROCESS_EXITED`
- `CORE_MIGRATION_UNKNOWN`

错误信息必须指出实际 Core 和失败阶段。`CORE_EVENT_MAPPING_FAILED` 要保留可诊断的原始事件摘要，并将本次 run 标为失败或部分失败，不能吞错后完成。

## 11. 安全与资源隔离

- Codex 使用 Eco 专用 `CODEX_HOME`，不读写用户日常 `~/.codex`。
- Claude 继续使用现有 SDK/proxy 隔离策略。
- Provider 密钥只通过现有安全存储和受控进程环境传递，不写入 Thread metadata。
- Codex app-server 全局进程退出时，只失败其管理的 Codex runs，不取消 Claude runs。
- Electron 退出时由 registry/coordinator 有序取消两种 Core 的活动 run。
- Core probe 不应触发真实模型请求或计费。

## 12. 风险与控制

| 风险 | 影响 | 控制措施 |
|---|---|---|
| `codex` 分支删除 Claude 代码 | Claude 回归 | 只选择性迁入，不整体 merge |
| `index.ts` 仍直接绑定具体 Core | 新 Core 接入继续扩散条件分支 | Phase 2 完成统一协调入口 |
| 两种事件语义不等价 | Feed/审批状态错误 | 公共事实 + Core 扩展事件 + golden fixture |
| 历史归属误判 | 无法 resume，甚至写错 session | 基于来源证据迁移，unknown 阻断 |
| 混合并发归因串线 | 审批、计费或取消错对象 | runAttempt + core + external ID 联合关联 |
| Codex schema 漂移 | 运行时解析失败 | 固定版本、启动 probe、schema contract test |
| 为未来 Core 过度抽象 | 当前进度变慢、接口失真 | 只抽真实共性，第三 Core 接入时再扩联合类型 |

## 13. 初步工作量

单人连续投入的保守估算：

| 阶段 | 预计 |
|---|---:|
| Phase 0-1：基线、契约、数据模型 | 1.5-2 周 |
| Phase 2：Claude 协调层收口 | 1.5-2 周 |
| Phase 3：Codex 主路径 | 2-3 周 |
| Phase 4：能力、网关、Mobile | 2-4 周 |
| Phase 5-6：UI、混合 E2E、灰度 | 1-2 周 |
| 合计 | 8-13 周 |

该估算假设可复用 `codex` 分支中已经验证的 app-server、event adapter、gateway 和测试。若 Codex live E2E 暴露协议转换、计费或恢复缺口，需要按缺口重新估算，不能用降低验收标准维持原排期。

## 14. 首批可执行任务

1. 建立 Claude 主路径测试清单和 baseline 报告。
2. 定义 `CoreKind`、`CoreDescriptor`、`CoreCapabilities` 和 Adapter contract tests。
3. 设计并实现 `threads.core_kind/core_locked_at` 与 `thread_core_sessions` 的幂等迁移。
4. 实现只注册 Claude 的 `CoreRegistry`。
5. 实现 `ThreadRuntimeCoordinator`，先收口 start/continue/cancel。
6. 分批收口 approval/plan/compact/rewind，并逐项跑 Claude 回归。
7. 对 `codex` 分支生产模块和测试建立迁入清单，标记可直接迁入、需适配、禁止迁入。
8. 在 Claude parity gate 通过后，开始 Codex app-server client 与生命周期接入。

## 15. 架构决策记录

实施中每个重要变化使用 ADR 记录，至少包括：

- ADR-001：Thread 首次运行后 Core 不可变；
- ADR-002：`defaultCore` 只用于新 Thread；
- ADR-003：公共最小生命周期 + capability ports；
- ADR-004：统一 `thread_core_sessions`，迁移期保留旧 binding；
- ADR-005：Codex 采用全局 app-server 还是进程池；
- ADR-006：Codex Plan/Ask 的产品语义；
- ADR-007：usage 唯一事实来源与未结算状态；
- ADR-008：Codex 分支模块迁入边界。

ADR 未决项不能靠临时代码默认值绕过；影响数据、恢复、计费或权限的决策必须在对应 Phase 开始前确定。
