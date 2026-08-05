# Codex loaded-idle resume 配置问题排障

## 目的

本文记录 Codex 会话在恢复前报错的问题、已经确认的底层行为、当前诊断日志，以及下次复现后的排查步骤。

目标不是先假设审批、多会话或配置刷新一定是根因，而是用日志回答两个问题：

1. 为什么当前 turn 生成的 thread config 与已加载线程的配置证明不一致？
2. 不一致来自真实配置变化、app-server/client 生命周期变化，还是配置登记链路缺失？

## 用户可见错误

```text
Codex cannot prove resume config reload while thread '<thread-id>' is idle.
Next action: Restart the Codex app-server so the thread is notLoaded, then retry the configured resume.
```

这段文案由 Eco 主动抛出，不是 Gateway、模型供应商或 Codex app-server 返回的原始错误。

触发位置：

- `packages/runtime/src/codex-thread-resume.ts`
- `resumeCodexThread()`
- `requireColdCodexThreadForConfigReload()`

## 已确认的行为

### Eco 的拦截条件

配置化 resume 同时满足以下条件时会被拒绝：

1. 请求包含 `config`。
2. `thread/read` 返回 `idle`、`active`、`systemError` 或其他非 `notLoaded` 状态。
3. Eco 无法证明同一个 app-server client 已经给该线程应用过完全相同的配置。

如果线程是 `idle`，且当前配置 fingerprint 与该 client 内记录的 fingerprint 相同，Eco 会移除重复的 `config`，继续执行普通 `thread/resume`。

配置应用证明目前保存在进程内 `WeakMap` 中，键为：

```text
app-server client -> Codex thread ID -> config fingerprint
```

它不会跨 client 或桌面进程持久化。

### Codex 0.146.0 的真实行为（仍为缺口）

仓库钉死版本：`apps/desktop` 依赖 `@openai/codex@0.146.0`。

真实进程集成测试（`ECO_CODEX_REAL_APP_SERVER_TEST=1`）在升级后已复测：

1. 启动一个 Codex thread，配置模型为 A。
2. 完成一次真实 turn，使 rollout 落盘。
3. thread 进入 loaded `idle`。
4. 直接调用 `thread/resume`，通过 `config` 把模型改成 B。
5. RPC 返回成功，但响应中的有效模型仍然是 A。
6. 重启 app-server 后，`thread/read` 返回 `notLoaded`。
7. 再次通过 `thread/resume(config=B)` 恢复，响应中的有效模型变为 B。

因此：

```text
loaded + idle + thread/resume(new config)
```

在 Codex **0.146.0 中仍**可能成功返回但静默忽略新配置。上游 MCP runtime 热更新改进**不能**覆盖本缺陷。

0.146.0 同期相关验收（`bun scripts/codex-0.146-rpc-smoke.mjs`）：

| RPC / 行为 | 0.146.0 结果 |
|------------|--------------|
| `initialize` | userAgent 含 `0.146.0` |
| `skills/list` | 正常 |
| `skills/extraRoots/set`（字段 `extraRoots`） | 正常（空列表可清空） |
| `thread/start` / `turn/start` / `turn/completed` | 正常 |
| `thread/read` + `includeTurns: true` | 返回完整 turns；默认 `historyMode: "legacy"` |
| `thread/rollback` | **仍可用**；可能伴随 `deprecationNotice`（官方已标弃用） |
| `thread/compact/start` | 正常 |
| `mcpServerStatus/list` / `config/mcpServer/reload` | 正常 |

对应测试：

```text
packages/runtime/test/codex-thread-resume.integration.test.ts
```

执行命令：

```bash
ECO_CODEX_REAL_APP_SERVER_TEST=1 \
  bun test packages/runtime/test/codex-thread-resume.integration.test.ts
```

该测试使用隔离的临时 `CODEX_HOME` 和本机回环 Responses API stub，不依赖真实模型响应。

### 历史：Codex 0.142.5

