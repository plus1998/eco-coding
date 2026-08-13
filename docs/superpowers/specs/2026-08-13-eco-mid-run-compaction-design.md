# Eco Mid-Run Compaction（Claude / Codex 调度对齐）

**日期**：2026-08-13  
**状态**：已确认设计，待实现计划  
**触发会话**：`thr_1786608100452`（Claude，planner 100% 未自动压缩）

## 1. 问题

长 Claude attempt 在运行中超过自动压缩阈值后不会压上下文。根因不是「压缩器坏了」，而是 **Eco 关掉了各 Core 原生 auto-compact，却只把自动调度接到了 Claude run 间隙**；同一次 attempt 内永远 `isThreadRunning`，`ensureHeadroom` 直接跳过。

复现证据（`thr_1786608100452`）：

- Core：`claude`
- Planner occupied：278,090 / 262,144（100%）
- 首次越过 ~85% 有效阈值：开跑后约 2.5 分钟
- `thread_compact_handoff` / `thread_compaction_archives` / `context.compaction.*`：全空
- Attempt 一直 `running`，`ended_at` 为空

## 2. 正确策略（纠正）

Eco 的策略是 **自己调度压缩**，不是依赖 Codex/Claude 原生 auto-compact。

| 层 | Codex | Claude |
|---|---|---|
| 决策 | Eco `ContextWindowMonitor.shouldCompact` | 同一套 |
| 原生 auto | Bridge 拦截 `/v1/responses/compact`，不转发 | `autoCompactEnabled: false` |
| Eco 原语 | `thread/compact/start`（in-place，要求 idle） | `runEcoCompact`（handoff + 清 SDK session） |
| 可压缩窗口 | Codex thread `idle` | 当前 Query 必须先停（interrupt） |

文档缺口：`docs/TECHNICAL.md` §7.3 写「auto-compact 由 Codex 自身完成」与实现相反；实现以本 spec 为准，文档应在实现时同步修正。

## 3. 目标

1. Claude 长 run 越过阈值后，在 **可压缩边界**（等价 Codex idle）触发 Eco compact，不必等整个 Eco attempt 结束。
2. Codex 自动压缩接到同一 scheduler，原语仍是 `thread/compact/start`（不是原生 auto-compact）。
3. 保持 handoff / 归档 / 熔断 / Feed 事件一致；不打开 SDK `autoCompactEnabled`。

非目标（本轮不做）：

- PI Core compact
- 子代理 instance 单独 mid-run compact（仍只看 planner）
- 把 `/compact` slash 当权威路径
- 改变阈值公式（仍 85% × effectiveLimit；后续可配置另开）

## 4. 设计

### 4.1 统一调度入口

`ContextSnapshotScheduler.ensureHeadroom` 按 `coreKind` 分发：

```text
ensureHeadroom(threadId, ...)
  if !shouldCompact → false
  if suspended && atThreshold → throw（现有行为）
  if running && !ignoreRunningGuard → false（仅「自然空闲」路径）
  switch coreKind:
    claude → runEcoCompactPath（现有 handoff）
    codex  → compactCodexThreadForEcoThread（idle 校验保留）
    pi     → 显式不支持（不静默跳过成 false 伪装成功）
```

手动压缩与自动压缩共用原语；运行中手动 Claude compact 走 4.3 编排，不再硬拒 `thread_running`（或改为走同一 interrupt 路径）。

### 4.2 可压缩边界（对齐 Codex idle，不是 tool-loop 内原生 auto）

| 边界 | 含义 | 动作 |
|---|---|---|
| Pre-run / resume | 开跑前已有 session | 现有 `prepareSdkRunAfterContextCompaction` |
| Post-run | Eco attempt 真正结束且 idle | 现有 `afterRunRefresh` → `ensureHeadroom` |
| Mid-run turn gap（新增） | Claude：本轮 tool 已齐、下一轮 model 请求未发；或需主动制造 idle | interrupt → Eco compact → 同 attempt 新 Query |
| Codex idle gap（新增自动） | Codex thread status = idle，且 `shouldCompact` | `thread/compact/start`，同 thread 继续 |

**不在** tool 执行中途压（与 Codex「必须 idle」一致）。

### 4.3 Claude mid-run 编排

```text
onClaudeCompactibleBoundary(threadId):
  if coreKind != claude: return
  if !shouldCompact: return
  if compactInFlight || autoCompactSuspended: return

  emit context.compaction.started (trigger=auto|manual)
  interrupt 当前 Claude Query（现有 teardown：interrupt → drain → close）
  await ensureHeadroom(..., { ignoreRunningGuard: true })
  if success:
    prompt = buildEcoCompactHandoffPrompt(threadPrompt, continueInstruction, handoff)
    同一次 Eco attempt 启动新 Query（无 resume；session 已由 handoff commit 清空）
    emit context.compaction.completed
  else:
    recordAutoCompactFailure → 可能 suspended
    emit failed / suspended
```

