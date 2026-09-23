# 对话存储、历史分页与实时同步 V2 实施计划

日期：2026-09-24。状态：进行中；核心 V2 存储、协议、桌面/移动端消费和迁移骨架已落地，**DEV 运行时已物理切到 V2-only；最新只读 native manifest 为 `cutoverReady=true`、SQLite integrity 为 `ok`，附件旧载荷/缺文件审计均为 0。生产发布仍受真实 Cloud 弱网与尾部恢复、故障矩阵、原生移动端触控/长会话、性能和兼容观察期阻断**。原生运行时的事件、用户消息编辑/回绑和活动线读写边界已切到 V2-only，V1 只作为迁移输入和限期只读备份。故障验收、生产真实链路验证与旧链路清理尚未完成。最终目标已经冻结为：**运行时读、写、命令、同步和恢复全部只走 V2；V1 仅作为一次性迁移输入和限期只读备份，不得作为生产兜底。** 当前验收快照见 `docs/plans/conversation-storage-sync-v2-acceptance.md`。

### 2026-09-24 第一百一十一批：V2 移动同步弱网故障矩阵复核

- `apps/mobile/test/conversation_v2_sync_engine_test.dart` 定向集 `16 pass / 0 fail`：100 个确定性种子覆盖丢包、重复、延迟、乱序，推送 gap 补拉，重复 effect hash 校验，缺失实体修复，断线缓存/重连重放，以及空页、head 回退、未知 effect、传输异常的 fail-closed。
- 该证据只覆盖协议和本地缓存故障矩阵，不能替代 Cloud WebSocket 实际断线、iOS 后台/蜂窝切换、真实尾部补拉和 Feed 去重演练。生产放行仍需在已绑定移动端上做真实网络切换并核对 `appliedSeq/headSeq/state/error`。

### 2026-09-24 第一百一十批：Supabase Cloud 登录、CAS 与 Realtime 受控写入闭环

- 当前账号的真实 password grant 已通过：公开/受保护函数边界、连续两次登录和绑定设备后的 stale settings CAS 均符合协议。CAS 返回 `409 + PT409/settings_sync_conflict`，读取确认 revision 未改变；未绑定 session 的设备会话拒绝是预期 `403`，不与 CAS 冲突混淆。
- Cloud 受控写 smoke `3 pass / 0 fail / 16 assertions`（约 24.5s）：临时 desktop/mobile device 注册与 session 注册、binding 首次/重复幂等、绑定 RLS、私有 Realtime broadcast 收发、未绑定客户端订阅拒绝均通过。finally 已禁用临时设备；没有修改正式 settings、secrets 或 conversation 数据。
- DEV 重启后的 CDP UI/Center 复核通过：`window.eco=true`、Composer 可见，console `0 errors / 1 warning`（仅未打包 Electron CSP）；Cloud 状态 `connected`、3 个 active binding、45 条 presence（在线 3，含 desktop/mobile），10 个同步域 `dirty=7/synced=3`。
- 该批关闭 Cloud 认证、CAS 冲突、device-session、binding 幂等和私有 Realtime 基础门禁；弱网断线/重连和尾部补拉仍未演练，不能将一次正常广播外推为完整同步保证。dirty 域权威选择、生产双次迁移/legacy 观察期、真实设备后台与长会话性能，以及 Codex 加密 `agent_message` 缺口仍是开放门禁。

### 2026-09-24 第一百零九批：修复同事务 provider patch 的实时 gap 发布

- `appendProviderInputPatchInCurrentTransaction()` 原先只返回主 patch 的提交结果，漏掉同事务自动追加的 `message.history_targeted` 通知；持久化是连续的，但 renderer 只收到后一条 effect，形成真实 `ConversationV2RendererGapError`。现在 API 通过 `onAppendResult` 发布主 patch 与所有 target 结果，Claude/Codex 回绑调用点在外部事务提交后一起发布。
- 新增当前事务通知回归；V2/store/renderer 定向集 `106 pass / 0 fail / 410 assertions`，桌面 `tsc --noEmit -p apps/desktop/tsconfig.json` 通过，Biome error-level 退出码为 0（保留既有 warning）。
- 最新 DEV 重启后 LongCat-2.0/CDP 全场景 `7/7` 通过：PI/Claude/Codex 主工具、Claude 子代理、Claude Plan→批准→coder 子代理均通过；Codex 子代理在派发前明确 fail-closed，因为 provider 不支持加密 `agent_message`。成功场景的 prompt/user row 均为 1，renderer head/applied cursor 全部收敛。
- Codex Plan smoke `thr_1790183467388` 验证计划阶段只读：`awaiting_plan`、无 Bash/探针文件/待审批 Bash；批准后只执行精确 `printf` 并得到 `codex_plan_execution_V2_LONGCAT_CODEX_PLAN_MUED0JQM`。第二条 user row 是协议生成的 `Implement the plan.`，不属于普通发送重复。
- 修复后 `cdp:snap` 为 `0 errors / 1 warning`，仅有未打包 DEV Electron CSP warning，之前的 renderer gap warning 未再出现。该本地发布缺口已关闭，但 Cloud/弱网尾部补拉、真机后台与长会话压力仍需独立验收。
- 严格全量 gate 为 `5376 pass / 19 skip / 0 fail`（5395 tests、674 files、23911 assertions）。根 `bun run typecheck` 仍被上游 `pi-web-search@1.5.0` 类型/TS5097 诊断阻断；桌面项目 tsc 通过。
- DEV 只读审计为 `phase/storageMode=v2_only`、`integrity=ok`、`cutoverReady=true`，184 streams，232369 events/effects，74 native facts；manifest `8c9e206c`，独立 verify `passed`、facts hash `0e9e371d`。`quick_check=ok`，13 张退役 V1 conversation source table 不存在，附件旧载荷/path/inline/缺失/解析错误和 native unmatched 为 0；4 条历史 pending-plan 与 5 条 follow-up 继续保留为 durable V2 状态。
- 全面生产 V2-only 仍进行中：Cloud password/CAS、Realtime 弱网尾部恢复、dirty 域权威选择、生产双次迁移/native manifest、物理故障/真机长会话性能、legacy 观察期和 Codex 子代理协议能力缺口尚未闭合。

### 2026-09-24 第一百零八批：Codex Plan 权限硬封与 LongCat 全链路复验

- Codex Plan 的权限映射已从“依赖模型提示词”收紧为运行时硬边界：`plan`/`ask` 的 `turn/start` 一律 `sandboxPolicy=readOnly`，无论编排层是 `workspaceWrite` 还是 `danger-full-access`；获批 handoff 才切换到执行态 `workspaceWrite`。这解决了弱模型在 Plan 中直接执行 Bash 的真实缺口，并保留 Codex 官方 Plan 模板要求的无副作用计划语义。
- 新增策略、物料化和 app-server 回归，定向 `52 pass / 0 fail / 190 assertions`；桌面 `tsc --noEmit -p apps/desktop/tsconfig.json` 通过。根 composite typecheck 仍被上游 `pi-web-search@1.5.0` 的类型/TS5097 错误阻断，未发现本批源文件诊断。
- 新增真实 CDP 脚本 `apps/desktop/scripts/dev-cdp-longcat-codex-plan-readonly-smoke.mjs`。LongCat-2.0/Codex 实测：计划阶段的 `touch` 探针没有 Bash row、没有文件落盘、没有审批请求，进入原生 `awaiting_plan`；批准后准确执行一条 `printf` Bash 并完成，renderer head 与 applied cursor 稳定收敛。审批动作会按协议生成第二条用户消息 `Implement the plan.`；首条业务 prompt 只有一条，这个合成审批消息不能和普通发送重复混淆。
- 新构建下既有 LongCat 全场景 `7/7` 通过，PI/Claude/Codex 主代理均各自产生一条用户消息和一条匹配工具结果，Claude 子代理与 Claude plan→approval→coder 也通过；Codex 子代理仍因 provider 不支持加密 `agent_message` 在派发前明确拒绝。
- 最后一次 `cdp:snap` 为 `0 errors / 24 warnings`：除未打包 DEV 的 Electron CSP 外，仍有多组 `ConversationV2RendererGapError`，目前会进入有界 V2 sync 并最终收敛，但它证明 IPC effect 仍可能乱序到达。该 warning 是实时恢复的开放门禁，不能因为所验线程最终稳定就标成已解决。
- DEV 只读维护审计最新为 `v2_only`、`integrity=ok`、`cutoverReady=true`、173 streams、228498 events/effects、74 native facts，manifest `c5e0b754`、独立 verify `passed`、facts hash `094cb315`；SQLite `quick_check=ok`、退役 V1 表 0 张。4 条历史 pending plan 和 5 条 follow-up 继续作为 durable V2 状态保留，不能用删除数据换取“全空”摘要。
- 本批关闭 Codex Plan 权限放大和普通 Agent 回归；生产放行仍受 Cloud 写/弱网尾部恢复、dirty 域权威选择、真机后台/物理故障/长会话性能、生产迁移双次复核、legacy 观察期和 Codex 子代理协议能力缺口约束。

### 2026-09-23 第一百零七批：补齐多 Agent/iOS 实际冒烟并稳定全量门禁

- LongCat-2.0 DEV/CDP 覆盖 PI、Claude、Codex 主 Agent 工具调用、Claude coder 子代理、Claude plan→approval→coder 执行和 Codex 子代理 fail-closed 门禁；当前真实 smoke `6/6` 通过，PI 的 plan→approval→coder 子代理另行通过。校验以 durable V2 tool/run/agent 归属和 renderer head 为准。Codex 的原生 plan 审批违约、provider 不支持加密 `agent_message`，以及被门禁拒绝的 Codex child path 仍是未完成项。
- 修复 macOS 临时工作区符号路径导致的真实越界误判：Bash workspace containment 先规范化已有真实路径，再追加不存在的尾段；无法解析仍拒绝。Alias 通过、外跳 symlink 拒绝，Bash policy/runtime confirmation `28/28`。
- 已配对 iOS Simulator 的 Composer 将 `IOS_V2_REAL_SYNC_20260923_1809` 发至桌面同一 V2 thread；移动端和桌面各只有一个 user prompt/answer，移动游标和桌面 renderer 收敛到 seq `289`，移动 cache `live/error=NULL`、无 pending command。此证据覆盖同步和 Feed 去重，不覆盖真机网络/后台挂起与原生控件触控。
- DEV 本轮只读 audit 再次确认 `storage_mode=v2_only`、`integrity=ok`、`cutoverReady=true`、170 streams、222,778 events/effects、74 native facts；manifest 独立 verify `passed`，facts hash `2abda8cf`，13 张旧 conversation source table 不存在。Cloud Center 登录态只读读取为 3 个 active bindings、10 个设置域（7 dirty / 3 synced）；无写设置或 secrets，dirty 域的本地/云端权威尚需用户选择。
- 无界并发导致迁移 CLI 子进程被 5 秒默认测试 watchdog 杀死；未放宽超时或 baseline。测试入口和 CI strict gate 改为默认 2 个文件并行、每文件 1 个用例并发，显式参数仍可覆盖；`--no-mobile` 分支的自我误判一并修复。完整 Bun suite `5,374 pass / 19 skip / 0 fail`（674 files、23,903 assertions），Flutter `660 pass`，CI `node scripts/test-gate.mjs --strict` 通过。19 个 skip 保持显式，包含 Cloud 写集成；它们不由手工 CDP 证据代替。
- 当前交付门禁仍打开：Cloud password grant/CAS 写冲突与实时广播/断线尾部补拉、7 个 dirty sync 域冲突决策、Codex 原生计划审批与子代理协议、真机后台/物理故障、生产双次迁移/旧代码观察清理。DEV manifest 通过和桌面+iOS Simulator 往返均不等于全面生产 V2-only 已完成。

### 2026-09-23 第一百零六批：修正 post-cutover 原生事件审计并重新通过 DEV manifest 门禁

- 原审计把迁移完成后新增的 V2 runtime 事件拿去和已退役的 V1 源表逐条比较：迁移完成标记会永久保留，导致三个旧会话中的 171 条合法 V2 runtime/恢复事件被报成 unmatched。现在只有每条候选事件都能通过稳定 event ID、来源前缀与 payload 校验，命令事件还能对上 durable receipt/job，provider history patch 和历史修复要对上对应身份，且（有迁移记录时）`recorded_at` 不早于 completed migration 的 `updated_at`，才标记为 post-cutover warning。历史时间早于迁移完成、来源不明或混合了未验证事件仍 fail-closed；启动恢复的 `tool.failed` 另要求精确 recovery identity 及 terminal run/tool 投影。
- 新增回归覆盖：带 completed migration marker 的完整 runtime receipt/source-envelope/lifecycle、provider patch、两种 history repair、migration 时间边界、terminal-run tool recovery，以及“已有 ledger 仍有额外未知 native event”必须阻断；由 modified fact 派生的 maintenance patch 必须反向对应 ledger。维护 CLI 全文件 `19/19`、桌面 tsc、Biome 和 `git diff --check` 通过。
- 新版脚本对 DEV 实库只读重审通过：`phase/storageMode=v2_only`、`integrity=ok`、`cutoverReady=true`，159 streams、221,117 events/effects；native manifest 74 facts 分为 62 equivalent、9 collapsed、3 modified、0 unmatched。132 条 `post_cutover_runtime_without_native_ledger`、8 条 `post_cutover_recovery_without_native_ledger` 和 2 条 `maintenance_native_fact_replay` 作为显式 warning 保留，没有被改写成“无差异”；附件旧载荷、inline bytes、路径引用、缺文件和解析错误均为 0。独立 `--verify-native-manifest` 返回 `passed`，facts hash `bd3092ef`。此前报出的 171 unmatched 是审计器误分类，经逐事件来源与时间证据确认后归类为 V2-only 后续写入。
- 新一轮 CDP Center 认证读取通过：连接 `connected`、3 个 active binding、41 条 presence、10 个设置域（7 dirty / 3 synced）。模拟器唤醒后的前两次 presence 查询短暂只看到 2 个 desktop；随后只读详情出现最近 mobile `connectedAt`，紧接着再次 `smoke:cdp-center` 确认 3 个 online presence，类型包含 desktop + mobile。iOS 本地两个 V2 cache 的 `applied_seq=257/271` 与桌面当前 head、`history_revision=0`、store epoch 全部一致，两条均 `live/error=NULL`、pending commands 为 0，`quick_check=ok`。观察到移动端唤醒后 presence 有延迟，故报告最终在线结果而不把启动瞬间的空档抹掉。
- 尝试运行 Cloud authenticated integration 文件时，发现 DEV `center_server_config.anon_key` 在本地由 Electron `safeStorage` 加密；直接从 SQLite 取原值会被 Auth 判为 `Invalid API key`，所以该次密码登录/CAS 结果无效，不能作为账号密码或 Cloud auth 缺陷结论。公开/受保护函数边界 `1 pass`；设备会话/绑定/Realtime 写用例按默认关闭策略 `1 skip`。正确 anon key 尚未安全注入测试进程，fresh password grant/CAS 仍未验收。既有 DEV 登录 session 的 Center 授权读取仍成功；没有创建或禁用设备、没有写绑定，也没有 push/pull 设置或 secrets。测试登录错误现在会呈现 Supabase 的安全错误码/消息字段，避免再次只显示 `unknown`。
- dirty 域的无写入 reconcile 仍返回 `needsUserChoice`，settings/secrets push/pull 均为 0；用户尚未选择本地或云端配置权威。DEV manifest 通过只关闭 DEV 数据审计门禁，不代表 Cloud 认证/移动在线、物理故障、真实设备或生产兼容观察门禁通过。

### 2026-09-23 第一百零五批：恢复未终结工具状态并优化 V2 启动查询

- 增加 V2-only 启动修复：已有 stream 中，如果 run 已 `failed/cancelled`、其 tool 仍 `started/running`，追加稳定身份的 `tool.failed`。事件说明进程中断导致终态工具结果未落盘，副作用结果未知；保留原 input，不伪造 output，不自动重跑命令。DEV 首次修复 8 个会话中的 119 条 orphan tools；复核 terminal runs 下活动工具数为 0。Codex Plan Mode 失败样例仍明确记录为：无 `pending_plan`，LongCat 在 prompt 要求等待审批后实际执行 Bash 三次。
- 修复恢复门禁的 SQLite 回表计划：V2 run/agent lifecycle 事件的最新序号由子查询精确选出，`seq` 在 conversation 内唯一，外层仅按 `(conversation_id, seq)` 回表，避免 `run_id`/`agent_instance_id` 使 planner 选择宽扫索引。最大 `141,191`-event stream 上 run list 从 `2,039ms` 降至 `1.1ms`。
- DEV 重新启动后从 app ready 到主窗口 ready `28.678s`；V2 Store 初始化 `2.354s`、所有 startup reconciliation `5.483s`、恢复 gate `0.817s`。CDP UI、Center、console 与 V2 状态校验通过；数据仍为 `v2_only`、159 streams、221,117 events。登录后从 Supabase Cloud 实际读到 10 个 settings 域；`providers/proxyBridge/asr/imageGeneration/orchestration/git/personalization` dirty，其他 3 个 synced。无写入的 `reconcile` 正确返回 `needsUserChoice`、vault `ready`，push/pull 均为 0；没有替用户选择云端或本地配置。完整自动化 Cloud auth/write 测试仍因 `ECO_SUPABASE_CLOUD_*` 未配置而跳过。此前 `cutoverReady=false` 的 169 unmatched facts 和 116 条无 native-ledger 运行记录本批未重审，继续阻断生产门禁。
- 桌面定向 `66/66`、完整桌面回归 `3841 pass / 6 skip / 0 fail`（523 files、18,703 assertions）、main bundle、`git diff --check` 通过。6 项跳过包含 3 项需 `ECO_SUPABASE_CLOUD_*` 的 live Cloud 测试。根 `tsc -b` 被第三方 `pi-web-search@1.5.0` 类型与 TS5097 错误阻断；筛选输出没有本批改动文件诊断。后续仍需闭合 Cloud 弱网/尾部同步、历史事实对账、Codex 原生 plan approval、缺失 stream、附件权限、崩溃/磁盘故障、真机性能与 legacy 观察期。

### 2026-09-23 第一百零四批：provider patch 幂等重放修复

- 根因来自 `appendV2ProviderPatch()` 的时间字段：event ID/source key 由 thread、patch reason 和 input IDs 确定，但 `occurredAt` 每次使用新 wall clock；同一 patch 被 SDK 事件再次绑定时，V2 immutable hash 把时间差当作内容差异并 fail-closed。已在 V2 store 内为已有 identity 复用其首次提交时间；所有其他字段与 patch target 仍严格比较，payload 改变继续冲突。source-event 和 history-target 错误新增无 prompt 正文的 structured DEV logs。
- 回归直接复现“相同 provider patch identity + 新时间戳”这一真实失败机制，并验证相同内容无新 seq、payload 不同仍被拒绝；扩展 Codex `bindLatestUserRunEventToSdkMessage` 重复 SDK callback 的运行时回归。store `52/0`、runtime `32/0`；桌面 TypeScript、main bundle 与 diff check 通过。
- **真实模型 E2E 尚待复验**：当前正在运行的 DEV 主进程启动于最新补丁之前；bundle 已重建但未二次重启。macOS 锁屏时不强行驱动 hidden UI；设备解锁后重启，再对原 `thr_1790131818558` 及新 Codex callback 复验。旧 native facts unmatched、V2-only 启动耗时、缺失 stream、真实 Cloud 弱网和附件权限等生产门槛保持打开。

### 2026-09-23 第一百零三批：真实手机发送复核与 history target 冲突诊断

- 用户登录恢复后，从已配对 iOS 模拟器的 composer 发送 `ios_v2_mobile_recovered_20260923_11`。桌面权威 V2 head 与移动端 `applied_seq` 都为 `271`；桌面有且仅有一条标记 user row、一条 Bash completed 和一个 `tool_count=1` 的 completed run。移动端状态 `live/error=NULL`，UI/AX 中提示与真实输出各出现一次。没有扫码。数据库另有 thinking channel 中间消息，但这次 Feed 没有重复展示用户输入。
- 当前 DEV 打开历史会话 `AI回复测评漏斗分层阈值` 成功，未复现此前的 `Message message_user_5ef6f938 history target changed` uncaught exception。V2 保存该 user row 的一次 `codex-pending:* → sdk:*` 临时目标升级；canonical target 的后续漂移继续 fail-closed。
- 为下一次 target drift 提供可诊断证据：错误现在包含原目标、尝试目标、conversation/message/event ID 与 seq，结构化 `ConversationV2Error.data` 同步保存这些字段。定向 store `51/51`，桌面 tsc 和 main bundle 通过，`git diff --check` 通过；Biome 检查退出码为 `0`，目标大文件有 `14` 条既有警告。
- 最近一次 Flutter integration runner 因 setup gate 未就绪而没有发出测试消息，且测试 runner 移除了模拟器 dev app；随后重新安装、登录和配对后完成了本批手动真链路。不能把这次手动结果算成 integration test 通过。新的 DEV main bundle 重启后约 `8分41秒` 才开放 CDP：`cdp:snap` 为 `0 errors / 1 warning`（唯一 warning 为未打包 DEV 的 Electron CSP）；重启后再开上述旧会话未复现 target 异常，手机游标仍为 `271/live/error=NULL`。最新只读 native manifest 再审计为 `phase/storageMode=v2_only`、`integrity=ok`、145 conversations/streams、`218,651` events/effects、74 facts/hash `2bab6285`；附件旧载荷/路径/inline bytes、缺文件与解析错误均为 `0`，13 张旧 source table 均不存在。`cutoverReady=false` 仍有历史 unmatched `143+26=169`，以及 `116` 条 post-cutover runtime without native ledger 观察项。该启动耗时超出生产体验预期，记为独立性能缺口。完整门禁仍受历史 `Source event was replayed with different content`、缺失 stream、native manifest unmatched facts、Cloud 弱网/尾部恢复、附件权限、物理故障、真机性能和 legacy 观察期阻断。

### 2026-09-23 第一百零一批：收紧弱模型重复工具调用验收

- 根据上一轮 Claude plan coder 重复执行同一 Bash 的证据，更新 LongCat DEV 提示：唯一 coder、Bash 总调用数恰好一次，禁止重试、重复、复核或由主代理复跑；iOS 集成测试也要求恰好一条匹配完成态 agent tool。CDP 判定检查标记工具调用的精确数量，不再只要求“至少一次”。
- 最新完整 CDP smoke 的 PI、Claude、Codex 主代理工具调用、Claude coder 子代理以及 Claude 原生 plan→approval→coder 均通过；所有成功场景的匹配 Bash V2 tool row 恰好 1 条、user row 恰好 1 条、Feed DOM 提示恰好 1 行。计划 coder 按更明确的提示只执行一次。Codex 子代理在派发前仍因 LongCat 不支持加密 `agent_message` 而 fail-closed，无半成品线程。
- iOS 已配对模拟器 V2 sync smoke `1 pass`；SQLite 实测 `thr_1790105647611`：`live`，序号 `129/129`，9 条 message，标记 user/tool 分别恰好 1 条。该次 integration 走保存的 Cloud 凭据与既有 PC binding，没有扫码；原生 UIKit 按钮真实触控仍未覆盖。
- 本批没有关闭生产门禁：`cutoverReady=false` 的历史 unmatched facts、正文/附件差异、Cloud 弱网和尾部恢复、跨设备权限、手机发起命令、原生触控、物理故障和性能、legacy migration/bridge 观察期仍需逐项完成。

### 2026-09-23 第一百批：明确提示词、真实模型工具验收与 iOS V2 同步

- 弱模型冒烟改成精确、单步、可证伪的提示契约：禁止主代理代跑；唯一 coder 子代理须执行指定 `printf`；拒绝派发即报告原始错误并停止。验收以 V2 durable tool row、agent owner、会话终态和 Feed DOM 为准，不以自然语言自报成功为准。
- LongCat-2.0 在 DEV 的 PI/Claude/Codex 主代理工具调用、Claude coder 子代理、Claude/PI native plan→approval→执行链路已通过。PI 计划另覆盖主代理与 coder 两种 execution target。Claude plan 子代理重复运行指定 Bash 两次，已记为重复执行风险；用户消息仍只有一条。Codex LongCat 子代理被加密 `agent_message` 能力门禁前置拒绝，因为 provider 不支持该协议；保持 fail-closed，不做有损降级。
- iOS 26.5 已配对模拟器从现存 Cloud 账号和 PC binding 读取 `thr_1790105647611`：V2 sync 到 `live`，SQLite `applied_seq=129/snapshot_seq=129/error=NULL`，9 条 message，标记用户消息 1 条，完成的 agent tool 1 条，Feed 显示同步内容。Flutter integration smoke 实际走应用连接回调并打开该 thread；原生 iOS 26 按钮的 UiKitView 真实触控命中没有覆盖，手机侧发起消息/审批也还未覆盖。
- 该次真实运行发现 Center RPC 提前断连错误可能在调用方 await 前成为未处理异步错误，以及 TTS stop 晚于服务 dispose 通知已销毁对象；已为 pending RPC Future 建立提前错误观察并保留调用方原错误，TTS dispose 以 `1` 条回归覆盖。
- 桌面完整严格门禁 `5365 pass / 19 skip / 0 fail`（5384 tests、674 files、23862 assertions、3 snapshots）；移动端 `660 pass / 0 fail`、iOS 集成 smoke `1 pass`、`flutter analyze` 通过。最新 LongCat smoke 中桌面每个被检查会话的 V2 user row 为 1，标记提示在 Feed DOM 出现 1 次。
- 全面生产 V2-only 的状态不变：历史 native facts unmatched `143 + 26` 与正文/附件差异仍需有证据地对账和维护窗口双次重导；真实 Cloud 弱网/尾部恢复、附件权限、手机发起命令、原生控件触控、物理故障、真机性能和 legacy migration/bridge 观察期仍未闭合。19 项外部依赖测试跳过，不能宣称生产完成。

### 2026-09-22 第九十九批：子代理生命周期归属修复与完整门禁闭合

- 完整严格门禁第一次暴露 11 条 replay 失败，全部集中在 `Agent ... changed identity or ownership`。根因是同一 Codex 子代理的 `agent.started` 与 `agent.stopped` 可能来自不同 provider turn；runtime writer 和 provider adapter 原先会按各自 `turnId` 推断 `runAttemptId`，把稳定 agent 错判成换 owner。现在 `agent.*` 只接受显式 `runAttemptId`，不再按 turn 猜归属；消息、工具、运行事件仍保留 request correlation，V2 身份冲突校验没有放宽。
- 修复后 gateway/conversation replay 定向回归 `15 pass / 0 fail / 268 assertions`；完整严格门禁最终 `5356 pass / 19 skip / 0 fail`（5375 tests、673 files、23846 assertions、3 snapshots）。迁移 CLI 单独复验 `18 pass / 0 fail / 130 assertions`；上一轮并发资源抖动导致的 dry-run 5 秒超时未复现，未被加入已知失败清单。
- renderer 对 `notification_content_unavailable` 等预期 no-op 不再错误打印 console error，未知失败仍保留 error；热更新后 `cdp:attach → cdp:snap` 为 `0 errors / 1 warning`（仅 Electron DEV CSP），`smoke:cdp-probe` 与 `smoke:cdp-center` 通过。已配对 iOS 模拟器仍用直接 SQLite/AX 证据验证，未重复扫码。
- 根 TypeScript composite gate 仍只剩上游 `pi-web-search@1.5.0` source 的 `exactOptionalPropertyTypes`/TS5097 等错误；桌面 `tsc --noEmit -p apps/desktop/tsconfig.json` 与 `bun run build` 通过。当前 DEV native manifest 的 `cutoverReady=false`（两个历史会话 unmatched `143 + 26`）和 LongCat Codex 在极明确提示下仍 `toolCount=0` 的真实能力缺口保持不变。


### 2026-09-22 第九十八批：真实演练后的 DEV 审计结果

- LongCat/PI/Codex CDP 演练后重新执行只读 native manifest：SQLite `integrity=ok`、`storageMode=v2_only`、64 个 streams、`199,462` events/effects、74 条 native facts，canonical attachment 的 legacy payload/path/inline bytes、missing/parse errors 均为 `0`。
- 当前 `cutoverReady=false`，原因不是被脚本隐藏的工具失败，而是两个历史会话在 V1 退役后仍有无法由 immutable native ledger 证明的 live facts（`thr_1788595100156` unmatched `143`、`thr_1789133041817` unmatched `26`），另有正文/附件差异审计项。没有原始来源证据，不能直接补写或把它们标成 equivalent；需要生产维护窗口做双次重导/人工对账。
- 新产生的 post-cutover runtime 会话被审计为 `post_cutover_runtime_without_native_ledger`，但其 unmatched count 为 `0`；这仍是观察项，不能把 `cutoverReady` 结果改成通过。
### 2026-09-22 第九十七批：LongCat 计划派发身份修复与弱模型边界复验

- 发现并修复一个真实的 V2 命令完成缺口：`piRuntimeOrchestrationDeps().runThreadRequestOnce` 丢弃了 `retryIndex/runtimeDispatch`，导致 PI 计划审批后的运行实际已经执行，但 `plan.resolve` 收据停在 `runtime_dispatch_not_started`，线程无法完成。现在完整透传派发身份；`conversation-plan-command`、`thread-plan-approval-runtime`、`thread-run-attempt` 与相关 V2 store/runtime/renderer 定向回归共 `140 pass / 0 fail / 504 assertions`。
- 修复后的 LongCat-2.0 原生 PI 计划主代理验收：线程 `thr_1790080516660` 完成，审批命令完成，计划运行与命令运行均有终态，`plan.runtime_dispatched` 和 `plan.pending_cleared` 检查点齐全，V2 user message 只有 `1` 条。
- 同一链路强制指定 `executionTarget={kind: "subagent", agentKey: "coder"}`：线程 `thr_1790080818866` 完成；planning run 和 command run 均 `completed`，command job `plan.resolve` 为 `completed`，coder 子代理和 `Bash printf PI_PLAN_SUBAGENT_OK` 均为 `completed`，V2 message 中 user row 仍为 `1`，没有重复事实。
- 为验证“提示词更明确”是否能修复弱模型，使用 `thinkingEffort=off`、中文单动作提示和精确命令重新测试 Codex LongCat：线程 `thr_1790081865464` 在 60 秒内只生成 thinking、`conversation_tool_calls_v2=0`，未调用 Bash；随后通过 V2 cancel command 安全收敛到 `idle`，没有未捕获异常，user row 为 `1`。这属于 LongCat-2.0 在 Codex 工具协议上的真实能力/适配缺口，不能用自动补 Bash 或假成功状态掩盖。
- 本次 DEV 重启期间，启动 reconciliation 需要扫描约 `198,276` 条 V2 事件、约 `402MB` 数据，CDP 暂时不可用约 7 分钟后恢复；没有数据损坏，但启动性能仍是生产门禁，需继续优化/复测。

### 2026-09-22 第九十六批：LongCat 原生计划与多代理 V2 真实链路

- LongCat-2.0 的 PI/Claude/Codex 简单工具、子代理和计划场景按真实 CDP 运行，不把模型文本标记当成工具成功。PI Bash、Claude Bash、Claude coder 子代理均产生 durable V2 tool/agent rows；Codex 工具和 Codex 子代理在旧轮次中未产生 Bash tool row，已明确标为失败并安全取消。
- Claude 原生计划在 LongCat-2.0 上未稳定调用原生 `ExitPlanMode`，而是继续读取/探索；该轮已取消并保留失败证据。PI 原生 `finalize_plan → approvePlan → forced coder execution` 已通过，当前计划验收以 PI 原生协议为准，Claude/ Codex 弱模型缺口不能被宣称已闭合。


### 2026-09-21 第九十一批：Supabase Cloud 认证全链路与 CAS 冲突修复

- Cloud 认证测试第一次暴露了真实缺陷：`eco_replace_account_config` 的 stale-revision 分支使用自定义 SQLSTATE `40001`，请求在 PostgREST 链路中挂起而不是返回冲突。该行为与 [Supabase 官方 RPC 故障说明](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b)一致；新增 migration `20260921170000_fix_account_config_conflict_sqlstate.sql`，将冲突映射为 PostgREST `PT409`，保留 `settings_sync_conflict` 消息、CAS 语义、secret whitelist、security-definer 和权限边界。
- 修复 migration 已通过 `supabase db push --dry-run` 预览并应用到 Cloud；远端 migration history 已推进到 `20260921170000`。桌面同步客户端显式识别 `PT409`，Cloud 集成测试要求 HTTP `409`、`code=PT409` 与冲突消息，避免把挂起或任意 4xx 当成通过。
- 新增 `apps/desktop/test/supabase-cloud-authenticated.integration.test.ts`：无写开关时写用例自动跳过；认证读测试实测 `2 pass / 1 skip / 0 fail`，完整受控写测试最新实测 `3 pass / 0 fail / 11 assertions`（约 11.5 秒）。写测试用两个独立 session 注册临时 desktop/mobile、注册 device session、验证 binding 首次/重复幂等、私有 Realtime broadcast 往返，并强制断言两个临时设备的 `device-disable` 清理均返回 `200`；没有改动正式设备设置或对话数据。
- 当前工作区严格桌面门禁 `3823 pass / 6 skip / 0 fail`（`18648 assertions`、`522 files`）；settings-sync 定向回归 `31 pass / 0 fail / 96 assertions`；移动端 `flutter test` 为 `656 pass`，`flutter analyze` 为 `No issues found`；`bunx tsc -b --pretty false`、`git diff --check` 和 `supabase db push --dry-run` 均通过。DEV 重启后 `cdp:attach → cdp:snap → smoke:cdp-probe → smoke:cdp-center` 通过，页面/Composer 可读，console `0 errors / 1 warning`，认证 Center 读取到 `connected`、1 个 active binding、29 条 presence（3 online）和 10 个 settings-sync 域。
- 本批闭合了 Cloud 的认证、CAS 冲突、设备/session、绑定幂等和私有 Realtime 基础链路；HTML shared-domain 的 `Content-Type=text/plain` 风险、deferred device-session RLS migration、真实 mobile peer 尾部补拉/弱网重连、附件对象权限、生产双次重导/native manifest、真机长会话和 legacy migration/bridge 观察期仍是全面生产 V2-only 门禁。

### 2026-09-21 第九十二批：iOS 模拟器 arm64 启动门禁与扫码插件升级

- 在本机 Xcode `26.6` 安装并启动 iOS `26.5` Simulator，创建 `Eco iPhone 11 V2`。首轮构建暴露真实兼容缺口：`mobile_scanner 6.x` 的 iOS Pod 明确排除 `arm64`，在 Apple Silicon 的 iOS 26 模拟器上只能产出无法安装的 x86_64 包。根据包的公开变更记录，升级 `mobile_scanner` 到 `7.4.2`（Apple Vision API）并重新生成 SPM/Pods 锁文件；代码 API 无需改写。
- `flutter test --reporter compact` 仍为 `656 pass`，`flutter analyze` 为 `No issues found`。标准 `flutter build ios --flavor dev --simulator` 通过（`76.5s`），产物 `Runner.app` 为 arm64/x86_64 universal binary；`xcrun simctl install`、`simctl launch` 均通过，bundle id 为 `com.plus.ecoding.dev`，启动截图显示 V2 Mobile 连接首屏、扫码和手动配置入口。补充执行 `flutter build ios --flavor dev --release --no-codesign`，iPhoneOS Release 产物也通过（`74.6s`，`Runner.app` 33.3MB，arm64）。
- 本批只证明 iOS 模拟器的构建、安装、启动和 UI 首屏门禁；模拟器尚未写入 Cloud 凭据、未注册真实 mobile device，也没有把截图或模拟器启动冒充 authenticated mobile peer。真实移动端登录、device-session、binding、Realtime 尾部补拉/弱网重连仍需在一次受控 Cloud 演练中完成；真机 Secure Enclave、推送、后台挂起、蜂窝网络和物理故障仍不能由模拟器覆盖。