上述 loaded-idle 静默忽略 config 的行为在 0.142.5 首次在本仓库内测确认；0.146.0 复测结论未变。

## 尚未确认的根因

真实事件中已经确认：

- 目标线程在 resume 检查时是 `idle`。
- 当前请求包含 thread config。
- `configAlreadyApplied` 为 false。
- Eco 在发送 `thread/resume` 和 `turn/start` 前主动终止了运行。

尚未确认的是：

> 为什么当前准备出的配置无法匹配该线程之前已应用的配置证明？

当前最高优先级的可能来源是：

1. 项目级或全局设置被另一会话修改，当前线程下一次运行时重新生成了不同配置。
2. app-server client 被替换，进程内 `WeakMap` 记录随旧 client 丢失。
3. 配置生成结果存在非预期变化，例如角色、MCP、feature、技能或生成路径发生变化。

这些是待验证分支，不是已经确认的结论。

## 当前诊断日志

### app-server client 身份

每次共享 app-server client 启动或被重新取得时会输出：

```text
[eco-codex] app-server client instance=<instance> generation=<generation>
```

字段含义：

- `instance`：当前桌面进程内单调递增的 `CodexAppServerClient` 实例编号。
- `generation`：app-server 生命周期跨重启单调递增的编号。

如果复现前后 generation 发生变化，可以确认共享 app-server/client 生命周期发生过替换。

### resume 决策

配置化 resume 会输出一条 JSON 诊断：

```text
[eco-codex] resume diagnostic <json>
```

示例：

```json
{
  "threadId": "019f...",
  "clientInstanceId": 3,
  "clientGeneration": 7,
  "previousConfigFingerprint": "abc...",
  "nextConfigFingerprint": "def...",
  "configAlreadyApplied": false,
  "status": "idle",
  "decision": "reject_loaded_config"
}
```

字段含义：

| 字段 | 含义 |
| --- | --- |
| `threadId` | Codex thread ID，不是 Eco thread ID |
| `clientInstanceId` | 当前客户端实例编号 |
| `clientGeneration` | 当前 app-server 生命周期编号 |
| `previousConfigFingerprint` | 当前 client 对该线程记录的已应用配置 SHA-256；缺失表示没有记录 |
| `nextConfigFingerprint` | 本次准备应用的配置 SHA-256 |
| `configAlreadyApplied` | driver 是否确认前后配置一致 |
| `status` | `thread/read` 返回的状态 |
| `activeFlags` | Codex 返回的 `waitingOnApproval`、`waitingOnUserInput` 等标志 |
| `decision` | Eco 在 resume 前作出的决定 |
| `error` | `thread/read` 失败时的错误文本 |

`decision` 可能值：

| 决策 | 含义 |
| --- | --- |
| `omit_known_config` | loaded-idle，但配置已知相同；删除重复配置并继续 |
| `resume_cold_with_config` | thread 为 `notLoaded`；携带配置恢复 |
| `reject_loaded_config` | thread 已加载，但无法证明配置相同；拒绝恢复 |
| `read_failed` | 无法读取 thread 状态 |

日志只记录配置 fingerprint，不记录配置正文、密钥或环境变量值。

### 日志何时生效

历史事故的 Eco、Codex 和数据库日志目前仍保存在本机，但事故发生时上述 fingerprint、client instance 和 generation 诊断尚未加入代码，因此无法从历史日志补出这些字段。

新诊断会由更新后的桌面应用自动写入现有日志通道。只有在包含本次代码修改的桌面应用完成重新构建或重启后，下一次复现才会产生这些字段。

## 两阶段定位流程

### 第一次再次复现

用户不需要手工复制或保存日志。复现后只需要：

1. 告知大致发生时间和对应会话。
2. 不要清理应用数据、日志或数据库。
3. 在方便时停止继续操作该会话，避免大量后续事件增加时间线噪声。

排查人员负责从现有日志和数据库中自动取得：