续跑指令（对齐 Claude Code 社区 auto-compact 行为，但仍是 Eco handoff 注入）：

> Continue without asking further questions. Resume the last task directly; do not acknowledge the summary, do not recap, do not preface.

硬约束：

- **禁止**在 live Query 仍持有 `sdk_session_id` 时 commit handoff（会与 `commitCompactHandoffAndClearSession` 的 session 比对冲突）。
- Mid-run 成功后 **不** `finishActiveRun`；attempt 保持 running。
- Mid-turn follow-up port：interrupt 后关闭；新 Query `onOpen` 再打开。
- 冷却（60s）与 3 次熔断保持不变。

### 4.4 Codex 自动线

- Scheduler 在 Codex thread **idle** 且 `shouldCompact` 时调用 `compactCodexThreadForEcoThread`。
- 仍拦截 `/v1/responses/compact`；不计费/不依赖上游 native compact。
- 运行中（status ≠ idle）不调用；与现有 `CodexCompactNotAvailable` 一致。
- 长 Codex turn 内部是否还能压：由 Eco 是否在 **turn 结束回到 idle** 时立刻 `ensureHeadroom` 决定，而不是打开 Codex auto-compact。

### 4.5 阈值与观测

复用现有：

- `DEFAULT_COMPACT_THRESHOLD = 0.85`
- `effectiveContextLimit`（33k buffer + ≤20k output reserve）
- `COMPACT_COOLDOWN_MS = 60_000`
- `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3`

Feed / 投影：

- `context.compaction.started|completed|failed|suspended`（已有渲染）
- Diag：`context.compact_decision` 增加 `coreKind`、`boundary`（`pre_run` / `post_run` / `mid_run_interrupt` / `codex_idle`）

### 4.6 子代理

- `shouldCompact` 继续 **只看 planner**。
- Mid-run 触发时若子代理仍在跑：仅在主 Query 可 interrupt 的边界压；不因 explore 350k 单独触发。
- 子代理级 compact 不在本 spec。

## 5. 实现分期

### Phase 1 — Claude 止血

1. `MidRunCompactionCoordinator`（或等价模块）：interrupt → `ensureHeadroom(ignoreRunningGuard)` → handoff 新 Query。
2. Hook：planner 可压缩边界（`request.completed` / usage 更新后且无 pending tool；或明确的 turn-gap 信号）。
3. `ensureHeadroom` 按 coreKind 分发；Claude 路径不变，Codex 接到同一入口。
4. 测试：超阈值长 run 在边界压；低于阈值不压；熔断；handoff 与 session 清空一致。

### Phase 2 — 体验与 Codex 自动

1. 运行中手动 Claude compact 走 mid-run 编排。
2. Codex post-idle / post-run 自动 `thread/compact/start`。
3. 修正 `docs/TECHNICAL.md` §7.3 与英文版。
4. 压缩中 UI（blocking + postTokens）。

### Phase 3 — 可选

1. `workflow_settings.autoCompactThresholdPct`
2. PI compact（另开 spec）

## 6. 验收

用 `thr_1786608100452` 类场景回放：

1. Planner 越过阈值后，下一次可 interrupt 边界出现 `context.compaction.started`。
2. 压缩后 occupied 明显下降；同一 attempt 仍 running 且任务续跑。
3. 产生 `thread_compact_handoff`（Claude）或 Codex compact completion（`postTokens`）。
4. Codex 线程：idle 超阈值时 Eco 调用 `thread/compact/start`；原生 `/v1/responses/compact` 仍被拦截。
5. 不开 `autoCompactEnabled`；测试断言保持 false。

## 7. 风险

| 风险 | 缓解 |
|---|---|
| Interrupt 丢 mid-turn follow-up | 沿用现有 interrupt/`still_queued` 策略；compact 期间拒绝新 steer |
| Handoff 后模型「复述摘要」 | 固定续跑指令；归档保留压缩前活动流 |
| Thrashing（压完立刻再满） | 冷却 + 熔断；收益不足拒绝 commit（现有 eco-compact 校验） |
| Codex 非 idle 误调 | 保留 status 检查；失败显式 `CodexCompactNotAvailable` |

## 8. 关键文件（预期）

- `apps/desktop/src/main/context-snapshot-scheduler.ts` — coreKind 分发
- `apps/desktop/src/main/context-lifecycle-service.ts` / `index.ts` — mid-run hook
- 新：`mid-run-compaction-coordinator.ts`（名称可微调）
- `apps/desktop/src/main/codex-runtime-run.ts` — 被 scheduler 调用，不改原语语义
- `apps/desktop/src/main/eco-compact-service.ts` — 复用
- `docs/TECHNICAL.md` / `TECHNICAL.en.md` — 纠正 §7.3
- 测试：`context-snapshot-scheduler`、`sdk-run-context-compaction`、新增 mid-run coordinator 测试