### 2026-09-22 第九十三批：Codex V2 事件幂等、历史目标和运行尝试身份收口

- 复现并修复了主进程的两个真实崩溃边界：`message.history_targeted` 收到本地 `codex-pending:*` 临时目标后，后续 SDK canonical target 不再被视为不可变历史目标冲突；runtime `tool:done` 等 provider 事件缺少 `runAttemptId` 时，先按同一 request 的已持久化输入 receipt 解析唯一 attempt，无法唯一解析仍显式失败，不伪造归属。
- Codex 接受路径不再把同一用户输入同时写入 V2 user message 和 provider `message.user` 回声；启动时对历史 echo 做一次性、可审计的 `history.deleted` 修复；连续发送入口传递已接受消息 ID，避免同一轮再次绑定。renderer 合并在同一 macrotask 内同步推进 V2 ref，避免实时事件先到时产生假 gap。
- provider/web-search 入口改为静态 `pi-web-search` import，新增 bundled factory 回归，避免生产 bundle 运行时动态模块缺失。桌面定向 V2 store/runtime/renderer 回归 `113 pass / 0 fail / 422 assertions`；runtime web-search 回归 `8 pass / 0 fail / 23 assertions`；桌面 `tsc --noEmit` 通过。
- DEV LongCat-2.0 极高 E2E 标记 `V2_LONGCAT_E2E_20260922_0007` 在桌面 V2 表中只有 `1` 条可见 user row（`message_9c434e33…`），mobile SQLite 同步后 Feed 也只出现一次；两端没有第二个 `message.created` 事实。该证据闭合了“发送一条 Feed 显示两条”在真实运行时的重复写入疑点，但不掩盖历史会话已有的恢复阻断。

### 2026-09-22 第九十四批：移动端 durable live 状态与 V2 Feed 显示修复

- 发现移动端 bootstrap 已经追平 authoritative head 时，`ConversationV2Cache.installBootstrap()` 会把数据库持久化为 `catchingUp`，随后同步引擎只改内存状态为 `live`；进程重启后会错误地回到 catching-up。新增 `markLive()` 事务，在 `start/refresh` 完成补拉后把 `state=live,error=NULL` 落库，并增加“bootstrap at head + close/reopen”缓存测试。
- 发现 ThreadSessionScreen 即使已经拿到完整 V2 Feed，仍会被原始 thread prompt 的 optimistic 分支整体替换，因此用户看到像是只剩第一条旧消息。现在只有 V2 Feed 为空时才使用 optimistic prompt；Feed 已有 V2 行时保留完整 ordered rows，运行中的 pending thinking 仅作为尾部追加。
- 移动端定向缓存/同步/Feed/session/live-event 套件共 `187 pass / 0 fail`，`flutter analyze --no-fatal-infos` 为 `No issues found`。iOS 26.5 `Eco iPhone 11 V2` 真实 DEV 演练通过：重启后进入已配对 Eco Dev，打开“询问AI助手能力”，发送 `V2_IOS_DUP_FINAL_20260922_01: only reply OK`，AX/UI 显示该 user row 一次、assistant `OK` 一次；SQLite `conversation_v2_state` 为 `applied_seq=195,snapshot_seq=170,state=live,error=NULL`，同一 marker 的 user message 计数为 `1`。
- 当前 DEV 仍保持 `storage_mode=v2_only`；本批没有把模拟器冒充真机或生产 authenticated peer。生产放行仍由历史不可恢复 lifecycle metadata、真实 Supabase mobile peer 双端尾部补拉/弱网、附件对象权限、生产双次重导/native manifest、ENOSPC/掉电/响应丢失、真机长会话/性能和 legacy migration/bridge 观察期阻断。

### 2026-09-21 第九十批：Supabase Cloud 增量部署与运行态冒烟

- 已对 Cloud project `ajlczxfuzmkaheakjjpz` 执行仓库标准 `bun run supabase:deploy -- --platform cloud --project-ref ajlczxfuzmkaheakjjpz`：增量 migration `20260905120000_replace_account_config_rpc_provider_proxy.sql` 已应用，远端与本地 migration history 完全一致；11 个 Edge Functions 均为 `ACTIVE`。
- 部署后 HTTP 只读冒烟通过：`html-host-probe=200`、`auth-email-confirmed=200`、不存在的 HTML 页面为 `404`；未认证调用 `device-register` 与 `binding-ensure` 均明确返回 `401`。Cloud shared domain 将 HTML 响应的 `Content-Type` 改写为 `text/plain`，属于已知 Custom Domain 风险，不能把 HTML hosting 冒烟写成可渲染性通过。
- 本批只证明 Cloud schema/functions 已部署且公开/受保护边界符合预期；没有执行设备注册、绑定、设置写入或 Realtime 数据写入。真实认证双端、弱网/重连/尾部补拉、附件对象权限和生产维护窗口仍是全面生产 V2-only 门禁。
- `supabase/deferred-migrations/20260822102000_enforce_device_sessions.sql` 仍按 runbook 保持未执行：虽然 `device-session-register` 已部署，但尚未完成现有设备升级/重连观察与受控窗口复核，暂不把会立即影响旧客户端的 RLS 收紧当成普通增量 migration。
- 发现并修正本地 `supabase/config.toml` 的 PostgreSQL major version 漂移（15 → 17）；修正后 `supabase db push --dry-run` 报告远端数据库已是最新，且不触发任何重置或写入。

### 2026-09-21 第八十九批：父工具归属补全与历史心跳审计

- 迁移/兼容适配器在处理 `scope=agent` 但缺少 `agent_id` 的 provider 行时，先读取同会话 V2 父工具的 `agent_id/agent_instance_id`；只有不存在明确父工具 owner 时，才继续使用 legacy agent registry 的 parent link 或唯一 role+run window。父工具 owner 是 durable 且唯一的归属证据，不按相邻行或文本猜测。新增回归覆盖“父工具已带 owner、子消息只有 `parent_tool_use_id`”场景；适配器定向测试为 `14 pass / 0 fail / 36 assertions`，改动文件 Biome 与全量 `tsc -b` 通过。
- 对当前 DEV 的 provider-input receipt 做只读分类：`197` 条 agent-scope 且缺少 `agent_id` 的历史源行中，`24` 条是 `-heartbeat-N` 心跳、`25` 条是 `task_progress`，两类均没有对应 durable V2 tool row；其余 request/status 行也只保留为输入 receipt。唯一仍有 durable V2 投影的历史缺 owner 行是 `1` 条嵌套 `message.delta`，其事件已保留 `parent_tool_call_id`，但旧迁移产生的 immutable event 仍没有 owner；新 resolver 会在生产重导时从父工具补齐，当前 DEV 不原地改写事件或伪造归属。
- 因此“心跳/进度被误投影成主 Feed 工具”的当前写入缺口已关闭；该 DEV 历史行的物理修复仍属于生产双次重导/maintenance 窗口，不能用读模型局部 UPDATE 破坏 event/effect 守恒。未能证明的 34 条账本归属继续保持未归属。
- 本轮 DEV 只读维护复核重新生成并验证 `/tmp/eco-v2-final-manifest-20260921-b89.json`：32 个会话、74 条 native facts，`storageMode=v2_only`、`integrity=ok`、`cutoverReady=true`，manifest hash 为 `7263d74f`、facts hash 为 `ecdb13f4`；SQLite 直接核对的 V2 durable 计数与旧表退役状态一致。热重载后再次执行 `cdp:attach → cdp:snap → smoke:cdp-probe → smoke:cdp-center` 通过，脚本全程只读。

### 2026-09-21 第八十八批：V2-only 审计覆盖孤儿 durable stream

- 维护 CLI 的 V2-only `--all` inventory、native manifest、cutover 重开校验和附件修复现在会把所有 `conversation_*_v2` durable 表中的 `conversation_id/thread_id` 并入会话集合，不再只依赖 `threads`。缺少公共 thread 元数据的孤儿 stream、message、effect 或 native fact 会进入审计并触发对应完整性/守恒结论，不能被会话计数漏掉。
- 新增孤儿 V2 stream 回归；迁移 CLI 定向文件 `18 pass / 0 fail / 130 assertions`，`bunx tsc -b --pretty false`、迁移脚本/测试 Biome 和 `git diff --check` 通过。该改动只扩大只读审计覆盖，不修改 DEV 数据。
- 当前全面生产 V2-only 阻断项保持不变：真实 mobile peer 双端往返与尾部补拉、Supabase 弱网/重连、跨设备附件权限、生产双次重导/native manifest、ENOSPC/掉电/响应丢失、Android/iOS 真机长会话和 legacy migration/bridge 观察期仍未闭合。

### 2026-09-21 第八十七批：V2-only 重启跟进队列物化与启动边界

- 复审发现一个真实的重启窗口：V2-only 数据库如果在上一次进程退出后仍残留 `thread_pending_followups`，启动流程此前会先退役旧表，可能跳过跟进项及其图片载荷的物化。现在 V2-only 初始化在同一事务内先执行 legacy follow-up 迁移，再退役 13 张 V1 source table；路径/inline 图片必须先由受管 `PromptImageFileStore` 物化为 `mediaType/contentRef/byteLength`，任何非法或不完整结构、对象不可读或缺少 durable store 都 fail-closed 并保留旧表。
- `ConversationStore`、桌面主进程和维护 CLI 都在 `initialize()` 之前注入同一个受管图片文件存储，避免“初始化后才设置 store”的时序缺口；新增 reopen 回归覆盖“外部重新出现旧 follow-up 表 + path-only 图片”场景，并断言 V2 附件无本地 path、旧表已在成功事务后退役。
- 定向迁移/跟进/SQLite 组合回归 `68 pass / 0 fail / 178 assertions`；完整严格门禁 `5345 pass / 16 skip / 0 fail`（5361 tests、23821 assertions、672 files、3 snapshots）。`bunx tsc -b --pretty false`、`git diff --check`、桌面生产构建均通过；Vite `5077 modules`，main `28.15 MB`，preload `60.1 KB`，仅保留既有 externalization、动态导入和大 chunk warning。移动端 `flutter test --reporter compact` 为 `656 pass / 0 fail`，`flutter analyze` 为 `No issues found`。
- 当前 DEV 只读直接核对仍为 `storageMode=v2_only`、`PRAGMA integrity_check=ok`、32 streams、22948 events/effects、1754 messages、1832 tools、74 native facts，过渡 skeleton/pending plans/follow-ups 均为 0，13 张退役 V1 source table 不存在；维护 CLI `--all --verify-native-manifest` 通过，`cutoverReady=true`、`factsHash=ecdb13f4`。已知 15 条 reconciliation reason 仍显式保留。
- 本批代码热重载后的 DEV CDP 复验通过：`cdp:attach → cdp:snap → smoke:cdp-probe → smoke:cdp-center`；页面 `http://127.0.0.1:5173/`、标题 `Eco Coding`、`window.eco=true`、侧栏/Composer/DOM 可读，console `0 errors / 1 warning`。已认证 Center 连接为 `connected`，活动 binding `1`，能力集含 `approval:decide/events:read/rpc:invoke`，private presence `25`/在线 `3`，settings-sync `10` 域（`dirty=7`、`synced=3`）；全部脚本只读。生产放行结论不变：真实 mobile peer 双端往返/尾部补拉、Supabase 弱网重连、跨设备对象权限、生产双次迁移/native manifest、ENOSPC/掉电/响应丢失、Android/iOS 真机长会话以及 legacy migration/bridge 观察期仍是硬阻断，不能把本地门禁写成生产 V2-only 已完成。
- 质量检查也明确记录：store/migrate/reopen 测试文件的 Biome check 退出码为 0（保留 18 条既有 warning）；`index.ts` 仍有既有 `organizeImports` error 和 `noAssignInExpressions` warning，不属于本批功能门禁，后续需单独清理。

### 2026-09-21 第八十六批：V2-only 跟进队列附件迁移与维护修复闭环

- 复审发现旧 `thread_pending_followups` 在切换时可能携带本地 `path` 或 inline `data`；`switchToV2OnlyStorage()` 现在在同一切换事务内逐行解析并通过受管 `PromptImageFileStore` 物化为 `mediaType/contentRef/byteLength`。附件 JSON 非法、记录无效、对象不可读或缺少 durable store 时直接抛出 `migration_incomplete`，事务回滚并保留旧表，绝不把旧载荷复制进 `conversation_followups_v2`。
- 维护 CLI 的 V2-only inventory 和 `--repair-legacy-attachments` 现在同时扫描/修复 `conversation_followups_v2`；修复先做 SQLite 备份，再在单事务内更新 follow-up JSON，事件重写仍重算 event hash 并重建 read model。维护结果单独报告 `repairedFollowUps`，重复执行保持幂等；native facts 台账不改写。
- 新增切换成功、无 durable store 阻断和 V2-only follow-up 修复回归；迁移 CLI + follow-up store `33 pass / 0 fail / 175 assertions`。此前全量严格门禁在本批代码后复跑为 `5344 pass / 16 skip / 0 fail`（5360 tests、23818 assertions、672 files、3 snapshots），没有新增失败。
- `bunx tsc -b --pretty false`、`git diff --check` 和桌面生产构建通过；Vite `5077 modules`，main `28.15 MB`，preload `60.1 KB`，仅保留既有 node:path externalization、动态导入和大 chunk warning。移动端 `flutter test --reporter compact` 为 `656 pass / 0 fail`，`flutter analyze` 为 `No issues found`。
- DEV 只读维护审计为 `storageMode=v2_only`、`integrity=ok`、`cutoverReady=true`、32 conversations；V2 events/effects `22948/22948`、messages `1754`、tools `1832`、native facts `74`，过渡 skeleton/pending plans/follow-ups 均为 0，13 张退役 V1 source table 全部不存在。审计保留 15 条已知 reconciliation reason（4 类，5 个有外部数据的会话），没有将它们隐藏在 ready 结果中。
- 当前 DEV 通过 `cdp:attach → cdp:snap → smoke:cdp-probe → smoke:cdp-center`：页面 `http://127.0.0.1:5173/`、标题 `Eco Coding`、`window.eco=true`、侧栏/Composer/DOM 可读，console `0 errors / 1 warning`；Center 连接与 settings 为 `connected`，活动 binding `1`，private presence `25`/在线 `3`，settings-sync `10` 域（`dirty=7`、`synced=3`）。脚本只读，不注册设备、不推送设置、不写入对话或凭据。
- 本批闭合的是本地 V2-only follow-up 附件迁移与维护审计缺口，不等于生产放行。真实 mobile peer 的双端往返/尾部补拉、Supabase 弱网重连、跨设备对象权限、生产双次迁移与 native manifest、ENOSPC/掉电/响应丢失、Android/iOS 真机长会话和 legacy migration/bridge 观察期仍是硬阻断。

### 2026-09-21 第八十五批：follow-up/runtime-config V2 durable command 收口

- follow-up 入队、取消、升级、编辑、暂停、更新、排序和 runtime-config 更新的共享 remote registry、桌面 IPC、移动 `DesktopRpc` 现在统一要求 `principalId + clientCommandId + threadId + expectedHistoryRevision`（按命令补充 follow-up/runtime payload）；缺字段不会回落旧形状或匿名执行。
- 新增 `followup.mutate` 与 `runtime-config.mutate` durable command job：请求 hash 冲突、running 重复、过期 history revision、响应丢失重试和进程启动恢复均由 V2 receipt/job/checkpoint 处理；恢复无法证明终态时 fail-closed，返回明确的 outcome-unknown，而不是重复写入或伪造成功。follow-up attachment 在存储和 wire 边界都清除本地 path/inline 载荷。
- 定向命令/协议回归（cancel、follow-up、runtime-config 及共享 registry）在本轮通过；移动端 `_v2CommandEnvelope`、凭据/Head 校验和全量测试保持一致。此批与第八十六批合并复跑的迁移/队列套件为 `33 pass / 0 fail / 175 assertions`。
- 生产放行结论不变：本批只闭合跨端命令契约与本地 durable idempotency；真实 mobile peer、Supabase 弱网/重连与尾部恢复、跨设备附件权限、生产迁移/native manifest、物理故障矩阵、真机性能和 legacy migration/bridge 观察期仍未闭合。

### 2026-09-20 第八十三批：Realtime V2 command envelope 校正

- 发现并修复一个真实跨设备协议缺口：桌面本地 IPC 对 `thread:delete`、计划审批/拒绝、澄清、Bash 审批、历史 retry/rewrite 都要求 `principalId + clientCommandId + thread identity + expectedHistoryRevision`，但共享 `remote-command-registry` 仍把其中部分命令声明成裸 `threadId` 或缺少身份字段；Cloud Realtime EventCenter 会在进入 V2 handler 前拒绝这些合法移动端 envelope。
- 共享 registry 现在与生产 V2 handler 的完整 envelope 对齐：删除、计划、澄清、Bash、retry/rewrite 均强制声明身份、会话/工具目标和版本字段；缺字段的远程请求在协议层明确返回 invalid params，不会落入旧形状或匿名执行。补充 shared validator 覆盖正确 envelope 与缺身份拒绝。
- 回归证据：共享 registry `8 pass / 0 fail / 88 assertions`；EventCenter、Supabase Realtime RPC、IPC 组合 `24 pass / 0 fail / 198 assertions`；`bunx tsc -b --pretty false`、改动文件 Biome error-level、`git diff --check` 均通过。
- 本批只修正了已存在的跨设备 V2 协议契约，不等于真实 mobile peer 已在线；authenticated Supabase 双端往返、尾部补拉、弱网/重连、附件对象权限、生产迁移与真机门禁仍阻断全面生产 V2-only。

### 2026-09-20 第八十四批：协议修复后的全量门禁与认证 Center/CDP 复验

- 第八十三批的共享 remote-command envelope 修复通过完整桌面严格门禁：`5330 pass / 16 skip / 0 fail`（5346 tests、23767 assertions、669 files、3 snapshots）。16 个 skip 仍明确是外部 Supabase、Live/LongCat 或 Codex app-server 依赖；没有新增失败。`bunx tsc -b --pretty false`、改动文件 Biome error-level 与 `git diff --check` 均通过。
- 桌面生产构建通过：Vite `5077 modules`，main `28.13 MB`，preload `60.1 KB`；仅保留已有 node:path externalization、动态导入和大 chunk warning。移动端全量 `flutter test --reporter compact` 为 `656 pass / 0 fail`，`flutter analyze` 为 `No issues found`。
- 现有 DEV 进程执行 `cdp:attach → cdp:snap → smoke:cdp-probe` 通过：页面 `http://127.0.0.1:5173/`、标题 `Eco Coding`、`window.eco=true`、侧栏/Composer/DOM 可读，console `0 errors / 1 warning`，截图 `apps/desktop/.smoke-artifacts/cdp-ui-probe.png`。随后执行 `bun run smoke:cdp-center` 通过（退出码 `0`）：已认证连接 `connected`，活动 binding `1`（含 `events:read`/`rpc:invoke`），private presence `25` 条/在线 `3` 条，settings-sync `10` 个域（`dirty=7`、`synced=3`）；脚本只读，未注册设备、未推送设置、未写入对话或凭据。
- 本批证明的是共享协议契约、桌面/移动本地门禁和当前已认证桌面 Center 读取链路一致；仍没有真实 mobile peer。因此 authenticated 双端 JSON-RPC 往返、移动端尾部补拉、弱网/重连、durable attachment 对象权限、生产双次迁移/native manifest、物理故障/真机长会话和 legacy migration/bridge 观察期仍阻断全面生产 V2-only。

### 2026-09-20 第八十一批：公共 schema 修复、最终门禁复跑与 CDP 只读验收

- V2-only 公共 schema 已补齐 `threads`、`composer_drafts`、`thread_compact_handoff` 的运行时列，并在启动时做幂等增量升级；该升级只触及公共 V2 依赖表，不创建任何 V1 conversation 表。新增的 fresh/reopen 回归覆盖“V2-only 重开时外部重新出现旧 `thread_pending_plans` 表”：pending plan 会迁移到 `conversation_pending_plans_v2`，旧表在同一事务中退役。SQLite cutover/reopen/老 schema 定向回归现为 `34 pass / 0 fail`。
- 关键 V2 store、production-boundary 与 Node SQLite 组合定向复跑为 `97 pass / 0 fail / 300 assertions`，覆盖 pending-plan V2 持久化、13 张退役表清单、公共 schema 增量升级、重开迁移和旧表物理退役。
- 最终严格桌面门禁 `5330 pass / 16 skip / 0 fail`（5346 tests、23759 assertions、669 files、3 snapshots）；16 个 skip 明确是外部 Supabase、Live/LongCat 或 Codex app-server 依赖。`bunx tsc -b --pretty false`、触及文件 Biome error-level 与 `git diff --check` 均通过。公共 schema 修复后的 `bun run build` 通过：Vite 5077 modules，main `28.13 MB`，preload `60.1 KB`；仅保留既有 externalization、动态导入和大 chunk warning。
- 移动端全量复跑 `flutter test --reporter compact` 为 `656 pass / 0 fail`，随后 `flutter analyze` 为 `No issues found`；本批没有用桌面门禁替代移动端证据。
- DEV 重启后重新执行 `cdp:attach → cdp:snap → smoke:cdp-probe`：`http://127.0.0.1:5173/`、标题 `Eco Coding`、`window.eco=true`、Composer/侧栏/DOM 可读，console `0 errors / 1 warning`，探针 PASS。随后只读打开真实历史会话“商品标名飞书同步与异常检测核对界面”，历史用户消息、正文和 Composer 均可读，仍为 `0 errors / 1 warning`；没有发送、编辑或删除数据。
- DEV 只读 preflight/manifest `/tmp/eco-v2-final-manifest-20260920-b80-final-2.json` 与独立 verify 均通过：`storageMode=v2_only`、`integrity=ok`、`cutoverReady=true`、32 conversations、74 native events、`factsHash=ecdb13f4`。聚合的 `feedSkeletons`、旧附件载荷/path/inline bytes、缺失/解析错误和 `nativeUnmatchedEvents` 均为 0；但审计仍保留 15 条已知 reconciliation reason（正文/附件差异、`run.started` 折叠到 attempt、post-cutover runtime without native ledger），分布在 5 个有外部数据的历史会话，未被 `cutoverReady` 掩盖。SQLite 直接复核仍为 32 streams、22948 events、22948 sync effects、1754 messages、1832 tools、74 native facts、过渡 skeleton 0 行、`PRAGMA integrity_check=ok`，V2 meta 为 `conversation_v2_storage_mode=v2_only`；13 张退役 V1 source table 的 `retiredPresent=[]`。
- 本批只证明本地运行时和 DEV 的 V2-only 边界已收紧；全面生产放行仍阻断于 authenticated Supabase Realtime/跨设备绑定与尾部恢复、生产双次重导及真实 native manifest、ENOSPC/掉电/响应丢失、跨设备 durable attachment 权限、Android/iOS 真机长会话/RSS/延迟、历史无证据归属/工具字段以及 legacy migration/bridge 观察期。当前不能把本地 `cutoverReady` 或匿名 Cloud 探针写成生产 V2-only 已完成。

### 2026-09-20 第八十二批：认证 Cloud 只读矩阵固化与 CDP smoke

- 新增 `apps/desktop/scripts/dev-cdp-center-server-smoke.mjs` 和 `bun run smoke:cdp-center`。脚本只通过现有 DEV 会话重新连接并读取 settings、binding、presence、settings-sync，不注册设备、不撤销绑定、不推送设置、不写入对话数据；输出只保留安全元数据，不打印 URL 密钥、access token、refresh token、device secret 或设备 ID。
- 在用户提供的 Supabase Cloud 现有认证会话上实际执行：连接状态 `connected`，refresh token/设备密钥/anon key 均存在；活动 binding `1`，能力为 `approval:decide/events:read/rpc:invoke`；private presence `25` 条、在线 `3` 条（当前在线设备均为 desktop）；settings-sync 读取 `10` 个域（`dirty=7`、`synced=3`）。随后执行 `syncCenterServerConfig('reconcile')` 返回 `needsUserChoice=true`、`settingsPushed=false`、`settingsPulled=false`、`secretsPushed=0`、`secretsPulled=0`、vault `ready`，证明冲突保护不会静默覆盖任一侧。
- 认证 Cloud smoke 退出码为 `0`；脚本已强制检查 settings/设备凭据完整、活动 binding 存在且具备 `events:read`/`rpc:invoke`，并检查在线 presence 与 settings-sync 域。与既有 `supabase-realtime-rpc`/`supabase-center-client` 定向回归合计 `27 pass / 0 fail / 107 assertions`。该证据只覆盖“当前已认证桌面连接、私有 presence、绑定读取和设置冲突保护”；因为没有在线 mobile peer，尚未证明跨设备 JSON-RPC 往返、移动端实时尾部补拉、弱网/重连和对象权限矩阵。
- 全面生产 V2-only 仍不放行：生产双次重导/native manifest、ENOSPC/掉电/响应丢失、跨设备 durable attachment 权限、Supabase 弱网/重连/尾部恢复、Android/iOS 真机长会话/RSS/延迟、历史无证据归属/工具字段和 legacy migration/bridge 观察期仍需在受控窗口完成；本批认证 smoke 不能替代这些门禁。

### 2026-09-20 第八十批：pending-plan V2 物化、退役表全量审计与严格门禁

- 计划审批冻结态已拥有独立的 V2 持久化表 `conversation_pending_plans_v2`；V2-only 运行时的保存、读取、清理、历史重写和命令续接均不再依赖 `thread_pending_plans`。旧表只在 `legacy_compat` 的显式迁移事务中读取，迁移会逐字段校验并在切换后退役；缺少后加可选列的最老旧表结构也会安全映射为 `NULL`，不会因 SQL schema 差异中断切换。
- `conversation-v2-migrate.ts` 的退役表审计已经覆盖全部 13 张 V1 conversation source table（包括 `thread_pending_plans`、follow-up、run、agent、metrics、usage 和 skeleton 表），新增 production-boundary 断言防止维护脚本漏审。定向回归：V2 store `49 pass / 0 fail / 187 assertions`，production-boundary + store `63 pass / 0 fail / 300 assertions`，SQLite cutover/reopen/老 schema `33 pass / 0 fail`，迁移 CLI `17 pass / 0 fail / 126 assertions`。
- 全量严格门禁最终为 `5330 pass / 16 skip / 0 fail`（5346 tests、23759 assertions、669 files、3 snapshots）；16 个 skip 仍是外部 Supabase、Live/LongCat 或 Codex app-server 依赖。第八十一批已补写公共 schema 修复后的 TypeScript、Biome、构建、DEV preflight/manifest 和 CDP 结果。
- 本批只收口本地 pending-plan V2 状态与维护审计覆盖，不把迁移输入误报为生产运行时写面。全面生产 V2-only 仍阻断于 authenticated Supabase Realtime/跨设备绑定与尾部恢复、生产双次重导/native manifest、ENOSPC/掉电/响应丢失、跨设备 durable attachment 权限、Android/iOS 真机长会话/RSS/延迟、历史无证据归属/工具字段以及 legacy migration/bridge 观察期。

### 2026-09-20 第七十九批：计划审批桥接续接确认、全量门禁与 DEV 复核

- 计划审批的 Claude bridge 现在在唤醒 SDK 等待器前绑定 `principalId + clientCommandId`。SDK 收到 approve/deny 后先写入 V2 `plan.bridge_continuation_resumed` checkpoint，再确认续接；只有该确认返回后，主进程才原子清理 pending plan 并完成命令 receipt。绑定丢失、超时或续接确认失败均 fail-closed，命令保持未完成状态；`plan.bridge_resolved` 没有后续续接 checkpoint 时，启动恢复明确返回 `plan_resolution_outcome_unknown`，不自动重放或伪造成功。进程在续接确认前退出仍需用户重试，这个边界已被显式保留。
- 新增 bridge binding/ack、绑定不匹配清理、审批恢复完成/拒绝终态 checkpoint 回归；计划命令/存储/运行时定向组合 `142 pass / 0 fail / 593 assertions`。全量严格门禁 `5326 pass / 16 skip / 0 fail`（5342 tests、23744 assertions、669 files、3 snapshots、0 failures）；16 个 skip 仍是外部 Supabase、Live/LongCat 或 Codex app-server 依赖。
- `bunx tsc -b --pretty false`、触及文件 Biome error-level、`git diff --check` 通过。桌面 `bun run build` 通过：Vite 5077 modules，renderer `activity-log-view` 约 1.21 MB，main `28.12 MB`，preload `60.1 KB`；只保留既有 externalization、动态导入和大 chunk warning。移动端 `flutter test --reporter compact` 为 `656 pass / 0 fail`，`flutter analyze` 为 `No issues found`。
- DEV CDP 重新执行 attach → snapshot → `smoke:cdp-probe`，并只读点击一个真实历史会话：页面 `http://127.0.0.1:5173/`、标题 `Eco Coding`、`window.eco=true`、Composer/历史正文可读，console 均为 `0 errors / 1 warning`，探针 PASS；没有发送或修改消息。Electron `Target.createTarget: Not supported` 仍只是工具层 warning。
- 当前 DEV 只读 preflight `/tmp/eco-v2-final-manifest-20260920-b79.json`：`storageMode=v2_only`、`integrity=ok`、`cutoverReady=true`、32 conversations、74 native events、manifest hash `c1c4818a`；独立 verify `passed`、`factsHash=ecdb13f4`。SQLite 直接复核为 32 streams、22948 events/effects、1754 messages、1832 tools、74 native facts、过渡 skeleton 0 行、`PRAGMA integrity_check=ok`。
- 这批收紧了本地计划命令的“决策已返回但 SDK 尚未确认续接”窗口，但不等于跨进程 SDK replay 已完成。全面生产 V2-only 仍阻断于 authenticated Supabase Realtime/跨设备绑定与尾部恢复、生产双次重导/native manifest、ENOSPC/掉电/响应丢失、跨设备 durable attachment 权限、Android/iOS 真机长会话/RSS/延迟、历史无证据归属/工具字段以及 legacy migration/bridge 观察期。

### 2026-09-20 第七十八批：Supabase Cloud 匿名矩阵与当前工作区最终复跑

- 用户提供的 Supabase Cloud 仅使用匿名公钥做无写入探针：Auth health `200`（GoTrue `v2.197.0`）；`auth-email-confirmed` 与 `html-host-probe` `200`，共享域名返回 `text/plain` 的 HTML；无 session 的 `device-register` `401`；匿名 PostgREST 根入口 `401`（服务端明确要求 `service_role`）；匿名私有 Realtime 加入仍 `401 Unauthorized`。没有创建用户、写入表、注册设备或改变 Cloud 配置，也没有把公钥写入仓库。
- 当前工作区严格桌面门禁重新通过：`5322 pass / 16 skip / 0 fail`（5338 tests、23728 assertions、669 files、3 snapshots）；`bunx tsc -b --pretty false`、触及文件 Biome error-level、`git diff --check` 和计划文档 whitespace 检查均通过。16 个 skip 仍是外部 Supabase、Live/LongCat 或 Codex app-server 依赖。
- CDP 在当前 DEV 进程重新执行 attach/snapshot/probe，并只读打开真实历史会话：页面 `http://127.0.0.1:5173/`、标题 `Eco Coding`、`window.eco=true`、Composer/历史正文可读，console `0 errors / 1 warning`，探针 PASS；没有发送或修改消息。Electron `Target.createTarget: Not supported` 仍是工具层 warning。
- 这批只新增云端可达性和当前工作区复跑证据，不把匿名拒绝边界写成认证同步通过。全面生产 V2-only 仍阻断于 authenticated Realtime/跨设备绑定与尾部恢复、生产双次重导/native manifest、ENOSPC/掉电/响应丢失、跨设备 durable attachment 权限、Android/iOS 真机长会话/RSS/延迟、历史无证据归属/工具字段以及 legacy migration/bridge 观察期。

### 2026-09-20 第七十七批：移除 local stream 第二状态源并完成全量回归

- 生产运行时已删除旧的桌面 local stream overlay 链路：移除 `ThreadLocalStreamUpdate` IPC 载荷、`thread.local_stream_updated` 主进程广播、SDK ingestion 的 `onLocalStreamUpdate` 回调、renderer 的 `local-stream-projection` 内存投影和终态清理逻辑。V2 durable event/effect/read model 现在是唯一 Feed 时钟；SDK 流聚合仍保留 throttle、block identity、工具边界和尾部 flush，但测试直接检查持久 V2 emit，不再维护瞬时 overlay 影子源。
- 新增 production-boundary 断言锁定该边界；静态扫描确认桌面/mobile/scripts source/test 不再引用 local stream overlay、旧 projection/skeleton 文件名或 `ActivityLogView` 的 projection/viewModel fallback。定向生产边界 + SDK stream/ingestion 回归 `58 pass / 0 fail / 195 assertions`；`bunx tsc -b --pretty false`、触及文件 Biome error-level 和 `git diff --check` 通过。
- 全量门禁 `node scripts/test-gate.mjs --strict` 通过：`5322 pass / 16 skip / 0 fail`（5338 tests、23728 assertions、669 files、3 snapshots）。16 个 skip 仍是外部 Supabase、Live/LongCat 或 Codex app-server 依赖；无失败测试。
- 桌面 `bun run build` 通过：Vite 5077 modules，renderer `activity-log-view` 约 1.21 MB，main `28.11 MB`，preload `60.1 KB`；仅保留已有 externalization、动态导入和大 chunk warning。移动端 `flutter test --reporter compact` 为 `656 pass / 0 fail`，`flutter analyze` 为 `No issues found`。
- DEV CDP 重新执行 attach/snapshot/probe，并只读打开一个真实历史会话再返回：页面 `http://127.0.0.1:5173/`、标题 `Eco Coding`、`window.eco=true`、Composer/历史消息可读，console 始终 `0 errors / 1 warning`，探针 PASS；没有发送或修改内容。Electron `Target.createTarget: Not supported` 仍是工具层 warning。
- 当前 DEV 只读 preflight/manifest `/tmp/eco-v2-final-manifest-20260920-b77.json`：`storageMode=v2_only`、`integrity=ok`、`cutoverReady=true`、32 conversations、74 native events、manifest hash `75f4aeec`；独立 verify `passed`、`factsHash=ecdb13f4`。附件旧载荷/path/inline bytes、缺失/解析错误和 `nativeUnmatchedEvents` 均为 0。SQLite 直接复核为 32 streams、22948 events/effects、1754 messages、1832 tools、74 native facts、过渡 skeleton 0 行、`PRAGMA integrity_check=ok`。
- 本批进一步关闭本地生产第二状态源，但不改变外部放行结论：Supabase authenticated matrix、生产双次重导与真实 native manifest、ENOSPC/掉电/响应丢失、跨设备 durable attachment 权限、Android/iOS 真机长会话/RSS/延迟、历史无证据归属/工具字段和 legacy migration/bridge 观察期仍未闭合。

### 2026-09-20 第七十六批：V2-only 最终门禁复跑与 DEV manifest 独立核验

- 第七十五批后的最终复跑全部通过：严格桌面门禁 `5329 pass / 16 skip / 0 fail`（5345 tests、23736 assertions、670 files）；ActivityLogView/V2 merge 定向 `109 pass / 0 fail / 502 assertions`；production-boundary `12 pass / 0 fail / 84 assertions`；仓库级 `bunx tsc -b --pretty false`、桌面构建、触及文件 Biome error-level 和 `git diff --check` 均通过。移动端 `flutter test --reporter compact` 为 `656 pass / 0 fail`，`flutter analyze` 为 `No issues found`。
- DEV 数据库直接只读复核为 `conversation_v2_storage_mode=v2_only`、`PRAGMA integrity_check=ok`；32 streams、22948 events、22948 sync effects、1754 messages、1832 tools、74 native facts，过渡 `conversation_feed_skeletons_v2` 为 0 行。重新生成的 `/tmp/eco-v2-final-manifest-20260920-final.json` 报告 `storageMode=v2_only`、`integrity=ok`、`cutoverReady=true`、32 conversations、74 native events、`nativeManifestHash=f863cd7d`；随后独立 verify `passed`，`factsHash=ecdb13f4`。附件旧载荷/path/inline bytes、缺失/解析错误和 native unmatched 均为 0。
- DEV CDP 末轮 `attach → snapshot → smoke:cdp-probe` 通过：页面/标题/`window.eco=true`/Composer/DOM 可读，console `0 errors / 1 warning`；只读点击真实历史会话并返回后仍为 `0 errors / 1 warning`。这证明当前本地 V2 renderer 入口可用，不把 Electron 工具层 `Target.createTarget: Not supported` warning 或历史会话中已有的 provider HTTP 失败误报为 V2 通过。
- 本批只更新本地可执行证据，不改变生产放行结论：Supabase authenticated matrix、生产双次重导与真实 native manifest、ENOSPC/掉电/响应丢失、跨设备 durable attachment 权限、Android/iOS 真机长会话/RSS/延迟、历史无证据归属/工具字段和 legacy migration/bridge 观察期仍未闭合。