- Eco thread ID 与 Codex thread ID。
- 错误前后的 client instance 和 generation。
- 前后配置 fingerprint。
- `thread/read` 状态和 `activeFlags`。
- pending approval、turn 和配置刷新时间线。

主要搜索命令：

```bash
rg -n -S \
  "app-server client instance=|resume diagnostic|cannot prove resume config reload|<codex-thread-id>" \
  ~/.eco-coding/logs \
  "$HOME/Library/Application Support/@eco/desktop"
```

如果日志目录由运行环境覆盖，应在实际 `onStderr` 输出目录中使用相同搜索词。

第一次再次复现的目标是确定问题来源类别：

```text
真实配置变化
client 生命周期变化
配置应用登记缺失
审批/用户输入状态竞争
配置生成不稳定
```

如果日志已经直接指向确定的调用链，可以立即修复，不需要等待第二次。

### 针对性补充诊断

如果第一次再次复现只能确认来源类别，排查人员应根据该类别补充最小范围的字段级诊断。例如：

- 确认真实配置变化后，增加各配置分区 fingerprint 和脱敏字段路径 diff。
- 确认 client 生命周期变化后，记录 restart 触发 revision、重启前后 loaded thread 列表。
- 确认登记缺失后，记录 start/resume 成功后的配置登记和 Eco/Codex thread mapping。
- 确认审批竞争后，记录 pending approval registry 与 Codex active flags 的对应关系。

不应在没有第一次复现证据时一次性记录完整配置正文。

### 第二次再次复现

带着针对性诊断再次复现后，应定位到具体问题：

- 哪个配置字段发生变化。
- 哪次设置保存或运行准备触发变化。
- 哪次 app-server restart 或 client 替换丢失证明。
- 哪个 start/resume 路径漏记配置。
- 哪个审批请求或状态投影出现竞争。

第二次再次复现的结果应足以形成确定修复和对应回归测试，而不是继续停留在假设列表。

## 判定矩阵

### 情况 A：真实配置变化

特征：

```text
clientGeneration 相同
previousConfigFingerprint 存在
previousConfigFingerprint != nextConfigFingerprint
status = idle
decision = reject_loaded_config
```

结论：

同一个 app-server client 仍在使用，但当前线程配置确实发生了变化。

下一步：

1. 对比该 Eco thread 的持久化 runtime config。
2. 查询错误时间前后的项目设置、全局设置和工作流设置更新时间。
3. 检查模型、MCP、agents、features、skills 等配置生成输入。
4. 确认另一会话是否保存了共享设置。

当前日志只能证明整体配置变化，不能直接指出变化字段。若此分支持续出现，需要增加分区 fingerprint 或脱敏结构 diff。

### 情况 B：client 生命周期变化导致证明丢失

特征：

```text
clientGeneration 变化
previousConfigFingerprint 缺失
status = idle
decision = reject_loaded_config
```

结论：

配置可能没有变化，但应用证明随旧 client 丢失；同时目标 thread 在新 client 上已经处于 loaded `idle`。

下一步：

1. 搜索 generation 变化前的 `cold restart app-server` 日志。
2. 查询是什么配置 fingerprint 或 global runtime revision 触发了重启。
3. 检查重启后有哪些 control-plane 操作提前加载了目标 thread。
4. 检查 `controlPlaneAppliedConfigByClient` 是否正确登记并转交配置证明。

### 情况 C：登记链路缺失

特征：

```text
clientGeneration 相同
previousConfigFingerprint 缺失
目标线程此前明确在同一 client 上 start/resume 成功
```

结论：

`recordAppliedCodexThreadConfig()` 没有执行，或记录被错误地绑定到其他 client/thread ID。

下一步：

1. 对齐 `thread/start`、`thread/resume` 和 Eco/Codex thread mapping 日志。
2. 检查 resume 是否刷新了 Codex thread ID。
3. 检查 driver 是否在成功 start/resume 后调用配置登记。
4. 检查 control-plane resume 与普通 driver resume 是否使用不同登记路径。