### 2026-09-20 第七十五批：ActivityLogView 生产入口 V2-only 收口

- 桌面 `ActivityLogView` 已移除 `projection` 与 `viewModel` 输入；生产入口只从 `conversationV2` 构建 Feed projection。V2 状态尚未完成 bootstrap 时只显示 prompt/loading，绝不回退到旧 projection。`App.tsx` 的 `LazyActivityLogView` 调用点同步删除旧 projection/viewModel 传参；缺失 V2 状态仍作为可见 bootstrap/recovery 条件处理。
- 纯展示回归改用显式命名的 `ConversationV2ProjectionActivityLogView` surface，保留 V2 read-model DTO 的渲染覆盖，但不再让测试契约把旧 projection 注入生产入口。新增 production-boundary 断言检查入口 props、ActivityLogView 分支和 App 调用点均无旧回退。
- 本轮定向 UI/merge 回归 `109 pass / 0 fail / 502 assertions`；production-boundary `12 pass / 0 fail / 84 assertions`。之后严格桌面门禁 `5329 pass / 16 skip / 0 fail`（5345 tests、23736 assertions、670 files）；桌面构建、`bunx tsc -b`、触及文件 Biome error-level、`git diff --check` 均通过；移动端 `flutter test` 全量通过、`flutter analyze` 为 `No issues found`。
- 本批只收口了本地生产 renderer 的 V2-only 入口，没有把旧迁移/回放/兼容代码误报为删除完成。真实 Supabase authenticated matrix、生产双次重导与 native manifest、物理故障、跨设备附件权限、Android/iOS 真机长会话和旧兼容观察期仍是全面生产放行的阻断项。

### 2026-09-20 第七十四批：V2-only 当前模块边界、Cloud 匿名探针与最终回归

- 生产模块路径已完成一次语义化收口：V2 runtime/presentation 使用 `conversation-v2-*`，维护/回放兼容代码使用 `legacy-feed-replay-*`、`legacy-feed-skeleton-*`。旧的 `thread-run-projection*`、`thread-feed-skeleton*`、`thread-run-turn-feed`、`run-projection-merge` 文件不再存在于桌面 source/test；`scripts/test.mjs` 分组入口已更新。共享 `ThreadRunProjection*` 仍只表示 V2 read-model 展示 DTO，不能据此推断旧投影运行时还在生产加载。
- 严格桌面门禁 `5328 pass / 16 skip / 0 fail`（5344 tests、23721 assertions、670 files）与重命名后的关键定向组合 `439 pass / 0 fail / 7089 assertions` 均通过；运行时 writer/交互命令/V2 remote publisher/迁移 CLI 故障组合另为 `36 pass / 0 fail / 211 assertions`，覆盖 `SQLITE_FULL` 游标守恒、响应丢失 receipt、旧表退役、备份/活动会话/损坏元数据 fail-closed 和附件原子修复。移动端 `flutter test` `656 pass / 0 fail`、`flutter analyze` 无问题；`bunx tsc -b`、触及文件 Biome error-level、`git diff --check`、`bun run build` 均通过。构建仅保留既有 externalization、动态导入和大 chunk warning。
- DEV 重启后 `eco-dev-cdp` attach/snapshot/probe 均通过：页面 `http://127.0.0.1:5173/`、标题 `Eco Coding`、`window.eco=true`、侧栏/Composer/DOM 可读，console `0 errors / 1 warning`，探针 PASS，截图 `apps/desktop/.smoke-artifacts/cdp-ui-probe.png`。随后用本地 Playwright CLI 只读点击一个现有会话，标题、用户消息导航、历史正文和 Composer 均加载，console 仍为 `0 errors / 1 warning`，未发送或修改内容。最终快照的 DEV 状态按钮显示“在线”，这里只证明桌面壳和本地 V2 入口可用，不把它当作认证后的 Cloud V2 同步验收；Electron `Target.createTarget: Not supported` 是工具层 warning。
- 用户提供的 Supabase Cloud 匿名探针结果为：Auth health `200`（GoTrue `v2.197.0`）；`html-host-probe` `200` 且被共享 rewrite 以 `text/plain` 返回；无 session 的 `device-register` `401`；匿名加入私有 Realtime topic 被 `401 Unauthorized` 拒绝；PostgREST 根入口 `401` 且服务端明确要求 `service_role`；Auth settings `200`，`disable_signup=false`、email provider 开启、`mailer_autoconfirm=false`。探针没有写入 Cloud 数据，也没有把 anon key 保存到仓库。
- authenticated Realtime、跨设备 device binding、断线/尾部补拉、对象权限、生产双次重导/manifest、物理故障、真机长会话和 legacy 观察期仍没有验收证据。当前不能宣称全面生产 V2-only；下一步必须在受控维护窗口补齐这些真实环境门禁，而不是以本地合成测试替代。

### 2026-09-20 第七十三批：V2-only 生产启动硬门禁与过渡投影生产移除

- 生产主进程现在以 `freshStorageMode: "v2_only"` 和 `requiredStorageMode: "v2_only"` 启动；已有 `legacy_compat` 数据库在创建任何 V1 公共 schema 前直接抛 `migration_incomplete`，必须先走显式维护迁移，启动路径不再自动兜底或悄悄复活 V1 表。Node SQLite 与 production-boundary 回归覆盖该拒绝边界。
- 主进程已删除旧 thread-feed skeleton/projection/focus IPC 的生产加载、注册、维护和 renderer 上报；`scheduleThreadRunProjectionUpdated` 只保留 V2 durable writer 的兼容调度接口，实际读写来自 V2 events/effects/read model。重试与历史编辑入口删除旧 projection/history fallback，缺失 V2 目标直接 fail-closed。共享 `ThreadRunProjectionSnapshot`/renderer view 仍作为 V2 read model 的展示 DTO，request-span helper 也只接收 V2 runtime sources；退役 V1 IPC、表读写和旧 skeleton 维护均不再进入生产链路。
- 本轮定向生产边界、projection parity、Node SQLite 组合为 `50 pass / 0 fail / 88 assertions`；严格桌面门禁最终为 `5328 pass / 16 skip / 0 fail`（5344 tests、23721 assertions、670 files）。`flutter analyze` 无问题，移动端全量 `656 pass / 0 fail`；桌面 noEmit TypeScript、触及文件 Biome error-level、`git diff --check`、构建均通过。
- 当前 DEV CDP 重新执行 attach → snapshot → probe：页面 `http://127.0.0.1:5173/`、标题 `Eco Coding`、`window.eco=true`、侧栏/Composer/DOM 可读，console `0 errors / 1 warning`，探针 PASS，截图为 `apps/desktop/.smoke-artifacts/cdp-ui-probe.png`。Electron `Target.createTarget: Not supported` 仍只是工具层 warning。
- 最新只读 DEV preflight 使用新 manifest 路径 `/tmp/eco-v2-final-manifest-20260920-b73.json` 成功：`storageMode=v2_only`、SQLite `integrity=ok`、`cutoverReady=true`、32 conversations、74 native manifest events、hash `40d284aa`；附件旧载荷/路径/inline bytes/缺失/解析错误和 `nativeUnmatchedEvents` 均为 0。native reconciliation 仍保留已知审计事实（正文/附件差异、`run.started` 折叠到 attempt、3 条 post-cutover runtime without native ledger），没有被 ready 标记隐藏。
- 本批把生产启动和主进程旧投影读写面收紧为 V2-only，但没有把未执行的外部门禁写成通过：真实 Supabase 弱网/重连/尾部恢复、跨设备对象权限、生产双次重导与 manifest、物理故障矩阵、Android/iOS 真机长会话与 RSS/延迟预算、历史无证据归属/工具字段缺口，以及旧迁移/bridge 兼容观察期仍阻断全面生产放行。

### 2026-09-20 第七十二批：最终本地 V2-only 门禁与真实云端阻断确认

- 严格桌面闸门 `node scripts/test-gate.mjs --strict` 通过：`5326 pass / 16 skip / 0 fail`，共 5342 tests、23710 assertions；跳过项全部是外部 Supabase、Live/Longcat 或 Codex app-server 依赖，没有已知失败清单，也没有新增失败。
- 移动端最终全量 `flutter test` 为 `656 pass / 0 fail`，`flutter analyze` 为 `No issues found`。桌面 `tsc --noEmit -p apps/desktop/tsconfig.json`、触及文件 Biome error-level、共享 remote command `3 pass / 0 fail`、`git diff --check` 和 `bun run build` 均通过；构建仅保留既有大 chunk 提示。
- DEV CDP 最终复验：`cdp:attach`、`cdp:snap`、`smoke:cdp-probe` 均退出 0，页面 `http://127.0.0.1:5173/`、标题 `Eco Coding`、`window.eco=true`、composer 可见、DOM 可读，console `0 errors / 1 warning`；`Target.createTarget: Not supported` 是 Electron Playwright 工具层 warning。
- 当前 DEV 数据库只读 `--all --native-manifest --attachments-root` 复核：`storageMode=v2_only`、SQLite `integrity=ok`、`cutoverReady=true`、32 conversations、74 native manifest events、manifest hash `39ceeea0`；`attachmentLegacyPayloads`、`attachmentPathRefs`、`attachmentInlineBytes`、missing/parse errors、`nativeUnmatchedEvents` 均为 0。报告仍保留 15 条 native reconciliation audit reason（正文/附件差异、`run.started` 折叠到 attempt、3 条 post-cutover runtime without native ledger），这些是审计事实，不被当作零问题放行。
- 本机执行 `supabase status` 失败，原因是 Docker daemon 不可用（未安装/运行 Docker Desktop）。因此真实 Supabase 弱网、断线重连、尾部丢失和跨端认证门禁本批没有执行；16 个 skip 与该外部依赖事实一致，不能用 SQLite 合成或移动 fault injector 代替云端验收。
- 本批完成本地可执行的 V2-only 回归、静态、构建和 UI 门禁；生产全面放行仍明确阻断于真实 Supabase/跨设备对象权限、生产双次重导与 manifest、物理故障矩阵、Android/iOS 真机长会话与 RSS/延迟预算、历史无证据归属及工具字段缺口、旧 projection/bridge/迁移兼容观察期。

### 2026-09-20 第七十一批：V2-only 大 run 写入与分页性能基线、运行时完整性热路径收口

- 发现并修复一个真实的性能缺口：`ConversationV2Store.appendInTransaction()` 原先在每个事件前重放该会话的全部 event/effect 并重算 hash，写入复杂度为 O(n²)。现在运行时显式使用 `appendRuntime()`，热路径只查询事件/effect 最新序号和 epoch；通用维护 `append()` 仍保留深完整性前置，`validateIntegrity()` 仍做全量 replay/hash，未用性能优化掩盖损坏数据。
- 工具摘要的 run 总数和 bootstrap/messages 的 `toolSummaryCounts` 改为 V2 read model 的同事务派生缓存：`conversation_runs_v2.tool_count`、`conversation_tool_calls_v2.run_known`；旧 V2 库打开时只做一次回填，缺失 run 的孤儿工具仍走显式索引回退。新增/重建/重开/孤儿工具回归均通过。
- 新增 `apps/desktop/scripts/conversation-v2-benchmark.ts` 和 `conversation:v2-benchmark` 命令，验证写入、字节预算、bootstrap/messages/tools/sync 分页、游标推进、重开一致性、数据库体积和 RSS。合成 256B 正文基线：1 万事件写入 1.98s（5,044 events/s），5 万事件 9.72s（5,142 events/s），30 万事件 63.66s（4,712 events/s）；30 万事件数据库约 649.5MB、RSS 约 1.66GB，bootstrap/messages/tools/sync 热查询 P95 分别 2.02/1.35/0.67/2.69ms，重开加 bootstrap 61.99ms。另跑 100KB/1MB 正文各 100 事件：bootstrap/messages P95 分别约 2.66/3.58ms、15.34/15.91ms，1MB 场景 RSS 约 789MB。该结果只证明桌面 SQLite 合成基线，尚未替代真实 Supabase、Android/iOS 真机和长会话测量；RSS 峰值仍需设备预算评审。
- 定向 V2 store/runtime/projection `71 pass / 0 fail / 269 assertions`；桌面 noEmit TypeScript、Biome error-level 通过。
- 本批关闭了本地 V2 大 run 写入的 O(n²) 和工具计数扫描缺口，但不改变生产放行结论：生产双次重导/manifest、跨设备对象复制与真实授权、物理故障/弱网/尾部恢复、100KB–1MB 大正文/附件、Android/iOS 真机长会话、历史归属/工具字段缺口、旧 projection/bridge/迁移兼容观察期仍未闭合。

### 2026-09-20 第七十批：V2-only 跨设备附件上下文授权收口

- `prompt-image:read-chunk` 的请求和远程命令契约新增必填 `contextKey`。桌面主进程只在 `thread:<conversationId>` 的 V2 canonical JSON 或 `landing:<workspace>` 的对应 composer draft 中找到同一个合法 `sha256:` 引用时才读取 CAS 对象；V2-only 不从全局引用集合或退役 V1 表放行，缺失 stream、跨会话引用、未知 landing draft 和非法 hash 均 fail-closed。
- `ConversationV2Store.hasPromptImageContentRef()` 按 conversation_id/thread_id 限定扫描事件、消息、follow-up、effect、projection、provider input、command receipt/job/checkpoint 和 native fact；`ConversationStore` 仅在 `legacy_compat` 为旧用户消息/队列提供同样的 scoped 兼容检查。移动端附件 staging 将已有 contextKey 传入 `DesktopRpc.downloadPromptImage`，不再发送无上下文的 contentRef。
- 回归已覆盖：Node SQLite `31 pass / 0 fail`（跨会话、landing draft、缺失 stream）；共享 remote command `3 pass / 0 fail`；移动 `desktop_rpc`/附件 wire `38 pass / 0 fail`；`flutter analyze` 无问题；桌面 noEmit TypeScript、Biome error-level、`git diff --check` 均通过。
- DEV 主进程仍在运行；此前 CDP attach/snapshot/probe 已证明页面、composer、DOM 可读且 console 为 `0 errors / 1 warning`。本批代码只改变远程附件请求契约和主进程授权，不改变 UI 结构；最终全量门禁需再次执行 CDP probe。
- 本批补齐本地 CAS 读链路的上下文授权缺口，但不改变生产放行结论：生产双次重导/manifest、跨设备对象复制与真实授权、物理故障/弱网/尾部恢复、生产大 run 与真机长会话、历史归属/工具字段缺口、旧 projection/bridge/迁移兼容观察期仍未闭合。

### 2026-09-20 第六十九批：V2-only 用户消息流错误分类收口与全量复验

- `listConversationUserMessageRecords` 在 `v2_only` 丢失 `conversation_streams_v2` 时现在抛出统一的 `ConversationV2Error(integrity_failure)`；`legacy_compat` 保留原有兼容错误语义。新增 SQLite 回归覆盖该分类，避免上层把损坏会话误判为普通运行时失败。
- 定向回归：Node SQLite `30 pass / 0 fail`；运行时与生产边界 `38 pass / 0 fail / 189 assertions`。桌面全量（排除 `e2e/**`、低并发）`3800 pass / 3 skip / 0 fail`（3803 tests、18542 assertions、519 files、353.72s）；`tsc --noEmit`、`git diff --check` 通过，Biome 无 error，仍有 17 条既有 warning。
- 移动端 V2 定向套件 `45 pass / 0 fail`，`flutter analyze` 为 `No issues found`；桌面构建通过（Vite 5078 modules、main 28.17 MB、preload 60.28 KB），仅保留既有 externalization、动态导入和大 chunk warning。
- DEV 在当前主进程上重新完成 CDP attach → snapshot → probe：页面 `http://127.0.0.1:5173/`、标题 `Eco Coding`、`window.eco=true`、composer 可见、DOM 可读，探针 PASS，console `0 errors / 1 warning`；截图为 `apps/desktop/.smoke-artifacts/cdp-ui-probe.png`。Electron `Target.createTarget: Not supported` 仍是工具层 warning。
- 本批只收口 V2-only 用户消息流的错误分类并完成全量复验；生产全面放行仍受生产双次重导/manifest、跨设备附件对象复制与授权、真实 ENOSPC/掉电/响应丢失、Supabase 弱网/重连/尾部恢复、生产大 run 与 Android/iOS 真机长会话、历史归属和工具字段缺口、旧 projection/bridge/迁移兼容观察期等硬门槛阻断。

### 2026-09-20 第六十八批：V2-only 缺失 stream 失败闭合与退役表写隔离

- 对所有仍可能被运行时调用的历史/活动/回绑入口做了 V2-only 审查：`listActivityLines`、`listUserMessageRecords`、`getUserMessageRecord`、编辑/rewind 目标、activity/run 回绑、run-event 列表和清理在缺少 `conversation_streams_v2` 时统一抛 `integrity_failure`，不再把损坏或缺失的 stream 伪装成空会话；有效的 V2 空流仍可返回合法空结果。
- 退役 V1 表即使被外部或旧进程重新创建，V2-only 的 `deleteThread`、`completeThreadDeleteCommand`、`commitCompactHandoffAndClearSession`、usage ledger 清理/归因和 history rewrite 也不会对这些表执行写入；新增回归用重建的 `thread_activity`、`thread_usage_ledger_events` 和 `thread_user_messages` 验证它们保持不变。V2-only 重写只更新 V2 表和 append-only 事件，不复活 `thread_subagent_*`、旧 metrics 或其他 V1 source；附件引用扫描也只读 V2 canonical refs，不再读取被重建的 `thread_pending_followups`。
- 定向验证：Node SQLite/store/usage-ledger/production-boundary `45 pass / 0 fail / 94 assertions`；桌面全量（排除 `e2e/**`，`--parallel=2 --max-concurrency=2`）`3800 pass / 3 skip / 0 fail`（3803 tests、18542 assertions、519 files、345.16s）。`tsc --noEmit`、`git diff --check`、构建均通过；构建为 Vite 5078 modules、main 28.17 MB、preload 60.28 KB，仅保留既有 `node:path` externalization、动态导入和大 chunk warning；Biome 无 error，仍有 17 条既有 warning。
- 移动端 V2 同步/cache/session/cross-end golden/字段守恒定向套件 `45 pass / 0 fail`，`flutter analyze` 为 `No issues found`。DEV 重启后按 `eco-dev-cdp` attach → snapshot → probe：页面 `http://127.0.0.1:5173/`、标题 `Eco Coding`、`window.eco=true`、composer 可见、DOM 可读，探针 PASS、截图 `apps/desktop/.smoke-artifacts/cdp-ui-probe.png`；console `0 errors / 1 warning`，唯一 warning 是 DEV Electron 的预期 CSP 提示，attach 的 `Target.createTarget: Not supported` 是工具层 warning。
- DEV 只读 manifest 已重新生成并独立 verify：`storageMode=v2_only`、`integrity=ok`、`cutoverReady=true`、32 conversations、74 native facts、verify `passed`、`factsHash=ecdb13f4`；结构化 inventory 为 `feedSkeletons=0`、`attachmentLegacyPayloads=0`、`attachmentPathRefs=0`、`attachmentInlineBytes=0`、`nativeUnmatchedEvents=0`。直接 SQLite 复核为 `conversation_v2_storage_mode=v2_only`、`PRAGMA integrity_check=ok`、退役 V1 表均不存在、过渡 skeleton 0 行。
- 本批完成的是 V2-only 运行时缺失数据的 fail-closed 和退役表写隔离，不构成生产全面放行。生产维护窗口双次重导/manifest、跨设备附件对象复制与授权、真实 ENOSPC/掉电/响应丢失、Supabase 弱网/重连/尾部恢复、生产大 run 与 Android/iOS 真机长会话、34 条无 parent 证据归属、100 条缺失 tool input、1160 条缺失 output、不可验证工具字段，以及旧 projection/bridge/迁移兼容观察期清理仍是硬门槛。

### 2026-09-20 第六十七批：V2-only 回绑事务边界、旧兼容标记隔离与过渡 projection 清理

- 静态审查和切换后边界回归发现，`rebindClaudeUserMessageRecords` 在已经开启写事务后读取 V2 user-message read model，会触发嵌套 SQLite 事务；现在先在事务外解析权威 V2 记录，再在同一写事务内提交回绑补丁和 legacy-compatible 镜像决策，避免真实 V2-only 运行路径因事务嵌套失败。
- 即使旧适配器在 V2 provider receipt 中留下 `legacyCompat` 元数据，`v2_only` 也不会重新查询或写入已退役的 V1 表；只有 `legacy_compat` 仍允许兼容镜像。新增回归在物理删除 V1 表后注入旧标记，验证 bind/rebind 不抛错、只推进 V2 事件且不重建 V1 表。
- V2-only 的切换和每次重开都在同一写事务中删除 `conversation_feed_skeletons_v2` 过渡缓存；新增回归先注入 stale skeleton，再以 V2-only 重开并断言清零。DEV 重启后该表为 0 行，运行时不再读写这份死 projection。
- 本批定向验证：Node SQLite `29 pass / 0 fail`；store runtime `29 pass / 0 fail / 136 assertions`；production boundary `9 pass / 0 fail / 53 assertions`；migration CLI `17 pass / 0 fail / 126 assertions`。补丁后的桌面全量为 `3799 pass / 3 skip / 0 fail`（3802 tests、18542 assertions、519 files、376.38s）；`tsc --noEmit`、`git diff --check` 和构建均通过，构建为 Vite 5078 modules、main 28.17 MB、preload 60.28 KB，仅保留既有 externalization/chunk-size warning；Biome 仅报告既有 warning，未发现 error。
- DEV 重启后的 CDP attach/snapshot/probe 均通过：页面 `http://127.0.0.1:5173/`、标题 `Eco Coding`、`window.eco=true`、`Eco Dev · 在线`、composer 可见、DOM 可读、console `0 errors / 1 warning`、探针 PASS；attach 的 `Target.createTarget: Not supported` 仍是 Electron 工具层 warning。只读 manifest 重新生成并独立 verify `passed`，`factsHash=ecdb13f4`、32 conversations、74 native facts、`cutoverReady=true`，结构化 inventory 的 `feedSkeletons=0`、`attachmentLegacyPayloads=0`、`attachmentPathRefs=0`、`attachmentInlineBytes=0`；直接 SQLite 复核 `storageMode=v2_only`、`integrity_check=ok`、退役 V1 表 0 张、过渡 skeleton 0 行、canonical message 有 2 行附件但旧 `path/data` 消息载荷 0、待处理 follow-up 0。
- 生产全面 V2-only 的阻断项保持不变：生产维护窗口双次重导/manifest、跨设备附件对象复制与授权、真实 `ENOSPC`/掉电/响应丢失、Supabase 弱网/重连/尾部恢复、生产大 run 与 Android/iOS 真机长会话、34 条无 parent 证据归属、100 条缺失 tool input、1160 条缺失 output、不可验证工具字段，以及旧 projection/bridge/迁移兼容观察期清理。

### 2026-09-20 第六十六批：V2-only canonical 附件旧载荷备份重建与 DEV 门禁闭合

- 为已经处于 `v2_only`、但切换前 append-only canonical event/message 仍含旧附件载荷的数据库新增显式维护命令：`--all --apply --repair-legacy-attachments --backup ... --attachments-root ...`。命令只接受 `v2_only`、无活跃 thread、显式附件根目录和不存在的备份目标；先 `VACUUM INTO`，再在一个 `BEGIN IMMEDIATE` 中把 path/裸 inline data 物化为 CAS `contentRef`，重算 event hash，并从事件重建 V2 read models；任何残留旧载荷、完整性错误或重放失败都会回滚。不得用 ad-hoc SQL 覆盖事件。
- `ConversationV2Store.rebuildReadModelsInCurrentTransaction` 让附件 payload 重写和派生表重建保持同一事务；不可变 `conversation_native_facts_v2` 原文、hash、facts manifest 不被修改。新增 CLI 回归覆盖备份完整性、message/event 重复计数、CAS 引用、重放后无 `path/data` 和幂等边界。
- 真实 DEV 已执行备份保护修复：`v2_only`、`integrity=ok`、32 conversations，修复 1 个会话、2 个事件、3 个附件；修复前 `attachmentLegacyPayloads=6/pathRefs=2/inlineBytes=47544`，修复后全部为 0。备份 `/tmp/eco-v2-attachment-repair-dev-20260920.sqlite` 独立保留且完整性通过。
- 修复后重新导出并独立 verify manifest：`passed`、32 conversations、74 native facts、`factsHash=ecdb13f4`、`cutoverReady=true`；SQLite 为 32 streams、22948 events/effects、1754 messages、72 runs、1832 tools、27 snapshots、74 native facts、2814 ledger rows，`conversation_followups_v2` 待处理 0，目标退役 V1 表为空，canonical attachment 行逐行扫描无 `path/data`。
- 定向 CLI `17 pass / 0 fail / 126 assertions`；Node SQLite `29 pass / 0 fail`；对象库/运行时组合 `46 pass / 0 fail / 179 assertions`。桌面全量（排除 `e2e/**`，`--parallel=2 --max-concurrency=2`）`3799 pass / 3 skip / 0 fail`（3802 tests、18542 assertions、519 files、351.94s）。
- DEV 重启后 CDP attach/snapshot/probe 通过：页面 `http://127.0.0.1:5173/`、标题 `Eco Coding`、`window.eco=true`、`Eco Dev · 在线`、composer 可见，console `0 errors / 1 warning`，探针 PASS；attach 的 `Target.createTarget: Not supported` 为 Electron 工具层 warning，不是页面错误。
- 本批闭合了 DEV 真实历史附件旧载荷阻塞和其可重复修复路径；生产全面 V2-only 仍需生产维护窗口双次重导/manifest、跨设备附件对象复制与授权、真实 `ENOSPC`/掉电/响应丢失、Supabase 弱网/重连/尾部恢复、生产大 run 与 Android/iOS 真机长会话、34 条无 parent 证据归属、100 条缺失 tool input、1160 条缺失 output、不可验证工具字段，以及旧 projection/bridge/迁移兼容观察期清理。

### 2026-09-19 第六十五批：维护重建附件清洗与 V2-only 就绪门禁

- 修复维护重建的一条真实写入缺口：`reconcileNativeFactsAfterRebuild` 不再把 modified native message 的旧 `path/data` 原样写回 `conversation_events_v2`。图片附件必须在显式附件根目录和受管对象库中重新校验并物化为 `mediaType/contentRef/byteLength`；非图片附件只保留经过验证的 `id/mediaType/byteLength/legacyOpaque` 元数据；缺根目录、非法 bytes、路径越界、文件缺失或 hash 不一致均 fail-closed。不可变 `conversation_native_facts_v2` 仍保留原始 payload 供审计，运行时 canonical 数据不再复用它。
- V2-only inventory 新增 `attachmentLegacyPayloads`，统计 canonical message/event 中仍含本地路径，或 inline data 没有合法 `sha256:` durable reference 的附件。`cutoverReady` 和可恢复迁移均要求该计数为零，避免“V1 表已退役”掩盖 canonical V2 仍含旧载荷。
- 定向迁移 CLI `16 pass / 0 fail / 117 assertions`；store/runtime/production-boundary 组合 `48 pass / 0 fail / 226 assertions`；Node SQLite `29 pass / 0 fail`。桌面 TypeScript、Biome 和 `git diff --check` 通过；全量（排除 `e2e/**`，低并发）`3798 pass / 3 skip / 0 fail`（3801 tests、18533 assertions、519 files、380.81s）。
- 构建通过：Vite 5078 modules、main 28.17 MB、preload 60.28 KB，仅有既有 externalization/chunk-size warning。按 `eco-dev-cdp` 完成 attach、snapshot、probe：页面 `http://127.0.0.1:5173/`、标题 `Eco Coding`、`window.eco=true`、composer 可见、console `0 errors / 1 warning`，探针 PASS，截图为 `apps/desktop/.smoke-artifacts/cdp-ui-probe.png`。
- DEV 最新只读复核仍为 `storageMode=v2_only`、`PRAGMA integrity_check=ok`、32 streams、22948 events/effects、1754 messages、72 runs、1832 tools、27 snapshots、74 native facts、2814 ledger rows，退役 V1 表为空；manifest 独立 verify `passed`，32 conversations、74 native facts、`factsHash=ecdb13f4`，但 `cutoverReady=false`。当前会话 `thr_1789540220642` 的 inventory 报告 `attachmentLegacyPayloads=6`、`attachmentPathRefs=2`、`attachmentInlineBytes=47544`，缺失文件和解析错误为 0；6 是 message/event canonical 行的重复计数，底层直接审计为 1 个 path 和 2 个 inline data。native fact 台账中的 raw payload 是不可变审计证据，不计作运行时清洁。
- 结论：新维护写入已经封口，但 DEV 切换前遗留的 append-only canonical 旧附件行不能用 ad-hoc SQL 覆盖，必须在独立维护窗口按 manifest 做显式重建/重导后再复核 `attachmentLegacyPayloads=0`。在此之前，生产全面 V2-only 不放行；双次生产重导/manifest、附件跨设备对象复制与授权、真实故障矩阵、弱网/尾部恢复、真机性能、历史归属与工具字段缺口、旧 projection/bridge/迁移兼容观察期仍是后续门槛。

### 2026-09-19 第六十四批：生产新库默认 V2-only 与旧库显式迁移边界

- 修复生产入口的默认模式缺口：主进程创建新数据库时显式要求 `freshStorageMode=v2_only`，空库首开直接创建 V2 schema 并持久化 `conversation_v2_storage_mode=v2_only`，不会先生成 `thread_activity`、`thread_run_events`、`thread_user_messages` 等 V1 源表。
- 安全边界保持 fail-closed：如果数据库在打开前已经存在任一 V1 conversation source table，fresh preference 不会强行切换或删除数据，仍停在 `legacy_compat`，必须经过 `conversation-v2-migrate.ts --all --apply --cutover` 的显式维护窗口。新增 Node SQLite 回归覆盖空库 V2-only 和已有旧源表拒绝自动切换。
- 本批定向 Node SQLite `29 pass / 0 fail`；生产边界、runtime writer、store runtime 定向 `47 pass / 0 fail / 225 assertions`；桌面 TypeScript 通过。该改动只改变生产新库初始化边界，不改变迁移输入的兼容策略。
- 改动后的桌面全量（排除 `e2e/**`，`--parallel=2 --max-concurrency=4`）为 `3798 pass / 3 skip / 0 fail`（3801 tests、18524 assertions、519 files、409.07s）；3 个 skip 仍是 live 外部依赖测试。构建和 CDP 复验需在本批完成后再更新。

### 2026-09-19 第六十三批：历史附件迁移物化与最终低并发全量复验

- 修复维护迁移器对历史用户附件的边界：受支持的图片附件在 dry-run 阶段必须能从受管根目录、旧 inline bytes 或已有 content reference 读取并校验，apply 阶段同步写入 content-addressed 对象库，V2 `message.created` 只保留 `mediaType`、`sha256:` reference 和 `byteLength`，不再写入本地路径或原始 bytes；相对路径只允许解析到显式 `--attachments-root` 内，词法越界、符号链接越界、缺失、篡改和 hash 不一致均 fail-closed，inline base64 也必须严格合法。
- 维护 CLI 兼容旧的非图片附件形状（例如 `application/octet-stream`）时，不把它伪装成可调度的提示图片：先在显式附件根目录下验证源文件，再把 V2 历史消息降为带 `legacyOpaque=true` 的 `id/mediaType/byteLength` 元数据，删除 `path/data`；原始 native fact/manifest 仍保留审计和内容 hash，运行时不会把 opaque 元数据当作图片输入。manifest 的附件 hash 同样拒绝 `../` 和 symlink escape。新增回归覆盖图片 CAS 物化、无对象库阻断、opaque 路径清洗、越界/symlink/base64 门禁和 manifest 内容变化门禁。
- 最终桌面全量（排除 `e2e/**`，`--parallel=2 --max-concurrency=4`）为 `3795 pass / 3 skip / 0 fail`（3798 tests、18523 assertions、519 files、383.10s）；真实语料、迁移/manifest/对象库定向回归通过。此前默认高并发出现的 5 个 60 秒真实语料超时在低并发全量中全部消失；另修复 `composer-agent-models` 测试对 worker 全局 i18n 初始化顺序的隐式依赖，并新增附件根目录越界/symlink/base64 回归。桌面 `tsc --noEmit` 通过，Biome 退出 0（仍有既有 warning），`git diff --check` 通过；最新构建仍为 Vite 5078 modules、main 28.17 MB、preload 60.28 KB，仅有既有 externalization/chunk-size warning。
- 重启最新主进程后的 DEV 只读审计：`storageMode=v2_only`、`PRAGMA integrity_check=ok`、32 streams、22948 events/effects、1754 messages、72 runs、1832 tools、27 snapshots、74 native facts、2814 ledger rows；`conversation_followups_v2` 待处理 0 行，目标退役 V1 表无残留。带 `prompt-images` 根目录重新生成并独立 verify 的 native manifest 通过：32 conversations、74 native facts、`factsHash=ecdb13f4`、`cutoverReady=true`；34 条历史 Agent 归属、100 条缺失 tool input、1160 条缺失 output 继续保持未猜测。
- 按 `eco-dev-cdp` attach → snapshot → probe 复验：页面 `http://127.0.0.1:5173/`、标题 `Eco Coding`、`window.eco=true`、composer 可见，snapshot/probe 均退出 0，console `0 errors / 1 warning`，截图为 `apps/desktop/.smoke-artifacts/cdp-ui-probe.png` 和 `apps/desktop/.smoke-artifacts/cdp-ui-final.png`。点击历史会话时 Playwright locator 在 5 秒稳定性等待中超时，未出现页面异常；该工具层限制不计作 UI 通过。
- 本批关闭历史图片迁移的路径/inline 泄漏、旧附件形状误阻断以及维护清单的根目录逃逸，并完成最终低并发全量复验；仍不构成生产全面 V2-only 放行。生产双次全量重导/manifest、云端/跨设备对象复制与授权、真实 `ENOSPC`/掉电/响应丢失、Supabase 弱网/重连/尾部恢复、生产大 run 与 Android/iOS 真机长会话性能、34 条无 parent 证据归属、工具字段缺口，以及旧 projection/bridge、迁移输入和兼容观察期的清理与验证仍需完成。

### 2026-09-19 第六十二批：V2 durable 附件对象引用扫描与宽限期 GC

- 新增 content-addressed 对象 GC：`PromptImageFileStore` 扫描 `prompt-images/objects`，由所有 V2 JSON-bearing 表建立 `sha256:` 引用集合，并合并 composer draft 与仍存在的 legacy follow-up 引用；只删除超过默认 24 小时宽限期、且不在引用集合中的对象。支持 dry-run 结果，引用、近期对象和删除数均可审计；不从本地路径推导引用，也不把预览或路径当作内容身份。
- V2-only 主进程启动后才执行这次 best-effort sweep，legacy-compatible 不执行；对象写入和事件/命令提交之间的竞态由宽限期覆盖。扫描整个 append-only V2 历史，因此被 tombstone 事件引用的对象仍会保留，避免对象清理反过来破坏可重放历史。
- 定向回归：prompt-image 文件存储 `13 pass / 0 fail`（36 assertions），Node SQLite `27 pass / 0 fail`；桌面全量（排除 `e2e/**`）`3789 pass / 3 skip / 0 fail`（3792 tests、18505 assertions、519 files、699.02s）；共享包 `32 pass / 2 skip / 0 fail`（232 assertions）；移动端 `flutter test` `655 pass / 0 fail`、`flutter analyze` `No issues found`。桌面 TypeScript、Biome error-level 检查、构建和 `git diff --check` 均通过；构建为 Vite 5078 modules、main 28.16 MB、preload 60.28 KB，仅保留既有 externalization/chunk-size warning。
- 重启最新主进程后的 DEV 只读审计：`storageMode=v2_only`、`PRAGMA integrity_check=ok`、31 streams、22925 events/effects、1752 messages、70 runs、1832 tools、26 snapshots、74 native facts、2812 ledger rows；`conversation_followups_v2` 待处理 0 行，目标退役 V1 表（包含 `thread_pending_followups`）无残留。原生 manifest 生成后再独立 verify 通过，31 conversations、74 native facts、`factsHash=55c68f4d`、`cutoverReady=true`；34 条历史 Agent 归属因同角色候选歧义继续保持未归属，100 条缺失 tool input、1160 条缺失 output 继续保持未猜测。
- 按 `eco-dev-cdp` attach → snapshot → probe 验证新主进程：attach 建立 session 但保留 Electron `Target.createTarget` 工具层 warning；snapshot/probe 均退出 0，页面 `http://127.0.0.1:5173/`、标题 `Eco Coding`、`window.eco=true`、composer 可见，console `0 errors / 1 warning`，截图 `apps/desktop/.smoke-artifacts/cdp-ui-probe.png`。
- 本批关闭本地 content-addressed 对象的孤儿回收实现缺口，但不构成生产全面 V2-only 放行。生产双次全量重导/manifest、云端/跨设备对象复制与授权、真实 `ENOSPC`/掉电/响应丢失、Supabase 弱网与跨端重连/尾部恢复、生产大 run 和 Android/iOS 真机长会话性能、34 条无 parent 证据归属、工具字段缺口、旧 projection/bridge 的兼容观察期和旧迁移代码清理仍需完成。

### 2026-09-19 第六十一批：follow-up 队列完成 V2-only 物理切换与附件引用链路收口

- 运行中的 follow-up 队列不再写入 `thread_pending_followups`：新增 `conversation_followups_v2`，所有入队、编辑、排序、抢占、投递、重排、重试、取消、删除和 rewind 清理在 `v2_only` 统一走 V2 表。原子切换会先逐字段校验搬迁旧队列，再把旧表纳入退役清单；V2-only 重开不会重建旧表，队列数据可跨重开读取。旧队列表只在 `legacy_compat` 迁移输入阶段存在。
- 图片消息在 V2 事件中只保留可验证的 `sha256:` durable content reference、字节数和有界预览；桌面受管对象库支持哈希校验与最多 64 KiB 的远程分块读取，移动端恢复/重试会按引用读回原始字节。只有本地路径或只有预览的旧附件在 V2 编辑/重试入口显式 `missing_durable_attachment` fail-closed，不把路径或缩略图伪装成内容身份。
- 新增 follow-up cutover/reopen/rewind 回归及对象存储哈希、分块、篡改拒绝、V2 消息去本地路径回归。桌面全量（排除 `e2e/**`）`3787 pass / 3 skip / 0 fail`，`18499 expect()`、`519 files`、`606.83s`；follow-up/Node SQLite 定向 `41 pass / 0 fail / 39 assertions`；共享包 `32 pass / 2 skip / 0 fail`、`232 assertions`；移动端 `flutter test` `655 pass / 0 fail`，`flutter analyze` `No issues found`；桌面 TypeScript、构建和 `git diff --check` 通过。构建为 Vite 5078 modules、main 28.16 MB、preload 60.28 KB，仅有既有 externalization/chunk-size warning。
- 重新启动最新主进程后，DEV 只读审计为 `storageMode=v2_only`、`PRAGMA integrity_check=ok`、31 streams、22925 events/effects、1752 messages、70 runs、1832 tools、26 snapshots、74 native facts、2812 ledger rows；`conversation_followups_v2` 当前 0 个待处理行，退役 V1 表（包含 `thread_pending_followups`）为空。`--all --verify-native-manifest` 在带真实附件根目录下通过，31 conversations、74 native facts、`factsHash=55c68f4d`、`cutoverReady=true`；已有 100 条缺失 tool input、1160 条缺失 output 和 34 条无 parent 证据归属继续保持未猜测。
- 按 `eco-dev-cdp` attach → snapshot → probe 重新验证新主进程：页面 `http://127.0.0.1:5173/`、标题 `Eco Coding`、`window.eco=true`、composer 可见，console `0 errors / 1 warning`，探针 PASS，截图 `apps/desktop/.smoke-artifacts/cdp-ui-probe.png`。
- 本批关闭了 follow-up 队列残留旧表和附件本地路径泄漏两个实现缺口，但不构成生产全面 V2-only 放行。生产双次全量重导/manifest、云端/跨设备对象复制与授权、对象生命周期回收、真实 `ENOSPC`/掉电/响应丢失、Supabase 弱网与跨端重连/尾部恢复、生产大 run 和 Android/iOS 真机长会话性能、34 条历史归属、工具字段缺口及旧迁移/兼容观察期仍需完成。

### 2026-09-19 第六十批：V2-only 重试门禁移除旧 projection 读取

- Codex/ACP 非 rewind 重试的 V2-only 分支现在直接读取 `ConversationV2Store.head()`、V2 用户消息和 V2 工具/详情事实；不再从 `thread_user_messages` 或旧 Feed projection 获取 prompt、history revision 或“本轮是否已有输出”的结论。legacy-compatible 数据库仍保留旧路径，便于迁移观察，但不再被 v2_only 混用。
- 运行时写入用户消息时，为已有 `message.accepted` 记录追加幂等的 `message.history_targeted` 事件；新建 V2 用户消息直接带 `historyTarget`。重试查询要求 target 唯一，按下一条 V2 user message 划界；system error notice 不算进度，assistant/agent、tool 或 file-change detail 会阻断，缺失/歧义身份直接阻断。
- 带图的 V2-only 重试在 durable content reference 尚未具备前显式拒绝，避免把移动端预览误当作原图再次发送。该行为把当前附件缺口暴露给用户与验收，而不是用 V1 表或缩略图兜底。
- 本批定向组合此前为 `97 pass / 0 fail / 343 assertions`；加入历史编辑 revision、preview-only attachment 和切换缓存门禁后，store/runtime/production-boundary 子集为 `84 pass / 0 fail / 372 assertions`，`conversation-store-runtime` 与图片存储回归为 `38 pass / 0 fail / 157 assertions`；桌面 noEmit TypeScript、Biome formatter、`git diff --check` 通过。随后桌面全量（排除 `e2e/**`）为 `3784 pass / 3 skip / 0 fail`（3787 tests、18489 assertions、519 files、664.24s），共享包为 `32 pass / 2 skip / 0 fail`（232 assertions），移动端 `flutter test` 为 `655 pass / 0 fail`、`flutter analyze` 为 `No issues found`，`bun run build` 通过（Vite 5078 modules、main 28.14 MB、preload 60.1 KB）。
- `eco-dev-cdp` 已按 attach → snapshot → probe 复验：页面 `http://127.0.0.1:5173/`、标题 `Eco Coding`、`window.eco=true`、侧边栏 action 1、composer 可见，console `0 errors / 1 warning`，截图写入 `apps/desktop/.smoke-artifacts/cdp-ui-probe.png`。
- DEV 维护只读复验目录为 `/tmp/eco-v2-final-XaOFGd`：preflight/verify 均为 `phase=v2_only`、`storageMode=v2_only`、`integrity=ok`、`cutoverReady=true`、31 conversations、74 native facts、0 blockers，manifest verify `passed`、facts hash `55c68f4d`；SQLite 为 31 streams、22925 events/effects、1752 messages、26 snapshots、1832 tools、2812 ledger rows，退役 V1 表查询为空。已知 100 条缺失 tool input、1160 条缺失 output、34 条无 parent 证据归属仍保持未猜测。
- 历史编辑/rewind 返回的 history revision 已切到 V2 head；V2 只有预览、没有受管原图路径时返回 `missing_durable_attachment` 并 fail-closed，不会把缩略图当作原图发送。该门禁覆盖 Codex/Claude 的 destructive rewrite 入口。
- 本批只收口 V2-only 重试与历史改写的旧读面/附件引用泄漏，不构成生产全面 V2-only 放行。生产双次全量重导/manifest、真实物理故障/响应丢失、Supabase 弱网与跨端重连、附件 durable reference/跨设备权限、真机性能、大 run 负载和旧兼容观察期仍需按前序批次的门槛执行；没有 provider durable identity 的 Claude rewind 继续 fail-closed。

### 2026-09-19 第五十九批：V2-only 过渡 skeleton 读写封口与 post-cutover 运行流审计

- V2-only 的过渡 `conversation_feed_skeletons_v2` 不再是在线写面：`getThreadFeedSkeleton`、`saveThreadFeedSkeleton`、`touchThreadFeedSkeletonSequence`、`deleteThreadFeedSkeleton` 在真实 V2-only 模式都立即返回；V2 Feed 继续由事件/effects 和 V2 projection 提供。Node SQLite 回归覆盖切换后误调用这些入口，确认不会重新写入 skeleton。
- 维护审计现在区分迁移数据与切换后新运行流。新流必须同时有 `desktop:user` receipt、带 source envelope 的 `runtime-input` receipt 和 `desktop:run`/`desktop:run-reconciled` lifecycle，才会记录 `post_cutover_runtime_without_native_ledger` warning 并允许继续审计；任意不满足证据条件的缺失台账仍强制 `native_fact_ledger_missing`、native unmatched 和 `cutoverReady=false`，不会用形状猜测掩盖损坏。
- 本批定向组合为 `94 pass / 0 fail / 331 assertions`，迁移 CLI 为 `15 pass / 0 fail / 105 assertions`；桌面全量（排除 `e2e/**`）为 `3779 pass / 3 skip / 0 fail`（3782 tests、18467 assertions、519 files、566.14s）。`bunx tsc -b --pretty false`、桌面 noEmit TypeScript、Biome（0 errors，17 条既有 warning）和 `git diff --check` 通过；`bun run build` 通过（Vite 5078、main 28.14 MB、preload 60.1 KB）。
- 当前 DEV 只读维护证据为 `/tmp/eco-v2-final-pLlEfd`：preflight `v2_only/v2_only/integrity=ok/cutoverReady=true`，31 conversations、74 native manifest events、0 unmatched、0 missing/parse-error attachments、2 path refs；独立 manifest verify `passed`，`factsHash=55c68f4d`。SQLite 审计为 31 streams、22925 events/effects、1752 messages、74 native facts、26 snapshots、1832 tools、2812 ledger rows，退役 V1 表为空、`PRAGMA integrity_check=ok`。
- 本批推进了实现层 V2-only 封口和维护审计准确性，但总体状态仍为进行中。正式放行前必须完成生产双次全量重导/manifest、真实物理故障与响应丢失、Supabase 弱网/跨端重连/尾部恢复、附件 durable reference 与跨设备权限、生产大 run/Android/iOS 真机长会话、34 条无 parent 证据 Agent 归属、工具字段缺口和旧迁移/兼容观察期；不得把 DEV 通过误报为生产完成。

### 2026-09-19 第五十八批：`run.corrected` 审计事件、CAS 修复命令与迁移重放

- 协议把管理员 run 修正定义为独立的 `run.corrected` 事件；`ConversationV2Store.correctRun()` 以 append-only 事件作为唯一写入口，携带管理员主体、原因、期望旧状态和目标状态，compare-and-swap 防止第二个操作者覆盖已修正终态。事件重复时保持原始 envelope 时间和 event hash，read model rebuild 与在线应用一致；缺少审计字段、旧状态不匹配或 run 不存在直接失败。
- 新增 `conversation:v2-correct-run` CLI，强制 `v2_only`，不提供 V1 fallback；迁移 native-facts manifest 对 `run.corrected` 做原始事件/hash 保留和重放，维护 cutover 后仍可核对管理员、原因、终态与 native ledger。对应 store、CLI、迁移和 cutover 回归均已落地。
- 本批验证为：定向 V2 store/renderer/迁移/CLI `79 pass / 0 fail / 336 assertions`；桌面全量（排除 `e2e/**`）`3778 pass / 3 skip / 0 fail`（3781 tests、18465 assertions、519 files、593.17s）；共享包 `32 pass / 2 skip / 0 fail`（232 assertions）；移动端 `flutter test` `655 pass / 0 fail`、`flutter analyze` `No issues found`；桌面 TypeScript（含 `bunx tsc -b --pretty false`）、脚本/测试 Biome、`git diff --check` 通过。`bun run build` 通过，Vite 5078 modules、main 28.14 MB、preload 60.1 KB，仅有既有 externalization/chunk-size warning。
- continuation 静态扫描仍无 `thread:continue`、`continueThread`、`threadContinue` 命中；第二层旧 projection/compat/迁移符号扫描仍命中生产兼容桥、迁移输入和 DEV smoke，生产边界尚未全部删除。DEV 重开审计为 `v2_only`、31 streams、22925 events/effects、1752 messages、74 native facts、26 snapshots、1832 tool rows、2812 V2 ledger rows，目标退役 V1 表为空，`PRAGMA integrity_check=ok`；100 条缺失 tool input、1160 条缺失 output 和 34 条无 parent 证据归属继续保持为空。CDP attach/snapshot/probe 通过，`window.eco=true`、composer/`Eco Dev · 在线` 可见，console `0 errors / 1 warning`，截图 `apps/desktop/.smoke-artifacts/cdp-ui-probe.png`。
- 本批完成管理员修正事件和维护命令的实现闭环，但不改变总体状态：生产双次全量重导/manifest、真实物理故障和响应丢失、Supabase 弱网与跨端重连/尾部恢复、附件 durable reference/跨设备权限、生产大 run 和 Android/iOS 真机性能、历史无证据 Agent 归属、不可验证工具字段及旧迁移/兼容观察期仍是 V2-only 正式放行阻断项。

### 2026-09-19 第五十七批：工具摘要总数驱动的孤儿 run 追页闭环

- 复审发现 bootstrap 字节预算可能把孤儿 run 的所有工具行裁掉，但仍带有该 run 的 `toolSummaryCounts`；因此 renderer 状态新增严格校验和持久化总数，工具追页 run 集合取 `toolSummaryCounts`、V2 run read model 与已返回工具行 `runId` 的并集。历史页与工具页只按单调最大值合并总数，页内行数超总数、未来 `readSeq` 或 history revision 不一致均直接拒绝。
- 当前验证：renderer 定向 `18 pass / 0 fail / 42 expect()`；桌面标准全量（排除 `e2e/**`）`3774 pass / 3 skip / 0 fail`（3777 tests、18434 assertions、518 files、389.79s）；桌面 TypeScript、构建和 `git diff --check` 通过。构建为 Vite 5078 modules、main 28.13 MB、preload 60.1 KB，仅保留既有 `node:path` externalization/chunk-size warning。移动端 `flutter test` `655 pass`、`flutter analyze` 无问题；共享包 `32 pass / 2 skip / 0 fail`、232 assertions。
- V1 continuation 静态扫描（排除 docs 与 boundary test）仍无 `thread:continue`、`continueThread`、`threadContinue` 命中。CDP DEV attach/snapshot/probe 当前均退出 0，`window.eco=true`、composer、`Eco Dev · 在线` 可见，console `0 errors / 1 warning`，截图为 `apps/desktop/.smoke-artifacts/cdp-ui-probe.png`。
- DEV 只读审计保持 `v2_only`、29 streams、22909 events/effects、1750 messages、74 native facts、V1 退役表为空、`integrity_check=ok`；工具摘要 100 条缺失 input、1160 条缺失 output 和 34 条无 parent 证据 Agent 归属继续保留为空。实现层边界进一步收口，但生产维护窗口双次重导/manifest、真实故障与响应丢失、Supabase 弱网/跨端重连、附件 durable reference/跨设备权限、生产大 run/真机性能、`run.corrected` 管理员事件及旧迁移/兼容观察期仍是正式放行阻断项。

### 2026-09-19 第五十六批：工具分页孤儿 run 覆盖与移动会话状态即时回读

- 桌面 renderer 工具摘要恢复按“V2 run read model 与 bootstrap 工具事实的 runId 并集”追完独立 cursor；迁移/修复留下只有工具事实的孤儿 run 时，剩余工具页仍会进入 Feed。移动 `SessionController.loadTools` 等待 V2 cache 写入后立即刷新 session state，公开 API 返回时 UI 已能读到新页；未来 `readSeq`、history revision 不一致仍 fail-closed。
- 当前全量证据：桌面（排除 `e2e/**`）`3774 pass / 3 skip / 0 fail`，`3777 tests / 18432 expect()`，`518 files`，`392.32s`；renderer/production-boundary/field-conservation/real-corpus parity 定向 `96 pass / 0 fail / 805 assertions`，9 个真实脱敏会话守恒与 cross-end golden 通过。移动 `flutter test` `655 pass`、`flutter analyze` 无问题；桌面 TypeScript、构建和 `git diff --check` 通过，Vite 5078、main 28.13 MB、preload 60.1 KB。
- 静态扫描仍确认生产源码没有 `thread:continue`、`continueThread`、`threadContinue`。DEV CDP attach/snapshot/probe 通过，`window.eco=true`、composer 与 `Eco Dev · 在线` 可见，console 为 0 errors/1 warning，截图 `apps/desktop/.smoke-artifacts/cdp-ui-probe.png`。
- 本批只收口大 run 孤儿工具事实和移动工具页即时回读，不改变正式放行结论。生产双次重导/manifest、真实物理故障/响应丢失、Supabase 弱网与重连、附件 durable reference/权限、生产大 run/真机性能、`run.corrected` 管理员事件、34 条无证据历史 Agent 归属、不可验证工具字段和旧迁移/兼容观察期仍是阻断项。

### 2026-09-19 第五十五批：V2 工具摘要独立分页与旧 continuation 注册表清零

- 共享协议新增 `tools` cursor、`conversation:tools-page` 和 `toolSummaryCounts`；桌面 store/IPC/remote、renderer 恢复及移动 `DesktopRpc → SyncEngine → Cache → SessionController` 已实现按 run 独立分页、opaque cursor、总数/过滤和完整响应字节预算。bootstrap/messages page 在预算不足时优先裁剪可独立回补的工具摘要，桌面启动恢复会追完每个 run 的工具页，移动端把页写入 SQLite 并跨重启读取。
- 远程 command registry 删除 `thread:continue`；桌面 E2E approval spec、DEV CDP upgrade smoke 和生产 helper 全部改用 V2 send。排除文档与边界测试后的静态扫描对 `thread:continue`、`continueThread`、`threadContinue` 无命中，旧 continuation 不再有注册表或 helper fallback。
- 新增大运行工具分页/字节预算、renderer merge、移动真实临时 SQLite、共享 cursor round-trip 及 corpus hydration 守恒回归；定向 corpus/field-conservation/renderer 为 `91 pass / 0 fail / 770 assertions`，桌面标准全量 `3774 pass / 3 skip / 0 fail`（3777 tests、18432 assertions、518 files、434.57s）。移动全量 `flutter test` `655 pass / 0 fail`，`flutter analyze` 无问题；工具页模型、SQLite 守恒和未来读序列/history revision 拒绝回归已通过；共享包 `32 pass / 2 skip / 0 fail`（34 tests、232 assertions）；桌面 TypeScript、`bun run build`、`git diff --check` 均通过。构建为 Vite 5078 modules、main 28.13 MB、preload 60.1 KB，仅保留既有 warning。
- CDP DEV 最终复验 attach/snapshot/probe 均退出 0，页面/标题/`window.eco`/composer/`Eco Dev · 在线` 可读，console `0 errors / 1 warning`，截图 `apps/desktop/.smoke-artifacts/cdp-ui-probe.png`；DEV 只读审计仍为 `v2_only`、29 streams、22909 events/effects、1750 messages、74 native facts、V1 退役表为空、`integrity_check=ok`。
- 本批闭合实现层的工具摘要分页/预算和旧 continuation 注册表缺口，不等于生产放行。生产维护窗口双次重导/manifest、真实物理故障与响应丢失、Supabase 弱网/重连/尾部恢复、附件 durable reference/跨设备权限、生产大 run 真实负载与 Android/iOS 真机长会话、`run.corrected` 管理员事件、34 条无证据 Agent 归属、不可验证工具字段及旧迁移/兼容观察期仍未闭合。

### 2026-09-19 第五十四批：桌面/移动端续写入口彻底切换 V2

- 桌面普通 composer 续写和 Git conflict 自动续写不再调用旧 `thread:continue`；运行中的会话仍使用 follow-up queue，已结束会话统一先更新 runtime config，再调用带稳定 `clientCommandId` 的 `conversation:send-message` V2 durable command。消息编辑/rewind 继续使用带 `expectedHistoryRevision` 的 V2 rewrite command，携带图片附件和 runtime config；V2 发送能力缺失时直接 fail-closed，不再降级到 V1。
- 从桌面 IPC、preload、移动 `DesktopRpc` 和移动 session 移除 `thread:continue`/`continueThread`/`threadContinue` 生产入口。移动端续写要求账号 principal 与启用的 V2 session controller，更新 runtime config 后通过 V2 pending-command/receipt/sync 路径发送；缺少任一条件直接拒绝，待重试命令仍保留在本地 V2 cache。
- 新增生产边界静态回归，扫描桌面 renderer/preload、移动端源码，禁止旧 continuation 入口重新出现；正向断言桌面 helper 必须更新 runtime config、生成稳定 command id 并调用 `conversationV2SendMessage`，移动端必须走 V2 controller；并覆盖现有无旧 `appendThreadRunEvent`、无退役 projection/usage/activity RPC 的门禁。当前专项边界 + IPC 为 `7 pass / 0 fail / 167 assertions`。
- 本批验证：桌面全量 `3771 pass / 3 skip / 0 fail`（3774 tests、18398 expect()、518 files、562.01s）；迁移 CLI 专项 `13 pass / 0 fail / 95 expect()`，其中备份目标不可写用例连续 100 次通过；移动端全量 `653 pass / 0 fail`，V2 sync/desktop RPC 定向 `49 pass`，`flutter analyze` 为 `No issues found`，V2 相关 Dart 格式检查无变更；桌面 TypeScript、`bun run build`、`git diff --check` 通过。构建产物为 Vite 5078 modules、main 28.13 MB、preload 59.84 KB，仅保留既有 `node:path` externalization 与 chunk-size warning。此前暴露的 macOS SQLite WAL 只读断言竞态已改为 `query_only` 写保护句柄，未放宽迁移失败门禁。
- DEV 重开后的只读审计仍为 `v2_only`、29 streams、22909 events/effects、1750 messages、74 native facts、旧 V1 表为空、`PRAGMA integrity_check=ok`；工具摘要仍有 100 条缺失 input、1160 条缺失 output，34 条历史 Agent 归属没有 parent 证据，均保持为空。`eco-dev-cdp` 的 attach/snapshot/probe 均退出 0：`window.eco=true`、composer 可见、`Eco Dev · 在线`、console `0 errors / 1 warning`，截图为 `apps/desktop/.smoke-artifacts/cdp-ui-probe.png`。
- 本批闭合客户端旧 continuation 入口的代码缺口，不构成正式全面 V2-only 放行。生产维护窗口的双次全量重导/manifest、真实 `ENOSPC`/掉电/响应丢失、Supabase 弱网与跨端重连及尾部丢失、附件 durable reference/跨设备分块权限、大 run 工具分页与大小预算、Android/iOS 真机长会话、`run.corrected` 管理员事件、34 条无证据 Agent 归属、不可验证工具字段和旧迁移/兼容观察期仍是阻断项。

### 2026-09-19 第五十三批：G-5 projection extras 字段守恒自动化

- 将 `ConversationV2ProjectionExtras` 的六个边界字段（`requestSpans`、`billing`、`ledgerEvents`、`context`、`subagentTimings`、`subagentMetrics`）纳入自动 G-5 inventory；测试直接解析共享 IPC 接口，新增字段若没有同步进入守恒清单会失败。
- 新增 V2 projection snapshot 的完整 round-trip 回归：覆盖 request span 的 timing/provider token 字段、billing、context、subagent timing/metrics，写入后重开仍逐字段相等；`ConversationStore` 边界同时验证 mutable extras 从 V2 snapshot 暴露，不触发 legacy hydration。字段守恒文件当前 `18 pass / 0 fail / 580 expect()`。
- 本轮移动端 V2 同步故障回放为 `15 pass / 0 fail`（其中包含 100 个确定性 loss/duplicate/delay/reorder 种子）；桌面全量为 `3770 pass / 3 skip / 0 fail`（3773 tests、18388 expect()、518 files、561.03s），生产边界/字段守恒/run reconcile 三文件为 `34 pass / 0 fail / 641 expect()`。
- `bunx tsc --noEmit -p apps/desktop/tsconfig.json`、新增字段守恒测试 Biome、`git diff --check` 和 `bun run build` 均通过；构建只保留既有 `node:path` externalization 与 chunk-size warning。
- 本批只补齐 G-5 的 projection extras 自动守恒证据，不把单元/临时库通过误报为生产放行。生产维护窗口双次重导/manifest、真实 `ENOSPC`/掉电/响应丢失矩阵、Supabase 弱网与跨端重连、真机长会话性能、34 条无证据 Agent 归属、不可验证工具字段和旧迁移/兼容代码观察期仍是剩余门槛。

### 2026-09-19 第五十批：历史账本 parent-tool identity 只做可证明归因

- `ConversationV2Store.reconcileUsageLedgerAgentAttribution` 现在同时识别账本 `parent_tool_use_id` 与 V2 agent registry 的 `parent_tool_call_id`；只有 parent tool、run 和 role 都唯一匹配时才写入 `agent_id`，否则继续保留未归属，绝不按顺序或角色猜测。新增两个同角色 Agent 的 parent-tool 回归：usage-ledger 文件 `6 pass / 0 fail / 41 expect()`，V2 store/迁移/runtime 定向 `83 pass / 0 fail / 343 expect()`。
- 最终桌面标准全量 `bun test test --timeout 60000 '--path-ignore-patterns=e2e/**'` 为 `3763 pass / 3 skip / 0 fail`（3766 tests、18371 expect()、518 files、386.85s）；桌面 TypeScript、error-level Biome、`bun run build` 和 `git diff --check` 均通过，构建只保留既有 chunk-size warning。
- DEV 重启启动维护仍扫描 34 条缺失归属；这 34 条现存历史行的 `parent_tool_use_id` 全部为空，因此没有可证明的 parent link，继续保持未归属（pi/proxy × coder/explore 分布为 8/8/9/9）。审计为 `conversation_v2_storage_mode=v2_only`、29 streams、22909 events、22909 sync effects、1750 messages（76 user，其中 70 条有 activity target、17 条有 provider target）；退役 V1 表清单为空，`PRAGMA integrity_check=ok`。工具摘要仍有 100 条缺失 input、1160 条缺失 output，因无可验证源证据保持为空。
- `eco-dev-cdp` 最终复验中 `cdp:attach`、`cdp:snap` 和 `smoke:cdp-probe` 均退出 0；页面 `http://127.0.0.1:5173/`、`Eco Coding`、`window.eco=true`、composer 可见，状态为 `Eco Dev · 在线`，console 为 `0 errors / 1 warning`，截图写入 `apps/desktop/.smoke-artifacts/cdp-ui-probe.png`。
- 本批只闭合“存在 parent-tool 证据时如何安全补偿归因”的实现与回归，不构成正式全面 V2-only 放行。生产维护窗口与双次全量重导、真实 `ENOSPC`/掉电/响应丢失矩阵、Supabase 弱网与跨端重连、真机长会话性能、34 条无证据历史归属、不可验证工具字段和旧迁移/兼容代码观察期仍是剩余门槛。

### 2026-09-19 第五十一批：V2-only native-facts 审计不再误报维护 patch

本批维护窗口操作已固化为 [`conversation-v2-maintenance-runbook.md`](./conversation-v2-maintenance-runbook.md)：停写确认、只读 manifest、独立 verify、备份/全量重导/原子切换、切换后双审计、SQLite 与 CDP 验证、回滚边界和证据归档均有可复制命令；native unmatched、附件内容 hash、command state、旧表残留或活跃 thread 任一失败即停止，DEV 证据不能直接复制为生产结论。

- 按 runbook 的只读路径在当前 DEV 库重跑：preflight、独立 verify、切换后 audit、旧表/SQLite 查询均通过；`v2_only`、`cutoverReady=true`、29 conversations、74 native facts、facts hash `70540380`、`integrity=ok`、29 streams/22909 events/22909 effects/1750 messages，证据目录为 `/tmp/eco-v2-runbook-check-9LXanN`。本次没有执行 `--apply --cutover`，没有改写 DEV 数据库。

- `conversation-v2-migrate.ts --all` 在 `v2_only` 模式下不再拿已退役的 V1 源表重新分类 live maintenance patch；inventory 改用不可变 `conversation_native_facts_v2` 台账中已经验证过的 disposition。这样合法的 `message.finalized` maintenance patch 不会被误报为 `unsupported_native_type`；如果 V2-only 库缺少 native-facts 台账，仍保留原有 fail-closed 的未匹配结果，不用空源掩盖缺口。路径附件没有提供 `--attachments-root` 时，`cutoverReady` 也会明确为 false。
- 新增切换后审计回归：modified native fact 在 V2-only 重开后仍报告 `1 modified / 0 unmatched`，manifest event count 为 1；另新增 native-facts 台账缺失时 `cutoverReady=false` 的回归。迁移 CLI 全量 `13 pass / 0 fail / 95 expect()`；V2 store/迁移/runtime/production-boundary 定向组合 `87 pass / 0 fail / 391 expect()`。
- 桌面标准全量 `bun test test --timeout 60000 '--path-ignore-patterns=e2e/**'` 为 `3764 pass / 3 skip / 0 fail`（3767 tests、18375 expect()、518 files、402.69s）；迁移脚本与回归文件 error-level Biome、桌面 TypeScript 均通过。
- `bun run build` 通过，仅保留既有 chunk-size、`node:path` externalization warning；`packages/shared` 为 `31 pass / 2 skip / 0 fail`、231 assertions 且 `tsc` 通过；移动端 `flutter analyze` 为 `No issues found`，`flutter test` 为 `653 pass`。
- DEV 只读维护审计（带真实附件根目录）为 `v2_only`、29 conversations、integrity=`ok`、74 native facts（62 equivalent、9 collapsed、3 modified、0 unmatched）；manifest verify 独立通过，facts hash 为 `70540380`。V2 数据仍为 29 streams、22909 events/effects、1750 messages；退役 V1 表清单为空。工具摘要 100 条 input、1160 条 output 仍因没有可验证源证据保持为空，34 条历史 Agent 归属仍未猜测补齐。
- `eco-dev-cdp` 的 `cdp:attach`、`cdp:snap`、`smoke:cdp-probe` 已复验退出 0；页面在线、`window.eco=true`、composer 可见、console `0 errors / 1 warning`，截图为 `apps/desktop/.smoke-artifacts/cdp-ui-probe.png`。
- 本批只修正 V2-only 审计的证据来源和回归门禁，不构成正式全面 V2-only 放行。生产维护窗口与双次全量重导、真实物理故障矩阵、Supabase 弱网/跨端重连、真机长会话性能、34 条无证据历史归属、不可验证工具字段和旧迁移/兼容代码观察期仍是剩余门槛。

### 2026-09-19 第五十二批：兼容期运行账本修复与 Feed 增量 parity 收口

- 兼容期的只读运行账本读取现在有明确边界：当线程没有 V2 stream 时，`legacy_compat` 只读解析 `thread_run_attempts`/`thread_agent_instances`；`v2_only` 仍 fail-closed，不会重建或写回 V1。V2 stream 内的坏 lifecycle metadata 不会被宽松读取，启动维护只能用可验证的 legacy row 修复缺失 `phase`/`retryIndex`，修复后严格 V2 读取继续生效。原始 legacy_compat 备份中发现 39 条坏 V2 lifecycle row，在独立副本上显式 reconcile 后修复 39 条；再次 reconcile 为 0，说明过程幂等。
- 真实 mixed legacy 副本的 Feed parity 在修复前会因缺少 V2 stream 或坏 lifecycle metadata 直接失败；完成显式 reconciliation 后，29 个线程、58 次回放在不跳过孤儿线程的情况下 `mismatched=0`、`empty feeds=0`。这是兼容期 repair 的证据，不把损坏数据悄悄降级成空结果。
- 修复 V2 迁移数据中 provider row 的 durable sequence 晚于用户 prompt observedAt 时的 skeleton 分段规则：所有 item 统一按 durable boundary 归属；兼容回放的 seed prefix 保留 candidate final，等迟到的 user boundary 到达后再切段。Feed skeleton rules version 升至 3，旧持久化 skeleton 会重建。当前 DEV 数据库独立 SQLite backup 的 29 个线程、58 次回放已复验 `mismatched=0`、`empty feeds=0`、`detector hits=0`；skeleton patch 定向回归 `199 pass / 0 fail / 6508 expect()`，run projection `13 pass / 0 fail / 47 expect()`。
- Recovery gate 现在也拒绝“没有 V2 stream 且没有任何 legacy thread 记录”的未知 conversation id；不会把空的兼容 fallback 当成健康结果。修复后的桌面全量为 `3767 pass / 3 skip / 0 fail`（3770 tests、18384 expect()、518 files、656.68s）；迁移 CLI `13 pass / 0 fail / 95 expect()`，`bun run build`、TypeScript、`git diff --check` 均通过，构建仅保留既有 chunk-size 与 `node:path` externalization warning。
- 本批闭合兼容期账本 repair 和 DEV 真数据 Feed parity 的当前缺口，但不构成正式全面 V2-only 放行。生产维护窗口的双次全量重导/manifest、command state 与 checkpoint 守恒、真实 `ENOSPC`/掉电/响应丢失、Supabase 弱网与跨端重连、真机长会话性能、34 条无证据 Agent 归属、不可验证工具字段和旧兼容代码观察期仍是剩余门槛。

### 2026-09-19 第四十六批：移动端 V2 失败请求 retry UI 接通

- 移动端 V2 session 现在保留 cache 的 `historyRevision`，projection 将它与稳定的 V2 user message identity 传到 Feed；`api.error` 在 reconnect phase 之前映射为可操作的 error 条目，避免失败请求被降级成不可点击的状态行。`ActivityFeed` 增加 retry action 和执行中/失败反馈。
- ACP/Codex 的非 rewind 失败请求已接到现有幂等 `thread:retry-from-message` V2 command：页面从失败行前的 user prompt 取出文本、图片标志和 expected revision，生成稳定 `clientCommandId`，调用 RPC 后重新接受 V2 session。没有伪造旧 activity line 或重新引入 V1 写面。
- 新增 projection 与 widget 回归，覆盖失败行的 request/sequence/history revision、稳定 retry identity、按钮回调和执行反馈；`dart format --set-exit-if-changed` 退出 0，`flutter analyze` 为 `No issues found`，全量 `flutter test` 为 `651 pass / 0 fail`。
- 本批只关闭 ACP/Codex 非 rewind 的移动端 retry UI 调用点。Claude rewind 仍未接通：V2 message 当前没有可验证的持久 legacy activity-line identity，不能用猜测的行号调用 destructive rewind；需先补 durable identity 与对应故障恢复证据。
- DEV 复验继续为 `conversation_v2_storage_mode=v2_only`，旧表清单为空、`PRAGMA integrity_check=ok`；V2 为 29 streams、22909 events/effects、26 snapshots、74 native facts、2812 ledger rows，accounting/token-cost blocking failures 为 0，历史 Agent attribution warning 仍为 6 会话/69 事件。`eco-dev-cdp` attach/snapshot 后真实会话 Feed、billing `$0.2400`、Context 33% 可读，console 为 0 errors / 1 CSP warning；强断言与存储审计退出 0。
- 本批不构成正式全面 V2-only 放行。生产维护窗口与双次全量重导、Claude retry、真实物理 `ENOSPC`/掉电/响应丢失矩阵、Supabase 弱网与跨端重连、真机长会话性能、历史 Agent 归属补偿策略和旧迁移/兼容代码观察期仍是剩余门槛。