### 情况 D：审批或用户输入参与状态竞争

特征：

```text
status = active
activeFlags 包含 waitingOnApproval 或 waitingOnUserInput
```

结论：

Codex 仍认为 turn 活跃。此时不应重启共享 app-server，也不应发起新的配置化 resume。

如果 Eco UI 显示待审批，但 Codex 返回 `idle` 且没有 active flag，需要同时检查：

1. Eco pending approval registry 是否仍有记录。
2. 对应 server request 是否已经响应、取消或因 client 关闭而断开。
3. thread 状态投影是否保留了过期的审批 UI。
4. app-server 是否在审批期间被替换。

### 情况 E：配置被错误判定为变化

特征：

```text
业务设置看起来未变化
clientGeneration 相同
previousConfigFingerprint != nextConfigFingerprint
```

结论：

配置生成可能包含不稳定输入。

下一步应增加并比较以下分区 fingerprint：

```text
model
model_provider
mcp_servers
agents
features
skills
developer instructions
runtime workspace roots
```

同时记录数组排序、生成文件路径和配置来源 revision。

## 数据库辅助查询

先通过 Codex thread ID 找 Eco thread：

```sql
SELECT *
FROM eco_thread_codex_map
WHERE codex_thread_id = '<codex-thread-id>';
```

查看线程最终状态：

```sql
SELECT id, status, message, created_at, updated_at, runtime_config_json
FROM threads
WHERE id = '<eco-thread-id>';
```

查看错误附近运行事件：

```sql
SELECT
  sequence,
  event_type,
  stream_state,
  message,
  observed_at,
  metadata_json
FROM thread_run_events
WHERE thread_id = '<eco-thread-id>'
ORDER BY sequence;
```

查看运行尝试：

```sql
SELECT *
FROM thread_run_attempts
WHERE thread_id = '<eco-thread-id>'
ORDER BY started_at;
```

默认数据库位置：

```text
$HOME/Library/Application Support/@eco/desktop/eco-coding.sqlite
```

使用只读方式查询：

```bash
sqlite3 -readonly \
  "$HOME/Library/Application Support/@eco/desktop/eco-coding.sqlite"
```

## 第一次再次复现后的诊断待办

当前日志足以判断“配置变化、client 变化或登记缺失”，但不足以直接定位变化字段。

这些待办应由第一次再次复现的证据选择性触发，不要求用户手工收集，也不应无差别全部启用：

- [ ] 为 `model`、`mcp_servers`、`agents`、`features`、`skills` 分别生成 fingerprint。
- [ ] 记录配置来源 revision：global、project、thread persisted runtime config。
- [ ] 记录本次 prepare 的触发原因：新会话、follow-up、设置保存或全局刷新。
- [ ] 记录脱敏后的字段路径 diff，例如 `mcp_servers.browser.enabled: changed`。
- [ ] 记录 Eco pending approval 数量及关联 Codex thread/turn ID。
- [ ] 记录 app-server restart 前后的 loaded thread 列表和状态。
- [ ] 增加“会话 A 等待审批，同时会话 B 修改配置”的端到端回归场景。

## 排查结束时应回答的问题

一次完整排查不能只写“配置不一致”或“重启后恢复”。必须回答：

1. 哪一个配置字段或哪一条配置证明发生了变化？
2. 变化由哪个用户操作或系统事件触发？
3. app-server client 是否重建？
4. 目标 thread 为什么在检查时是 loaded `idle`？
5. 审批状态是实际 Codex active flag，还是 Eco UI/持久层残留状态？
6. 当前保护是否正确阻止了 Codex 静默忽略配置？
7. 应修复配置生成、生命周期登记、状态投影，还是自动冷恢复流程？

在上述问题未得到证据支持前，不应把问题简单归类为“审批问题”或“恢复问题”。