### 2026-09-19 第四十七批：历史 Agent attribution 唯一匹配修复与歧义保留

- 迁移器现在在 provider rows 前先追加 `agent.created` source facts；legacy `scope=agent/both` rows with empty `agent_id` can resolve by the parent tool or role plus run window from the replayable registry. `conversation-v2-legacy-migration.test.ts` 为 `10 pass / 0 fail / 54 expect()`。
- V2-only 启动维护会扫描 ledger rows missing `agent_id`，只修复唯一 `(run_attempt_id, role)` 匹配；多个同角色 Agent 的候选保留未归属，不猜测、不追加伪造 V2 event。usage-ledger 与 migration 定向组合为 `16 pass / 0 fail / 92 expect()`；桌面全量 `bun test test --timeout 60000 --path-ignore-patterns=e2e/**` 为 `3759 pass / 3 skip / 0 fail`（3762 tests、18353 expect()、400.00s）。桌面 TypeScript、error-level Biome、`bun run build` 与 `git diff --check` 均通过；构建仅保留既有 chunk-size 与 node:path externalization warning。
- DEV 重启实际执行 attribution maintenance：扫描 69 条缺失归属行，35 条唯一归属已修复，34 条因两个同角色 Agent 保持未归属；审计从 6 个会话/69 条 warning 收敛为 2 个会话/34 条 warning。当前 storage mode 仍为 `v2_only`，29 streams、22909 events/effects、26 snapshots、74 native facts、2812 ledger rows，accounting/token-cost blocking failures 为 0。
- DEV 通过 `eco-dev-cdp` 重新 attach/snapshot 与 `smoke:cdp-probe`：页面 `http://127.0.0.1:5173/`、`window.eco` 可用、composer 可见、console `0 errors / 1 warning`，截图写入 `.smoke-artifacts/cdp-ui-probe.png`。
- 本批关闭的是可证明历史归属的补偿缺口，不覆盖两个仍有同角色候选的歧义会话。Claude mobile retry、生产故障/维护/网络/性能/兼容观察期仍未闭合，因此不构成正式全面 V2-only 放行。

### 2026-09-19 第四十八批：legacy 工具摘要以 `tool.updated` 追加回填

- 迁移重跑现在会识别已完成但由旧适配器产生的稀疏工具读模型：当仍可读取的 legacy source 能证明 `input` 或 `output` 时，追加稳定 source key 的 V2 `tool.updated`，只覆盖缺失字段；不改写旧事件、不把 V1 表带回 V2-only 在线读写。运行时模式不会执行这条维护分支。
- 新增回归模拟“旧 V2 行 `input_json` 已丢失但源事件还在”，验证重跑只追加一条 `tool.updated`、字段恢复、再次重跑幂等；迁移专项 `11 pass / 0 fail / 59 expect()`，迁移+store 组合 `52 pass / 0 fail / 200 expect()`。桌面全量 `bun test test --timeout 60000 --path-ignore-patterns=e2e/**` 为 `3760 pass / 3 skip / 0 fail`（3763 tests、18358 expect()、400.84s）；TypeScript、error-level Biome、`bun run build` 和 `git diff --check` 均通过。
- 当前 DEV 已进入 `v2_only` 且 legacy 表已物理退役，所以无法再从 DEV 旧表执行这次维护回填；SQLite 审计仍为 29 streams、22909 events/effects、26 snapshots、74 native facts、2812 ledger rows、`integrity_check=ok`，当前遗留工具行仍有 100 条缺失 `input`、1160 条缺失 `output`。这组缺失没有可验证源证据，继续保留并列为生产维护窗口重导前的核对项，不用猜测填充。
- `eco-dev-cdp` attach/snapshot 与 `smoke:cdp-probe` 仍通过：`window.eco` 和 composer 可用，console `0 errors / 1 warning`。本批只闭合“源仍在时如何安全追加摘要”的实现与回归，不构成正式全面 V2-only 放行；生产双次全量重导、真实故障/弱网/真机性能、Claude retry、歧义 Agent 归属和兼容观察期仍未闭合。

### 2026-09-19 第四十九批：V2 message 固化历史身份并接通 Claude 安全 retry

- 共享 `ConversationMessage` 与 `conversation_messages_v2` 现在持久化受冲突拒绝保护的 `historyTarget`（`activityLineId`，可选 provider `userMessageId`）。桌面 provider event、late provider patch、迁移回填和移动端缓存只接受能匹配 V2 user message 的直接身份；同一会话内的 prompt 文本只在唯一候选时回填，歧义或缺失继续留空，不生成猜测的 `sdk:`/legacy ID。新增 `message.history_targeted` 事件与 `message.history_target` effect，支持 provider 身份晚到、重放和跨端同步。
- 移动端 schema 升至 11，Feed 传递 `rewindTarget`；Claude 只有在所有用户消息都具备完整 `activityLineId + userMessageId` 时才显示 destructive retry，并通过稳定 command ID、expected revision 调用持久化 `thread:rewrite-from-message`。ACP/Codex 保持 V2 幂等的非 rewind `thread:retry-from-message`。桌面 V2-only native path 不再为缺失 provider identity 合成标识。
- 定向桌面 V2 store/迁移/runtime 为 `83 pass / 0 fail / 343 expect()`，字段守恒为 `15 pass / 0 fail / 576 expect()`；桌面全量 `3763 pass / 3 skip / 0 fail`（3766 tests、18368 expect()、518 files、386.69s）；移动端全量 `653 pass / 0 fail`。共享/桌面 TypeScript、error-level Biome、Dart format、`flutter analyze`、`bun run build` 和 `git diff --check` 均通过；构建仅保留既有 chunk-size 等 warning。
- DEV 重启审计：`conversation_v2_storage_mode=v2_only`；29 streams、22909 events、22909 sync effects；V2 messages 共 1750 条（user 76 条，其中 70 条有 activity target、17 条有 provider target）；V1 退役表在 `sqlite_master` 中为空；`PRAGMA integrity_check=ok`。尚有 34 条历史 Agent attribution 歧义和无法从现存源证明的工具摘要字段，均保留为空，不用猜测填充。
- `eco-dev-cdp` 重启复验中，`cdp:attach` 创建了 default session 但 Playwright/Electron 报告 `Target.createTarget: Not supported`；沿该 session 的 `cdp:snap` 与 `smoke:cdp-probe` 均通过。页面 `http://127.0.0.1:5173/`、`Eco Coding`、`window.eco=true`、sidebar action 1、composer 可见，等待重连后显示 `Eco Dev · 在线`，console `0 errors / 1 warning`，截图写入 `apps/desktop/.smoke-artifacts/cdp-ui-probe.png`。该 attach 工具兼容错误不影响已建立 session 的页面读取，但仍是工具层待清理项。
- 本批闭合 V2 message 身份传播与 Claude 安全 retry 的客户端链路，但不构成正式全面 V2-only 放行。生产维护窗口与双次全量重导、真实 `ENOSPC`/掉电/响应丢失矩阵、Supabase 弱网与跨端重连、真机长会话性能、34 条历史归属歧义、不可验证工具字段和旧迁移/兼容代码观察期仍是剩余门槛。

### 2026-09-19 第四十五批：V2-only 停止过渡 Feed skeleton 维护

- `maintainThreadFeedSkeletonFromEvent` 与 `scheduleThreadRunProjectionUpdated` 现在在 `v2_only` 模式立即返回；原生 V2 事件不再重建或写入过渡 `conversation_feed_skeletons_v2`/旧 projection cache。skeleton 只保留给 `legacy_compat`、迁移和显式回放路径，V2 renderer projection 成为唯一在线 Feed 读模型。
- 新增生产边界回归，覆盖两个主进程入口及 usage ledger 边界，定向结果为 `8 pass / 0 fail / 49 assertions`；桌面 TypeScript `bunx tsc --noEmit -p apps/desktop/tsconfig.json` 退出 0，`git diff --check` 与新增测试 Biome 检查通过。主进程全文件仍有历史 warning，未把 warning 伪报成 clean。
- DEV 重启后继续为 `conversation_v2_storage_mode=v2_only`，退役表为空、`PRAGMA integrity_check=ok`；V2 计数为 29 streams、22909 events/effects、26 snapshots、74 native facts、2812 ledger rows，accounting/token-cost blocking failures 为 0，历史 Agent attribution warning 保留为 6 会话/69 事件。按 `eco-dev-cdp` attach/snapshot 后，真实会话 Feed、billing `$0.2400`、Context 33% 可读，console 为 0 errors / 1 开发环境 CSP warning；V2 强断言通过。
- 本批关闭第二个过渡 Feed 读模型在 V2-only 运行时继续被维护的缺口，不等同于正式全面 V2-only 放行。生产维护窗口与双次全量重导、真实物理 `ENOSPC`/掉电/响应丢失矩阵、Supabase 弱网与跨端重连、真机长会话性能、历史 Agent 归属补偿策略和旧迁移/兼容代码观察期仍是剩余门槛。

### 2026-09-19 第四十四批：V2-only 账务读面拒绝重建的 V1 ledger 表

- 收紧 `ConversationStore.listUsageLedgerEvents(threadId)`：只要 V2 stream 存在且 storage mode 为 `v2_only`，即使外部或旧版本重新创建了 `thread_usage_ledger_events`，在线读面也只返回 `conversation_usage_ledger_events_v2`；旧表只允许在启动维护事务中一次性导入并退役，不能重新成为账务权威。新增回归先在当前进程人为重建旧表并验证读面不混入，随后重开验证启动维护仍会导入并物理退役残留表。
- 本轮定向 usage-ledger/V2 projection/production boundary 组合为 `18 pass / 0 fail / 85 assertions`（其中 usage-ledger `5 pass / 0 fail / 35 assertions`）；Node SQLite `31 pass / 0 fail`，桌面标准全量 `3756 pass / 3 skip / 0 fail`（3759 tests、18344 assertions、401.70s），TypeScript、Biome、构建和 `git diff --check` 均通过。移动端 `flutter analyze` 为 `No issues found`，`flutter test` 为 `649 pass / 0 fail`。
- 审查记录：第一次并发启动桌面全量时，迁移 CLI 曾出现一次 SQLite `SQLITE_CANTOPEN`；未修改测试去掩盖，迁移 CLI 专项复跑 `12 pass / 0 fail / 91 assertions`，随后第二次标准全量完整通过。生产边界与 usage-ledger 单独复跑为 `7 pass / 0 fail / 45 assertions`。
- DEV 重启后仍为 `conversation_v2_storage_mode=v2_only`，退役旧表清单为空，`PRAGMA integrity_check=ok`；V2 计数为 29 streams、22909 events/effects、26 snapshots、74 native facts、2812 ledger rows，accounting/token-cost blocking failures 为 0，历史 Agent attribution warning 保留为 6 会话/69 事件。按 `eco-dev-cdp` 执行 attach/snapshot，console 为 0 errors / 1 Electron CSP warning；真实会话 Feed、billing `$0.2400`、Context 33% 可读，V2 强断言通过。
- 本批关闭的是“残留/重建 V1 ledger 表被在线读面重新采用”的缺口，不等同于正式全面 V2-only 放行。生产维护窗口与双次全量重导、真实物理 `ENOSPC`/掉电/响应丢失矩阵、Supabase 弱网与跨端重连、真机长会话性能、历史 Agent 归属补偿策略，以及旧迁移/兼容代码观察期仍是剩余门槛。

### 2026-09-19 第四十三批：V2-only 物理 schema 不再重建 run-attempt/feed 旧表

- 从 `ConversationStore.initialize()` 的公共 schema 移除 `thread_run_attempts`，并把它列入 `ConversationV2Store` 的旧表退役清单；它现在只由 `legacy_compat` 初始化，作为显式迁移/reconcile 输入。V2-only 切换会删除历史残留，V2-only 重开不再重建该表。`thread_feed_skeleton` 的迁移建表函数也增加 storage-mode 守卫，避免 V2-only 启动短暂创建旧表。
- Node SQLite 的 V2-only cutover/reopen 回归加入 `thread_run_attempts`，run projection 新增 schema 回归；专项为 `11 pass / 0 fail / 40 assertions`，Node SQLite `31 pass / 0 fail`。桌面标准全量 `3756 pass / 3 skip / 0 fail`（3759 tests、18343 assertions、397.74s），TypeScript、Biome、构建和 `git diff --check` 均通过。
- DEV 重启实证：`conversation_v2_storage_mode=v2_only`，旧表查询为空（含 `thread_run_attempts`），`PRAGMA integrity_check=ok`；V2 仍为 29 streams、22909 events/effects、26 snapshots、74 native facts、2812 ledger rows，accounting/token-cost blocking failures 为 0，历史 Agent attribution warning 仍为 6 会话/69 事件。按 `eco-dev-cdp` 顺序执行 `cdp:attach`、`cdp:snap`，均为 0 console errors / 1 Electron CSP warning；真实会话点击加载后 Feed、billing `$0.2400`、Context 33% 可读，V2 强断言继续通过。
- 本批关闭的是 V2-only 启动 schema 重建缺口，不等同于正式全面 V2-only 放行。真实 `ENOSPC`/掉电与响应丢失矩阵、Supabase 弱网/跨端重连、真机长会话性能、历史 Agent 归属补偿策略、旧迁移/兼容代码观察期和生产维护窗口仍是剩余门槛。

### 2026-09-19 第四十二批：启动全库 run reconcile 收口并做成原子回归

- 补回 `ConversationStore.reconcileConversationV2Runs(threadId)`，并新增 `reconcileAllConversationV2Runs()`。启动阶段扫描仍处于 `legacy_compat` 的已迁移 V2 stream，`conversation:bootstrap` 处理前也按会话复核 `thread_run_attempts`；V2-only、旧表不存在或没有 V2 stream 时不创建任何新事实。
- reconcile 先全量验证 legacy attempt 的 phase/status/retry/metadata，再在一个 `BEGIN IMMEDIATE` 中追加缺失、终态/边界/metadata/`timingQuality` 不一致的生命周期权威事件；失败整批回滚，重复执行保持幂等。新增回归覆盖错误终态纠正、全库汇总、未迁移 stream 不创建和损坏 metadata 零部分写入。
- 定向 run projection 回归 `10 pass / 0 fail / 35 assertions`，`bunx tsc --noEmit -p apps/desktop/tsconfig.json` 通过。该批关闭了计划 8.2 中“按 attempt 回填”已写规格但启动全库入口缺失的实现缺口；生产维护窗口和真实故障/网络/真机门槛不变。

### 2026-09-19 第四十一批：把 V2-only 生产边界固化为回归门禁

- 新增 `apps/desktop/test/conversation-v2-production-boundary.test.ts`：扫描生产主进程，禁止任何旧 `appendThreadRunEvent` 调用点；扫描桌面 preload/renderer 与移动端源码，禁止重新暴露已退役的 projection、usage、subagent、todo、activity 查询和旧 usage/activity RPC。专项门禁 `2 pass / 0 fail / 10 assertions`，纳入桌面标准全量后为 `3754 pass / 3 skip / 0 fail`（3757 tests、18329 assertions、397.78s）；本批 Biome、桌面 TypeScript、`bun run build`、`git diff --check` 均通过。该测试只约束客户端和运行时边界，不误删迁移器、兼容输入适配器或历史对拍代码。
- 本批关闭旧 API/旧写入口的回归保护缺口，不等同于正式全面 V2-only 放行。最新 `cdp:snap`、V2 强断言和数据库审计通过；`cdp:attach` 进程退出码为 0，但 Playwright CLI 额外报告 Electron `Target.createTarget: Not supported`，不影响已建立的 default session 或页面快照，属于测试工具兼容性待清理项。真实物理 `ENOSPC`/掉电、更多损坏源与响应丢失、真实 Supabase 弱网与跨端重连、真机长会话性能、历史 Agent 归属补偿策略、旧迁移/兼容代码观察期和生产维护窗口仍需完成。

### 2026-09-19 第四十批：全生产事务回滚审查与运行时/迁移器 `SQLITE_FULL` 回归

- 本批把上一批在 `ConversationV2Store` 发现的 SQLite 自动回滚问题扩展到全部生产写入边界：`ConversationV2RuntimeWriter`、`ConversationV2LegacyMigrator`、`ConversationStore` 的 27 个事务 catch，以及 `ProviderStore` 的事务 catch 都改为保护性回滚，SQLite 已自动结束事务时保留原始存储错误；迁移失败 checkpoint 自身写不进去时也不再覆盖原始错误。生产源码扫描未发现未保护的 `catch → ROLLBACK` 模式。新增 runtime append 与 legacy migration 两个真实文件库 `PRAGMA max_page_count` 故障注入，均证明 V2 cursor、event/effect 不前进。
- 改动后门禁：事务故障/存储定向组合 `86 pass / 0 fail / 841 assertions`；V2 账单/存储/投影/迁移/字段守恒组合 `121 pass / 0 fail / 1006 assertions`；Node SQLite 三套 gate `31 pass / 0 fail`；桌面标准 `60s` 全量 `3752 pass / 3 skip / 0 fail`（3755 tests、18319 assertions、401.77s），扩展 `120s` 全量同样 `3752 pass / 3 skip / 0 fail`（397.02s）；`bunx tsc --noEmit -p apps/desktop/tsconfig.json`、`bun run build`、Biome、`git diff --check` 通过。移动端 `flutter analyze` 为 `No issues found`，`flutter test` 为 `649 pass / 0 fail`。
- DEV/CDP 复验：`cdp:snap` 和强断言通过，console `0 errors / 1 warning`；`cdp:attach` 退出码为 0，但 Playwright CLI 额外报告 Electron `Target.createTarget: Not supported`，不影响 default session 快照。旧 projection/usage/subagent/todo/activity API 静态审计为 clean，capabilities 为 protocol 2 / event schema 1 / effect 1，bootstrap 为 30 messages、8 runs、29 tools、7 todos，projection 为 139 request spans、147 ledger events。数据库审计仍为 `v2_only`、29 streams、22909 events/effects、26 snapshots、74 native facts、2812 ledger rows，退役表清单为空、`PRAGMA integrity_check=ok`，usage_state 为 0，accounting/token cost blocking failures 为 0；历史 Agent attribution warning 保留为 6 个会话/69 条。
- 本批关闭的是生产事务回滚掩错和 `SQLITE_FULL` 注入覆盖缺口，不等同于正式全面 V2-only 放行。真实物理 `ENOSPC`/掉电、更多损坏源与响应丢失、真实 Supabase 弱网与跨端重连、真机长会话性能、历史 Agent 归属补偿策略，以及旧迁移/兼容代码观察期仍需完成。

### 2026-09-19 第三十九批：SQLite_FULL 故障注入与事务 fail-closed

- 新增临时 SQLite `PRAGMA max_page_count` 故障注入，真实触发 `SQLITE_FULL`。修复 V2 写事务在 SQLite 已自动回滚时再次 `ROLLBACK` 覆盖原始错误的问题；现在保留原始存储错误，事件、effect、head 保持提交前状态。append、usage ledger、stream 初始化、read-model rebuild 等 V2 事务均补上回滚保护，并新增字段守恒回归。
- 改动后 V2 定向组合 `120 pass / 0 fail / 1001 assertions`，Node SQLite 三套 gate `31 pass / 0 fail`；桌面标准 `60s` 全量 `3750 pass / 3 skip / 0 fail`（3753 tests、18309 assertions、401.29s），扩展 `120s` 阈值同样为 `3750 pass / 3 skip / 0 fail`（401.10s）；`bunx tsc --noEmit -p apps/desktop/tsconfig.json`、`bun run build`、Biome、`git diff --check` 通过。移动端 `flutter analyze` 无问题，`flutter test` 为 `649 pass / 0 fail`。
- 改动后的 DEV/CDP attach、snapshot 和强断言均通过：console `0 errors / 1 warning`；旧 projection/usage/subagent/todo/activity API 均不在 `window.eco`，capabilities 为 protocol 2 / event schema 1 / effect 1，bootstrap 为 30 messages、8 runs、29 tools、7 todos，projection 为 139 request spans、147 ledger events 且含 billing/context。数据库审计为 `v2_only`、29 streams、22909 events/effects、26 snapshots、74 native facts、2812 ledger rows，退役表清单为空、`PRAGMA integrity_check=ok`，token/cost blocking failures 为 0；历史 Agent attribution warning 仍为 6 个会话/69 条。
- 本批关闭了 SQLite `SQLITE_FULL` 自动故障注入和事务回滚缺口；这不等同于真实物理盘耗尽。真实 `ENOSPC`/掉电、更多损坏源与响应丢失故障矩阵，真实 Supabase 弱网与跨端重连，真机长会话性能，历史 Agent 归属补偿策略，以及旧迁移/兼容代码观察期仍是剩余门槛。

### 2026-09-19 第三十八批：工具标签确定性归一化与改动后全量复验

- `conversation-v2-store` 将同一 `toolCallId` 的 `MCP: tool` / `MCP tool` / `tool` 占位名升级为后续具体标签（例如 `Bash`）；两个具体标签仍保留首个并记录完整性诊断。renderer reducer 同步接受占位名到具体名的单调升级，仍拒绝具体名之间的变更。真实语料字段守恒新增覆盖，`MCP: tool`/`Bash` 不再触发生产冲突诊断。
- 改动后 V2 定向组合 `119 pass / 0 fail / 996 assertions`，Node SQLite 三套 gate `31 pass / 0 fail`；桌面标准 `60s` 全量 `bun test test --timeout 60000` 为 `3749 pass / 3 skip / 0 fail`（3752 tests、18304 assertions、402.71s），扩展 `120s` 阈值同样为 `3749 pass / 3 skip / 0 fail`（397.80s）；`bunx tsc --noEmit -p apps/desktop/tsconfig.json`、`bun run build`、Biome、`git diff --check` 通过。移动端 `flutter analyze` 无问题，`flutter test` 为 `649 pass / 0 fail`。
- 改动后的 DEV/CDP attach、snapshot 和强断言均通过：console `0 errors / 1 warning`；旧 projection/usage/subagent/todo/activity API 均不在 `window.eco`，capabilities 为 protocol 2 / event schema 1 / effect 1，bootstrap 为 30 messages、8 runs、29 tools、7 todos，projection 为 139 request spans、147 ledger events 且含 billing/context。数据库审计为 `v2_only`、29 streams、22909 events/effects、26 snapshots、74 native facts、2812 ledger rows，退役表清单为空、`PRAGMA integrity_check=ok`，token/cost blocking failures 为 0；历史 Agent attribution warning 仍为 6 个会话/69 条。
- 本批关闭了 `MCP: tool`/`Bash` 标签冲突欠账，但不宣称正式全面 V2-only 已放行。真实磁盘不足/`ENOSPC`、更广泛损坏源与响应丢失故障矩阵，真实 Supabase 弱网与跨端重连，真机长会话性能，历史 Agent 归属补偿策略，以及旧迁移/兼容代码观察期仍是剩余门槛。

### 2026-09-19 第三十七批：附件内容守恒、切换后重验与最终门禁复验

- 维护 manifest 的附件摘要新增 `pathContentHashes`。使用 `--attachments-root` 时逐个读取路径附件并记录 SHA-256；替换文件、文件缺失、解析失败或未提供 root 都会让 verify/cutover fail-closed。V2-only 台账验收不再信任持久化的历史 hash：verify 必须带 root 重新读取当前文件，切换完成后替换附件仍会报 `facts mismatch`。新增回归覆盖导出后替换附件、带 root/无 root 校验、备份目标不可写和损坏 V1 attempt metadata；维护 CLI `12 pass / 0 fail / 91 assertions`。cutover 统一使用带 busy timeout 的维护数据库句柄并在必要时重开，消除短暂 `SQLITE_BUSY` 竞态。
- V2 定向组合 `119 pass / 0 fail / 994 assertions`，Node SQLite 三套 gate `31 pass / 0 fail`；桌面全量在标准 `60s` 与扩展 `120s` 阈值下均为 `3749 pass / 3 skip / 0 fail`（3752 tests、18302 assertions；标准 385.44s，扩展 382.22s）；`bunx tsc --noEmit -p apps/desktop/tsconfig.json`、`bun run build`、Biome、`git diff --check` 通过。移动端 `flutter analyze` 无问题，`flutter test` `649 pass / 0 fail`。
- DEV/CDP 强断言与数据库审计通过：旧 preload API 缺失，V2 capabilities/bootstrap/projection 与真实 Feed 可读；数据库 `v2_only`、29 streams、22909 events/effects、26 snapshots、74 native facts、2812 ledger rows、旧表为空、`integrity_check=ok`，token/cost blocking failures 为 0；历史 Agent attribution warning 仍为 6 个会话/69 条。
- 附件文件内容 hash、备份目标不可写和损坏 V1 attempt metadata 的 DEV 回归已关闭；真实磁盘不足/`ENOSPC`、更广泛损坏源与响应丢失故障矩阵、真实 Supabase 弱网/跨端重连、真机长会话性能、历史 Agent 归属补偿策略以及迁移/兼容代码观察期仍是正式全面 V2-only 的剩余门槛。

### 2026-09-19 第三十六批：命令状态守恒、静态门禁清零与全量复验

- 维护 CLI 的 native manifest 现在同时保存并校验 V2 `commandReceipts`、`commandJobs`、`commandCheckpoints` 及历史 revision。重导前验证 accepted event、request/payload/hash 和 checkpoint 顺序；若进程死在 native-facts 台账与清理提交之后，下一次 cutover 从不可变台账恢复 event、receipt、job、checkpoint，并在事务内重新校验 command state。新增中断窗口演练覆盖 send receipt、running history retry 和 `execution.claimed` checkpoint，恢复后重复发送仍返回同一 receipt，不重复接受。
- 命令维护 CLI 回归为 `9 pass / 0 fail / 72 expect()`；V2 账单、存储、投影、迁移和字段守恒定向组合为 `116 pass / 0 fail / 969 expect()`（迁移 CLI 在与字段守恒并发执行时连续 8 轮 `23/23` 通过）。桌面全量 `bun test test --timeout 120000` 为 `3746 pass / 3 skip / 0 fail`，3749 tests、18283 expect、402.18s；`bunx tsc --noEmit -p apps/desktop/tsconfig.json` 退出 0；`bun run build`、Biome、`git diff --check` 通过。
- 移动端清理全部 analyzer 诊断（生产异步 context、弃用 API、测试相对导入和未使用声明），`flutter analyze` 退出 0，`flutter test` 为 `649 pass / 0 fail`；CI 的 TypeScript 与 Flutter analyze 均已改为阻断式步骤。
- DEV/CDP 最终检查：旧 projection/usage/subagent/todo/activity API 在 `window.eco` 中均不存在；capabilities 为 protocol 2 / event schema 1 / effect 1；真实会话 bootstrap 为 30 messages、8 runs、29 tools、7 todos，projection 为 139 request spans、147 ledger events 且含 billing/context；强断言脚本退出 0，CDP console 为 0 errors / 1 CSP warning。数据库仍为 `v2_only`、29 streams、22909 events/effects、26 snapshots、74 native facts、2812 ledger rows，旧表清单为空且 `PRAGMA integrity_check=ok`。
- 本批关闭 command manifest/恢复和静态门禁缺口，但不把 DEV 证据当作正式放行。附件文件内容 hash/磁盘不足/损坏源/响应丢失故障矩阵、真实 Supabase 弱网与跨端重连、真机长会话性能、历史 Agent 归属补偿策略和旧兼容代码观察期仍是全面 V2-only 的剩余门槛。

### 2026-09-19 第三十五批：V2-only 维护验收 CLI 修复与全量复验

- 修复 V1 表物理退役后的维护 CLI 缺口：`--all --verify-native-manifest` 在 `storageMode=v2_only` 时不再调用已不存在的 V1 表，而是直接读取 `conversation_native_facts_v2` 不可变台账；因此切换后仍能重算并核对切换前 manifest。对 DEV 原始 manifest 的复核已通过：`29` 个会话、`74` 条 native facts、`factsHash=6d2cc230`、`integrity=ok`。
- 修复 macOS/Bun 连续 WAL 短进程读取的 `SQLITE_CANTOPEN` 竞态：维护读取会重开 SQLite handle；持续异常时使用 `PRAGMA query_only=ON` 的写保护连接，不把可恢复的 WAL 锁态误报成事实损坏，也不允许验收路径写库。新增 V2-only 台账验收回归；第三十六批已另外覆盖 command state 恢复。
- V2 账单、存储、投影、迁移和字段守恒定向组合当时为 `116 pass / 0 fail / 969 expect()`；桌面全量当时为 `3746 pass / 3 skip / 0 fail`（3749 tests、18277 expect、399.62s）；`bun run build`、新增脚本/测试 Biome、`git diff --check` 通过。第三十六批已以 120 秒阈值重新复验，见上方最新快照。
- 移动端当时全量为 `649 pass / 0 fail`，静态分析仍有 49 条诊断；第三十六批已清零并将 CI 改为阻断式。
- DEV 重启审计仍为 `v2_only`、29 streams、22909 events/effects、26 snapshots、74 native facts、2812 ledger rows；旧表清单为空，`PRAGMA integrity_check=ok`，账单 token/cost blocking failures 为 0；历史 Agent attribution warning 仍为 6 个会话/69 条。CDP 重新确认旧 API 缺失、projection 只有 V2 `billing/context/ledgerEvents/requestSpans/subagentTimings`，console 为 0 errors/1 CSP warning，最新截图为 `apps/desktop/.smoke-artifacts/v2-only-final-20260919.png`。
- 本批只修复验收工具和补强证据，不把 DEV 通过误报为正式放行；第三十六批已推进 command receipt/job/checkpoint 与阻断式 TypeScript/Flutter 静态门禁，附件内容守恒/故障矩阵、真实 Supabase 弱网与跨端重连、真机性能、历史 Agent 归属补偿策略和旧兼容代码观察期仍是剩余门槛。

### 2026-09-19 第三十四批：V2 账单权威化与旧 accumulator 退场

- 单次 usage / SDK run billing effects 追加 V2 ledger 后直接解析 `resolveV2BillingSnapshot()`；投影缺失显式 fail-closed，不再从 `ThreadUsageAccumulator` 或旧 aggregate 补账。V2-only 启动恢复、metrics 持久化只处理 context；`usageState` 从 projection extras 协议移除，V2-only 切换/重开在校验历史值后物理清除旧 accumulator，损坏值回滚并阻断。
- 新增唯一 billable-event selector，统一处理 Proxy 主账、SDK shadow、同源重复行和 partial/context 排除；billing projection 与 ledger reconciliation 共用该 selector，修复真实 DEV 中 raw shadow rows 导致的 token/cost 假阳性。仅剩历史 Agent 归属缺口时记录 `usage_ledger.attribution_gap`，不猜测归属。
- 定向账单/迁移回归 `39 pass / 0 fail`；桌面全量 `3744 pass / 3 skip / 0 fail`（3747 tests、18269 expect、397.89s）；renderer/main/preload 构建和 `git diff --check` 通过。
- DEV 重启审计：`v2_only`、29 streams、22909 events/effects、26 snapshots、74 native facts、2812 V2 ledger rows、旧表清单为空、`integrity_check=ok`、snapshot `usageState=0`；全库 token/cost blocking failures 为 0，仍显式保留 6 会话/69 条历史 attribution warnings。CDP 0 errors / 1 CSP warning，V2 projection 含 billing/context 且不暴露 `usageState`。
- 本批关闭 DEV billing token/cost 对账差异；command receipt/job/checkpoint、附件守恒/故障矩阵、Supabase/真机/性能、阻断式静态门禁、历史 Agent 归属策略和旧兼容代码观察期仍阻断正式全面 V2-only。

### 2026-09-19 第三十一批：旧活动线 RPC 退场

- 无消费者的 `thread:activity-list` 已从桌面 preload/IPC/主进程、共享 remote registry 和移动端 DesktopRpc 删除；SDK transcript 仍只作为 runtime resume 的内部输入。
- 删除后的桌面全量为 `3740 pass / 3 skip / 0 fail`（3743 tests、18251 expect、399.03s）；IPC/V2 renderer `22/22`、remote registry `3/3`、移动端 DesktopRpc `35/35`；主进程/preload 构建通过。DEV 重启/CDP 与 V2-only 数据库复核保持通过。

### 2026-09-19 第三十二批：usage ledger 读面与物理存储 V2-only

- 删除 `thread:usage-ledger-events-list` preload/主进程/demo RPC；计费明细改由 `conversation:projection` 的 V2 `ledgerEvents` extras 一次返回，桌面 usage breakdown 不再按 threadId 读取旧 ledger RPC。
- 新增 `conversation_usage_ledger_events_v2`，V2 stream 存在时 ledger 的追加、列表、归属更新、清空和历史重写清理均落到该表；旧 `thread_usage_ledger_events` 仅在 `legacy_compat` 作为迁移输入。V2-only 启动每次幂等执行残留 ledger 迁移与退役，修复历史上“模式已切换但旧表仍留存”的重开缺口。
- 新增磁盘回归：预切换旧行迁移、projection extras 明细、关闭重开，以及人为重建残留旧表后的 V2-only 启动修复；usage ledger 定向测试 `2 pass / 0 fail`、`19 expect()`。主进程、preload、renderer 构建和 `git diff --check` 通过。
- DEV 重启实证：`v2_only`、29 streams、22909 events/effects、26 snapshots、74 native facts、2812 条 V2 ledger rows、26 个 ledger 会话，`PRAGMA integrity_check=ok`；九张退役旧表（含 `thread_usage_ledger_events`）均不存在。CDP attach/snapshot 为 `0 errors / 1 CSP warning`，V2 projection 返回 139 request spans、147 ledger events、billing/context，旧 usage/projection/subagent/todo/activity API 均不在 `window.eco`。
- 本批门禁：桌面全量 `3741 pass / 3 skip / 0 fail`（3744 tests、18257 expect、395.51s）；移动端 `flutter test` `649 pass / 0 fail`；`flutter analyze` 仍为 49 条既有 lint/info/warning、0 error。billing token/cost 对账、command receipt/job/checkpoint 与附件守恒、真实 Supabase/真机故障与性能、全量静态阻断门禁和旧迁移兼容代码观察期仍阻断正式全面 V2-only 放行。

### 2026-09-19 第三十三批：metrics snapshot 迁移输入化与真实 DEV 重开复验

- `thread_metrics_snapshots` 从公共启动 schema 移到 `legacy_compat` 初始化；V2-only 切换与每次重开先严格解析旧 accumulator/context，写入 `conversation_projection_snapshots_v2` 的 `usageState/context`（已有 V2 字段保持权威），再物理退役旧表。JSON 损坏、字段非对象或没有对应 V2 stream 均显式抛出完整性错误并回滚，不通过空值或旧表兜底。
- `listThreadMetrics()` 在 V2-only 直接遍历 V2 projection；rewind/discard/rewrite 的旧 metrics 清理 SQL 加表存在性 guard，避免物理退役后历史操作再次触发 V1 查询。新增迁移成功、V2 字段优先、重开清理和损坏输入 fail-closed 回归。
- metrics/usage ledger 定向 `4 pass / 0 fail`、`30 expect()`；桌面全量 `3743 pass / 3 skip / 0 fail`（3746 tests、18270 expect、398.47s）；主进程、preload、renderer 构建和 `git diff --check` 通过。全量 TypeScript 仍为既有失败（本批目标文件无命中），移动端本批无生产代码变更。
- 真实 DEV 重启后仍为 `v2_only`、29 streams、22909 events/effects、26 projection snapshots、74 native facts、2812 V2 ledger rows；`thread_metrics_snapshots`、`thread_usage_ledger_events` 与其他退役 V1 表均不存在，`PRAGMA integrity_check=ok`。CDP attach/snapshot 为 0 errors / 1 CSP warning；V2 bootstrap 为 30 messages、8 runs、29 tools、7 todos，projection 为 139 request spans、147 ledger events 且含 billing/context，当前视口截图为 `apps/desktop/.smoke-artifacts/v2-only-metrics-v2.png`。
- 本批进一步收紧旧指标物理边界，但 billing token/cost 对账差异、command receipt/job/checkpoint 与附件守恒/故障矩阵、真实 Supabase 弱网/跨端重连、真机性能、阻断式 TypeScript/Flutter 静态门禁和旧迁移兼容代码观察期仍阻断正式全面 V2-only。

### 2026-09-18 第三十批：V2-only 物理表与历史重写收口

- `thread_subagent_sessions` / `thread_subagent_metrics` 不再由公共启动 schema 创建，只在 `legacy_compat` 迁移初始化中建立；V2 cutover 与重开均将其视为退役兼容表。历史编辑、删除、rewind、compact 清理在旧表不存在时只维护 V2 事实，不执行 V1 SQL。
- 无消费者的 `thread:activity-list` 旧 preload/IPC 读桥已删除；仍保留的 SDK transcript 读取只服务 runtime resume，不是对话事实源。
- 最新桌面全量：`bun test test --timeout 120000` 为 `3740 pass / 3 skip / 0 fail`（3743 tests、18251 expect、395.44s）；迁移 CLI `8/8`；最后的历史清理 guard 修改后，迁移/运行时/store/Node SQLite 相关集 `96/96`；移动端全量 `649/649`；`git diff --check` 通过。
- DEV 重开复核保持 `v2_only`、29 streams、22909 events/effects、26 snapshots、74 native facts，八张已收口旧表均不存在且 `PRAGMA integrity_check=ok`。CDP 重新验证真实会话的 V2 capabilities/bootstrap/projection、旧 preload 方法缺失、Feed/计费/Context 展示和 0 console error（仅 CSP warning）。
- 本批仍不改变生产放行条件：billing 对账、command receipt/job/checkpoint、附件守恒、Supabase/真机故障与性能、全量静态门禁和旧兼容代码观察期清理继续阻断全面 V2-only。

### 2026-09-18 原生 V2 写入口与源身份索引推进

- 实时 provider 写入已统一经过 `ConversationV2RuntimeWriter`：累计正文只追加 delta，旧快照重投不覆盖新正文，空最终正文可以清空草稿；正文事件、输入身份回执和 effect 在同一 SQLite 事务中提交，损坏回执会显式触发完整性错误。
- Claude/Codex/ACP 实时流、子代理生命周期、提示缓存、请求终态和图像分析的生产回调已切换到 `appendConversationRuntimeEvent`；旧 `appendThreadRunEvent` 不再是生产入口。
- 新增 `conversation_provider_inputs_v2` 与 V2 派生视图，迁移器为每个旧事件补齐不可变输入身份回执；隐藏的旧用户提示也保留源身份，重建读模型不依赖 V1 源表。请求重绑、SDK 消息归属和撤回目标通过 V2 patch 事件更新源索引。
- 历史撤回/丢弃不再删除 V2 事件；通过 `history.*` 事件隐藏 provider 输入并拒绝迟到结果，重建后仍保持隐藏状态。
- 用户消息投影新增 V2 原生读取：编辑/撤回所需的用户消息、附件预览、SDK upstream identity 从 `conversation_messages_v2` 与 provider source index 解析；原生运行时不再写入 `thread_user_messages`。活动线在有 V2 provider source 时直接从 V2 source 生成，Claude SDK 回绑也用 V2 provider patch 写入 `rewindTarget`。
- 首条用户消息先写入/终结 `conversation_messages_v2`，再提交 provider input receipt，避免 receipt 在同一运行链中引用尚不存在的 V2 message row；旧 `saveUserMessageRecord` 仅对无 V2 source 的兼容/迁移数据生效。
- Feed skeleton 缓存已迁入 `conversation_feed_skeletons_v2`；旧 `thread_feed_skeleton` 只在启动时一次性导入，生产读写不再访问旧缓存表。
- legacy bridge source 现在显式带 `legacyCompat` 标记；只有兼容桥接允许镜像旧活动线/用户消息/事件行，Claude/Codex 原生 V2 回绑只写 provider patch。新增原生 Claude 回绑专项验证旧用户消息表保持空；此前 `5256/5259 pass` 属于历史快照，最新桌面全量以 `bun test test --timeout 120000` 重跑为 `3740 pass / 3 skip / 0 fail`（3743 tests，18256 expect，402.65s）；移动端全量 `flutter test` 为 `655 pass / 0 fail`；标准 60 秒阈值的性能基线仍需单独补齐；Node SQLite gate `31 pass / 0 fail`。
- Codex 场景回放不再调用 `appendThreadRunEvent`：回放先建立确定性的 V2 run attempt，再走 `appendConversationRuntimeEvent`，Feed skeleton 和完整投影均读取 V2 provider source index；固定场景回归 `7 pass / 0 fail`，预期产物已刷新为 V2 结果。
- 验证：原生写入/迁移/CLI 18/18；字段守恒 14/14；桌面真实语料差分与跨端 golden 65/65。全量 TypeScript 基线仍有仓库既有诊断，真实数据库维护窗口、旧用户消息/附件面和 V1 物理清理尚未完成。

### 2026-09-18 维护窗口全量迁移与 V2-only 切换工具

- `apps/desktop/scripts/conversation-v2-migrate.ts` 新增 `--all` 全库 dry-run / apply 入口；dry-run 会返回逐会话 `existingV2` inventory 与 `cutoverReady`，并把原生 V2 event 对照 V1 源分类为 `nativeEquivalentEvents`、`nativeCollapsedEvents`、`nativeModifiedEvents`、`nativeUnmatchedEvents`。发现不属于可恢复迁移过程的 V2 event/effect、实体或 command receipt/job/checkpoint 时，`--cutover --backup <path>` 会在迁移前以会话 ID 和计数 fail-closed。通过预检后才会拒绝 `queued`、`running`、`awaiting_plan` thread，再用 `VACUUM INTO` 固定备份，按会话执行可恢复迁移并校验 V2 integrity/source coverage。
- dry-run 可附加 `--native-manifest <path>` 导出维护窗口 manifest。该参数只允许 `--all` 只读预检且拒绝覆盖已有文件；manifest 保存 integrity/storage mode、逐会话 inventory、原生事件原文及 `event_hash`/payload hash、V1 source/attempt 的 `matchedSourceId`、匹配结论和原因、事件/会话级附件摘要，并写入 `contentHash` 供离线校验。读事务提交后才以临时文件 + rename 落盘，manifest 只用于保全和复核，不能授权 cutover。随后可用 `--verify-native-manifest <path>` 重算当前数据库的原生 facts hash，逐条核对事件元数据、原文、hash、来源结论和事件附件摘要；生成时间和数据库路径不纳入比较，任何差异都显式阻断。
- 全部会话校验通过后，`ConversationStore.switchToV2OnlyStorage()` 在一个 `BEGIN IMMEDIATE` 事务中写入 `conversation_v2_storage_mode=v2_only` 并删除全部 13 张已收口的 V1 conversation source table（含 `thread_pending_plans`、`thread_agent_instances`）；旧表不存在时 delete、活动线、历史回滚和旧事件写入均显式走 V2-only 行为，不再执行 V1 SQL fallback。
- `--reconcile-native-manifest <path>` 现在把已有原生事件保全到 `conversation_native_facts_v2`：等价事实由 V1 重建，`run.started` 折叠到 attempt，修改事实以带 `authority=maintenance` 的 V2 patch 恢复；未匹配、payload/附件错误和 V2 command 状态均阻断。账本保留原始 payload、归属字段、hash、匹配结论与附件摘要；若进程死在账本/清理提交后，下一次运行从账本恢复而不要求已清理的 native event rows。
- 临时磁盘演练已验证备份保留 V1 源、切换后 `PRAGMA integrity_check=ok`、关闭重开仍保持 `v2_only`、旧表清单为空、V2 history invalidation 和活跃 thread 预检阻断；当前迁移 CLI 8/8、Node SQLite store 40/40 通过，Node gate 合计 31/31。2026-09-18 在 29 会话 DEV 一致性副本上完成带原生事实保全的全量重导：22,909 条 V2 event/effect、74 条 native facts（62 equivalent、9 collapsed、3 modified）、六张 V1 表清零、二次 cutover 返回 `idempotent=true`，关闭重开与账本清理后中断恢复均通过。原始 DEV 混合库的 dry-run inventory 返回 29 条会话记录（含可重建 skeleton），识别出 13 个已有 V2 stream 且 `cutoverReady=false`，新 preflight 按会话计数显式阻断；inventory 另计出 18,126 条 `legacyCompat` 镜像事件、5 个附件引用（47,544 个 inline bytes、1 个 path 引用；带 `--attachments-root` 校验缺失数为 0）。随后同日已对真实 DEV 库完成带 manifest reconcile 的 `--all --apply --cutover`，实际库重开后保持 `v2_only`，并通过第二遍幂等 cutover。生产运行仍需维护窗口、command receipt/job/checkpoint 守恒、附件内容守恒和故障矩阵。
- 2026-09-18 对真实 DEV 库切换前只读生成并复核 manifest，报告与 manifest `contentHash` 一致且 facts hash 对账通过；29 个会话共导出 74 条原生事件，分类为 62 条 `equivalent`、9 条 `collapsed`、3 条 `modified`、0 条 `unmatched`，源库 integrity=`ok`、storage mode=`legacy_compat`，无 SQLite 写入。切换后实际库为 29 个 V2 stream、22,909 条 event/effect、68 个合法 lifecycle run，6 张退役表不存在；`VACUUM INTO` 备份保留 76 条用户消息和 11,306 条旧 run 事件。重启 DEV 后用 CDP 验证列表、V2-only 会话、原先只有 V1 的会话、reload 和 console，均为 0 errors（仅开发环境 CSP warning）。
- 最近一次完整桌面测试门禁为 `bun test test --timeout 120000`：`3740 pass / 3 skip / 0 fail`，3743 tests、18256 expect，402.65s；移动端全量 `flutter test` 为 `655 pass / 0 fail`；迁移 CLI 定向集为 `8 pass / 0 fail`、60 expect。全量日志仍出现 `conversation-v2.tool-name-conflict`（同一 toolCallId 的 `MCP: tool`/`Bash` 标签冲突）；当前保留首个名称并记录诊断，未导致测试失败，但生产放行前仍需定名规则。仓库根目录的 `bun test` 会错误加载 Playwright `e2e/` 规格，E2E 仍按独立 Playwright 命令执行，不能把该 runner 误用结果算作单测失败。
- `ConversationStore.initialize()` 现在按 durable storage mode 分支：`v2_only` 重开只初始化公共表和 V2 schema，不再重建后再删除六张退役 V1 表；SQLite 回归会在重开后再次断言退役表不存在。

## 2026-09-17 决策：全面 V2-only

这不是“V2 优先、V1 兜底”的渐进兼容项目。完成时必须同时满足：

- 新消息、流式正文、run、工具、代理、审批、澄清、计划、todo、编辑、删除、重试和分支全部先写 V2 事件，再由同一事务维护 V2 读模型与同步 effect。
- 桌面和移动端只消费 V2 bootstrap/page/details/sync/head/entity 与 V2 command receipt；任何 V1 投影、骨架或旧 RPC 都不能参与页面正确性或命令结果判断。
- `thread_run_events`、`thread_feed_skeleton*`、旧投影及旧移动端 DTO 不再接受生产写入；旧表只在迁移观察期只读保留，观察期结束后删除生产引用，再单独决定物理清理版本。
- 不提供“V2 出错就读 V1”的开关。迁移失败、协议不兼容和完整性失败必须显式阻断该会话并给出错误。

### 迁移分叉决策

选定**维护窗口全量重导**，不采用“让迁移器接管已有 V2 stream”或长期双写收敛：

1. 拒绝新执行，等待活跃 run 结束；超时的 run 显式取消并落终态。
2. 对 SQLite 主库、WAL 和关联内容文件做一致性备份，并记录源指纹。
3. 预检必须对比 V1 源与现有 V2 的实体、附件和 command receipt，识别 V2 独有数据；先无损导出并定义重导恢复规则，无法证明守恒则停止，禁止直接清理。优先在暂存库生成并验证完整 V2，再原子安装；旧 V1 源表不动。正式清理或安装必须由受测迁移命令执行并单独确认操作范围，本次计划修改不授权修改真实用户库。
4. 用当前适配器和迁移器从 V1 源全量生成干净 V2 事件；按 `thread_run_attempts` 播种权威 run，并重建读模型/effect。
5. 校验会话集合、消息正文哈希、用户消息多重集、run 终态与时间、工具调用身份、代理归属、未映射事件、连续 seq/effect 和双端渲染 fixture。任一会话失败则整个正式切换不发生。
6. 原子安装校验通过的 V2、写入全库 V2-only 存储版本并启用 V2 写入；重建的 stream 必须更换 `store_epoch`，客户端显式失效旧缓存和游标并 bootstrap。保留独有数据与幂等回执的语义，禁止旧 command 重试触发第二次执行。从这一刻起禁止 V1 写入口和旧客户端写命令。
7. 观察期只允许修复前进。若 V2 尚未接受任何新写入，可恢复整库备份；一旦接受 V2 新事件，不得通过恢复旧库丢弃它们。

选择重导的原因：现有镜像会话已经包含旧适配器生成的不可变错误事件，继续双写不能修复历史；迁移器接管已有 stream 还会混合两套 source key 和 reducer 版本。一次性重导边界清楚，且已在真库副本上验证能清除进度/心跳幽灵行。

此前 preflight/附件盘点后的 `5257/5259 pass` 结果属于历史快照；标准 60 秒阈值曾在并发负载下出现真实语料 timeout（`thr_1789133041817: V2 is coherent on its own terms`）。本批已用标准 `bun test test --timeout 60000` 重跑并通过 `3747 pass / 3 skip / 0 fail`（382.76s），该历史阻断已关闭；真机长会话、滚动/内存/延迟预算仍需独立实测。

## 当前实施状态（2026-09-16）

### 2026-09-17 todo V2 迁移推进

- todo 协议已冻结为 `todo.updated` 事件和 `todo.list.replace` effect，桌面 reducer/read model、bootstrap、sync、rebuild 与完整性校验已落地。
- `replaceCoderTodos` 只追加 V2 事件，桌面 renderer、移动端 session/cache 和同步 effect 只读 V2 状态；旧 `thread:todo-list` preload/IPC/remote command 已删除，activity 抽取不再作为生产 fallback。旧 todo 表不再接受 replace/rewind 写入，仅作为一次性迁移输入和限期备份。
- 新 thread 与 V2 stream 同事务建立；存量 thread 必须经过显式迁移，不会通过保存操作伪造空 V2 stream。
- legacy migrator 已将 `thread_coder_todos` 作为一次性迁移输入并使用稳定 source key 幂等写入。
- 移动端 cache schema 升至 10，新增 todo DTO、SQLite read model、sync effect reducer、session state；任务菜单和任务面板只读 V2。
- 定向验证：桌面 todo/store/migration 88/88；移动端 V2 cache/sync/cross-end 35/35；相关 Flutter 生产文件 analyze 无新增诊断。
- conversation branch 审计结论：当前没有独立产品 RPC/UI；Codex `thread/fork` 属于 rewrite/retry 的外部副作用，已纳入 durable history command，不另造一条伪命令链路。
- 仍未完成：其余 SDK/live 旧写入口清理、正式 storage version 切换和 V1 物理清理。全面 V2-only 继续保持未通过。

### 2026-09-18 桌面/移动端 todo 读面收口与重启复核

- 桌面 renderer 的 todo 状态只来自 V2 bootstrap / `todo.list.replace` effect；旧 `thread:todo-list` 已从 preload、主进程、demo、移动端 RPC 和共享 remote command registry 删除。新增 renderer state 回归覆盖 bootstrap 安装和 effect 替换，并在 store runtime 回归中证明原生 V2 用户消息读 API 不会向旧表兜底，缺失 V2 stream 会显式失败。
- 全量验证：桌面 `bun test test --timeout 120000` 为 `3740 pass / 3 skip / 0 fail`（3743 tests、18256 expect、402.65s）；移动端 `flutter test` 为 `655 pass / 0 fail`；`git diff --check` 通过。
- 重启 DEV 后重新 CDP attach/snapshot，打开含 7 条 V2 todo 的真实会话并调用 V2 bootstrap：`protocolVersion=2`、`todoCount=7`，`window.eco` 不再有 `listThreadTodos`；reload 后结果一致，console 为 0 errors（仅开发 CSP warning）。这只证明 todo 读面已切 V2，不能覆盖尚未迁移的 requestSpans/billing/context/subagentTimings 和命令/附件故障矩阵。

### 2026-09-16 移动端与展示语义适配进展

本轮补齐了此前计划没有明确写出的“跨端展示语义等价”部分：

- 移动端会话主 Feed 已以 V2 的消息、运行和工具读模型为唯一内容来源，再接入既有的轮次、动作组、工具卡片、子代理卡片和详情加载能力；不再用“是否有条目”决定回退到旧投影。
- 移动端 V2 工具适配器保留命令、路径、读取、搜索、文件变更、联网搜索、图片、HTML、MCP、消息派发、非执行结果和审批等结构化字段，工具数量与展示类型不再因只保留工具名而缩水。
- 桌面端 V2 直出路径使用同一套结构化字段语义；V2 工具输入不再被清空，进入成熟桌面 Feed 前会保留文件变更、读取目标、联网搜索和输出摘要。
- 旧事件桥接会保留缺少结构化元数据的工具行，生成稳定的工具/运行身份，并把审批、澄清和计划请求/结果写入 V2 详情；移动端从这些详情恢复交互状态。
- V2 接受消息与旧 `thread.user_prompt` 事件复用同一消息身份，避免移动端发送后出现两个用户气泡。

这说明此前 V2 计划考虑了移动端的存储、同步和详情接口，但没有把移动端已有 Feed 的展示能力、工具分类/计数和交互状态列为协议验收项；这正是“重构后效果丢失”的根因之一。

### 2026-09-16 状态单一时钟与工具标签修复

用户报告的两个问题：移动端“输出还没完成状态就变了”（发送/停止按钮先于 Feed 变终态），以及移动端工具行只剩“读取了文件/运行了命令”这类泛化标签、还会出现“读取了 读取了文件”的重复。根因与修复：

1. V2 此前完全没有 run：运行时写的是 `request.started/completed`，而桥接只映射 `run.attempt.*`，真实 run 从不入 V2，移动端只能从旧 `thread.*` 通道取运行状态，于是状态和 Feed 分属两个时钟。现在由 `ConversationStore.upsertRunAttempt` 这一 attempt 生命周期唯一入口投影 `run.started/completed/failed/cancelled`（`run_id` = `turn_id` = `attempt_id`，稳定 source key 幂等；V2 保留首个终态，迟到结算不改写）。
2. 旧事件桥接不再为空正文的 `*.delta` 占位行创建 V2 消息，也不用空正文覆盖已有正文：这些行永远等不到 final，会留下永久 `streaming` 的消息，Feed 因此收不了尾。移动端投影同时忽略空正文的非用户消息，已有脏数据也不会再让轮次永远处于流式。
3. 移动端会话运行状态改为两个时钟的逻辑与（`resolveSessionRunning`）：只有旧 `thread.*` 已报终态 **且** V2 最新 run 已终态才离开运行态。`run.completed` 与最终正文在同一有序流中、排在正文之后，因此状态与 Feed 共用一个时钟；V2 状态不可信（uninitialized/offline/error/incompatible）或老会话（V2 无 run）时仍按旧状态。
4. 移动端工具目标解析补齐：读取行范围（`offset/limit` → `L12-40`，兼容 detail 里的 `:L12-40`）、结构化 `readTarget/grepTarget` 传入 Feed、旧 V2 工具行（`input` 为空、旧展示 detail 存在 `output`）回退读取该 detail、泛化标签不再被当作可拼接的 rawTarget 二次加动词（对齐桌面 `actionBlockTargetKey` 的防护）。

验证：桌面新增 `test/conversation-v2-run-projection.test.ts`（运行状态投影、幂等重放、终态冲突、无 V2 表时的安全跳过）；移动端新增单一时钟、占位流式行、读取行范围、旧行 detail 与标签去重测试。桌面相关 14 个测试文件 131/131、V2 相关 7 个文件 68/68 通过，移动端 `flutter test` 619/619 通过。

### 2026-09-16 子代理内容溢出到主 Feed：读模型丢了 agent 归属

现象：子代理（planner/explore 子代理）的叙述出现在主代理 Feed 里——例如“辅助模型已允许 Grep：/repo”“## Overview 两张界面截图…”“@mission {\"role\":\"explore\"…”。旧投影从不这样做：主时间线只收 `scope in (main, both)` 的行，`scope=agent` 的行按 `agentId` 落到代理卡片，只有找不到卡片的孤儿行才被收回主 Feed（`thread-run-projection.ts` 的 `mainTimeline` 构造）。

根因是一条**读模型缺列**，不是合并逻辑写错：`conversation_events_v2` 一直有 `agent_id` / `agent_instance_id`（dev 库 146 条消息事件带 `agent_id`），桥接也一直把 `event.agentId` 写进事件，但 `conversation_messages_v2` 没有这两列，`rowToMessage` / `storedMessage` / 共享 `ConversationMessage` DTO / 移动端 `ConversationV2Message` 也都没有，于是“这条正文属于哪个代理”在离开事件日志的瞬间就丢了。桌面 `conversationV2MessageToTimelineItem` 因此只能硬写 `scope: "main"`，合并时每条 V2 消息都当成主代理内容。旧工具行的归属纯属侥幸：V2 工具表本来就有 `agent_instance_id`，所以子代理工具没溢出，只有消息溢出。

等价性可以用旧表对拍（真机库）：`thread_run_events` 里 `scope='main'` 的 786 行 `agent_id` 全为 NULL，`scope='agent'` 的 73 行全有值——`agent_id IS NOT NULL ⇔ 子代理内容`是旧链路成立的不变量，V2 必须保持。

修复（读模型补归属，两端同构）：

- `conversation_messages_v2` 增加 `agent_id` / `agent_instance_id`（走既有的 `PRAGMA table_info + ALTER TABLE ADD COLUMN` 升级路径），`applyMessageCreate` 写入，`rowToMessage` / `storedMessage` 读出，共享 DTO 与移动端模型（含 `copyWith` / `toJson`，避免本地缓存与增量更新把归属丢掉）补齐字段；新增 `backfillMessageAgentOwnership()`：只在列是本次新加时执行，从 `message.created` 事件回填（幂等，且与重放结果一致——归属和正文一样来自不可变事件，所以回填不违背不变量 10）；顺带补 `idx_conversation_events_v2_message`。
- 桌面合并在 `mergeConversationV2MessagesIntoProjection` 里按归属分流：代理已知（`projection.agents` 里有这个 `agentId`）时把行标成 `scope: "agent"` 并追加到该代理卡片的 timeline；找不到卡片时保持主 Feed（`conversationV2MessageToTimelineItem` 的默认 `scope` 就是 `main`，V2-only 投影没有代理卡片，也因此不会把内容藏掉）。
- 移动端 `buildConversationV2Projection` 做同样的事：消息归属已知代理时进 `agents[].timeline`（`scope: "agent"`），否则留在主时间线。工具原本就已按 `tool.agentId` 分组，这次把消息与工具放进同一个卡片 timeline，避免“卡片只列工具、叙述却跑到 Feed”。

真实数据验证（dev 库 `VACUUM INTO` 副本，让 store 自己跑一遍升级路径，不动运行中的库）：ALTER + 回填后 `conversation_messages_v2` 有 31 条带 `agent_id` 的消息，与事件日志里带 `agent_id` 的 `created` 事件数完全一致，第二遍 `initialize()` 仍为 31（幂等）。再把真实消息喂给真实的 renderer 合并（代理卡片取自 `thread_agent_instances`）：

| 会话 | 子代理消息 | 修复前进主 Feed | 修复后进主 Feed | 进代理卡片 | 孤儿 |
| --- | --- | --- | --- | --- | --- |
| `thr_1789530530422` | 2 | 2 | 0 | 2 | 0 |
| `thr_1789531481908` | 4 | 4 | 0 | 4 | 0 |
| `thr_1789540220642` | 1 | 1 | 0 | 1 | 0 |
| `thr_1789542050047` | 13 | 13 | 0 | 13 | 0 |
| 合计 | 20 | 20 | 0 | 20 | 0 |

测试：桌面 `conversation-v2-activity-merge.test.ts` 新增三条，其中一条是**跨层用例**（旧行 → 桥接 → V2 读模型 → renderer 合并 → 代理卡片），把合并分流或 DTO 字段任一处改回去都会失败（已实测：临时禁用分流后 2 条用例失败）；移动端 `conversation_v2_activity_feed_test.dart` 新增两条（归属已知进卡片、孤儿留 Feed）。桌面相关 11 个文件 203/203、移动端 621/621 通过，`bunx tsc -b` 与 `flutter analyze` 对改动文件无新增诊断。

注：读模型加列需要重启 dev 桌面才生效（ALTER + 回填只在启动时跑）；renderer 侧分流的改动经 HMR 已生效。

本轮同时确认了两个**尚未修掉的相邻缺口**（已记入“尚未完成”）：

1. **旧链路的消息角色标签没有对应字段。** 读模型 `role` 被归一成 `user/assistant/system/tool`，而旧链路里主代理的叙述行是 `role='planner'`（dev 库 766 行），子代理行是 `tool/coder/explore`——这些标签目前在 V2 路径里拿不回来，需要新的事件字段才能恢复（本轮先把归属做对，标签仍是已知数据缺口）。
2. **现有测试抓不到这类回归的原因值得单独记录。** V2 的单测都只验证“V2 输入 → V2 输出”，旧链路有自己一套等价的展示测试，两者没有**差分对拍**：只要 V2 侧新写一段自己的映射，两边就可能分别通过而语义已经分叉。这次的跨层用例是补这一课的第一条，后续应把“同一份旧事件在两条链路上渲染出等价结构”作为固定测试类型（见“尚未完成”）。

### 2026-09-16 桌面 Feed「时序乱了」排查与修复（会话 `thr_1789540220642`）

用 CDP 抓 Feed DOM、与 DB（`thread_run_events` / `thread_run_attempts` / `conversation_*_v2`）逐条对拍后，确认了三处独立缺陷，都发生在**旧的过渡读模型与 V2 读模型合并**这一段（未提交的 WIP），不在 V2 存储或事件协议本身：

1. **工具完成会关掉它所属的 run。** 旧事件桥接在 `tool.completed` / `tool.failed` 上无条件发 `run.completed` / `run.failed`（source key 后缀 `synthetic-run-final`），本意是收掉“无 `runAttemptId` 的工具行自建的合成 run”，但它对带真实 attempt id 的工具行同样生效：一轮里第一个工具完成时，V2 就把仍在运行的 attempt 记成 `completed`（实测 09:41:36.822 起、09:41:47.944 止 = 11s），桌面合并又把 V2 run 的状态/时长覆盖到 attempt 上。于是正在跑的轮次显示「已处理 11s / 本轮执行结果」，而该 attempt 真正在 09:57:27 才以 failed 结束；V2 因“首个终态不可改写”保留了错的终态，迟到的真实 `run.failed` 会撞成 integrity 冲突。修复：只有**本次事件没有 `runAttemptId`、由桥接自建合成 run 时**才允许收 run（`conversation-v2-legacy-adapter.ts`）；真实 run 的终态只由 attempt 生命周期投影（`upsertRunAttempt`）产生。
2. **V2 镜像里的冲突终态会让权威结算抛错。** `applyRun` 对“同一 run 两个不同终态”按 integrity 错误失败，而投影在写 V2 之前不检查镜像；一次 attempt 结算就可能因为镜像早已是另一个终态而抛错。修复：`projectRunAttemptToConversationV2` 先读镜像终态，冲突时跳过写入并打 `[eco-diag] conversation-v2.run-status-conflict`（生命周期是权威写入模型，镜像冲突不得打断结算）；同时桌面合并在两个来源都是**不同**终态时以 attempt 记录为准（一次 attempt 只会结算一次，两个不同终态不可能都真）。
3. **被骨架裁掉的正文/工具重新定位错误。** Feed 骨架对已结束的轮次只保留“该段最后一条正文”，其余消息由 V2 补回；合并时把它们全部锚到该 run 的第一条旧行，`at`/`sequence` 也因此完全相同，等于没有位置信息 —— 排序退化成按消息 hash 排（实测 19 条 planner 消息按 `legacy_message_<hash>` 字母序渲染，最后一条“全部搞定”被排到中间，而「最终输出」取到了 hash 最大的那条）。修复：`buildConversationV2RunMessagePositions` 用同一 run 内**最近的已锚定兄弟**做定位（排在它前面并按 V2 顺序倒数、或排在它后面顺序递增），保留 V2 顺序又落在本轮的旧行区间内。V2 工具行同理不再用 `generatedAt` 当时间：无旧行的工具按 attempt 的 `endedAt/startedAt` 定位、序列接在该 run 幸存旧行之后（此前每个工具的 `at` 都是“现在”，重启/回滚后整个历史上所有轮次的工具行会堆成底部一堆额外的空轮次）；V2 工具组的分段判定也改成按墙钟（`isConversationV2FeedEntry`），否则它会被判进更早的用户消息段、在提问上方多出一个空轮次。

验证：新增 `a conflicting terminal V2 run cannot overwrite the attempt that settled it`、`keeps the V2 order of a turn whose narrative rows left the feed skeleton`、`keeps a V2 tool of a finished turn inside that turn`（把定位逻辑改回旧写法即失败，复现出按 hash 排序 + 取错最终输出的现象）；桥接新增 `does not close the run that owns a completing tool`、`closes only the synthetic run a run-less tool call invented`；run 投影新增冲突终态不抛错用例。桌面 V2 相关 7 个文件 72/72、Feed/轮次相关文件全绿，`bunx tsc -b` 该 4 个文件无错误。真机数据核对：修复后该会话 Feed 为 `... 已处理 21m 17s → USER 17:41 → 运行 15分 50秒 后停止了 → USER 继续 → 同一 attempt 的后段 → 当前 running 轮次`，底部不再有额外空轮次，最终输出回到 DB 里真正最后的那条正文。

注：桥梁修复需要重启 dev 桌面才生效；renderer 侧合并/排序修复经 HMR 已在运行中的 dev 应用生效。

排查过程中另外看到一个展示缺陷（与三条根因无关，顺手修掉）：浏览器工具名是动态拼 key 的，目录里没登记的工具（如 `agent_browser_eval`）会把 `activity.named.agent_browser_eval` 这种原始 key 直接当文案渲染到 Feed 里。现在只有目录真实登记过的工具名用自己的标签，其余回退到通用的 `activity.named.browser`（已知可命名的后缀集中在 `browser.ts` 的 `NAMED_AGENT_BROWSER_TOOL_SUFFIXES`，`activity-display.ts` 与 `feed-action-kind.ts` 共用同一份名单），并加了“未知浏览器工具不得泄露 key”的测试（i18n stub 对缺 key 直接抛错，因此旧代码会被该测试直接拓爆）。

### 2026-09-16 run 终态权威、按 attempt 回填与计划缺口收口

历史记录说明：本节第 3 项的时间维度取舍已被后续 `occurred_at` 决策取代，不再是待决策项；当前规格以不变量 4 和 4.2 为准。

排查桌面 Feed 时确认的三个缺口里，有两个在计划正文有依托但实现/协议没落实，本轮把代码与计划一起收口：

1. **run 终态的唯一权威是 `thread_run_attempts`。** 旧桥接在 `tool.completed` 上写 `run.completed`，造成“正确的终态写不进去、错误的终态改不掉”的死结（旧实现遇到不同终态抛 integrity，后端就只能跳过，两端永久分歧）。现在写侧规则是：`payload.authority === "lifecycle"` 的生命周期事件可以纠正已终态的 run（含时间与 `timingQuality`），其他来源仍然粘滞、两个不同终态仍报冲突。`authority` 存在事件 payload 里而不是调用参数里，所以 `rebuildReadModels` 重放后得到同样的读模型。事件构造集中在新的 `conversation-v2-run-events.ts`（`conversationV2RunEventForAttempt`），source key 覆盖 attempt + 状态 + 起止时间，重放即幂等。
2. **按 attempt 回填 run（计划 8.2 步骤 1/6/9 要求的执行终态）。** 两个入口共用同一事件构造：迁移器 `ConversationV2LegacyMigrator` 在迁移一个会话时先按 `thread_run_attempts` 播种 run（并把 attempt 表纳入源指纹与 dry-run 报告 `runAttemptCount`）；运行期 `ConversationStore.reconcileConversationV2Runs(threadId)` 在 V2 bootstrap 前对比镜像与 attempt 表，缺失/状态不同/时间或 `timingQuality` 不同就补一条权威事件（已迁移会话不会因为缺少 V2 stream 而被凭空创建）。桥接不再“靠工具完成伪造 run”之后，这条是移动端 V2 轮次卡片的硬依赖。
3. **读模型的时间维度仍是设计取舍，不是本轮改动。** 计划在第 3 节不变量 4 与 4.2 表设计里主动选了“位置由 `created_seq` 决定”，读模型的 messages/tools/turns 不存 `occurred_at`（只有 runs 有 `started_at/ended_at`）。所以过渡期“V2 条目与旧骨架条目对齐位置”必须有一条明确规则（禁止退化成按 hash/字母序或投影时间排序），这已写进第 7 节 UI 验收；若要每条被补回的行都有真实时刻，需要一次协议变更（读模型加列 + effect 结构变化 + `reducer_version` bump + 双端缓存失效），已在“尚未完成”里列为待决策项。

真实数据验证（dev 库副本，`VACUUM INTO` 快照，不动运行中的库）：run 权威投影在用户重启 dev 桌面后已生效 —— `conversation_runs_v2` 由 2 行变为 16 行，与 `thread_run_attempts` 的 16 条 attempt 逐条一致（含那条被工具完成误判为 11s completed 的 `attempt_execution_0_1789551696822_1`，现为 failed / 09:41:36.822→09:57:27.208 / `timingQuality: recorded`）；事件日志里 13 条 `desktop:run-reconciled:`（12 条历史播种 + 1 条纠正）与 7 条 `desktop:run:` 生命周期事件共存。副本上对 8 个 V2 会话重跑 reconcile：未打开过的 7 个会话共补播种 17 条 attempt run，已修好的会话 0 写入，第二遍全 0（幂等）；`validateIntegrity` 返回 `headSeq = eventCount = effectCount = 10368`。

测试：桌面 `conversation-v2-*` 8 个文件 102/102、并入 Feed/展示相关共 12 个文件 223/223 通过；新增用例覆盖“生命周期纠正已终态镜像”“非权威来源不得改终态”“允许生命周期事件重开被误关的 run”“按 attempt 回填（含只回填时间不改状态）”“未迁移会话不创建 V2 数据”“迁移器播种 run 与 resume 幂等”。

已落地：

- 共享 V2 DTO、事件/effect 语义、版本与错误边界，以及 golden fixture。
- 桌面 SQLite V2 事件仓储、读模型、同步效果、游标、幂等发送和队列恢复。
- V1 写入适配、历史修改桥接、V2 IPC/RPC、bootstrap/page/details/sync/head/entity 查询。
- 桌面 renderer 的 V2 状态 reducer、消息投影接入，以及断序/冲突推送后的 bootstrap + 连续补拉恢复；初始化加载不会覆盖更高游标。
- 移动端 V2 本地缓存、同步引擎、会话接入和可控重复/乱序/丢包/延迟/断连故障注入；已完成 100 个固定种子回放测试。
- 旧数据迁移器、dry-run CLI、迁移状态记录和相关单元测试骨架。
- 持续收口的本地完整性边界：bootstrap 的 `maxBytes` 约束完整响应，历史重写只按显式 `messageId` 关联，读模型/事件 envelope/同步页对非法数据失败关闭；桌面旧投影合并不再按正文、时间或 run/channel 猜 V2 消息归属。
- 桌面 renderer 对 bootstrap 后未知旧序列的重复推送向权威端校验 effect hash；移动端发送进入同步串行队列并显式传播远端错误；工具详情 UI 首次只加载一页，按服务端 cursor 显式继续加载。
- 2026-09-15 本地回归：桌面 V2 相关 11 个测试文件 185/185 通过，桌面生产构建通过；移动端相关 4 个测试文件 178/178 通过；共享包 TypeScript 构建通过，变更相关静态分析无新增诊断。

### 2026-09-16 桌面 Feed 读路径切到 V2-only、代理注册表与差分对拍

用户决定不再以“不影响使用”为目标，直接推进全面 V2；旧代码只作为对拍基准保留，退场前必须删干净。本轮据此完成三件事，并把“把旧单测迁到 V2 上跑”作为发现缺口的手段（结果：首跑即红，暴露出下面两个真实缺口）。

**1）桌面 Feed 改由 V2 读模型直接投影（读侧切，不删任何旧代码）**

- 新增 `buildConversationV2OnlyProjection(conversationV2, thread?)`，替代原来的 `mergeConversationV2IntoProjection`：attempts 来自 `conversation_runs_v2`，主时间线与各代理卡片的工具按 `agent_instance_id` 分流，消息按归属进卡片或主 Feed，代理卡片来自代理注册表，`requestSpans` 为空。`ActivityLogView` 的 `rawProjection` 改为 V2-only + `withLegacyHydration()`。
- `withLegacyHydration()` 只补旧快照里的**非 Feed 内容**：`requestSpans`、`billing`、`context`、`subagentTimings`。这是一张明确的欠账表：这四项进 V2 之前，旧读取路径不能删（见下方退场清单）。
- 旧合并路径 `mergeConversationV2IntoProjection` / `mergeConversationV2MessagesIntoProjection` 降级为**测试与对拍专用**（仍被既有 15 条 merge 测试使用）。

**2）代理注册表 `conversation_agents_v2`（补齐 V2 缺失的代理事实）**

- 新增 `ConversationAgent` DTO（`packages/shared`），承载 `role` / `kind` / `status` / `mission` / `todoId` / 父子关系 / 起止时间；`bootstrap` 与 `messages-page` 都返回 `agents`。
- `conversation-v2-store.ts` 新增 `conversation_agents_v2` 表与 `agent.*` 事件处理（按 `agent_instance_id` upsert，终态不可回退），并新增一次性 `backfillAgentRegistry()`：仅在表**首次创建**时从旧 `thread_agent_instances` 播种，幂等、与重放一致。
- adapter 的 `agent.*` 事件补上 `role` / `kind` / `mission`（旧 `metadata.missionKey`）/ `delegationPrompt` / 父子链接，新数据的注册表不再依赖旧表。
- 桌面 renderer state 增加 `agents: ReadonlyMap<string, ConversationAgent>`，bootstrap 填充，效果应用时校验。
- **实测发现的缺陷（已修）**：播种时 `version_seq` 取“该代理自己的最大事件 seq”，而旧表里的代理常常没有对应事件 → `version_seq = 0` → 客户端读模型校验失败，整条 `conversation:bootstrap` 报 `Stored agent.version_seq is invalid`，这 8 个会话的 V2 读路径整体不可用（真机 dev 库 31 行、8 个会话）。修复：播种版本夹在 `[1, 流头 last_seq]` 内，`last_seq < 1` 的会话不播种。已补回归测试（模拟“有 V2 流、无注册表”的升级库，断言 bootstrap 可读 + 二次升级不重复）。
- **协议决定（2026-09-17 更新）**：代理生命周期产生完整 `agent.upsert`，共享协议、持久化 effect 校验、桌面 renderer 与移动端缓存消费者一起实现并同批发布。保留 effectVersion 1 的现有 envelope，新类型由显式支持清单识别；旧客户端遇到未知类型必须 fail-closed，不能静默跳过。已有 `detail.invalidation` 历史不会原地变成 agent 更新；迁移器现把 `thread_agent_instances` 纳入 source fingerprint，并为每行追加幂等 agent 事件，使新全量重导的 bootstrap 与 seq-0 effect replay 注册表一致。旧 V2 stream 仍必须重导，不能据此宣称原历史已被修复。detail 的完整 source row 必须保留到最终消费边界：桌面 typed renderer 直接消费 DTO，移动端 `ActivityFeedEntry` 携带 `conversationV2Detail`，排序/重编号 copy 不得裁掉版本、父级归属或精确空字符串。移动端已用 `sqflite_common_ffi` 的真实临时磁盘库验证整页事务回滚、cursor 不前移和关闭重开持久化；桌面 command receipt 已进一步通过独立进程提交后、不关闭数据库即 `SIGKILL`、新进程重开重试的恢复验证。该证据不等同于 COMMIT 中途死亡或物理掉电，也不替代真机验证。
- **传输适配契约（2026-09-17）**：移动端 `DesktopRpc` 的 V2 capabilities/bootstrap/messages/details/head/sync/send route 必须以测试固定 channel 与完整 wire args，尤其是分页字节预算、detail owner 过滤、throughSeq 和 clientCommandId。该 recording transport 契约只防 adapter 漂移，不得替代真实 Supabase WebSocket/设备绑定故障矩阵。
- **Realtime 进程内协议契约（2026-09-17）**：合法 V2 invoke 必须从 bind-channel broadcast 经 `DesktopEventCenter` 返回 `{channel, result}` 双层 JSON-RPC envelope；`channel.send()` 抛异常或返回非 `ok` 时必须立即清除 pending/timer，由当前调用失败，不能留下迟发 timeout。该契约仍不等于真实 Supabase 网络验证。
- **接受后调度恢复契约（2026-09-17）**：桌面启动扫描 queued V2 用户消息时，必须从 durable message row 恢复正文和全部附件再交给 runtime；附件损坏必须显式 `integrity_failure` 并把消息终结为 failed，禁止退化成纯文本继续执行。该规则与 receipt/SIGKILL 测试共同覆盖“已接受、未完成调度”的恢复边界。

**3）差分对拍 harness（用户要求的“旧单测搬到 V2”的落地形式）**

- 新增 `apps/desktop/test/conversation-v2-projection-parity.test.ts`：把 `thread-run-projection.test.ts`（旧链路行为规格）的场景改写成同一份旧事件**同时**跑旧投影与 V2 全链路（adapter → V2 store → bootstrap → renderer state → V2-only projection），再对拍**Feed 渲染结果**（turn section / 条目文本顺序 / 代理卡片 / attempts）。
- 首跑结果（4 条）：3 绿 1 红。绿的是本轮已修的能力（叙述-工具-终稿同窗口、同角色并发子代理按 agentId 隔离、代理终态覆盖）；红的是新发现的缺口：

**缺口 A（红，测试已命名标注）：没有 agent id 的 agent-scope 行在 V2 里无法归属**

旧链路用行的 `scope`（加 role/父链接）把“agent 作用域但没有 agent id”的行挂到代理卡片；V2 读模型既没有 `scope` 也没有 provider role，这类行在 V2 侧无法归属，工具从卡片上消失。真机 dev 库量级：旧 `thread_run_events` 里 `scope='agent'` 且 `agent_id IS NULL` 的工具行 23 条（总 3950）。修复方向：把 `scope`（以及 provider role）写进 V2 工具/消息读模型，再按旧投影的规则归属。与下面“角色标签丢失”是同一族缺口。

**缺口 B（已知）：provider 角色标签 `planner/coder/explore/tool` 在 V2 不可得**，`role` 只有 `user/assistant/system/tool`。

### 2026-09-16 读模型补 `occurred_at`、丢弃任务进度行（用户实测的两个 Feed 缺陷）

用户对照真机会话 `thr_1789558307403` 的库事件与实际 Feed，报了两个现象：「出现 2 个处理中」「工具调用莫名其妙出现在中间」。两者都能从事件日志逐条对上，根因都在 V2 读路径，不在展示层。

**缺陷 1：读模型没有“行发生在什么时候”，一轮被切成两段、每段各画一个「处理中」**

- 证据：该会话 V2 消息全部落在 `11:31:47`、工具全部落在 `11:32:37`（run 的起止时刻），而库事件里每行都有自己的 `occurred_at`（11:31:47 → 11:32:37 逐条递增）。Feed 的 turn 分段按时间切，于是同一轮被切成 2 个 turn section，各自渲染一次「处理中 26s」。
- 修复：读模型 `conversation_messages_v2` / `conversation_tool_calls_v2` 新增 `occurred_at`（写入取事件的 `occurredAt`，工具行保留最早值、不被后续更新覆盖），DTO 暴露 `occurredAt?`，桌面 V2-only 投影用 `occurredAt` 定 `at`（run 窗口只作旧行兜底）。effect 结构随之变化，因此**必须**同步扩展 effect 校验器（`storedMessage` / `storedTool`）——实测漏掉这一步会立刻报 `effect hash mismatch`，这是校验器在正确工作。
- 升级路径：列是新增的，`initialize()` 的 ALTER 分支触发一次性 `backfillOccurredAt()`，从 `conversation_events_v2.occurred_at` 按 `message_id` / `tool_call_id` 取最早事件回填（纯重导，与重放一致）。真机 dev 库：1122 条消息、1145 条工具全部回填，0 缺失；重启后无 bootstrap / effect 错误。
- 真机复验：同一会话从「2 个处理中」变为单个「已处理 50s」，顺序恢复为「叙述 → 子代理卡片 → 中间叙述 → 汇总」，工具回到卡片内。

**缺陷 2：把 provider 的任务进度通知当成了一个工具调用，于是主 Feed 里凭空多出一行工具**

- 证据：`tool.started` 行里有 `metadata.sdkTaskKind = "task_progress"` / `liveType = "todo.updated"`、没有 `toolUseId`、`agent_id` 为 NULL 的行（该会话 4 条，dev 库 33 条），其 `metadata.tool.detail` 是 `Running <description>`。adapter 给它们合成了 `legacy_tool_<hash>` 的 tool call id，于是读模型里多出一个“从来没发生过的调用”；它没有归属，就落在主 Feed 中间。
- 修复：这一类行不再产出工具行（与旧链路一致：旧投影也丢弃它们，真正的调用行另有一条），删掉了此前为它们加的“从 `metadata.sdkTaskId` 猜归属”代码。
- 真机复验（副本上重导该会话）：主 Feed 无 `Running …` 残留，卡片内工具行数为 4（与旧投影一致），1 个 turn section；新增回归测试 `does not invent a tool call from a provider task progress row`。
- **已知边界**：已镜像会话里这些行是**不可变事件**，改代码不会重写它们。副本重导已验证能得到 0 残留、正确归属；正式处置已纳入顶部的维护窗口全量重导方案，必须先验证 V2 独有数据守恒，不得照副本实验直接删真实库数据。

**仍未修的同类缺口（有实测样本）**：`scope='agent'` 但没有 `agent_id`、也不是任务进度的工具行（如 `metadata.parent_tool_use_id` 关联的心跳行 `Tool: Bash (30.0s)`，dev 库 24 条），V2 仍无法归属 → 仍会落在主 Feed。修法同上一条（补 `scope`/父链接归属）。

### 回归测试计划（单独成文）

展示层的场景账本、每层期望值来源、93 个场景清单、执行协议（一条一条测：先写红用例 → 证伪 → 修 → 记账）与闸门见 `docs/plans/feed-regression-test-plan.md`。固定真库脱敏语料差分与双端 golden 已进入 CI；需要用户开发库的 `feed:parity` 只作为切换前本地审计工具，不冒充可复现的 CI 门槛。

### V2 全面切换：阶段划分与旧链路退场清单

顺序不可反：先补齐 V2 事实与命令面，再演练全量重导，随后在同一个维护窗口原子切换写侧，最后删除旧运行时代码。

- **阶段 A（已完成）读侧主路径切 V2**：桌面 Feed 和移动端主 Feed 走 V2-only 投影；固定语料差分、双端 golden、桌面/移动端 CI 已落地。旧投影只作为测试基准保留。
  - 阶段 A 本轮补齐的两项（都是真语料审计打出来的缺口，见 `feed-regression-test-plan.md` §4.19）：① **客户端历史分页** —— 读侧切 V2 后 `loadConversationV2RendererState` 只取一页 bootstrap 就返回，60 条消息以前的历史（连同它们的 attempt/tool）在 Feed 里不存在；现在渲染器状态有 `mergeConversationV2OlderPage`（读历史不推进 `appliedSeq`），`App.tsx` 一路翻到 `hasOlder === false`。② **provider 失败通知（`api.error`）** —— 旧链路画成 planner 行（带重试入口），V2 里没有落点，迁移时被记成 `legacy_event_unmapped` 丢弃；现在镜像成 `channel: "system"` 的 notice 消息，两端渲染成通知行（正文与 provider role 保留，行身份用事件自己的 id，因为同一 requestId 可能失败两次）。
- **阶段 B1（进行中）补齐 V2 写入面**：所有 SDK/live 入口直写 V2；实现发送、审批、澄清、计划/todo、编辑、删除、重试/分支的 V2 command + durable receipt。非发送命令的 durable job、append-only checkpoint、Claude fork recovery title、本地 rewind 同事务 checkpoint、runtime prepared identity、首个 attempt/V2 run/dispatched checkpoint 原子提交、attempt terminal/V2 terminal run/command terminal result 原子提交、启动恢复分类与不可能状态耐久失败，以及 `redispatch_prepared` 的安全自动恢复已落地。desktop rewrite、Claude rewind retry 与 Codex/ACP non-rewind retry RPC 现已要求 principal/clientCommandId，生产入口先 accept/claim V2 job，再把稳定 command identity 贯穿到 continuation。non-rewind retry 明确允许 `execution.claimed` 直接进入 `history.runtime_dispatch_prepared`，不伪造 fork/local rewrite；accepted/claimed/prepared 均可在启动时恢复，revision 竞争、unsupported runtime 与 pre-attempt 异步失败会耐久失败。Codex/ACP 首个 attempt 使用 planned identity，ACP command 失败后禁止内部自动重试，也不进入旧的 unstarted turn 删除路径。同 ID 重试不重复历史变更或 runtime dispatch。澄清 submit/dismiss 与 Bash approval resolve 也已分别切 `clarification.resolve` / `approval.resolve` V2 command：桌面和移动端发送 principal、稳定 clientCommandId、thread/tool identity、完整 decision payload 与 expected history revision；claim 在唤醒内存 waiter 前落库，completed response-loss retry 不要求 pending map 仍存在。Bash 的一次性批准、remember-prefix、session grant、exec/network policy amendment、拒绝和取消均保留为不同 durable decision；实际权限副作用仍由 waiter 唤醒后的 runtime 分支执行。由于内存 waiter 无法跨进程恢复，启动时 accepted/running interaction command 会显式失败为 `interaction_context_lost`，禁止自动重放用户答案或权限授予。plan approve/dismiss 生产入口也已切入 `plan.resolve`：双端必须发送 principal、稳定 command ID 与 expected revision，completed receipt 可覆盖响应丢失，payload 变化冲突；durable request 已冻结 pending plan、core/status/runtime config 与 bridge identity，执行前会重新核对。plan 专用 checkpoint 已覆盖 context、snapshot、session mode、bridge delivery、runtime prepared/dispatched、pending clear 与 dismissal，并限制只能用于 `plan.resolve`。approved-plan 产物使用 thread 确定性绝对/相对路径，规范文档先写同目录临时文件再 rename；checkpoint 固定保存两种路径、SHA-256 和算法标识。所有 approve 路径均在 session mode、bridge delivery、runtime dispatch 之前先写并 checkpoint snapshot；启动补 receipt 前必须用冻结 workspace 重新计算确定性路径并校验实际文件哈希，缺失、路径漂移或内容变化均 `integrity_failure`。Codex、Pi、ACP、Claude 的 plan continuation 均使用 command 唯一 dispatch/planned-attempt identity；首次 running attempt、V2 `run.started` 与 `plan.runtime_dispatched` 在同一 SQLite 事务提交，pending-plan 只在 attempt 建立后与 `plan.pending_cleared` 原子删除，attempt 终态不会覆盖已经完成的 approval receipt。pre-attempt failure 会耐久失败 command，dispatch waiter 同时监听 commit hint 并轮询 command 状态，不会挂到假超时。session mode/config 与 checkpoint 也在同一 SQLite 事务。plan 启动恢复现已按 durable 事实分类：accepted 保留等待同命令重试；prepared 无 attempt 明确失败为未启动；dispatched 必须匹配 attempt identity 和 snapshot artifact，主目标补 pending clear 后完成 receipt，强制子代理目标保留 pending；pending-cleared/dismissal-committed 补 completed receipt；仅有 bridge-resolved 而没有 bridge continuation resumed 时因进程内后续结果未知显式失败，所有路径均禁止自动重放；已确认续接的命令才允许清理 pending plan 并完成 receipt。文件产物不再依赖“路径存在即成功”。移动端 rewrite UI 已使用账号 principal 和稳定 command ID；Codex/ACP 非 rewind retry UI 已接入同一稳定 command ID、expected revision 和 V2 receipt，Claude rewind retry 也已接入同一 V2 rewrite command，仅在 `historyTarget.activityLineId + userMessageId` 可验证时启用，缺少 provider identity 时保持 fail-closed。thread delete 已采用独立 `thread_delete_receipts_v2` tombstone，最终数据库删除与 receipt completion 原子提交，双端 envelope 与移动端跨重启 pending delete 已接入；todo 读写、同步、移动端缓存/UI 和一次性 V1 导入已完成；当前没有独立 conversation branch 产品入口，Codex `thread/fork` 已归入 durable rewrite/retry。当前仍需完成的是 `requestSpans`、billing、context、subagentTimings、附件 durable content reference 的生产双端与真实故障/性能门禁；内部 storage cleanup 的会话删除也已统一经过同一 coordinator。桥接在本阶段只用于测试对拍，不能再成为生产写入路径。
- **阶段 B2 全量迁移演练（DEV 已通过）**：`conversation-v2-migrate.ts --all` 已具备预检、备份、checkpoint、完整性报告和失败恢复边界，并已在临时磁盘库和真实 DEV 库完成全量重导；真实 DEV 的第二遍运行返回 `idempotent=true`。生产放行前仍需在构造损坏库、磁盘不足和命令/附件异常上补齐故障矩阵。
- **阶段 B3 原子切换（DEV 已通过，生产窗口待执行）**：CLI 已在真实 DEV 全部会话校验通过后一次性启用 V2-only storage version、V2 写入和 V2 命令，并退役全部 13 张 V1 conversation source table（含 `thread_pending_plans`、follow-up、run、agent、metrics、usage 和 skeleton 表）；生产执行前仍需完成附件/V2 独有数据和 command receipt/job/checkpoint 守恒及范围确认，不存在按会话长期混跑或 V1 fallback。
- **阶段 C 删除旧运行时（本地生产入口已收口，观察期未完成）**：`withLegacyHydration()`、旧 `thread-run-projection*` / `thread-feed-skeleton-*` 文件和 Feed 生产 fallback 已移除；移动端主 Feed、桌面 ActivityLogView、同步与命令入口均只消费 V2。保留的 `legacy-feed-replay-*` / `legacy-feed-skeleton-*`、旧 bridge 和迁移输入只能用于维护、回放和一次性迁移，不能进入 V2-only 生产路由。旧表仅保留只读迁移备份。**剩余门槛**：G-1 至 G-5 全绿、生产迁移/manifest 与故障矩阵、真实 Supabase authenticated matrix、真机性能结论，以及兼容代码观察期结束后的物理删除。

尚未完成，不能据此宣称整份计划完成：

- 老会话的 V2 run 覆盖：已由“迁移器按 attempt 播种 + 启动全库 reconcile + bootstrap 前按会话 reconcile”补齐（见第四十二批）。
- 旧 V2 工具行的结构化字段仍有数据缺口，但迁移器已补上安全路径：legacy source 仍在时可追加幂等 `tool.updated` 回填可证明的 `input/output`；当前 DEV 已退役 V1 源，审计仍有 100 条 `input_json` NULL、1160 条 `output_json` NULL，因此不能伪造补值。读取行范围、`fileChange`、联网搜索等结构化语义仍需在生产维护窗口重导后复核；MCP / `mcpScript` / `TaskStop` 等源本身无 detail 的行继续显示泛化标签。
- V2 消息读模型已经纳入小型用户图片预览并能在移动端气泡展示；移动端发送路径复用既有 64KB 分块上传，桌面在 V2 消息最终化时把队列中的桌面本地路径替换为预览，避免跨设备泄漏不可读路径。大附件的 durable content reference、跨设备分块读取和内容权限仍未完成，当前预览仍不是完整附件存储方案。
- 工具摘要现在有独立的 `conversation:tools-page` opaque cursor、总数/过滤和字节预算；bootstrap/messages page 会优先裁剪可独立回补的摘要，桌面 renderer 与移动端 cache/session 会追完工具页并跨重启保存。大 run 的实现缺口已闭合，但生产规模的真实负载、滚动/内存/延迟测量仍未完成，不能用 DEV 单机回归替代。
- 移动端 V2 页面已经通过 V2 会话控制器接入审批、澄清、计划和续写；动作完成后会补拉并重新解析 V2 详情，避免旧页面状态继续作为事实源。现有 RPC 仅作为传输层，生产 handler 已携带 principal、稳定 command id 和 expected revision 进入 V2 command receipt/job；不再另设一套会绕过 V2 的移动写面。
- 真实 Supabase 弱网/重连/末条丢失集成验证、跨端 fixture 对拍和桌面/移动端完整 E2E。
- 真实旧库副本上的迁移 dry-run、备份/中断恢复/切换演练已在 DEV 完成；仍需把 command/附件故障矩阵和生产维护窗口操作手册固化。
- Android/iOS 真机长会话、滚动/内存/延迟性能测量与预算验收。
- `occurred_at` 已进入消息/工具读模型、effect、双端 DTO 与排序逻辑；升级回填和双端测试已落地。`created_seq` 只用于同一时刻的稳定 tie-break。
- 已被旧桥接写入的错误终态 run 已被本轮权威规则纠正（dev 库实测两端一致）；现已补齐协议层的管理员覆盖/纠正事件 `run.corrected` 与 `conversation:v2-correct-run` CAS 修复命令。事件携带 `authority`、`actorPrincipalId`、`reason`、`expectedPreviousStatus`，迁移 manifest 可精确重放并校验 hash。剩余的是生产维护窗口演练、权限控制和审计运营流程，不再是协议缺口。
- 旧骨架和旧投影链路的生产引用清理：桌面 `ActivityLogView` 已不再接受旧 projection/viewModel 回退，主 Feed 生产入口只消费 V2 状态；保留的 `ThreadRunProjection*` 仅是 V2 read-model 展示 DTO，`legacy-feed-replay-*` / `legacy-feed-skeleton-*` 仅服务维护、回放和迁移测试。剩余的是这些兼容/迁移代码的观察期清理，以及生产窗口证据。
- 固定真库语料差分与跨端 golden 已落地并进入 CI；G-5 的实体字段与 projection extras 字段守恒契约已自动化，切换前仍要补完 P0 未覆盖场景，切换后旧投影测试只保留到观察期结束。
- provider role、行时间、代理归属与父调用关系已进入 V2 读模型和双端 DTO；实体字段与 projection extras 已纳入 G-5 自动守恒清单，后续新增字段会被接口 inventory 测试拦截。
- 桌面 TypeScript（`apps/desktop` tsconfig 与仓库级 `tsc -b`）和 Flutter test/analyze 当前本地通过；CI 基线、运行时监控指标接入、真实 Supabase/设备门禁仍未完成。

本文第 1–8 节保持为**规格**（新接口、表名、不变量和性能预算是设计要求，不代表现有能力）；第“当前实施状态”各节记录实现与实测证据。第三方复核与未决问题见 `docs/plans/conversation-storage-sync-v2-acceptance.md`，展示层回归场景见 `docs/plans/feed-regression-test-plan.md`。

## 1. 目标与交付边界

彻底解决桌面与移动端对话顺序错乱、骨架反复出现、流式正文重复或缺失、重连后状态不一致、历史与实时相互覆盖的问题。

最终架构：不可变事件日志作为唯一事实源；同事务维护消息、执行、工具等查询读表；桌面与移动端使用相同的消息语义、版本规则和同步协议。移动端历史按游标分页，中间过程按需加载。实时传输允许重复、乱序和断开，通过持久化游标与范围补拉恢复。

验收不以“正常聊天看起来可以”为标准，而以故障恢复后状态一致、全量重放一致、双端一致和真机性能达标为标准。

本期包含：

- 事件写入、运行时适配、消息及执行读表、详情读表。
- IPC/远程 RPC、推送、补拉、版本协商。
- 桌面列表与移动端列表、移动端持久化缓存及同步状态机。
- 用户消息幂等提交、执行状态恢复、编辑/删除/重新生成/分支的展示语义。
- 旧数据迁移、协议切换、旧链路清理、测试与监控。

默认产品边界：一个会话由一个桌面数据库权威写入；移动端为读副本和命令发起端。保留现有 Supabase 通道作为传输，不假设广播具有可靠消息队列语义。桌面离线时手机可阅读已缓存历史，未缓存历史明确提示需桌面在线。本期不承诺云端完整历史副本、多桌面同时写同一会话或离线执行模型任务。

若产品要求桌面关闭后仍能加载任意历史，必须另立云端持久化及复制任务，在上线前明确是否扩展本期；不能用本地缓存冒充完整离线能力。

## 2. 已确认的现状与代码入口

下表路径均相对于仓库根目录。代码行号会变化，以符号名为准。
第七十四批完成了运行时/兼容模块的路径语义化重命名；历史批次中的旧文件名只用于解释当时的排查证据，不再表示当前生产入口。

| 入口 | 当前作用/问题 | 改造要求 |
| --- | --- | --- |
| `apps/desktop/src/main/conversation-store.ts` / `appendThreadRunEvent` | 同 ID 事件可能被 UPDATE，部分更新重新分配 sequence | 新增事务事件仓储，禁止修改已提交日志 |
| `apps/desktop/src/main/thread-run-event-sequence.ts` | 部分 delta 更新推进序列 | 替换为会话内事务分配，新事件新序列 |
| `apps/desktop/src/main/thread-run-event-live-persist.ts` | live 事件规范化、写入、触发投影 | 接入统一写入事务，提交后发布 |
| `apps/desktop/src/main/mobile-remote-event-publisher.ts` | 流式投影默认 5 秒节流、合并，过滤部分 delta | 发布持久化同步记录或水位；停止合并旧骨架 |
| `apps/desktop/src/main/event-center.ts` | 传输事件中心，含进程内序列 | 传输序列不得充当会话数据库游标 |
| `apps/desktop/src/main/legacy-feed-skeleton-*.ts` | 仅保留迁移/回放兼容的骨架缓存、选择、补丁 | V2-only 主列表不加载、不维护这些模块；兼容观察期结束后再删除 |
| `apps/desktop/src/main/conversation-v2-runtime-projection.ts`、`conversation-v2-projection-request.ts`、`legacy-feed-replay-*.ts` | V2 runtime 投影请求与 legacy 回放/详情兼容分界 | 生产读面只调用 `conversation-v2-*`；legacy 文件只能由维护/回放入口显式调用 |
| `apps/desktop/src/main/thread-session-bootstrap.ts` | 会话启动数据 | 提供与消息页同一快照的状态及水位 |
| `apps/desktop/src/main/supabase-realtime-rpc.ts` | 远程 RPC | 新协议、鉴权、消息大小限制、错误码 |
| `apps/desktop/src/renderer/conversation-v2-turn-feed.ts`、`feed-virtual-sections.tsx` | 桌面 V2 轮次与虚拟列表 | 消费 V2 消息及执行读模型，稳定 key 和滚动锚点 |
| `apps/mobile/lib/features/threads/thread_providers.dart` | bootstrap、投影合并、重连、详情加载混在状态管理中 | 拆成 repository、同步引擎、页面状态；不再按时间/事件数量猜新旧 |
| `apps/mobile/lib/core/network/desktop_rpc.dart` | 历史/详情远程接口 | V2 DTO 与游标接口 |
| `apps/mobile/lib/core/network/eco_center_client.dart`、`eco_realtime.dart` | 通道连接和重连 | 仅负责传输，不决定对话完整性 |
| `apps/mobile/lib/core/models/conversation_v2_projection_models.dart` | V2 投影展示 DTO 与合并模型 | 仅作为 V2 read-model presentation DTO；旧事件/骨架逻辑不得回流 |
| `apps/mobile/lib/features/threads/projection_activity_feed.dart`、`activity_feed_scroll_coordinator.dart`、`thread_session_screen.dart` | Feed 与滚动、显示组装 | 统一消息排序、加载状态、详情分页和活动执行展示 |
| `packages/runtime/src/*event-adapter.ts`、`sdk-stream-events.ts` 等 | SDK 事件来源 | 明确追加 delta / 累计快照 / 最终结果，不能混用 |

这些是结构缺口的证据，不能据此声称已定位每一个线上故障。阶段 0 必须保存真实复现样本。

## 3. 必须满足的不变量

1. 在同一 `(store_epoch, conversation_id)` 中，已提交事件序列从 1 开始连续递增，不重排、不复用。事务回滚不产生可见缺号。
2. 已提交事件内容不可 UPDATE；语义修正以新事件表达。事件硬删除/日志裁剪不在本期范围，隐私物理清除另有专门流程。
3. 同一个来源事件重试不得生成两个业务事件；同 ID 不同内容必须报冲突，不能静默覆盖。
4. 消息位置由 `occurred_at`（事件里该行发生的时间）决定；`created_seq` 只表示读者何时学到这一行（流式增长和状态更新只改变 `version_seq`）。读模型必须携带 `occurred_at`：只按序列号排序无法把一条消息放进同一轮的两个工具之间，真机上表现为同一轮被切成两段、各画一个状态头。回填只能来自事件日志，不得猜测。
5. 事件、查询读表和可补拉的同步效果在同一数据库事务中提交；推送只发生在提交以后。
6. 客户端仅推进已连续应用并持久化的同步游标；最大收到序列、当前可见消息最大序列都不是同步游标。
7. 初始快照的数据和水位 H 来自同一读取事务；旧快照不能覆盖更高版本的消息和状态。
8. 历史覆盖范围、详情覆盖范围、实时同步位置分别存储，不互相推断。
9. 网络恢复且权威端可用后，所有已加载实体最终收敛到服务端读模型；未加载实体仍能按需查询正确版本。
10. 删除读表后重放事件，得到与在线事务更新相同的规范化读模型。
11. 已完成/失败/取消执行不因迟到的普通 delta 回到 running；真正恢复必须新建执行或明确的恢复事件。
12. 获取失败、迁移缺失、协议不支持、数据损坏都明确暴露状态，不用空数组、骨架或“已同步”掩盖。
13. 一次执行的终态只有 attempt 生命周期（以及由此派生、带 `authority: "lifecycle"` 的 run 事件）可以写：工具完成、重放的旧行等来源一律不得把 run 推向终态，也不得改写已有终态；生命周期记录可以纠正被误写的终态（含起止时间与 `timingQuality`）。两端读到的是同一个状态，不允许“服务端保留首个终态、客户端照收”这类分歧。
14. 消息与工具行的**归属**（`agent_id` / `agent_instance_id`）和正文一样是不可变事实，必须从事件带进读模型并在同步中保留：主 Feed 只呈现无归属（主代理）的行，子代理的叙述属于该代理卡片。归属是已知代理时不得留在主 Feed；归属找不到对应代理（孤儿）时退回主 Feed——宁可展示，也不把内容藏到没有任何地方能渲染的位置。
15. provider 的**进度通知与心跳不是工具调用**：`metadata.sdkTaskKind = "task_progress"` / `liveType = "todo.updated"` 的进度行、以及 `toolUseId` 形如 `call_…-heartbeat-N` 的心跳行，一律不得进入工具读表或主 Feed。旧链路对同一会话输出 0 条（实测 `thr_1789531481908`），V2 保留它们就是分叉。这类行要按来源分类丢弃，不能用“给它猜一个归属”来掩盖。
16. 读模型/同步 effect 的**结构变更必须同步扩展校验器**（`storedMessage` / `storedTool` 等）并保持重放可重建：本轮加 `occurred_at` 时漏掉校验器会立即报 `effect hash mismatch`，这是校验器在正确工作，不是可以绕过的噪音。
17. 位置、归属、状态任一属性在事件→读模型→同步→渲染链路上丢失，属于必须暴露的缺陷，不允许静默降级成“先按主代理显示、展示层再过一遍”。归属找不到代理卡片时退回主 Feed 是**显式规则**（见不变量 14），不是静默兜底。

## 4. 数据模型

### 4.1 标识和关联

- `conversation_id`：会话标识，映射现有 threadId。
- `store_epoch`：数据谱系标识。数据库备份恢复到旧状态或整体重建后更换，避免复用序列误判已同步；普通进程重启不更换。
- `turn_id`：一轮交互，不假设恰好一条用户消息配一条回答。
- `run_id`：一次执行；重试/重新生成与用户轮次分别建模，关联 `retry_of_run_id` 或 `regeneration_of_run_id`。
- `message_id`：气泡或过程消息的稳定身份，与 event_id 分开。
- `tool_call_id`、`agent_id`：工具及子代理归属，不以工具名称匹配调用。
- `client_command_id`：发消息等命令的幂等键，作用域包含认证用户和会话。
- `source_event_key`：上游重放去重键，包含 provider、session、run 和上游事件身份；上游无稳定 ID 时必须在入口明确生成及重启去重策略。

禁止只根据时间相邻、正文相同、当前最新 run 来猜归属。无法明确归属的 SDK 事件记录诊断并暴露错误/不完整状态。

### 4.2 建议表

| 表 | 主要字段 | 说明 |
| --- | --- | --- |
| `conversation_streams_v2` | conversation_id, store_epoch, last_seq, history_revision, reducer_version | 单会话写入锁与水位；history_revision 用于结构性历史变更，不是实时游标 |
| `conversation_events_v2` | conversation_id, seq, event_id, type, turn_id, run_id, message_id, tool_call_id, agent_id, occurred_at, recorded_at, schema_version, source_event_key, payload_json/payload_ref | 不可变事实日志，保留来源类型和原始内容 |
| `conversation_messages_v2` | message_id, conversation_id, turn_id, run_id, role, provider_role, channel, agent_id, agent_instance_id, occurred_at, created_seq, version_seq, content_version, content/body_ref, status, is_deleted | 主列表查询；channel 区分 answer、commentary 等，occurred_at 决定展示位置 |
| `conversation_runs_v2` | run_id, turn_id, status, started_at, ended_at, version_seq, timing_quality, retry_of_run_id | 运行状态与时间，不通过有没有最终正文推断 |
| `conversation_turns_v2` | turn_id, conversation_id, created_seq, active_run_id, version_seq | 轮次关系及当前执行 |
| `conversation_tool_calls_v2` | tool_call_id, run_id, agent_id, agent_instance_id, parent_tool_call_id, provider_role, name, status, occurred_at, created_seq, version_seq, input_ref, output_ref | 一次调用一行，start/delta/end 不重复计数 |
| `conversation_detail_items_v2` | item_id, run_id, agent_id, tool_call_id, type, created_seq, version_seq, content/ref | 展开时读语义化过程；原始日志用于审计和诊断 |
| `conversation_sync_effects_v2` | conversation_id, seq, effect_version, effect_json/ref | 与日志一一对应的不可变同步效果，允许仅含元数据；同事务写入 |
| `conversation_command_receipts_v2` | principal_id, conversation_id, client_command_id, request_hash, result_json, accepted_seq | 发消息重试得到相同结果；不同请求体复用键则冲突 |
| `conversation_command_jobs_v2` | principal_id, conversation_id, client_command_id, command_type, request_hash, request_json, expected_history_revision, status, result_json, error_json, accepted_seq, accepted_at, updated_at | 编辑/删除/重试等非发送命令的耐久调度状态；`accepted/running/completed/failed` 显式区分 |
| `conversation_command_checkpoints_v2` | principal_id, conversation_id, client_command_id, ordinal, name, payload_hash, payload_json, recorded_at | 非发送命令 append-only 执行检查点；history 路径固定 claim/fork/local rewrite/runtime dispatch，plan 路径固定冻结上下文后记录 snapshot/session/bridge/runtime/pending-clear/dismissal 等事实；缺口、越序和损坏必须阻断恢复 |
| `thread_delete_receipts_v2` | principal_id, thread_id, client_command_id, request_hash, expected_history_revision, status, result_json, accepted_at, updated_at | 完整会话删除的独立 tombstone；不能放进将被删除的 conversation-local job/stream。每个 thread 最多一条 accepted delete，最终事务同时删除 thread/V2 stream 并完成 receipt |
| `conversation_migrations_v2` | migration_version, conversation_id, source_fingerprint, phase, checkpoint, validation_json | 迁移幂等、恢复和审计 |

同步效果表是可从日志重建的服务端读产物，用于让 TypeScript 和 Dart 不必各自理解所有 SDK 事件。它不是第二份业务事实；版本与重放一致性必须验证。长正文不能在每次 delta 的效果中重复保存完整累计字符串。

读模型的时间维度（2026-09-16 决策并已落地）：`conversation_messages_v2` / `conversation_tool_calls_v2` **携带 `occurred_at`**，取自产生该行的事件的 `occurred_at`（工具行保留最早值，不被后续更新覆盖；`version_seq` 仍记录最新修订）。执行时间继续只存在 `conversation_runs_v2`（`started_at`/`ended_at`/`timing_quality`）。这条决策是必须的而不是可选的：只按 `created_seq` 排序无法把一条消息放进同一轮的两个工具之间，真机现象就是同一轮被切成两段、各画一个「处理中」。代价是 effect 结构变化（校验器必须同步扩展，见不变量 16）+ 客户端按协议失效；升级路径是 `initialize()` 的 ALTER 分支触发一次性 `backfillOccurredAt()`（从 `conversation_events_v2` 按 `message_id`/`tool_call_id` 取最早事件回填，纯重导）。真机 dev 库回填 1122 消息 / 1145 工具，0 缺失，二次 initialize 幂等。

附件、大工具输出使用持久化内容引用和校验值。文件必须先可靠落盘，再提交引用；失败会留下的孤立文件可清理，但不能提交不存在的文件引用。正文不静默截断，超限用显式分块/分页协议。

建议唯一约束及索引：

```text
events: UNIQUE(conversation_id, seq), UNIQUE(event_id)
events: UNIQUE(conversation_id, source_event_key) WHERE source_event_key IS NOT NULL
events: (conversation_id, run_id, seq), (conversation_id, tool_call_id, seq)
messages: (conversation_id, created_seq DESC, message_id)
messages: 主列表可见 channel 且未删除的部分索引，具体 SQL 用 EXPLAIN 验证
details: (run_id, created_seq, item_id), (tool_call_id, created_seq, item_id)
tools: (run_id, name, tool_call_id)
sync_effects: UNIQUE(conversation_id, seq)
receipts: UNIQUE(principal_id, conversation_id, client_command_id)
```

主消息历史不做 OFFSET 深分页，也不每次扫描全会话日志 GROUP BY。工具数量按 tool_call_id 统计，必要时同事务维护每个 run 的分类计数。

### 4.3 事件类别和状态机

最少覆盖：用户消息接受、消息创建、正文追加、正文替换、消息最终确认、执行开始/完成/失败/取消、工具开始/更新/结束、审批请求/解决、澄清请求/解决、历史编辑/删除、分支/重新生成、运行中追加用户输入、恢复中断执行。

必须区分：

- `message.delta` 是追加片段；`message.replaced` 是显式替换；上游累计快照不能直接当追加。
- 消息 final 与 run completed 是两种事实：最终正文已出现时，执行可能还有持久化或工具收尾。
- 执行的开始/完成/失败/取消只能由 attempt 生命周期产生（见不变量 13）；工具、消息、审批等事件不得推 run 终态。生命周期事件带 `authority: "lifecycle"`，可以纠正错误终态；其他来源只能创建/推进一次，冲突报错。该字段必须在不可变 payload 里，否则读表重放无法得出相同读模型。
- 通信断开不是执行失败；启动恢复时检查运行时是否可恢复，无依据时标记 interrupted/unknown，不能伪造 completed。
- 待审批、待澄清和失败/取消有独立摘要，不能因为没有最终回答而在历史中消失。
- 思考和 commentary 默认进入过程详情；进行中的 answer 可流式显示，最终仍为同一个 message_id。

状态机和每种事件的 reducer 输入/输出必须写成协议表及共享 fixture，评审通过后再实现双端。

### 4.4 耗时

默认“已处理”表示权威端 recorded_at 定义的执行开始到终止的墙钟耗时，包含工具及等待时间；排队单独记录。若展示纯执行耗时，必须累计明确状态区间，不以两条相邻消息的时间差代替。

权威时间优先用于跨设备一致性，客户端时钟只用于运行中显示递增效果。旧数据缺少边界时显示耗时未知，或有依据时明确标记估算。系统时钟回拨需诊断，不允许把异常负值伪装成精确的零耗时。

## 5. 写入事务与可靠性

单会话串行写入，序列分配与日志 INSERT 在同一事务执行。首版使用现有桌面 SQLite 驱动，验证实际运行时的事务、WAL、busy timeout 和同步持久化设置；不要未经测量更换数据库。

```text
接收来源事件/用户命令
  → 校验身份、关联及幂等键
  → BEGIN 写事务
  → 重复则返回既有结果；冲突则报错
  → 读取并递增该会话 last_seq
  → INSERT 不可变 event
  → reducer 更新 messages/runs/tools/details 等读表
  → INSERT 对应不可变 sync_effect
  → 必要时记录 command receipt
  → COMMIT
  → 发布 seq 或事件批次；发布失败仍可从数据库补拉
```

支持事务内写一批事件，但每个事件有独立 seq。可以合并网络包和 UI 刷新，不能只保留批次最后一条而丢失协议覆盖信息。

上游事件持久化失败时必须中断/暂停相应消费并暴露错误；不能继续向 UI 推送看似成功的内容。对没有 ACK/replay 能力的 SDK，进程在收到事件而尚未落盘时崩溃，无法凭空保证恢复该事件；阶段 0 要核实各适配器恢复能力，无法恢复时明确标记执行不完整。

SDK 会话记录仍可服务于模型上下文恢复，但不能继续成为 UI 另一条并行事实来源。

## 6. V2 查询与同步协议

建议在现有 RPC 通道上新增以下方法，名称可按仓库规范调整，语义不得模糊。所有方法都要执行会话访问授权与参数边界校验。

### 6.1 协商与 bootstrap

`conversation.capabilities` 返回 protocolVersion、事件/effect 支持版本、批大小上限和 storeEpoch。

`conversation.bootstrap(conversationId, pageSize, maxBytes)` 在单一读取事务返回：

```text
protocolVersion, storeEpoch, conversationId
snapshotSeq = H
historyRevision
最新一页主消息：含 createdSeq、versionSeq、contentVersion
当前轮次/执行、审批/澄清及可见轮次摘要
olderCursor、hasOlder
```

bootstrap 只对返回实体提供 H 时刻快照，不声称手机已缓存 H 以前全部事件或历史。若移动端首次进入时不在进行中，也必须返回明确终态。

先订阅并缓冲，然后 bootstrap，安装快照后应用 `seq > H`；无论订阅是否看似成功，都调用 sync 拉取 H 之后的记录闭合竞态。旧 bootstrap 响应由请求 generation 和 storeEpoch 检查丢弃。

### 6.2 历史分页

`conversation.messages.page(conversationId, beforeCursor, limit, maxBytes)`。

游标包含固定位置 `(created_seq, message_id)`、storeEpoch、historyRevision；服务端校验，客户端不自行计算 opaque cursor。按倒序查询，客户端正序展示。返回 readSeq、下一页游标、hasMore。

后续历史页读取当时最新消息内容，不宣称为首次 H 的历史快照；逐实体 versionSeq 合并，旧页不得覆盖新实时状态。historyRevision 因删除、编辑影响结构、分支切换发生变化时，明确返回历史失效状态并重新锚定窗口，保留仍存在的可见消息锚点。

实时效果可能更新未加载的老消息：不把它插到最新列表、不创建大量气泡；记录窗口失效/实体版本标记，未来分页读取最新值。对正在请求的页面，若响应 readSeq 早于期间观察到的更新，则应用暂存效果或重新查询该页。不能简单丢弃未加载实体更新后安装旧页。

### 6.3 过程与工具详情

`conversation.details.page(conversationId, runId, agentId?, toolCallId?, cursor, limit, maxBytes)`。

- 展开先加载一页，按可见范围继续；禁止展开即循环拉完全部 500 条页。
- 工具摘要返回分类和调用数量，输入、输出正文单独分页/分块。
- 每个详情实体有 versionSeq，活动调用可继续更新。
- 详情缓存范围与同步游标分开。详情可能失效时明确重取，不用“已加载过”永久跳过。

### 6.4 连续同步

`conversation.sync(conversationId, storeEpoch, afterSeq, throughSeq?, maxEvents, maxBytes)`。

返回 `fromSeq, throughSeq, headSeq, hasMore, effects[]`。fromSeq 为 afterSeq + 1；effects 覆盖每一个已提交序列，序列连续，包括不影响主列表的 metadata/noop 效果。没有新增时 throughSeq 等于 afterSeq，effects 为空。

同步 effect 的类型限定为标准操作，例如：message create/append/replace/finalize/tombstone、run upsert、tool summary upsert、detail invalidation、history invalidation、noop。正文追加携带 messageId、baseContentVersion、nextContentVersion 和片段。各 DTO 有明确版本与验证规则。

折叠工具输出不传大正文，只传身份、版本、摘要或详情失效信息。完整原始 payload 仍在服务端日志/内容库。不能仅筛选 user/final 事件后沿用原始 seq 做连续性判断。

客户端收到 n+2 而缺 n+1：先缓冲、不推进 cursor，调用 afterSeq=n 范围补拉；应用连续记录后恢复。重复已应用记录直接跳过；相同 seq 不同 eventId/effect hash 为数据完整性错误。

未知 effect/schema 版本不能当 noop 跳过：停在该序列并提示需要升级。明确声明的 noop 才可直接推进。

对于已缓存正文版本不匹配，调用 entity get 获取带 versionSeq 的当前实体，修复后继续；该实体可比当前流游标更新，因此每个实体都须忽略不高于本地版本的后续重复效果。范围游标仍逐条连续推进。修复失败保留同步错误，不能吞掉正文片段。

网络批量可设初始目标 50～100ms 聚合窗口并同时限制字节数，作为待测配置。它不改变逐事件落库和补拉语义。超过单包的主消息增量必须分帧/持久化引用读取，未完整读取前不能确认已应用。

### 6.5 尾部丢失、重连和背压

`conversation.head` 返回 storeEpoch、lastSeq、historyRevision。前台活动会话初始每 10 秒核对水位，运行中/完成附近可缩短；最终数值按成本和恢复 SLA 测定。每次重连、App 回到前台、桌面重新在线都立即核对。

这负责发现“最后一个完成事件丢了，之后再无消息”的情况。不能只靠接到更大 seq 才查缺口。

客户端离线时暂停重试计时器，重新可用后指数退避带抖动；新连接立即尝试一次。缓冲区按事件数和字节限制；达到上限时放弃未应用内存包，从已持久化 cursor 重新拉取，不丢已确认状态、不强制全量重载所有历史。

服务端不为每个离线手机积攒无限内存队列。持久化日志就是重放来源；推送失败后水位核对能恢复。

### 6.6 命令与错误

`conversation.sendMessage(..., clientCommandId)` 返回正式 messageId、acceptedSeq 和状态。手机发送前持久化待发送命令；超时重试复用相同键；用回执把临时气泡替换成正式身份，保持视觉位置。发送已被接受但运行时尚未执行，也必须是可见 queued 状态。

编辑、删除、重新生成等命令同样幂等并检查预期版本。非发送命令使用独立 `conversation_command_jobs_v2`，接受命令与 `command.accepted` 的 V2 `noop` 审计事件同事务提交；同 key 同请求返回现有 job，同 key 不同请求显式 `idempotency_conflict`。领取执行权时再次比较 history revision，版本变化必须耐久失败。执行事实进入 append-only `conversation_command_checkpoints_v2`，不允许跳步、倒退或同名不同 payload。Claude fork 在调用前记录源 session、截断点、cwd 和 command 唯一 recovery title；SDK 显式 fork 不能指定目标 UUID，因此响应丢失后用 `listSessions` 按该 title 核对，唯一匹配才继续，多个匹配完整性失败。旧表删除、V2 history invalidation 与 `history.local_rewrite_committed` 必须同一 SQLite 事务。runtime dispatch 固定为 `history.runtime_dispatch_prepared` → `history.runtime_dispatched`：prepared 先耐久保存 command 唯一 `dispatchId` 和 `plannedAttemptId`；生命周期必须使用该预分配 attempt ID，并把 command 归属写入 attempt metadata。首次 running attempt、V2 `run.started` 与 dispatched checkpoint 必须同一 SQLite 事务；同一 planned attempt 已存在时禁止再次请求外部模型，必须进入恢复判定。non-rewind retry 没有 fork 和 local rewrite，只允许 `history.retry + request.rewind=false` 从 claim 直接进入 prepared；其他命令跳过历史 checkpoint 必须显式冲突。内存交互命令必须在触发 waiter 前先 claim，以 at-most-once 边界换取响应丢失幂等；进程重启后结果未知的 running interaction 禁止自动重放，必须耐久失败。desktop rewrite、Claude/Codex/ACP retry 与 clarification resolve 已接入相应 V2 链路；移动端 retry UI 及其余非发送命令在具备同等 command identity、checkpoint、恢复和 durable result 前不得切换。不能承诺对不支持幂等的外部工具执行“恰好一次”。

完整会话删除是例外：若把 receipt 放在 conversation-local command 表或 stream 中，删除成功会同时销毁幂等证据。因此它使用独立 `thread_delete_receipts_v2` tombstone。顺序固定为“接受 tombstone → 幂等清理外部 session/file → 单一 SQLite 事务删除 thread-owned rows 与 V2 stream，并把 receipt 标为 completed”。崩溃在外部清理阶段时同一 command 重试；最终事务回滚时 thread、stream 和 accepted receipt 必须全部保留。只有 matching completed receipt 才能把已消失 thread 判为成功；新 command 面对缺失 thread 必须显式失败。移动端在发出命令前把完整 delete envelope 持久化到 V2 SQLite，响应丢失或应用重启后复用原 key，禁止尝试从已经删除的 thread 重新读取 head。外部 SDK/session/file 与 SQLite 无法原子提交，只承诺幂等重试，不宣称 exactly-once。

必备错误分类：访问拒绝、会话不存在、版本不支持、epoch 不匹配、历史游标失效、范围不可用、幂等冲突、存储失败、迁移未完成、数据完整性失败。只对可重试错误自动重试。

## 7. 双端状态和 UI

移动端新增事务型本地数据库。当前依赖列表未见专用 SQLite ORM，阶段 0 比较 Flutter 支持、事务、迁移、测试及包体后选型并固定版本；不要用 shared_preferences 保存事件缓存和同步游标。遇到 SDK/库问题先查社区同类问题，技术结论用官方文档或可复现实验确认。

缓存主键包含账号、桌面身份、storeEpoch、conversationId。至少持久化：消息窗口、执行摘要、详情页覆盖范围、sync cursor、history revision、待发送命令。消息应用与 cursor 更新必须同一事务。

同步引擎与 Widget 分离，建议状态：uninitialized / bootstrapping / catching_up / live / offline / error / incompatible。历史初始加载、上翻加载、详情加载各有独立状态，禁止一个 loading 控制整页。

桌面 renderer 也消费 V2 DTO 和版本规则，允许通过本地 IPC 降低传输成本，但不能另写一套按投影时间合并的语义。TypeScript/Dart 无法直接复用 reducer 时，通过共享 JSON 协议和 golden fixtures 保证等价。

UI 验收规则：

- 主列表排序为 createdSeq + messageId；Widget/React key 使用稳定 messageId。
- 过渡期把 V2 条目与旧骨架条目合并展示时：V2 行有真实 `occurred_at`，直接按它排序；`created_seq` 只用于**同一 run 内**的次序打破平局。旧行（无 `occurred_at`）只允许回落到该 run 的执行窗口，**不得**退化成按 hash/字母序、按 key 或按“当前时间”排序；被骨架裁掉的行不得因此改变真实顺序，也不得被当成新建在末尾的内容。状态头（「已处理 N」）每一轮只允许一个：同一轮的行必须落在同一个 section。
- 首次无缓存可显示骨架；有缓存重连时展示缓存及同步提示，不退回全屏骨架。
- 失败有重试入口，空会话有空态，缺失数据有明确标识。
- 默认展示用户消息、answer 和执行状态摘要；过程折叠，必要审批/澄清始终可操作。
- 归属决定位置：主 Feed 只呈现无 `agentId`（主代理）的行；子代理的叙述与工具必须落在该代理（`agents[].timeline`）且带 `scope: "agent"`（与旧投影把 `scope=agent` 行按 `agentId` 落到卡片一致）。找不到对应代理的孤儿行退回主 Feed，不得因为渲染不到就丢内容。归属丢失（读模型或 DTO 少字段）属于不变量 14 的违反，不允许“先写 `scope: main` 再靠展示层过滤”的代替方案。
- 新增消息只有在用户接近底部时自动跟随，否则显示未读/新消息提示。
- 上翻插入历史后保持首个可见 messageId 及像素偏移；图片加载、Markdown 高度变化、键盘伸缩、横竖屏也验证。
- 流式刷新按帧批量，数据确认不等待 UI 渲染；视图销毁不会中断已提交游标的持久化。
- 切换会话/桌面/账号后，旧异步响应不能污染新页面；每次请求带上下文与 generation。
- 缓存清理保留覆盖范围语义。清掉实体后必须标记未缓存，不能因 cursor 较新误以为正文仍在本地。

## 8. 历史修改和首次迁移

### 8.1 新数据历史语义

删除用 tombstone，编辑用新事件，重新生成建立新 run；旧执行保留为历史，当前展示选择显式记录。分支记录来源会话及边界，新的会话有自己的序列。不要通过 DELETE 历史日志后复用序列实现这些操作。

结构变更递增 historyRevision，客户端失效受影响窗口及详情，保留可确认的新数据。编辑是否自动废弃后续回答等产品行为要在阶段 0 对照现有功能固定规则并测试。

### 8.2 迁移步骤

1. 盘点 `thread_user_messages`、`thread_run_events`、`thread_run_attempts`、旧 activity/骨架/SDK 原始记录；列出各年代数据和可恢复字段。`thread_run_attempts` 是执行状态的唯一权威，迁移必须按它**播种 run 事件**（一条 attempt 一条 run，缺边界则 `timing_quality=unknown`），不能只把旧事件流翻成 V2 事件。
2. 在测试副本执行 dry-run，输出每个会话的消息数量、正文校验、执行关系、工具调用数、缺失字段及冲突列表。
3. 使用数据库一致性备份方式保存源库；WAL 模式不能只复制主文件而忽略 WAL。对已有 V2 独有数据、附件和 command receipt 做守恒预检与无损导出；无法证明可恢复则停止。重建 stream 更换 epoch，并测试旧缓存/游标失效与旧 command 重试不重复执行。
4. 按本计划已选定的维护窗口方案执行：暂停新执行接入，等待已有执行结束；无法等待的显式中断并记录状态。正式迁移先清理已有 V2 派生数据，再从未修改的 V1 源全量重导，不能边迁移边让旧写入继续，也不能把旧镜像事件与新迁移事件混在同一 stream。
5. 从旧记录生成确定性迁移事件 ID 和新连续 seq；正文已被覆盖的旧 delta 只迁移可确认的最终内容，不伪造逐 token 历史。
6. 排序优先已有可靠顺序/关联；必须借助时间和稳定 ID 排序的遗留记录标记 order_quality=inferred。缺失运行边界记录 timing_quality=unknown。
7. 旧源之间有冲突时按事先定义的来源优先级并记录冲突；不能无日志地选择最长文本或最新时间作为真相。
8. 分批事务提交，保存 checkpoint 和 source fingerprint；重启从 checkpoint 继续，同一源重复迁移结果相同。源变化则停止当前迁移并明确处理。
9. 重放生成读表与同步效果；比较消息正文、附件引用、执行终态、调用数量、关系完整性及规范化哈希。
10. 全部会话的必需校验通过后原子切换**全库**存储版本，再启用 V2 写入和读取；任一会话失败则本次正式切换整体不发生，错误必须可见，不伪装为空会话。
11. 旧表保留只读备份及迁移报告，到后续专门清理版本再删除；正式运行不从旧骨架自动兜底。

首次升级固定采用维护窗口。若演练证明窗口预算不可接受，必须先重新评审并修改本计划；不得临时降级为按会话长期混跑或双写。

### 8.3 回滚边界

尚未接收 V2 新写入时，可取消切换回到备份。接收 V2 新事件后，不允许直接恢复旧库丢弃这些消息；应修复前进，或先完整导出/转换新数据再恢复。保留旧代码开关不等于拥有无损回滚能力。

旧客户端不能继续调用 V1 写接口破坏 V2 会话。版本协商不通过则明确要求升级；过渡期若必须兼容，适配器只能从 V2 派生，不恢复旧写入源，且要单独测试和设置移除日期。

## 9. 测试计划与通过标准

### 9.1 存储、状态机和一致性

- 多事件事务成功/回滚、连续序列、唯一约束、并发写入、同会话串行与跨会话隔离。
- 相同来源重放、同 ID 不同内容、同 commandId 超时重试/冲突。
- delta、累计快照、最终完整正文、Unicode/emoji/代码块边界、空最终结果、正文替换。
- 并发工具同名、工具失败、子代理交错、审批取消、执行中追加输入、重试/重新生成。
- 终态后迟到 delta、重复终态、主机重启后的 interrupted/恢复路径。
- 终态权威：工具/消息/重放旧行不得把 run 推向或改写终态；生命周期事件可以纠正错误终态（含时长），纠正后读表重建结果与在线更新一致；旧库脏 run 经回填后两端一致。
- 按 attempt 回填 run：老会话（无 V2 run）播种、只差时间的镜像被修正、重复执行回填不追加事件、未迁移会话不得被凭空创建 V2 数据。
- 编辑、删除、分支后旧页和迟到推送不能复活废弃数据。
- 归属与角色：带 `agent_id` 的消息必须离开主 Feed 并落到对应代理卡片（归属找不到卡片时退回主 Feed），两端一致；读模型或 DTO 丢字段时要被这条用例抓住。
- 差分等价：同一份旧事件分别走旧投影与 V2 链路，对拍主 Feed 结构（条目集合、归属、顺序、分组、标签）完全一致；任一侧新增自己的映射逻辑而另一侧未同步时必须失败。
- 每个测试日志在线生成读表，清空读表后离线重放并比较规范化结果。
- 存储满、读写异常、内容文件缺失、未知事件版本均不返回虚假成功。

### 9.2 协议与故障注入

建立可控制的 fake transport，覆盖：重复、任意乱序、单包/多包丢失、仅末条丢失、延迟响应、断连、重订阅失败、缓冲溢出、分包中断、跨会话交错。

逐个注入崩溃点：写入事务前、日志写入后提交前、读表更新后提交前、提交后推送前、客户端应用后 cursor 提交前、cursor 提交后 UI 刷新前、用户消息接受后执行调度前。

随机测试：生成合法业务事件，再对传输施加随机故障；恢复网络并完成补拉后，已加载实体与权威读表一致、cursor=headSeq、无重复气泡。每次失败保存随机种子和最小复现日志。建议 CI 每次至少 100 个种子，夜间至少 1,000 个；数量可调整但必须保留确定性回放。

专项竞态：

- bootstrap 返回前收到新事件；bootstrap 旧请求晚于新请求返回。
- 历史页读取期间消息被编辑/删除/补齐，旧页不得覆盖新版本。
- 尚未加载的老实体被更新，之后加载其页面仍正确。
- 详情加载同时工具输出继续，重复展开不会重复正文。
- epoch 改变/备份恢复、historyRevision 改变、客户端版本不支持。
- active run 完成事件单独丢失，水位核对能终止“处理中”。

### 9.3 双端和真机

复用 `scripts/conversation-round/fixtures` 及现有 replay fixtures，新增统一 V2 fixtures；分别验证 TypeScript 和 Dart 最终消息顺序、正文哈希、状态、工具计数。覆盖当前产品实际支持的每个运行时/模式，不能只测一个 SDK。

Flutter widget 测试验证加载、滚动、状态切换；integration_test 或等价真实集成入口验证本地数据库、重启和连接。至少一台中档 Android 真机，若发布 iOS 则至少一台 iPhone；模拟器结果不能替代真机性能。

手工/自动 UI 场景：冷启动、缓存启动、后台数分钟恢复、弱网切换、桌面重启、不同入口进入同一会话、连续快速发送、发送响应丢失、看旧消息时来新消息、展开大工具输出、超长 Markdown、图片迟加载、软键盘及旋转、切换账号/桌面。

现有重点回归入口：

- `apps/desktop/test-node/conversation-store-sqlite.test.ts`
- `apps/desktop/test/thread-run-event-live-persist.test.ts`
- `apps/desktop/test/thread-run-event-sequence.test.ts`
- `apps/desktop/test/thread-run-projection*.test.ts`
- `apps/desktop/test/remote-projection-wire.test.ts`
- `apps/desktop/test/conversation-round-replay.test.ts`
- `apps/desktop/e2e/feed-loading.spec.ts`、`feed-skeleton.spec.ts`
- `apps/mobile/test/thread_session_reconnect_test.dart`
- `apps/mobile/test/thread_session_seed_bootstrap_test.dart`
- `apps/mobile/test/thread_live_event_test.dart`、`activity_feed_test.dart`

这些测试需按新契约重写或替换，不把旧骨架行为当新验收标准。保留通用业务回归。

### 9.4 性能预算

下列为初始验收目标，阶段 0 固定设备、数据分布和网络条件后评审，未测前不能宣称已达标。

| 指标 | 初始预算/要求 |
| --- | --- |
| 数据集 | 单会话 1万/5万/30万事件；正常分布和工具密集分布；含 100KB～1MB 正文与大附件引用 |
| 主历史页 SQL | 标准 30 条，暖缓存 P95 ≤20ms、P99 ≤50ms；冷缓存单独报告 |
| 标准 bootstrap 响应 | 常规文本样本 ≤256KB；超长正文使用明确分块，报告实际字节量 |
| 正常实时可见延迟 | 指定稳定网络下，从数据库提交到真机显示 P95 ≤500ms |
| 尾部丢失恢复 | 活动前台水位核对预算 10 秒 + 补拉耗时；不得无限处理中 |
| 小缺口恢复 | 100 条轻量效果、指定 RTT 100ms 网络下 P95 ≤2 秒，另测大正文恢复 |
| 流式写入空间 | 日志/同步存储相对输出增长近似线性，不能重复累计正文导致平方增长 |
| 滚动 | 60Hz 设备统计 frame timings、P95/P99 与掉帧比例，展开大正文不得阻塞整页 |
| 内存 | 固定可见窗口持续翻页及流式运行后不随历史页数无限增长；报告基线、峰值及回收结果 |
| 首次迁移 | 报告真实库规模下耗时、峰值磁盘与内存；决定维护窗口是否可接受 |

同时记录 SQL、序列化、传输、Dart 解码、数据库应用、Markdown 布局各阶段，避免把网络/渲染耗时都归因于查询。

### 9.5 验证入口

仓库已有 `bun run typecheck`、`bun run test`、桌面 `test:e2e` 及 Flutter 测试入口。实施者先核对 `scripts/test.mjs` 的当前参数与运行条件，新增独立 V2 存储、同步故障、迁移和性能套件并接入 CI。

建议交付命令包括：V2 单元测试、Node SQLite 集成测试、共享 fixture 双端测试、Flutter test/analyze、真实传输集成、桌面 E2E、Flutter 真机集成和独立 benchmark。新增命令在 README 写出准确用法；不能仅贴一个尚不存在的命令作为验证结果。

## 10. 分阶段任务与交付件

### 阶段 0：盘点与协议冻结

- 保存至少一份顺序错乱、一份重连丢失、一份骨架异常的可复现样本；若不能复现，记录缺口并继续构造确定性故障用例，不伪称已复现。
- 盘点全部事件写入方、SDK 重放能力、历史修改入口、现有数据库版本与实际性能基线。
- 固定事件/状态机、正文追加协议、主列表可见规则、耗时口径、命令幂等、版本与离线边界。
- 选定移动端事务缓存库；核实 Supabase 当前消息限制和绑定重连行为。
- 输出 ADR、DTO schema、golden fixtures、迁移样本矩阵、验收设备和预算。

退出条件：协议评审通过，所有不变量都有测试归属，未决项有负责人和关闭时点。

### 阶段 1：存储与 reducer

- 新建 V2 schema、事务仓储、来源去重、命令回执。
- 实现规范化事件与消息/执行/工具/详情 reducer，同事务生成 sync effects。
- 实现读表重建、完整性校验、启动时未终止执行的恢复策略。
- 接入所有运行时写入入口，先在测试/隔离数据中验证。

退出条件：事务崩溃测试、幂等、重放一致性和运行时 golden fixtures 通过；不可有绕过统一入口的 UI 事件写入。

### 阶段 2：查询与同步服务

- bootstrap、历史页、详情页、实体修复、sync、head、版本协商。
- 推送改成已提交记录/水位；分页和包大小限制、鉴权及错误码。
- fake transport 故障注入和确定性补拉状态机参考实现。

退出条件：快照竞态、乱序/重复/末条丢失、背压、版本错误、权限隔离测试通过。

### 阶段 3：双端消费

- 移动端数据库、repository、同步引擎、待发命令、加载状态拆分。
- 移动端主消息分页、详情懒加载、稳定滚动和错误展示。
- 桌面改为同一 V2 DTO；保留成熟 UI 外观，但移除旧骨架合并作为事实来源。
- 将 `requestSpans`、billing、context、subagentTimings、plan/todo 等剩余 hydration 字段纳入 V2 契约；不得依赖 `withLegacyHydration()` 达到双端等价。

退出条件：双端 fixture 一致，冷启动/重连/进程重启和 UI 竞态通过。不得以桌面通过替代移动端验收。

### 阶段 4：迁移与切换

- 完成迁移 dry-run、恢复、异常数据报告和一致性备份。
- 按 `thread_run_attempts` 播种 run，并在迁移校验中比较执行终态与时间（见 8.2 步骤 1/6/9）；迁移后会话在移动端的轮次状态与耗时必须来自 V2 run。
- 实现维护窗口全库写入锁、暂存库重导、V2 独有数据守恒、epoch 更新、全库原子版本切换和旧客户端限制；具体步骤遵循顶部决策，不采用按会话长期混跑。
- 用真实旧库副本及构造缺损库演练，验证不产生重复消息。

退出条件：迁移中断可恢复、迁移结果校验通过；回滚边界说明和操作手册齐全。

### 阶段 5：故障验收与性能

- 全矩阵运行，随机测试、真机长会话、实际 Supabase 通道测试。
- 根据分阶段耗时优化索引、批量传输、Markdown 与本地缓存，不牺牲完整性。
- 提交性能报告、失败样本、测试命令与结果，修复所有数据丢失/重复/错序/永久处理中问题。

退出条件：数据一致性零已知阻断缺陷，预算达标或有明确评审结论，任何剩余限制如实记录。

### 阶段 6：上线与旧链路清理

- 先测试数据及内部账号，再少量真实会话；每批检查迁移失败率、同步缺口恢复、正文版本冲突及性能。
- 正式使用 V2 后删除旧投影推送、骨架合并和同 ID 覆盖日志路径的生产引用。
- 旧源仅用于迁移/只读备份；更新技术文档、排障手册和开发测试入口。

退出条件：主列表在两端均无 V1 依赖，运行时写入只有一个事实源，测试与运维文档可由接手同事独立执行。

## 11. 分工与依赖建议

| 工作包 | 建议负责人 | 前置依赖 | 交付物 |
| --- | --- | --- | --- |
| A 协议与状态机 | 技术负责人，双端共同评审 | 无 | ADR、DTO、状态机、fixture |
| B 存储与 SDK 入口 | 桌面/后端开发 | A | 仓储、reducer、运行时适配、重放测试 |
| C 查询与同步 | 后端/协议开发 | A；集成依赖 B | RPC、推送、补拉、故障模拟器 |
| D 移动端 | Flutter 开发 | A 可用 mock 开始；联调依赖 C | 缓存、同步引擎、列表、真机结果 |
| E 桌面 UI | 桌面前端开发 | A 可用 fixture 开始；联调依赖 C | V2 Feed、滚动回归 |
| F 迁移 | 熟悉现有存储的开发 | 0 阶段即可盘点；实现依赖 B | 迁移器、报告、操作手册 |
| G 质量与性能 | 测试负责人 | 从 A 开始，贯穿全程 | 故障矩阵、CI、benchmark、验收报告 |

同一人可承担多个包。先冻结契约再并行客户端与服务端；不要在协议尚未明确时分别开发两套合并逻辑。估工由阶段 0 的数据盘点、SDK 能力和团队人数决定，不在未评估前承诺固定工期。

建议 PR 顺序：协议与 fixture → 存储与 reducer → 运行时适配 → 查询同步 → 移动端缓存/引擎 → 双端 UI → 迁移切换 → 故障性能与旧链路清理。各 PR 可合入但正式开关必须在迁移、双端和版本协商完成后启用。

## 12. 监控、交接和完成定义

记录元数据指标：写入延迟/失败、headSeq 与 appliedSeq 差值、补拉次数及范围、重复/冲突数量、尾部恢复耗时、缓冲峰值、bootstrap/page 字节数、迁移失败与缺失统计、正文版本修复次数。诊断默认不采集聊天正文、工具输入或附件内容。

交接必须提供：

- [ ] schema、索引与事务边界文档。
- [ ] 全部事件和 effect 契约、状态机、版本策略、错误码。
- [ ] SDK 来源与恢复能力矩阵，无法恢复场景的明确 UI 行为。
- [ ] 双端公共 fixtures 与故障注入回放方法。
- [ ] 迁移 dry-run、实际执行、失败恢复和切换手册。
- [ ] 真机测试报告、性能分项数据、可复现命令。
- [ ] 旧链路删除清单和剩余只读迁移依赖。
- [ ] 桌面离线/旧客户端/数据库恢复的行为说明。

完成定义：新写入、命令、读取、同步和恢复全部只走 V2；生产代码中不存在 V1 写入口、旧骨架合并、旧投影查询或旧 RPC fallback；事件不可变且可补拉；已加载消息在故障恢复后双端收敛；历史、实时、详情互不覆盖；末条丢失可恢复；迁移不伪造缺失信息；真机性能有测量结果；旧表只作为限期只读备份存在。

不能以“自动全量刷新能恢复”“异常时清空缓存”“失败时返回空消息”“桌面正常所以移动端应该正常”作为交付依据。

## 13. 设计参考

- [Matrix Client-Server API](https://spec.matrix.org/v1.14/client-server-api/)：初始同步、增量游标、历史分页及 timeline gap 的分工；不要求照搬整个 Matrix 协议。
- [SQLite Query Planning](https://www.sqlite.org/queryplanner.html)：索引筛选与排序的原则；实际索引必须用本项目 SQL、数据分布和 EXPLAIN/benchmark 验证。

本计划没有依赖第三方库具备未经验证的可靠投递能力。具体库版本、限制与行为在阶段 0 查询当前官方资料并通过集成实验确认。
