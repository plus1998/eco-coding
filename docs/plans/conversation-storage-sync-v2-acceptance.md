# 验收快照：`conversation-storage-sync-v2.md`

日期：2026-09-24。目标：**运行时读、写、命令、同步和恢复全部只走 V2；V1 只作为一次性迁移输入和限期只读备份。**

### 2026-09-24 第一百一十一批：V2 移动同步弱网故障矩阵复核

- 移动端 `conversation_v2_sync_engine_test.dart` 定向集 `16 pass / 0 fail`：100 个确定性种子覆盖丢包、重复、延迟、乱序；推送 gap 必须走权威区间补拉；重复 effect 做 hash 校验；缺失 message 做受限实体修复；断线缓存包在重连后按原种子重放；空页、回退 head、未知 effect 和传输异常均 fail-closed。
- 这是协议/缓存层的自动化故障矩阵，不是 Cloud 实际 WebSocket 断线、iOS 后台挂起、蜂窝切换或真实尾部补拉。生产放行仍需在已绑定移动端上制造真实断线并核对 `appliedSeq/headSeq/state/error`，同时验证重复/乱序不会在 Feed 生成第二条用户消息。

### 2026-09-24 第一百一十批：Supabase Cloud 登录、CAS 与 Realtime 受控写入闭环

- 使用当前已登录账号对 Supabase Cloud 做了真实 password grant：公开/受保护函数边界、连续两次登录且 session 不同、绑定设备后的 stale settings CAS 均通过。CAS 返回 HTTP `409`、`PT409/settings_sync_conflict`，随后读取确认 revision 未变化；未绑定设备时先返回设备会话策略的 `403`，没有把策略拒绝误判成 CAS 冲突。
- 受控写 smoke `3 pass / 0 fail / 16 assertions`（约 24.5s）：注册临时 desktop/mobile、注册 device session、binding 首次与重复调用保持同一 ID、校验绑定 RLS、私有 Realtime broadcast 双端收发，以及未绑定客户端订阅拒绝。测试 finally 对临时设备执行 `device-disable` 清理；没有写入正式设置、密钥或对话。
- 重启最新 DEV bundle 后 `cdp:attach → cdp:snap → smoke:cdp-probe → smoke:cdp-center` 通过：页面 `window.eco=true`、Composer 可见，console `0 errors / 1 warning`（仅未打包 Electron CSP）；Center 为 `connected`、3 个 active bindings、45 条 presence（在线 3，含 desktop/mobile），10 个同步域为 `dirty=7/synced=3`。
- 本批关闭 Cloud 的 password/CAS、device-session、binding 幂等和私有 Realtime 基础链路门禁，但没有把单次广播等同于弱网尾部补拉。Cloud 断线重连、丢包/重复/乱序、移动端真实后台挂起与尾部恢复、settings dirty 域权威选择、生产迁移/legacy 观察期、真机长会话和 Codex 加密 `agent_message` 能力仍未关闭。

### 2026-09-24 第一百零九批：修复同事务 provider patch 的实时 gap 发布

- 定位并修复 renderer gap warning 的实际根因：`appendProviderInputPatchInCurrentTransaction()` 在 SQLite 同一事务中会追加主 `provider.patch` 和自动生成的 `message.history_targeted`，但原实现只把第一条 `ConversationAppendResult` 返回给 `publishCommitted()`；持久化序号因此出现“已写入 7、通知直接到 8”的可观测跳跃。现在当前事务 API 通过 `onAppendResult` 发布主 patch 和所有 history-target 结果，Claude/Codex 回绑调用点把完整结果批量发布，事务外路径保持原有行为。
- 新增当前事务发布回归，断言提交结果序号为 `3,4`、监听器收到两条 effect、`sync` 连续返回两条；V2/store/renderer 定向集 `106 pass / 0 fail / 410 assertions`，桌面 `tsc --noEmit -p apps/desktop/tsconfig.json` 通过，Biome error-level 退出码为 0（仅保留既有 warning）。
- 重启最新 DEV bundle 后复跑真实 LongCat-2.0/CDP：PI、Claude、Codex 主工具、Claude 子代理、Claude 原生 Plan→批准→coder 子代理全部通过；Codex 子代理在派发前按能力门禁拒绝加密 `agent_message`。完整 smoke `7/7`，成功场景每个业务 prompt 都只有一条 V2 user row，renderer `appliedSeq=lastSeq` 且没有 buffered/recovery。
- Codex Plan 只读边界再次通过：线程 `thr_1790183467388` 计划阶段 `awaiting_plan`，没有 Bash、没有探针文件、没有待审批 Bash；批准后仅执行一次精确 `printf`，输出 `codex_plan_execution_V2_LONGCAT_CODEX_PLAN_MUED0JQM`。最终两条 user row 中第二条是审批协议生成的 `Implement the plan.`，不是重复发送。
- 修复后 `bun run cdp:snap` 为 `0 errors / 1 warning`；console 日志只剩未打包 DEV 的 Electron CSP 提示，原先的 `ConversationV2RendererGapError` 序号跳跃未再出现。该结果关闭了本轮已定位的 publication gap，但仍不替代真实 Cloud/弱网/尾部补拉和长会话压力验收。
- 严格全量 gate：`node scripts/test-gate.mjs --strict` 为 `5376 pass / 19 skip / 0 fail`（5395 tests、674 files、23911 assertions）。19 个 skip 仍明确包含 Cloud live 与 LongCat network 集成；根 `bun run typecheck` 的已知失败仍来自上游 `pi-web-search@1.5.0` 源码类型/TS5097 诊断，桌面项目 tsc 未受影响。
- 最新 DEV 只读维护审计：`phase/storageMode=v2_only`、`integrity=ok`、`cutoverReady=true`，184 streams，232369 events/effects，74 native facts；manifest hash `8c9e206c`，独立 verify `passed`、facts hash `0e9e371d`。SQLite `quick_check=ok`，13 张退役 V1 conversation source table 均不存在，旧附件载荷/path/inline/缺失/解析错误和 native unmatched 均为 0；库内仍有 4 条历史 pending-plan、5 条 follow-up，作为 durable V2 状态保留。
- 全面生产 V2-only 仍未放行：Cloud password/CAS 写入、Realtime 弱网尾部补拉、dirty sync 权威选择、生产双次迁移与 legacy 观察期、真实设备后台/物理故障/长会话性能，以及 Codex 子代理协议能力缺口仍是开放门禁。

### 2026-09-24 第一百零八批：Codex Plan 权限硬封与 LongCat 全链路复验

- 定位并修复 Codex Plan 的真实权限缺口：Eco 原先只把 session 标成 `collaborationMode=plan`，却仍把编排策略的 `workspaceWrite`/`danger-full-access` 传给 `turn/start`；这让“Plan 不得修改”只依赖弱模型遵守提示词。`resolveEffectiveTurnSandbox()` 现在对 `plan` 与 `ask` 强制返回 `readOnly`，只有 `agent` 继承编排写权限；批准后的 handoff 仍显式切回 `workspaceWrite`。Codex 官方 Plan 模板也要求计划阶段不修改文件或执行副作用命令，当前实现与该边界一致（参考：[Codex Plan 模板](https://github.com/openai/codex/blob/main/codex-rs/collaboration-mode-templates/templates/plan.md)）。
- 新增权限策略、prompt materializer、app-server `turn/start` 回归：Codex Plan 即使编排策略是 `danger-full-access` 也只能收到 `readOnly`；批准执行阶段收到 `workspaceWrite`。定向测试 `52 pass / 0 fail / 190 assertions`，桌面 `tsc --noEmit -p apps/desktop/tsconfig.json` 通过。
- 新增 `apps/desktop/scripts/dev-cdp-longcat-codex-plan-readonly-smoke.mjs`，用真实 LongCat-2.0/Codex 和 CDP 验收：计划阶段要求一次 `touch` 探针，但模型没有产生 Bash、没有写入探针文件、没有出现 Bash 审批请求，线程进入原生 `awaiting_plan`；批准后只执行一条精确 `printf` Bash，输出正确。最新线程 `thr_1790180451875` 为 `1 pass / 0 fail`，V2 tool 只有 1 条，renderer `appliedSeq=lastSeq`、无 gap/recovery。原始 V2 消息明确显示第二条用户记录是审批协议自动生成的 `Implement the plan.`；首条用户提示仍只有 1 条，不能把计划审批动作误报成普通发送重复。
- 既有 LongCat 全场景 smoke 在新构建上再次 `7/7` 通过（PI/Claude/Codex 主代理、Claude 子代理、Claude 原生计划审批后 coder 执行、Codex 子代理能力门禁）；所有成功主代理场景 `userMessageCount=1`、标记 Feed DOM 恰好 1 行、durable tool/run/agent 与 renderer head 均收敛。Codex 子代理仍因 LongCat 不支持加密 `agent_message` 在派发前 fail-closed，无半成品线程。
- 本轮完整桌面 Bun 套件 `5375 pass / 19 skip / 0 fail`（5394 tests、674 files、23907 assertions）；19 个 skip 仍如实包含 Cloud live/LongCat 网络集成，不以 CDP 手工结果替代。根 `bun run typecheck` 仍被已安装的上游 `pi-web-search@1.5.0` 源码的 `exactOptionalPropertyTypes` 与 `TS5097` 错误阻断；输出没有本轮改动文件诊断。Biome 对新增 smoke 无错误，`git diff --check` 通过。
- 最后一次 `cdp:snap` 为 `0 errors / 24 warnings`：1 条未打包 DEV 的 Electron CSP 提示，其余是切换/实时运行时偶发的 `ConversationV2RendererGapError`（后续进入有界 V2 sync，所验线程最终 `appliedSeq=lastSeq`、无 buffered effect/recovery）。这说明当前 Feed 能够收敛，但 IPC effect 顺序仍有可观测乱序，不能把 warning 数量压掉后宣称实时恢复门禁已关闭；需要继续做事件排序/批处理和长会话压力验收。
- LongCat 演练后的 DEV 只读审计：`phase/storageMode=v2_only`、`integrity=ok`、`cutoverReady=true`、173 streams、228498 events/effects、74 native facts；manifest hash `c5e0b754`，独立 verify `passed`、facts hash `094cb315`，附件旧载荷/路径/inline bytes/缺失/解析错误和 native unmatched 均为 `0`。SQLite `quick_check=ok`，13 张退役 V1 conversation source table 均不存在。库内仍有 4 条历史 pending-plan 和 5 条 follow-up（其中 3 条为 queued 用户队列），这是待按业务意图处理的 durable V2 状态，不能为了审计数字直接删除。
- 本批关闭了 Codex Plan 的权限放大和普通 Agent/子代理回归门禁；全面生产 V2-only 仍受 Cloud 真实 password/CAS 写入、Realtime 弱网尾部补拉、dirty sync 域权威选择、真机后台/物理故障/长会话性能、生产双次迁移与 legacy 观察期阻断。Codex 子代理协议能力缺口也仍保持显式 fail-closed。

### 2026-09-23 第一百零七批：LongCat 多 Agent / 计划执行、iOS 联动与全量回归

- LongCat-2.0 DEV/CDP 真实冒烟复核覆盖 PI、Claude、Codex 主 Agent 工具调用，Claude coder 子代理，Claude 原生计划审批后由 coder 子代理执行，以及 Codex 子代理能力门禁；完整场景 `6 pass / 0 fail`。PI 另完成原生 plan→approval→coder 子代理直接 Bash 执行，恰好一条匹配 Bash V2 tool row。成功场景都核对了 V2 owner、run/tool 终态、单条用户消息与 renderer head 收敛；Codex 的加密 `agent_message` 能力缺失仍在派发前明确拒绝，没有半成品线程。**Codex LongCat 原生 plan 等待审批仍未通过历史实测**，不能把 Claude/PI 的结果外推到 Codex。
- 真实 Claude Bash 冒烟发现 macOS `/var/folders/...` 与 SDK 返回的 `/private/var/folders/...` 指向同一路径，却被 workspace lexical containment 错判为越界。`packages/bash-policy/src/path-utils.ts` 现在将候选与 workspace 解析到真实路径，并支持“最近已存在祖先 + 不存在尾段”；解析错误 fail-closed。回归证明 macOS alias 和 workspace 内 symlink 可用、指向 workspace 外的 symlink 仍被拒绝；Bash policy/runtime confirmation 定向套件 `28 pass / 0 fail / 46 assertions`。
- 在已配对 iOS Simulator 的真实 Composer 发送标记 `IOS_V2_REAL_SYNC_20260923_1809`。桌面和移动端 V2 都落入一条 user prompt 与一条 assistant answer；iOS Feed 可见提示/回答各一次，未重复展示 thinking channel。移动 SQLite `applied_seq=289`、`snapshot_seq=254`、`state=live`、`error=NULL`、pending commands `0`、`quick_check=ok`；桌面 head/rendered `appliedSeq=289`，无缓冲 effect 或 recovery 请求，DOM 提示恰好一行。没有扫码或重装模拟器。
- 登录后的 Supabase Center 只读 smoke 为 `connected`、3 个 active bindings、10 个设置域（7 dirty / 3 synced）。no-write reconcile 仍要求对 dirty 域选择本地或云端权威；本批没有 push/pull settings 或 secrets，也没有更改设备绑定。当前 DEV SQLite 直接检查为 `v2_only`、`quick_check=ok`、170 streams、222,778 events/effects、74 native facts，13 张 V1 conversation source table 全部不存在。新生成并独立验证的只读 manifest 为 `cutoverReady=true`、`integrity=ok`、74 facts，manifest hash `d99e195e`、facts hash `2abda8cf`。
- 默认无界并发完整跑曾得到 `5,359 pass / 19 skip / 15 timeout / 12 child-process errors`；子进程错误是 runner 超时后退出码 143，并非独立业务断言。根因是 Bun 同时运行过多测试文件/同文件用例，迁移 CLI 子进程互相争抢；运行时线性存储基准从并发下 `8.18s` 在串行文件用例下回到 `255ms`。不提高 5 秒默认超时。统一 `scripts/test.mjs` 与 CI `scripts/test-gate.mjs` 现在默认为 2 个文件并行、每文件 1 个用例并发，显式并发参数仍优先；并修复 `--no-mobile` 将自身误判为未知参数。默认 full Bun suite `5,374 pass / 19 skip / 0 fail`（5,393 tests、674 files、23,903 assertions）；`node scripts/test-gate.mjs --strict` 同样通过，baseline 为空。Flutter 全量 `660 pass`。V2 migration/runtime-writer 隔离串行复核 `32 pass / 0 fail / 180 assertions`；桌面 tsc、bash-policy tsc、Biome 与 `git diff --check` 通过。
- 19 个自动化 skip 仍如实保留，包括 Supabase Cloud 写链路和 LongCat 网络集成用例；登录态只证明 Center 授权读取和实际跨设备消息往返，没有证明 fresh password grant、CAS 写冲突、Cloud Realtime 广播/尾部补拉或 settings/secrets 写入。全面交付继续受 Cloud 弱网/尾部恢复、dirty 域权威选择、Codex 原生 plan 审批、长会话物理故障、真机原生控件/后台恢复、生产双次迁移与兼容观察期阻断。

### 2026-09-23 第一百零六批：post-cutover 事件审计已通过 DEV manifest 门禁

- 最新只读检查：`phase/storageMode=v2_only`、`integrity=ok`、`cutoverReady=true`，159 streams、221,117 events/effects；native manifest 74 facts 为 62 equivalent、9 collapsed、3 modified、0 unmatched。附件旧载荷、inline bytes、路径引用、缺文件、解析错误均为 0。同一 manifest 的独立 `--verify-native-manifest` 为 `passed`，facts hash `bd3092ef`。
- 之前 fresh audit 报告的 171 条 unmatched 来自一个审计器缺陷：`conversation_migrations_v2.phase=completed` 是永久 provenance，不代表后续事件仍须匹配 V1。现在逐条验证 native event 来源、稳定 event ID、命令 receipt/job、runtime input envelope、lifecycle、provider history patch、history repair；有 migration row 的 stream 还必须满足每条 `recorded_at >= migration.updated_at`。来源不明、与 migration 时间不符或混合未经验证事件仍会阻断；恢复生成的 `tool.failed` 还必须与 recovery source key 和 terminal run/tool projection 一致。
- 审计明确保留 132 条 `post_cutover_runtime_without_native_ledger`、8 条 `post_cutover_recovery_without_native_ledger` 与 2 条 `maintenance_native_fact_replay` warning；这些是没有独立迁移台账副本、但逐条证明来自切换后 V2 writer 或 modified ledger fact 的事实，不是“无差异”。旧 ledger 的 3 条 matched-but-modified facts（1 条正文、2 条附件）仍在 manifest 中保留其分类。
- 新增 CLI 回归覆盖 post-cutover runtime/patch/history repair、migration 时间边界、terminal-tool recovery、未知 native source fail-closed，以及有 ledger 时仍有额外未知 event 的阻断。桌面迁移 CLI `19 pass / 0 fail / 137 assertions`；桌面 tsc、Biome 和 `git diff --check` 通过。
- DEV CDP 复核通过：`cdp:attach → cdp:snap` 为 `0 errors / 1 warning`，`smoke:cdp-probe` 确认 `window.eco` 与 composer 可见；已登录 Center 的授权读冒烟通过，3 个 active binding、41 条 presence、10 个设置域（7 dirty / 3 synced）。这些是只读观察；没有 push/pull settings 或 secrets。
- 新一轮 Center 认证读烟测通过：`connected`、3 个 active binding、41 条 presence、10 个设置域（7 dirty / 3 synced）。模拟器唤醒后的前两次查询暂只看到 2 个 desktop online；随后只读 presence 详情出现最近 mobile `connectedAt`，紧接着重跑 smoke 确认 3 个在线（desktop + mobile）。本地两个 V2 cache 的 `applied_seq=257/271` 与桌面 head、history revision、epoch 一致，均 `live/error=NULL`、pending commands 为 0，SQLite `quick_check=ok`。唤醒后 presence 有短暂延迟，最终移动在线已复现。
- 尝试运行 Cloud 集成文件时发现本地 `center_server_config.anon_key` 由 Electron `safeStorage` 加密；直接从 SQLite 取原值会被 Auth 判为 `Invalid API key`，该次密码登录/CAS 结果无效，不能归因到账号密码或 Cloud auth。公开/受保护函数边界 `1 pass`；设备会话/绑定/Realtime 写测试按默认关闭策略 `1 skip`。正确 anon key 尚未安全注入测试进程，fresh password grant/CAS 仍待验收。现存 DEV 登录 session 的 Center 授权读取通过；本次未创建/禁用设备、未改绑定，也未 push/pull settings 或 secrets。测试登录错误现在会呈现 Supabase 安全错误码/消息字段。
- 10 个同步域中 7 个仍为 dirty，no-write reconcile 返回 `needsUserChoice`，push/pull settings 和 secrets 均为 0。DEV manifest 通过只关闭 DEV 数据审计门禁，不代表生产 Cloud、移动端实时在线、物理故障、真机长会话或兼容观察期已通过。

### 2026-09-23 第一百零五批：修复启动恢复的 running tool 残留与 V2 run 查询卡顿

- 在 LongCat-2.0 Codex Plan Mode 验收中，模型没有等待原生计划审批，实际启动 3 次 Bash；未生成 `pending_plan`。重启恢复已把 run 记为 `failed`，却留下 1 条 `running` tool。新增 V2-only 启动 reconciliation：只对已有 stream 中、所属 run 已 `failed/cancelled` 的 `started/running` tool 追加幂等 `tool.failed` 事件，并明示“终态结果未持久化、工具副作用未知”；不重放任何命令。DEV 首次恢复 8 个会话、119 条 tool；复核后 terminal run 下活动 tool 为 `0`，测试 run 为 `failed`、其 tool 状态为 `completed, completed, failed`。这关闭了持久化状态不一致，没有关闭 LongCat 原生 Plan 审批违约。
- 启动性能采样确认卡点在 `ConversationRecoveryGate.inspect → listV2RunAttemptRows`。最大 stream 有 `141,191` 个事件；旧 SQL 用 `conversation_id + run_id + seq` 回表，SQLite 误选只按 conversation 过滤的 agent 索引，单次查询耗时约 `2,039ms`。run lifecycle 子查询已限定具体 run，且 `(conversation_id, seq)` 是唯一键，因此移除冗余 `e.run_id` join；相同数据上查询降至 `1.1ms`。agent lifecycle 回表同理使用唯一 sequence。
- DEV 实库重启实测 `v2_only`、`159` streams、`221,117` events：ConversationStore `2.354s` 初始化；全部 conversation reconciliation `5.483s`；Recovery Gate `0.817s`；异常 run 循环约 `0.18s`；home workspace 在 `14.471s` 就绪，main window 在 `28.678s` 就绪。`cdp:attach → cdp:snap` 与 `smoke:cdp-probe` 通过，renderer console `0 errors / 1 warning`（未打包 DEV 的 CSP 提示）。
- 登录后 `getCenterServerSyncStatus` 成功读取 Supabase Cloud 的远端配置和 settings 状态：10 个域中 `providers/proxyBridge/asr/imageGeneration/orchestration/git/personalization` 为 `dirty`，`agentLibrary/packageScriptArgs/sshBookmarks` 为 `synced`。随后执行 `syncCenterServerConfig('reconcile')`，返回 `needsUserChoice=true`、vault `ready`，且 settings/secrets push/pull 均为 `false/0`，没有改写账号配置；dirty 域需要用户决定本地或云端哪一侧权威。启动日志曾记录 `setSession ... fetch failed`，但登录后的授权远端读取与无写入冲突检测成功。`ECO_SUPABASE_CLOUD_*` 未配置，完整自动化 Cloud auth/write 集成测试仍未运行。此前 native manifest 的 `cutoverReady=false`（169 条 unmatched facts、116 条 post-cutover runtime without native ledger）尚未重审，不提升门禁状态。
- 新增恢复状态与 V2-only 边界回归；桌面定向测试 `66 pass / 0 fail / 247 assertions`；随后完整桌面回归 `3841 pass / 6 skip / 0 fail / 18,703 assertions`（523 files）。6 项跳过包含 3 项需 `ECO_SUPABASE_CLOUD_*` 的 live Cloud 测试。`build:main`、CDP UI/Center smoke 与 `git diff --check` 通过。根 composite `typecheck` 仍被已安装 `pi-web-search@1.5.0` 源码的 TS 类型/TS5097 错误阻断；输出中没有本批修改文件的诊断。Cloud 弱网和尾部恢复、7 个 dirty sync 域、Codex 原生 Plan 审批、历史 unmatched/native ledger 对账、缺失 stream、附件权限、物理故障与 legacy 观察期仍是开放门禁。

### 2026-09-23 第一百零四批：修复 provider patch 重放的伪冲突

- 旧 DEV 失败栈明确落在 `ConversationStore.appendV2ProviderPatch → ConversationV2Store.appendProviderInputPatchInternal`。该路径用 thread/reason/input identities 生成稳定 event ID/source key，却每次取新的 `occurredAt=now`；immutable event hash 包含 `occurredAt`，因此同一 provider patch 的重放会被误判为“相同 source、不同内容”。这是实际栈对应的确定性冲突条件。
- V2 store 现在在同一 patch/history-target event identity 已存在时复用首次提交的 `occurred_at`；其余事件字段仍按 immutable hash 全量比对，改变 patch payload 仍 `idempotency_conflict`。历史目标 drift 和 source-event conflict 均写入不含 prompt 正文的结构化 DEV 诊断日志。
- 新回归证明相同 provider patch 在不同重试时间幂等返回、cursor 不增长，目标不变；同一 identity 改 payload 仍失败且整批不写入。V2 store `52 pass / 0 fail / 196 assertions`，ConversationStore runtime `32 pass / 0 fail / 150 assertions`；连同 runtime writer、Codex event normalizer、V2 production boundary 共 `112 pass / 0 fail / 503 assertions`。桌面 `tsc --noEmit`、main build、Biome error-level、`git diff --check` 通过。
- 当前主进程运行的是上一批启动后的构建；新 bundle 已生成，但为避免在锁屏时强制 UI 操作，尚未再次重启 DEV 并对原 `thr_1790131818558` 执行真实重放。因而本批关闭了可复现的 deterministic hash defect，真实模型链路复验仍待设备解锁后完成。生产 V2-only 的 unmatched facts、缺失 stream、Cloud 弱网/尾部恢复、附件权限、物理故障、性能和 legacy 观察期阻断项不变。

### 2026-09-23 第一百零三批：恢复登录后的 iOS→桌面真实发送与历史目标复核

- 用户重新登录并恢复既有 PC binding 后，我从 iOS 26.5 模拟器真实 composer 发送 `ios_v2_mobile_recovered_20260923_11`。桌面 V2 stream head 为 `271`；该标记恰好对应 `1` 条 user message、`1` 条 Bash completed（实际命令和输出均与标记一致）和 `tool_count=1` 的 completed run。移动端 SQLite 同步到 `applied_seq=271`、`state=live`、`error=NULL`；AX 树只显示一条用户提示和一条实际结果。V2 message 表还保存了 thinking channel 的中间模型记录，但 Feed 没有把它们展示成重复用户消息。没有扫码。
- 重启 DEV 后在桌面重新打开曾报告 `Message message_user_5ef6f938 history target changed` 的历史 Codex 会话，页面成功加载、CDP console `0 errors`；V2 日志显示该消息从旧版 `codex-pending:*` 临时目标升级为一个 canonical `sdk:*` 目标，升级后未再写入第二个目标。该历史错误在当前构建下未复现；canonical 目标的其他变更仍按完整性错误 fail-closed，因此不能据此宣称所有 target conflict 根因已关闭。
- 冲突诊断现包含 conversation/message/event identity、seq、原目标和尝试目标；对应回归覆盖 canonical target 不可改写及结构化错误信息。`conversation-v2-store` 专项 `51 pass / 0 fail / 190 assertions`，桌面 `tsc --noEmit`、main build 和 `git diff --check` 通过。Biome 返回退出码 `0`，但目标大文件仍报告 `14` 条既有 lint warning。
- 单独记录 iOS 自动化边界：本轮较早的 Xcode integration runner 在 setup gate 失败，检查时 `setupComplete=false`，它没有发出任何测试消息，并且测试运行器卸载了 dev app。随后重装、重新登录、恢复既有 binding，并以上述手动 UI+V2 SQLite 证据完成真实发送；这次手动冒烟不能算作那次集成测试通过，也没有再次用会卸载 app 的 runner 触碰配对设备。
- 重启后的桌面 DEV 启动恢复约 `8分41秒` 后才开放 CDP。最新 `cdp:attach → cdp:snap` 为 `0 errors / 1 warning`，唯一 warning 是未打包 DEV 的 Electron CSP 提示；重启后再次打开上述历史会话仍未复现异常。手机 V2 state 在重启后更新为 `applied_seq=271,state=live,error=NULL`。这证明当前 DEV 可恢复，不代表该启动耗时达到生产预算；长启动仍是独立性能门槛。
- 重启后的只读维护 CLI 再审计：`phase/storageMode=v2_only`、`integrity=ok`、145 conversations/streams、`218,651` events/effects、74 native manifest facts（hash `2bab6285`）；带真实 prompt-images 根目录后 canonical attachment legacy payload/path/inline bytes、missing files 和 parse errors 全为 `0`。`cutoverReady=false` 仍由两个历史会话 `143+26=169` 条 unmatched live facts 阻断；另有 `116` 条 post-cutover runtime without native ledger 的审计观察项，保持原样并单独对账，不将它们伪装成 migrated native facts。SQLite `quick_check=ok`，13 张 V1 conversation source table 均不存在。
- 本批没有改变全面生产 V2-only 的放行结论。旧 Claude/LongCat run 仍有未定位的 `Source event was replayed with different content`；历史缺失 stream、manifest unmatched facts、正文/附件对账、Cloud 弱网/尾部补拉、跨设备附件权限、物理故障、真机长会话性能与 legacy 观察期仍是门槛。

### 2026-09-23 第一百零二批：弱模型计划执行语义与 iOS→桌面发送复核

- 把 LongCat-2.0 DEV smoke 提示统一改成中文编号契约：精确命令、唯一工具调用、等待真实返回、禁止代跑/伪造/重试；PI/Claude Plan Mode 另写清楚“审批界面选定的 coder 本身就是执行者”，不得让 coder 再派发嵌套 coder。PI 子代理计划首轮失败的根因已由 V2 message/tool/agent 记录证实：旧计划让被选定的 coder 再派发子代理，而它按能力边界拒绝；没有产生 Bash 命令。修订后 PI 子代理计划（`thr_1790111404667`）与主代理计划（`thr_1790111885563`）均通过，V2 工具行恰好一条、owner 与执行目标一致。
- LongCat-2.0 第二轮完整 DEV CDP smoke（标记 `V2_LONGCAT_FULL_MUD6BU9O`）为 `6 pass / 0 fail`：PI、Claude、Codex 主代理 Bash；Claude 子代理 Bash；Claude 原生计划审批后 coder 直接执行；Codex 子代理能力门禁明确拒绝。每例恰好一条标记用户消息，工具事件唯一且完成，子代理 owner 正确，Feed 的用户提示 DOM 行只出现一次。
- 修复桌面 renderer 的另一类确定性竞态：bootstrap 后读取旧消息/工具页时，页携带的 `readSeq` 可能领先当前已应用 effect cursor；现在先用有界 V2 sync 补齐到页水位，再合并只读页。回归明确证明旧行为会因“page ahead”失败、新 catch-up 后可成功合并；renderer state 定向测试 `20 pass / 0 fail`。
- 已配对的 iOS 26.5 模拟器从真实 composer 发送 `v2_ios_longcat_send_47c8b2a1`，集成测试 `1 pass`。发送前等待 runtime config 就绪并确认连接为 `connected`、binding active、RPC provider 和 principal 存在；`conversation_v2_pending_commands` 先持久化一条待发命令，之后同步完成。桌面 V2 独立复核确认该 thread 只有一条匹配 user row（seq 325）、一条完成 Bash 工具（seq 349/351）、一个 completed run；用户提示在桌面 Feed 的带 anchor DOM 行中恰好出现一次。模拟器本地 SQLite 复核为 `state=live`、`applied_seq=373`、`snapshot_seq=322`、`error=NULL`，标记对应 `1 user + 1 assistant + 1 tool`；assistant 行包含工具输出标记，是正常回复，不是第二条 user message。
- 同一跨端 run 中另有一条可见 `thread.api_error`：“Scheduler unavailable”，但 run 仍以 completed 收敛且只执行一条 Bash；记录为 provider/网关瞬时错误，不把它计作干净无错误运行。iOS 测试首轮曾在 Composer runtime config 尚未就绪时点击，发送按钮 `onTap=null`；加强等待和就绪断言后通过。测试现在会区分“按钮未就绪”“尚无 pending command”“模型运行未完成”，不会把未触发的点击报告成发送成功。
- `bun run cdp:snap` 最终为 `0 errors / 21 warnings`，其中 20 条是 smoke 期间的 `ConversationV2RendererGapError`（例如 expected 7、收到 8），另 1 条是 Electron DEV CSP 提示。未发现 renderer recovery failed、buffered effect deferred 或 duplicate conflict 日志。当前逻辑会缓冲并请求权威 sync；所选 smoke Feed 最终能展示用户消息和执行结果，但本轮尚未逐线程比较 renderer applied cursor 与 durable head，因此**仍保留为实时乱序/恢复验证项**，不宣称警告已全部闭合。
- 全量严格桌面门禁：`5366 pass / 19 skip / 0 fail`（5385 tests、674 files、23869 assertions、3 snapshots）；移动端 `flutter test`：`660 pass / 0 fail`；集成测试文件 `flutter analyze`：无问题；两个 smoke 脚本 Biome check、`git diff --check` 通过。6 个由 Claude smoke 生成、正文带 `V2_LONGCAT_FULL_*` 标记的 `.claude/plans` 测试产物已清理。
- 全面生产 V2-only 仍不放行：DEV native manifest 的 unmatched facts `143 + 26`、正文/附件差异、真实 Cloud 弱网/尾部补拉、跨设备附件权限、物理故障、iOS/Android 真机长会话与性能、legacy migration/bridge 观察期以及本批新增的 renderer 实时 gap 收敛证据仍需关闭。桌面/模拟器冒烟通过不替代这些门槛。

### 2026-09-23 第一百零一批：弱模型单次调用约束复验

- 针对前一轮 Claude 计划审批后的 coder 重复执行问题，提示词进一步明确“总共只调用一次 Bash、禁止重试/复核/重复”；DEV CDP smoke 断言标记命令必须恰好有 1 条完成态 durable V2 tool row，重复执行即失败。已配对 iOS 集成断言也从“至少一个”收紧为“恰好一个”完成态子代理工具。
- LongCat-2.0 完整 DEV smoke 复跑通过：PI、Claude、Codex 主代理 Bash；Claude coder 子代理；Claude 原生计划→审批→coder 执行均通过。每个 smoke 会话恰好 1 条匹配用户消息、1 条匹配完成态工具事实，计划 coder 本轮只执行 1 次；Feed DOM 标记各出现 1 次。Codex 子代理仍由加密 `agent_message` 能力门禁前置拒绝，未生成半成品线程。
- iOS 26.5 已配对模拟器集成 smoke 再次通过。新 app container 的 SQLite 独立复核：`thr_1790105647611` 为 `live`、`applied_seq/snapshot_seq=129/129`、`error=NULL`、9 条 V2 messages、匹配 user row 恰好 1 条、匹配 completed tool 恰好 1 条；Flutter Feed 可见提示。未扫码。UIKit 原生控件的实际触摸命中仍未覆盖。
- 本批仅补强验收提示和重复调用检测；完整严格桌面门禁上次为 `5365 pass / 19 skip / 0 fail`，移动端全量测试上次 `660 pass / 0 fail`，本次单独重跑 iOS integration smoke `1 pass`、Biome/Dart format/`git diff --check` 通过。生产 V2-only 阻断项仍见下文，不因本批 smoke 通过而改变。

### 2026-09-23 第一百批：明确提示词下的 LongCat 验收与已配对 iOS V2 同步

- 为弱模型把冒烟提示改成可机械验收的单动作契约：明确禁止主代理代跑、要求唯一 coder 子代理执行精确 `printf '<marker>'`、拒绝派发时立即报告原始错误并停止；成功必须同时满足线程终态、V2 durable tool row、工具 owner 和 Feed DOM 标记。提示词只定义任务，测试不以模型的“已完成”文本代替工具事实。
- LongCat-2.0 DEV CDP 实测：PI、Claude、Codex 的主代理 Bash 工具用例均完成；Claude coder 子代理完成；Claude 与 PI 的 native plan→approval→执行计划均完成，PI 覆盖主代理和 coder 执行目标。所有已打开检查的 smoke 会话 V2 user message 为 `1`，桌面 Feed 中标记用户提示的 DOM 行为 `1`。Claude plan 子代理在相同步骤重复执行了两次精确 Bash 命令，保留为弱模型重复执行风险；并未造成重复用户消息。
- LongCat Codex 子代理在派发前被能力门禁拒绝：该协议会要求加密 `agent_message`，当前 LongCat 不支持。没有丢弃加密任务内容或伪造纯文本，也没有创建半成品会话；这仍是明确的产品能力限制，不会靠加长提示词掩盖。
- iOS 26.5 `Eco iPhone 11 V2` 已配对 Cloud 会话实测同步 `thr_1790105647611`：生产连接流程的 setup gate 为完整，集成测试通过进入流程后打开该会话，V2 state 到 `live`，SQLite `applied_seq=129/snapshot_seq=129/error=NULL`、9 条 V2 message、唯一标记对应 1 条 user message 和 1 条完成的 agent tool；Feed 中可见标记。此轮使用已存凭据与既有 PC binding，没有扫码。
- 测试边界：`adaptive_platform_ui` 在 iOS 26 使用原生 `UiKitView`，Flutter 标签本身设为 `IgnorePointer`；集成测试调用“进入应用”按钮的公开回调来验证同一连接逻辑，**没有验证 UIKit 控件的真实触控命中**。移动端从会话页发消息/审批并回到桌面、弱网尾部补拉仍待验收。
- 实际收尾又暴露两个生命周期竞态并已修复：Center disconnect 若早于 RPC caller 开始 await，会把原错误变成未处理 zone 错误；TTS native stop 晚于服务 dispose 时会通知已销毁的 ChangeNotifier。现有调用仍收到 `websocketDisconnected` 原错；新增 TTS dispose 回归。TTS 定向测试 `1 pass`。
- 完整严格桌面门禁 `5365 pass / 19 skip / 0 fail`（5384 tests、674 files、23862 assertions、3 snapshots）；移动端 `flutter test --reporter compact` 为 `660 pass / 0 fail`，iOS V2 integration smoke `1 pass`，`flutter analyze` 为 `No issues found`。迁移 CLI 5 秒 native manifest 用例复跑耗时 2751ms，通过。
- 全面生产 V2-only 仍不放行：DEV manifest 的历史 unmatched facts `143 + 26` 与正文/附件差异尚待证据对账和维护窗口双次重导；Cloud 弱网/重连、跨设备附件权限、手机侧发起命令、UIKit 实际触控、物理故障、真机长会话/性能和 legacy migration/bridge 观察期仍未闭合。严格门禁内 19 项外部依赖用例仍跳过，不能据本批宣称生产验收完成。

### 2026-09-22 第九十九批：子代理生命周期归属修复与完整门禁闭合

- 完整严格门禁第一次暴露 11 条 replay 失败，全部集中在 `Agent ... changed identity or ownership`。根因是同一 Codex 子代理的 `agent.started` 与 `agent.stopped` 可能来自不同 provider turn；runtime writer 和 provider adapter 原先会按各自 `turnId` 推断 `runAttemptId`，把稳定 agent 错判成换 owner。现在 `agent.*` 只接受显式 `runAttemptId`，不再按 turn 猜归属；消息、工具、运行事件仍保留 request correlation，V2 身份冲突校验没有放宽。
- 修复后 gateway/conversation replay 定向回归 `15 pass / 0 fail / 268 assertions`；完整严格门禁最终 `5356 pass / 19 skip / 0 fail`（5375 tests、673 files、23846 assertions、3 snapshots）。迁移 CLI 单独复验 `18 pass / 0 fail / 130 assertions`；上一轮并发资源抖动导致的 dry-run 5 秒超时未复现，未被加入已知失败清单。
- renderer 对 `notification_content_unavailable` 等预期 no-op 不再错误打印 console error，未知失败仍保留 error；热更新后 `cdp:attach → cdp:snap` 为 `0 errors / 1 warning`（仅 Electron DEV CSP），`smoke:cdp-probe` 与 `smoke:cdp-center` 通过。已配对 iOS 模拟器仍用直接 SQLite/AX 证据验证，未重复扫码。
- 根 TypeScript composite gate 仍只剩上游 `pi-web-search@1.5.0` source 的 `exactOptionalPropertyTypes`/TS5097 等错误；桌面 `tsc --noEmit -p apps/desktop/tsconfig.json` 与 `bun run build` 通过。当前 DEV native manifest 的 `cutoverReady=false`（两个历史会话 unmatched `143 + 26`）和 LongCat Codex 在极明确提示下仍 `toolCount=0` 的真实能力缺口保持不变。


### 2026-09-22 第九十八批：真实演练后的 DEV 审计结果

- CDP 演练完成后只读 native manifest 复核：`integrity=ok`、`storageMode=v2_only`、64 个 streams、`199,462` events/effects、74 条 native facts；canonical attachment legacy payload/path/inline bytes、missing/parse errors 均为 `0`。
- `cutoverReady=false` 的具体原因已保留：`thr_1788595100156` 有 143 条无法由 immutable native ledger 证明的 unmatched live facts，`thr_1789133041817` 有 26 条；另有正文/附件差异审计项。V1 源表已退役，没有原始证据就不做等价补写，需生产维护窗口双次重导/人工对账。
- 新 post-cutover runtime 会话的 unmatched count 为 `0`，但仍标记 `post_cutover_runtime_without_native_ledger` 观察项；不把这类观察项或弱模型工具失败改写成通过。
### 2026-09-22 第九十七批：LongCat 计划派发身份修复与弱模型边界复验

- `piRuntimeOrchestrationDeps().runThreadRequestOnce` 已修复为完整透传 `retryIndex/runtimeDispatch`。修复前 PI 计划审批的实际运行会执行，但 `plan.resolve` 收据停在 `runtime_dispatch_not_started`；修复后 `thr_1790080516660` 的主代理计划和 `thr_1790080818866` 的强制 coder 子代理计划均完成，command job、run、checkpoint 和 pending-plan 清理均有终态。
- `thr_1790080818866` 的 planning run、command run、coder agent、`finalize_plan`、`Agent`、`Bash printf PI_PLAN_SUBAGENT_OK` 全部为 `completed`；V2 user message 计数为 `1`。桌面计划/运行/V2 定向回归 `140 pass / 0 fail / 504 assertions`。
- 使用 `thinkingEffort=off`、中文单动作提示和精确 Bash 命令复测 Codex LongCat（`thr_1790081865464`）：60 秒内只生成 thinking，Bash tool row 为 `0`；经 V2 cancel command 后安全回到 `idle`，无未捕获异常，user row 为 `1`。这是真实模型/适配缺口，不能标为通过，也不通过兜底自动执行工具来掩盖。
- LongCat Claude 原生计划仍未稳定发出 `ExitPlanMode`，Codex 工具/子代理旧轮次未产生 Bash durable tool row；这些场景保留为失败证据。PI 原生 `finalize_plan → approvePlan → forced coder` 链路已通过，不能据此宣称所有核心和所有弱模型场景均闭合。
- 本次 DEV 重启 reconciliation 扫描约 `198,276` 条 V2 事件、约 `402MB` 数据，约 7 分钟后 CDP 恢复；无数据损坏，但启动性能仍是生产门禁。


### 2026-09-21 第九十一批：Supabase Cloud 认证全链路与 CAS 冲突修复

- Cloud 认证测试第一次暴露了真实缺陷：`eco_replace_account_config` 的 stale-revision 分支使用自定义 SQLSTATE `40001`，请求在 PostgREST 链路中挂起而不是返回冲突。该行为与 [Supabase 官方 RPC 故障说明](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b)一致；新增 migration `20260921170000_fix_account_config_conflict_sqlstate.sql`，将冲突映射为 PostgREST `PT409`，保留 `settings_sync_conflict` 消息、CAS 语义、secret whitelist、security-definer 和权限边界。
- 修复 migration 已通过 `supabase db push --dry-run` 预览并应用到 Cloud；远端 migration history 已推进到 `20260921170000`。桌面同步客户端显式识别 `PT409`，Cloud 集成测试要求 HTTP `409`、`code=PT409` 与冲突消息，避免把挂起或任意 4xx 当成通过。
- 新增 `apps/desktop/test/supabase-cloud-authenticated.integration.test.ts`：无写开关时写用例自动跳过；认证读测试实测 `2 pass / 1 skip / 0 fail`，完整受控写测试最新实测 `3 pass / 0 fail / 11 assertions`（约 11.5 秒）。写测试用两个独立 session 注册临时 desktop/mobile、注册 device session、验证 binding 首次/重复幂等、私有 Realtime broadcast 往返，并强制断言两个临时设备的 `device-disable` 清理均返回 `200`；没有改动正式设备设置或对话数据。
- 当前工作区严格桌面门禁 `3823 pass / 6 skip / 0 fail`（`18648 assertions`、`522 files`）；settings-sync 定向回归 `31 pass / 0 fail / 96 assertions`；移动端 `flutter test` 为 `656 pass`，`flutter analyze` 为 `No issues found`；`bunx tsc -b --pretty false`、`git diff --check` 和 `supabase db push --dry-run` 均通过。DEV 重启后 `cdp:attach → cdp:snap → smoke:cdp-probe → smoke:cdp-center` 通过，页面/Composer 可读，console `0 errors / 1 warning`，认证 Center 读取到 `connected`、1 个 active binding、29 条 presence（3 online）和 10 个 settings-sync 域。
- 本批闭合了 Cloud 的认证、CAS 冲突、设备/session、绑定幂等和私有 Realtime 基础链路；HTML shared-domain 的 `Content-Type=text/plain` 风险、deferred device-session RLS migration、真实 mobile peer 尾部补拉/弱网重连、附件对象权限、生产双次重导/native manifest、真机长会话和 legacy migration/bridge 观察期仍是全面生产 V2-only 门禁。

### 2026-09-21 第九十二批：iOS 模拟器 arm64 启动门禁与扫码插件升级

- 本机 Xcode `26.6` 已安装 iOS `26.5` Simulator，并创建/启动 `Eco iPhone 11 V2`。旧 `mobile_scanner 6.x` 的 iOS Pod 排除模拟器 `arm64`，导致 Apple Silicon + iOS 26 只能生成不可安装的 x86_64 包；升级到 `mobile_scanner 7.4.2`（Apple Vision API）后移除 Google MLKit 的 iOS Pod 依赖，保留现有扫码 API。
- 验收证据：`flutter test --reporter compact` `656 pass / 0 fail`；`flutter analyze` `No issues found`；`flutter build ios --flavor dev --simulator` 通过（`76.5s`）；`Runner.app` 检查为 arm64/x86_64 universal binary；`xcrun simctl install` 与 `xcrun simctl launch` 通过；bundle id `com.plus.ecoding.dev`，首屏可见“扫码”和“手动配置”入口。补充执行 `flutter build ios --flavor dev --release --no-codesign`，iPhoneOS Release 目标通过（`74.6s`，`Runner.app` 33.3MB，arm64）。
- 结论边界：iOS 模拟器现在可用于 Mobile V2 UI、REST/WebSocket/Realtime 联调和受控断线演练，但本批没有在模拟器持久化 Cloud 凭据或注册 mobile device，因此不能把它计入 authenticated mobile peer。真实移动端尾部补拉/弱网重连、真机 Secure Enclave/推送/后台/蜂窝和物理故障仍保持未闭合。

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

- 修复真实启动缺口：V2-only reopen 现在在同一事务内先迁移残留 `thread_pending_followups`，再退役旧表；follow-up 图片先经受管 `PromptImageFileStore` 物化为 `mediaType/contentRef/byteLength`，非法结构、不可读对象或缺少 durable store 直接 fail-closed，不丢数据、不复制旧载荷。
- 主进程和维护 CLI 在 `initialize()` 前注入图片存储；新增 path-only 图片的 reopen 回归，成功后旧表不存在、V2 附件不含本地 path。定向套件 `68 pass / 0 fail / 178 assertions`；严格门禁 `5345 pass / 16 skip / 0 fail`（5361 tests、23821 assertions、672 files、3 snapshots）；TypeScript、diff 检查、桌面构建、Flutter `656 pass` 与 analyze 均通过。
- DEV 直接 SQLite 核对为 `storageMode=v2_only`、`integrity=ok`、32 streams、22948 events/effects、1754 messages、1832 tools、74 native facts，过渡表为 0，13 张退役 V1 source table 全部不存在；维护 CLI native manifest verify 通过（`cutoverReady=true`、`factsHash=ecdb13f4`），15 条已知 reconciliation reason 仍保留。
- 热重载后的 CDP/Center 只读复验通过：页面 `http://127.0.0.1:5173/`、标题 `Eco Coding`、`window.eco=true`、Composer/DOM 可读，console `0 errors / 1 warning`；Center `connected`，活动 binding `1`（`approval:decide/events:read/rpc:invoke`），private presence `25`/在线 `3`，settings-sync `10` 域（`dirty=7`、`synced=3`）。全面生产 V2-only 仍未放行，真实 mobile peer、Supabase 弱网/尾部恢复、跨设备附件权限、生产迁移/native manifest、物理故障、真机长会话和 legacy migration/bridge 观察期均未闭合。
- Biome 目标文件 check 通过但保留 18 条 warning；`index.ts` 的既有 `organizeImports` error 和 `noAssignInExpressions` warning 仍待单独清理，未被测试结果掩盖。

### 2026-09-21 第八十六批：V2-only 跟进队列附件迁移与维护修复闭环

- 旧 `thread_pending_followups` 在切换时若含本地 `path` 或 inline `data`，现在会在同一事务内通过受管 `PromptImageFileStore` 物化为 `mediaType/contentRef/byteLength`；非法 JSON、无效记录、对象不可读或无 durable store 直接返回 `migration_incomplete` 并保留旧表，`conversation_followups_v2` 不接收旧载荷。
- V2-only 维护 CLI inventory/repair 已纳入 `conversation_followups_v2`。修复前生成 SQLite 备份，follow-up 更新与 canonical event 修复在一个事务中完成，事件 hash/read model 保持一致，结果单独报告 `repairedFollowUps`，native facts 不改写且重复执行幂等。
- 迁移 CLI + follow-up store `33 pass / 0 fail / 175 assertions`。随后全量严格门禁 `5344 pass / 16 skip / 0 fail`（5360 tests、23818 assertions、672 files、3 snapshots），无新增失败；`bunx tsc -b --pretty false`、`git diff --check`、桌面构建均通过。构建为 Vite `5077 modules`、main `28.15 MB`、preload `60.1 KB`；移动 `flutter test --reporter compact` `656 pass / 0 fail`、`flutter analyze` `No issues found`。
- DEV 只读审计：`storageMode=v2_only`、`integrity=ok`、`cutoverReady=true`、32 conversations；V2 events/effects `22948/22948`、messages `1754`、tools `1832`、native facts `74`，过渡 skeleton/pending plans/follow-ups 为 0，13 张退役 V1 source table 全部不存在。仍显式保留 15 条已知 reconciliation reason（4 类、5 个有外部数据的会话）。
- CDP `attach → snap → smoke:cdp-probe → smoke:cdp-center` 全部通过：页面/标题/`window.eco=true`/侧栏/Composer/DOM 可读，console `0 errors / 1 warning`；Center `connected`，活动 binding `1`，private presence `25`/在线 `3`，settings-sync `10` 域（`dirty=7`、`synced=3`）。脚本只读，没有注册设备、推送设置或写入对话/凭据。
- 验收结论：本地 V2-only 附件迁移、维护审计、桌面/移动门禁和 DEV 冒烟均已闭合；全面生产 V2-only 仍被真实 mobile peer 双端往返/尾部补拉、Supabase 弱网重连、跨设备对象权限、生产双次迁移/native manifest、ENOSPC/掉电/响应丢失、Android/iOS 真机长会话和 legacy migration/bridge 观察期阻断。

### 2026-09-21 第八十五批：follow-up/runtime-config V2 durable command 收口

- follow-up 入队/取消/升级/编辑/暂停/更新/排序与 runtime-config 更新的共享 registry、桌面 IPC、移动 `DesktopRpc` 已统一完整 V2 command envelope：`principalId + clientCommandId + threadId + expectedHistoryRevision`，并按命令携带 follow-up/runtime payload；旧裸形状被协议层拒绝。
- durable job 类型 `followup.mutate`、`runtime-config.mutate` 覆盖 request hash 冲突、running 重复、stale revision、响应丢失幂等和启动恢复；无法证明终态时 fail-closed，不重放、不伪造成功。follow-up 在 SQLite 存储和 remote wire 两个边界均不泄漏本地 path/inline attachment。
- 本轮命令/协议定向回归通过；与第八十六批合并的迁移/队列套件为 `33 pass / 0 fail / 175 assertions`。本批不替代真实 mobile peer 和生产网络故障门禁。

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

- V2-only 公共 schema 已补齐 `threads`、`composer_drafts`、`thread_compact_handoff` 的运行时列，并在启动时做幂等增量升级；该升级只触及公共 V2 依赖表，不创建任何 V1 conversation 表。新增 fresh/reopen 回归覆盖“V2-only 重开时外部重新出现旧 `thread_pending_plans` 表”：pending plan 会迁移到 `conversation_pending_plans_v2`，旧表在同一事务中退役。SQLite cutover/reopen/老 schema 定向回归现为 `34 pass / 0 fail`。
- 关键 V2 store、production-boundary 与 Node SQLite 组合定向复跑为 `97 pass / 0 fail / 300 assertions`，覆盖 pending-plan V2 持久化、13 张退役表清单、公共 schema 增量升级、重开迁移和旧表物理退役。
- 最终严格桌面门禁 `5330 pass / 16 skip / 0 fail`（5346 tests、23759 assertions、669 files、3 snapshots）；16 个 skip 明确是外部 Supabase、Live/LongCat 或 Codex app-server 依赖。`bunx tsc -b --pretty false`、触及文件 Biome error-level 与 `git diff --check` 均通过。公共 schema 修复后的 `bun run build` 通过：Vite 5077 modules，main `28.13 MB`，preload `60.1 KB`；仅保留既有 externalization、动态导入和大 chunk warning。
- 移动端全量复跑 `flutter test --reporter compact` 为 `656 pass / 0 fail`，随后 `flutter analyze` 为 `No issues found`；本批没有用桌面门禁替代移动端证据。
- DEV 重启后重新执行 `cdp:attach → cdp:snap → smoke:cdp-probe`：`http://127.0.0.1:5173/`、标题 `Eco Coding`、`window.eco=true`、Composer/侧栏/DOM 可读，console `0 errors / 1 warning`，探针 PASS。随后只读打开真实历史会话“商品标名飞书同步与异常检测核对界面”，历史用户消息、正文和 Composer 均可读，仍为 `0 errors / 1 warning`；没有发送、编辑或删除数据。
- DEV 只读 preflight/manifest `/tmp/eco-v2-final-manifest-20260920-b80-final-2.json` 与独立 verify 均通过：`storageMode=v2_only`、`integrity=ok`、`cutoverReady=true`、32 conversations、74 native events、`factsHash=ecdb13f4`。聚合的 `feedSkeletons`、旧附件载荷/path/inline bytes、缺失/解析错误和 `nativeUnmatchedEvents` 均为 0；但审计仍保留 15 条已知 reconciliation reason（正文/附件差异、`run.started` 折叠到 attempt、post-cutover runtime without native ledger），分布在 5 个有外部数据的历史会话，未被 `cutoverReady` 掩盖。SQLite 直接复核仍为 32 streams、22948 events、22948 sync effects、1754 messages、1832 tools、74 native facts、过渡 skeleton 0 行、`PRAGMA integrity_check=ok`，V2 meta 为 `conversation_v2_storage_mode=v2_only`；13 张退役 V1 source table 的 `retiredPresent=[]`。
- 本批只证明本地运行时和 DEV 的 V2-only 边界已收紧；全面生产放行仍阻断于 authenticated Supabase Realtime/跨设备绑定与尾部恢复、生产双次重导及真实 native manifest、ENOSPC/掉电/响应丢失、跨设备 durable attachment 权限、Android/iOS 真机长会话/RSS/延迟、历史无证据归属/工具字段以及 legacy migration/bridge 观察期。当前不能把本地 `cutoverReady` 或匿名 Cloud 探针写成生产 V2-only 已完成。

### 2026-09-20 第八十二批：认证 Cloud 只读矩阵固化与 CDP smoke

- 新增 `apps/desktop/scripts/dev-cdp-center-server-smoke.mjs`（入口：`bun run smoke:cdp-center`）。该脚本只重连现有 DEV 会话并读取 settings、binding、presence、settings-sync；不注册设备、不撤销绑定、不推送设置、不写入对话数据，输出不含任何凭据或设备标识。
- 通过当前 DEV 的已认证会话实测：连接 `connected`；活动 binding `1`，具备 `approval:decide/events:read/rpc:invoke`；private presence `25` 条、在线 `3` 条（均为 desktop）；settings-sync 读取 `10` 个域，其中 `dirty=7`、`synced=3`。`syncCenterServerConfig('reconcile')` 返回 `needsUserChoice=true` 且无 push/pull 或 secret 计数，vault 状态为 `ready`，证明冲突不会被静默覆盖。
- `smoke:cdp-center` 退出 `0`；脚本强制检查 settings/设备凭据完整、活动 binding 存在且具备 `events:read`/`rpc:invoke`，并检查 private presence 与 settings-sync 域。Supabase Realtime RPC 与 Center client 定向回归 `27 pass / 0 fail / 107 assertions`。这只证明当前已认证桌面连接、private presence、binding 读取和设置冲突保护；没有在线 mobile peer，跨设备 JSON-RPC、移动端尾部补拉、弱网/重连和对象权限仍未验收。
- 本批没有把认证 smoke 写成生产通过。全面 V2-only 仍被生产双次重导/native manifest、ENOSPC/掉电/响应丢失、跨设备 durable attachment 权限、Supabase 弱网/重连/尾部恢复、Android/iOS 真机长会话/RSS/延迟、历史无证据归属/工具字段及 legacy migration/bridge 观察期阻断。

### 2026-09-20 第八十批：pending-plan V2 物化、退役表全量审计与严格门禁

- 计划审批冻结态已落到独立 V2 表 `conversation_pending_plans_v2`。V2-only 保存、读取、清理、历史重写和命令续接不再依赖 `thread_pending_plans`；旧表仅在 `legacy_compat` 显式迁移事务中读取并逐字段校验，切换后退役。对缺少后加可选列的最老旧表结构，迁移会安全填入 `NULL` 并继续校验，不会因 schema 差异崩溃。
- 维护 CLI 现在审计全部 13 张退役 V1 conversation source table；新增 production-boundary 断言锁住清单。定向回归：V2 store `49 pass / 0 fail / 187 assertions`，production-boundary + store `63 pass / 0 fail / 300 assertions`，SQLite cutover/reopen/老 schema `33 pass / 0 fail`，迁移 CLI `17 pass / 0 fail / 126 assertions`。
- 全量严格门禁最终为 `5330 pass / 16 skip / 0 fail`（5346 tests、23759 assertions、669 files、3 snapshots）；16 个 skip 仍是外部 Supabase、Live/LongCat 或 Codex app-server 依赖。第八十一批已补写公共 schema 修复后的 TypeScript、Biome、构建、DEV preflight/manifest 和 CDP 结果。
- 本批只闭合本地 pending-plan V2 状态和维护审计覆盖，不把迁移输入误报为生产运行时写面。全面生产 V2-only 仍被 authenticated Supabase Realtime/跨设备绑定与尾部恢复、生产双次重导/native manifest、ENOSPC/掉电/响应丢失、跨设备 durable attachment 权限、Android/iOS 真机长会话/RSS/延迟、历史无证据归属/工具字段以及 legacy migration/bridge 观察期阻断。

### 2026-09-20 第七十九批：计划审批桥接续接确认、全量门禁与 DEV 复核

- 计划审批的 Claude bridge 在唤醒 SDK 等待器前绑定 `principalId + clientCommandId`。SDK 收到 approve/deny 后先写入 V2 `plan.bridge_continuation_resumed` checkpoint，再确认续接；只有确认返回后，主进程才原子清理 pending plan 并完成命令 receipt。绑定丢失、超时或续接失败均 fail-closed；只有 `plan.bridge_resolved` 而没有续接 checkpoint 时，启动恢复返回 `plan_resolution_outcome_unknown`，不自动重放或伪造成功。进程在续接确认前退出仍需用户重试。
- bridge binding/ack、绑定不匹配清理、审批恢复完成/拒绝终态 checkpoint 回归与计划命令/存储/运行时组合为 `142 pass / 0 fail / 593 assertions`。全量严格门禁为 `5326 pass / 16 skip / 0 fail`（5342 tests、23744 assertions、669 files、3 snapshots）；16 个 skip 仍为外部 Supabase、Live/LongCat 或 Codex app-server 依赖。
- `bunx tsc -b --pretty false`、触及文件 Biome error-level、`git diff --check` 均通过。桌面 `bun run build` 通过：Vite 5077 modules，renderer `activity-log-view` 约 1.21 MB，main `28.12 MB`，preload `60.1 KB`；移动端 `flutter test --reporter compact` 为 `656 pass / 0 fail`，`flutter analyze` 为 `No issues found`。
- DEV CDP attach → snapshot → `smoke:cdp-probe` 通过，并只读点击真实历史会话：页面 `http://127.0.0.1:5173/`、标题 `Eco Coding`、`window.eco=true`、Composer/历史正文可读，console `0 errors / 1 warning`，探针 PASS；没有发送或修改消息。Electron `Target.createTarget: Not supported` 是工具层 warning。
- DEV 只读 preflight `/tmp/eco-v2-final-manifest-20260920-b79.json` 为 `storageMode=v2_only`、`integrity=ok`、`cutoverReady=true`、32 conversations、74 native events、manifest hash `c1c4818a`；独立 verify `passed`、`factsHash=ecdb13f4`。SQLite 直接复核为 32 streams、22948 events/effects、1754 messages、1832 tools、74 native facts、过渡 skeleton 0 行、`PRAGMA integrity_check=ok`。
- 本批收紧的是本地计划命令的续接确认边界，不是跨进程 SDK replay 的完成证明。全面生产 V2-only 仍被 authenticated Supabase Realtime/跨设备绑定与尾部恢复、生产双次重导/native manifest、ENOSPC/掉电/响应丢失、跨设备 durable attachment 权限、Android/iOS 真机长会话/RSS/延迟、历史无证据归属/工具字段和 legacy migration/bridge 观察期阻断。

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

- 第七十五批后的最终复跑全部通过：严格桌面门禁 `5329 pass / 16 skip / 0 fail`（5345 tests、23736 assertions、670 files）；ActivityLogView/V2 merge 定向 `109 pass / 0 fail / 502 assertions`；production-boundary `12 pass / 0 fail / 84 assertions`；`bunx tsc -b --pretty false`、桌面构建、触及文件 Biome error-level 和 `git diff --check` 均通过。移动端 `flutter test --reporter compact` 为 `656 pass / 0 fail`，`flutter analyze` 为 `No issues found`。
- DEV 数据库直接只读复核为 `conversation_v2_storage_mode=v2_only`、`PRAGMA integrity_check=ok`；32 streams、22948 events、22948 sync effects、1754 messages、1832 tools、74 native facts，过渡 `conversation_feed_skeletons_v2` 为 0 行。重新生成的 `/tmp/eco-v2-final-manifest-20260920-final.json` 报告 `storageMode=v2_only`、`integrity=ok`、`cutoverReady=true`、32 conversations、74 native events、`nativeManifestHash=f863cd7d`；随后独立 verify `passed`，`factsHash=ecdb13f4`。附件旧载荷/path/inline bytes、缺失/解析错误和 native unmatched 均为 0。
- DEV CDP 末轮 `attach → snapshot → smoke:cdp-probe` 通过：页面/标题/`window.eco=true`/Composer/DOM 可读，console `0 errors / 1 warning`；只读点击真实历史会话并返回后仍为 `0 errors / 1 warning`。这证明当前本地 V2 renderer 入口可用，不把 Electron 工具层 `Target.createTarget: Not supported` warning 或历史会话中已有的 provider HTTP 失败误报为 V2 通过。
- 本批只更新本地可执行证据，不改变生产放行结论：Supabase authenticated matrix、生产双次重导与真实 native manifest、ENOSPC/掉电/响应丢失、跨设备 durable attachment 权限、Android/iOS 真机长会话/RSS/延迟、历史无证据归属/工具字段和 legacy migration/bridge 观察期仍未闭合。

### 2026-09-20 第七十五批：ActivityLogView 生产入口 V2-only 收口

- 桌面 `ActivityLogView` 的生产 props 已移除 `projection` 与 `viewModel`；它只从 `conversationV2` 构建 Feed projection。V2 bootstrap 尚未就绪时显示 prompt/loading 或显式 recovery 状态，不读取旧 projection。`App.tsx` 的 `LazyActivityLogView` 调用点也不再传入旧 projection/viewModel。
- 需要直接覆盖展示逻辑的回归改用 `ConversationV2ProjectionActivityLogView`，这只是 V2 read-model projection 的 presentation surface，不是生产 fallback。新增 production-boundary 测试锁住入口 props、分支和调用点的 V2-only 约束。
- 定向 UI/merge 回归 `109 pass / 0 fail / 502 assertions`，production-boundary `12 pass / 0 fail / 84 assertions`；严格桌面门禁 `5329 pass / 16 skip / 0 fail`（5345 tests、23736 assertions、670 files），桌面构建、`bunx tsc -b`、Biome error-level 与 `git diff --check` 通过；移动端全量测试与 `flutter analyze` 均通过。
- 这批证据只覆盖本地生产 renderer 入口，不等于外部放行。Supabase authenticated matrix、生产双次重导/native manifest、物理故障、跨设备附件权限、Android/iOS 真机长会话/RSS/延迟以及 legacy migration/bridge 观察期仍未闭合。

### 2026-09-20 第七十四批：V2-only 当前模块边界、Cloud 匿名探针与最终回归

- 为避免把兼容代码误认成生产入口，桌面 V2 runtime/presentation 文件已统一为 `conversation-v2-*` 命名；只用于维护/回放的过渡代码明确为 `legacy-feed-replay-*`、`legacy-feed-skeleton-*`。旧的 `thread-run-projection*`、`thread-feed-skeleton*`、`thread-run-turn-feed`、`run-projection-merge` 文件已从 `apps/desktop/src` 和 `apps/desktop/test` 移除，`scripts/test.mjs` 的分组入口同步更新。共享 `ThreadRunProjection*` 仍是 V2 read-model 展示 DTO 名称，不代表旧运行时模块复活。
- 最终桌面严格门禁仍为 `5328 pass / 16 skip / 0 fail`（5344 tests、23721 assertions、670 files）；重命名后的 V2 production-boundary/projection/parity/runtime/view/feed 与 legacy replay/skeleton 定向组合为 `439 pass / 0 fail / 7089 assertions`。运行时 writer/交互命令/V2 remote publisher/迁移 CLI 故障组合另为 `36 pass / 0 fail / 211 assertions`，覆盖 `SQLITE_FULL` 游标守恒、响应丢失 receipt、旧表退役、备份/活动会话/损坏元数据 fail-closed 和附件原子修复。移动端全量 `flutter test` 为 `656 pass / 0 fail`，`flutter analyze` 为 `No issues found`；`bunx tsc -b`、触及文件 Biome error-level、`git diff --check` 和 `bun run build` 均通过。构建只保留既有 externalization、动态导入和大 chunk warning。
- DEV 重启后按 `eco-dev-cdp` 执行 `cdp:attach → cdp:snap → smoke:cdp-probe` 均通过：`http://127.0.0.1:5173/`、标题 `Eco Coding`、`window.eco=true`、侧栏 action、Composer 和 DOM 可读，console `0 errors / 1 warning`，探针 PASS，截图 `apps/desktop/.smoke-artifacts/cdp-ui-probe.png`。随后用本地 Playwright CLI 只读点击一个现有会话，标题、用户消息导航、历史正文和 Composer 均加载，console 仍为 `0 errors / 1 warning`，未发送或修改内容。最终快照的 DEV 状态按钮显示“在线”；这只代表当前开发环境连接指示，不代表认证后的 Cloud V2 同步已验收。`Target.createTarget: Not supported` 是 Electron 工具层 warning。
- 对用户提供的 Supabase Cloud 只做了不写数据的匿名/负向探针：Auth health `200`（GoTrue `v2.197.0`）；`html-host-probe` `200`（共享云端 rewrite 返回 `text/plain`）；无用户 session 的 `device-register` `401`；匿名加入私有 Realtime topic `401 Unauthorized`；PostgREST 根入口 `401`（明确仅 `service_role` 可用）；Auth settings `200`，`disable_signup=false`、email provider 开启、`mailer_autoconfirm=false`。这些结果证明端点可达且拒绝边界生效，不证明认证后的 V2 对话同步。
- Cloud 的认证私有 Realtime、跨设备绑定、断线/重连/尾部补拉、对象权限和设备生命周期矩阵尚未执行：当前只有 anon key，没有可确认邮件的 disposable test user、service-role/数据库密码或生产维护窗口。不会把这条外部缺口用本地 SQLite、合成 fault injector 或 CDP 静态壳冒充通过；anon key 未写入仓库或文档。
- 本批将当前可执行证据和未闭合证据分开：本地代码、迁移前置检查、移动/桌面回归与 DEV UI 已通过；全面生产 V2-only 仍被真实 Supabase authenticated matrix、生产双次重导与 native manifest、物理 ENOSPC/掉电/响应丢失、跨设备 durable attachment 权限、Android/iOS 真机长会话/RSS/延迟、历史无证据 Agent 归属和工具字段、legacy migration/bridge 观察期清理阻断。

### 2026-09-20 第七十三批：V2-only 生产启动硬门禁与过渡投影生产移除

- 生产主进程现在以 `freshStorageMode: "v2_only"` 和 `requiredStorageMode: "v2_only"` 启动；已有 `legacy_compat` 数据库在创建任何 V1 公共 schema 前直接抛 `migration_incomplete`，必须先走显式维护迁移，启动路径不再自动兜底或复活 V1 表。Node SQLite 与 production-boundary 回归覆盖该拒绝边界。
- 主进程已删除旧 thread-feed skeleton/projection/focus IPC 的生产加载、注册、维护和 renderer 上报；V2 durable writer 只保留兼容调度接口，实际读写来自 V2 events/effects/read model。重试与历史编辑入口删除旧 projection/history fallback，缺失 V2 目标直接 fail-closed。共享 `ThreadRunProjectionSnapshot`/renderer view 仍作为 V2 read model 的展示 DTO，request-span helper 也只接收 V2 runtime sources；退役 V1 IPC、表读写和旧 skeleton 维护均不再进入生产链路。
- 定向 production boundary、projection parity、Node SQLite 组合 `50 pass / 0 fail / 88 assertions`；严格桌面门禁 `5328 pass / 16 skip / 0 fail`（5344 tests、23721 assertions、670 files）。移动端 `flutter test` `656 pass / 0 fail`、`flutter analyze` 无问题；桌面 TypeScript、触及文件 Biome error-level、`git diff --check`、构建均通过。
- 当前 DEV CDP attach → snapshot → probe 均通过：`http://127.0.0.1:5173/`、`Eco Coding`、`window.eco=true`、侧栏/Composer/DOM 可读，console `0 errors / 1 warning`，探针 PASS，截图 `apps/desktop/.smoke-artifacts/cdp-ui-probe.png`。Electron `Target.createTarget: Not supported` 是工具层 warning。
- 最新只读 DEV preflight 使用 `/tmp/eco-v2-final-manifest-20260920-b73.json` 成功：`storageMode=v2_only`、SQLite `integrity=ok`、`cutoverReady=true`、32 conversations、74 native manifest events、hash `40d284aa`；附件旧载荷/路径/inline bytes/缺失/解析错误和 `nativeUnmatchedEvents` 均为 0。报告保留正文/附件差异、`run.started` 折叠到 attempt、3 条 post-cutover runtime without native ledger 等审计事实。
- 本批只关闭本地生产启动和主进程旧投影读写面；真实 Supabase 弱网/重连/尾部恢复、跨设备对象权限、生产双次重导/manifest、物理故障矩阵、Android/iOS 真机长会话与 RSS/延迟预算、历史无证据归属/工具字段缺口，以及旧迁移/bridge 兼容观察期仍是全面生产放行的阻断项。

### 2026-09-20 第七十二批：最终本地 V2-only 门禁与真实云端阻断确认

- 严格桌面闸门 `node scripts/test-gate.mjs --strict` 通过：`5326 pass / 16 skip / 0 fail`，共 5342 tests、23710 assertions；没有已知失败清单，也没有新增失败。16 个 skip 全部是外部 Supabase、Live/Longcat 或 Codex app-server 依赖。
- 移动端最终全量 `flutter test` 为 `656 pass / 0 fail`，`flutter analyze` 为 `No issues found`。桌面 TypeScript、触及文件 Biome error-level、共享 remote command `3 pass / 0 fail`、`git diff --check` 和 `bun run build` 均通过；构建只剩既有大 chunk 提示。
- DEV CDP 最终复验：attach、snapshot、probe 均退出 0，`http://127.0.0.1:5173/` / `Eco Coding` / `window.eco=true` / composer / DOM 均可读，console `0 errors / 1 warning`；`Target.createTarget: Not supported` 为 Electron 工具层 warning。
- 当前 DEV 数据库只读 `--all --native-manifest --attachments-root` 复核：`storageMode=v2_only`、SQLite `integrity=ok`、`cutoverReady=true`、32 conversations、74 native manifest events、manifest hash `39ceeea0`；附件旧载荷/路径/inline bytes/缺失/解析错误和 `nativeUnmatchedEvents` 均为 0。报告保留 15 条 native reconciliation audit reason（正文/附件差异、`run.started` 折叠到 attempt、3 条 post-cutover runtime without native ledger），这些审计事实没有被“ready”字段掩盖。
- 本机 `supabase status` 因 Docker daemon 不可用而失败；真实 Supabase 弱网、重连、尾部丢失和跨端认证门禁本批没有执行。SQLite 合成基线、移动 fault injector 和本地单测不能替代这条生产门禁，当前不能宣称全面生产 V2-only。
- 本批把本地可执行证据全部跑完，并把外部依赖缺口显式保留。剩余阻断：真实 Supabase/跨设备对象权限、生产双次重导与 manifest、物理故障矩阵、Android/iOS 真机长会话与 RSS/延迟预算、历史无证据归属及工具字段缺口、旧 projection/bridge/迁移兼容观察期。

### 2026-09-20 第七十一批：V2-only 大 run 写入与分页性能基线、运行时完整性热路径收口

- 生产运行时不再在每个事件前重放整段 event/effect：新增显式 `appendRuntime()`，热路径只做最新序号/epoch 的 O(1) 索引检查；通用维护 `append()` 与 `validateIntegrity()` 仍保留深 replay/hash，损坏数据不会被静默吞掉。
- `conversation_runs_v2.tool_count` 和 `conversation_tool_calls_v2.run_known` 作为同事务派生缓存，避免大 run bootstrap/messages 每次现场统计数万工具；旧库重开回填，孤儿工具保留索引回退。V2 store/runtime/projection 定向 `71 pass / 0 fail / 269 assertions`，TypeScript/Biome error-level 通过。
- `bun run --cwd apps/desktop conversation:v2-benchmark --events=10000|50000|300000 --batch-size=2000|5000|10000 --body-bytes=256` 已实测：1 万/5 万/30 万事件写入分别约 1.98s/9.72s/63.66s（约 5,044/5,142/4,712 events/s）；30 万事件 DB 约 649.5MB、RSS 约 1.66GB，bootstrap/messages/tools/sync P95 为 2.02/1.35/0.67/2.69ms，重开加 bootstrap 61.99ms，所有分页预算和重开 head 校验通过。100KB/1MB 正文各 100 事件的 bootstrap/messages P95 约为 2.66/3.58ms、15.34/15.91ms，1MB 场景 RSS 约 789MB。
- 这是桌面 SQLite 合成基线，不等同于真实 Supabase 弱网、Android/iOS 真机或长会话；30 万事件和 1MB 正文的 RSS 峰值仍需设备预算与真实链路验收。

### 2026-09-20 第七十批：V2-only 跨设备附件上下文授权收口

- `prompt-image:read-chunk` 现在要求显式 `contextKey`；桌面主进程先校验 `thread:<conversationId>` 或 `landing:<workspace>`，再按 V2 conversation event/message/follow-up/effect/provider/command/native-fact JSON 精确证明 `contentRef` 归属。V2-only 缺失 stream、跨会话引用、未知 landing 草稿和非法引用均 fail-closed，不把全局 CAS hash 当作权限。
- 移动端 `DesktopRpc.downloadPromptImage` 和附件 staging 全程携带已有 composer context；共享 remote registry 已把 `contextKey` 列为必填。legacy-compatible 只保留对应旧消息/队列的 scoped 兼容读取，V2-only 不访问重建的 V1 表。
- 新增回归：Node SQLite `31 pass / 0 fail`（含跨会话、landing draft、缺失 stream）；共享 remote command `3 pass / 0 fail`；移动 `desktop_rpc`/附件 wire 定向 `38 pass / 0 fail`；`flutter analyze` 仍为 `No issues found`；桌面 noEmit TypeScript、Biome error-level 和 `git diff --check` 通过。
- 当前 DEV 进程保持运行；前一轮 CDP attach/snapshot/probe 已通过（`window.eco=true`、composer/DOM 可读、console `0 errors / 1 warning`，截图 `apps/desktop/.smoke-artifacts/cdp-ui-probe.png`）。本批只新增协议/授权与自动化回归，代码变更后的页面静态结构未改变，需在最终门禁重跑一次 CDP。
- 本批关闭本地 CAS 读链路的跨上下文越权缺口；生产全面 V2-only 仍受生产双次重导/manifest、跨设备对象复制和真实云端授权、物理故障/弱网/尾部恢复、生产大 run/真机性能、历史归属与工具字段缺口、旧 projection/bridge/迁移兼容观察期等硬门槛阻断。

### 2026-09-20 第六十九批：V2-only 用户消息流错误分类收口与全量复验

- `listConversationUserMessageRecords` 在 `v2_only` 丢失 `conversation_streams_v2` 时统一返回 `ConversationV2Error(integrity_failure)`；`legacy_compat` 保留兼容错误语义，SQLite 回归已覆盖该边界。
- 定向回归：Node SQLite `30 pass / 0 fail`；运行时与生产边界 `38 pass / 0 fail / 189 assertions`。桌面全量（排除 `e2e/**`）`3800 pass / 3 skip / 0 fail`（3803 tests、18542 assertions、519 files、353.72s）；TypeScript、构建和 `git diff --check` 通过，Biome 无 error、保留 17 条既有 warning。
- 移动端 V2 定向套件 `45 pass / 0 fail`，`flutter analyze` 为 `No issues found`。DEV 当前主进程 CDP attach/snapshot/probe 均通过：`Eco Coding`、`window.eco=true`、composer 可见、DOM 可读、console `0 errors / 1 warning`，探针 PASS，截图为 `apps/desktop/.smoke-artifacts/cdp-ui-probe.png`；Electron `Target.createTarget` 为已知工具层 warning。
- 本批完成的是错误分类和全量复验，不是生产放行。生产双次重导/manifest、跨设备附件对象复制与授权、物理故障/弱网/尾部恢复、生产大 run 与真机长会话、历史归属/工具字段缺口及旧 projection/bridge/迁移兼容观察期仍是硬门槛。

### 2026-09-20 第六十八批：V2-only 缺失 stream 失败闭合与退役表写隔离

- 对活动线、用户消息、编辑/rewind、activity/run 回绑、run-event 列表和清理入口完成 V2-only 读面审查：缺少 `conversation_streams_v2` 时统一返回 `integrity_failure`，不再用 `[]` 掩盖损坏或缺失的会话；真实存在的 V2 空流仍按合法空结果处理。
- V2-only 的 `deleteThread`、`completeThreadDeleteCommand`、`commitCompactHandoffAndClearSession`、usage ledger 归因/清理和 history rewrite 不再写任何退役 V1 表；即使旧表被重新创建，回归也确认其内容保持不变，`thread_subagent_*`、旧 metrics 和旧 source 不会被重建；附件引用扫描也不会读取被重建的 `thread_pending_followups`。
- 定向 Node SQLite/store/usage-ledger/production-boundary `45 pass / 0 fail / 94 assertions`；桌面全量 `3800 pass / 3 skip / 0 fail`（3803 tests、18542 assertions、519 files、345.16s）；TypeScript、构建和 `git diff --check` 通过，Biome 无 error（保留 17 条既有 warning）。
- 移动端 V2 定向套件 `45 pass / 0 fail`，`flutter analyze` 无问题。DEV CDP attach/snapshot/probe 全部通过，页面/标题/`window.eco`/composer/DOM 可读，探针 PASS、截图为 `apps/desktop/.smoke-artifacts/cdp-ui-probe.png`；console `0 errors / 1 warning`，告警均为已知 DEV 工具或 Electron CSP warning。
- DEV manifest 独立 verify `passed`：`v2_only`、`integrity=ok`、`cutoverReady=true`、32 conversations、74 native facts、`factsHash=ecdb13f4`，inventory 的 feed skeleton、附件旧载荷/路径/内联字节、native unmatched 均为 0；SQLite 直接复核确认退役 V1 表均不存在、过渡 skeleton 0 行。
- 验收结论：本批闭合 V2-only 缺失数据静默成功和退役表回写风险，但生产全面放行仍需完成生产双次重导/manifest、跨设备附件复制与授权、真实物理故障/弱网/尾部恢复、生产大 run 与真机长会话、历史归属/工具字段缺口及旧 projection/bridge/迁移兼容观察期。

### 2026-09-20 第六十七批：V2-only 回绑事务边界、旧兼容标记隔离与过渡 projection 清理

- 审查发现 `rebindClaudeUserMessageRecords` 在写事务内读取 V2 read model 会产生嵌套 SQLite 事务；已将权威记录解析移到事务外，回绑补丁和 legacy-compatible 镜像决策仍在同一写事务中提交。
- `v2_only` 下即使 provider receipt 带有旧 `legacyCompat` 标记，也不会重新触碰已经退役的 V1 表；仅 `legacy_compat` 保留镜像路径。回归在物理删除 V1 表后注入旧标记，确认 bind/rebind 不抛错、V2 head 正常推进且 V1 表不会复活。
- V2-only 切换和重开均在同一写事务清除 `conversation_feed_skeletons_v2` 过渡 projection；回归注入 stale skeleton 后重开清零，DEV 重启后的结构化 inventory 也为 `feedSkeletons=0`。
- 定向验收：Node SQLite `29/29`；store runtime `29/29`（136 assertions）；production boundary `9/9`（53 assertions）；migration CLI `17/17`（126 assertions）。补丁后的桌面全量 `3799 pass / 3 skip / 0 fail`（3802 tests、18542 assertions、519 files、376.38s）；`tsc --noEmit`、`git diff --check` 和构建通过，构建为 Vite 5078 modules、main 28.17 MB、preload 60.28 KB，仅有既有 externalization/chunk-size warning；Biome 仅报告既有 warning，未发现 error。
- DEV 重启后的 CDP attach/snapshot/probe 通过：页面、标题、`window.eco=true`、`Eco Dev · 在线`、composer 和 DOM 均可读，console `0 errors / 1 warning`，探针 PASS；attach 的 `Target.createTarget: Not supported` 是 Electron 工具层 warning。只读 manifest 独立 verify `passed`，`factsHash=ecdb13f4`、32 conversations、74 native facts、`cutoverReady=true`，`attachmentLegacyPayloads=0`、`attachmentPathRefs=0`、`attachmentInlineBytes=0`；直接 SQLite 复核 `storageMode=v2_only`、`integrity_check=ok`、退役 V1 表 0 张、过渡 skeleton 0 行、canonical message 附件旧 `path/data` 载荷 0、待处理 follow-up 0。
- 本批仍不宣称生产全面放行；生产双次重导/manifest、附件跨设备授权、物理故障与弱网尾部恢复、真机和大 run 性能、历史归属/工具字段缺口、旧 projection/bridge/迁移兼容观察期仍是硬门槛。

### 2026-09-20 第六十六批：V2-only canonical 附件旧载荷备份重建与 DEV 门禁闭合

- 新增受备份保护的 `--all --apply --repair-legacy-attachments --backup ... --attachments-root ...`：只允许 `v2_only`、无活跃 thread 和显式附件根目录；先生成 SQLite 备份，再在一个事务中物化 canonical event/message 的旧 path/裸 inline data、重算 event hash、重建 V2 read models。重建失败、完整性错误或仍有旧载荷时回滚；native facts 原文/hash 不改。
- 真实 DEV 修复结果：`v2_only`、`integrity=ok`，1 个会话、2 个事件、3 个附件完成重建；`attachmentLegacyPayloads 6→0`、`pathRefs 2→0`、`inlineBytes 47544→0`。备份 `/tmp/eco-v2-attachment-repair-dev-20260920.sqlite` 独立 `PRAGMA integrity_check=ok`。
- 修复后 manifest 独立 verify `passed`，32 conversations、74 native facts、`factsHash=ecdb13f4`、`cutoverReady=true`；SQLite 32 streams、22948 events/effects、1754 messages、72 runs、1832 tools、27 snapshots、74 native facts、2814 ledger rows，旧 V1 表为空，canonical attachment 逐行扫描无 `path/data`。
- 验证：迁移 CLI `17 pass / 0 fail / 126 assertions`；Node SQLite `29 pass / 0 fail`；对象库/运行时 `46 pass / 0 fail / 179 assertions`；桌面全量（排除 `e2e/**`，低并发）`3799 pass / 3 skip / 0 fail`（3802 tests、18542 assertions、519 files、351.94s）。
- DEV 重启后 CDP attach/snapshot/probe 通过：`Eco Coding`、`window.eco=true`、`Eco Dev · 在线`、composer 可见、console `0 errors / 1 warning`，探针 PASS；`Target.createTarget` 仅为 Electron 工具层 warning。
- 验收结论：DEV 的历史 canonical 附件旧载荷阻塞已通过可审计备份重建闭合，后续维护写入也已 fail-closed；生产全面 V2-only 仍不能仅凭 DEV 放行，必须完成生产双次重导/manifest、跨设备附件授权与复制、物理故障/弱网/尾部恢复、真机长会话和旧兼容观察期等门槛。

### 2026-09-19 第六十五批：维护重建附件清洗与 V2-only 就绪门禁

- `reconcileNativeFactsAfterRebuild` 已改为 fail-closed：modified native message 的图片附件必须重新物化为 `mediaType/contentRef/byteLength`，非图片附件降为已验证的 `legacyOpaque` 元数据，canonical V2 event/message 不再写入旧 `path/data`。缺少附件根目录、非法 bytes、越界路径、缺失文件或 hash 不一致直接阻断；native fact 台账继续保留原始 payload 作为不可变审计证据。
- inventory 新增 `attachmentLegacyPayloads`，只要 canonical V2 message/event 仍含路径或无合法 `sha256:` durable reference 的 inline data，就不能报告 `cutoverReady`。迁移 CLI `16 pass / 0 fail / 117 assertions`；store/runtime/production-boundary `48 pass / 0 fail / 226 assertions`；Node SQLite `29 pass / 0 fail`；TypeScript、Biome、`git diff --check` 通过。
- 桌面全量（排除 `e2e/**`，低并发）`3798 pass / 3 skip / 0 fail`（3801 tests、18533 assertions、519 files、380.81s）。构建通过（Vite 5078 modules、main 28.17 MB、preload 60.28 KB，仅既有 externalization/chunk-size warning）；CDP attach/snapshot/probe 通过，`Eco Coding`、`window.eco=true`、composer 可见、console `0 errors / 1 warning`，探针 PASS。
- DEV 只读证据：`v2_only`、`PRAGMA integrity_check=ok`、32 streams、22948 events/effects、1754 messages、72 runs、1832 tools、27 snapshots、74 native facts、2814 ledger rows，退役 V1 表为空；manifest 独立 verify `passed`，`factsHash=ecdb13f4`。当前 `cutoverReady=false`，会话 `thr_1789540220642` 报告 `attachmentLegacyPayloads=6`、`attachmentPathRefs=2`、`attachmentInlineBytes=47544`，底层直接审计为 1 个 path 和 2 个 inline data（因同时存在 message/event 行而计数为 6），缺失文件/解析错误为 0。
- 验收结论：代码已阻止后续维护重建继续写入旧附件载荷，但现有 append-only canonical 历史不能直接覆盖，必须在独立维护窗口完成 manifest 驱动的显式重建/重导并复核 `attachmentLegacyPayloads=0`。因此当前 DEV 证据不构成生产全面 V2-only 放行；生产双次重导/manifest、附件跨设备对象复制与授权、故障矩阵、弱网/尾部恢复、真机性能、历史归属与工具字段缺口及旧兼容观察期仍未闭合。

### 2026-09-19 第六十四批：生产新库默认 V2-only 与旧库显式迁移边界

- 主进程现在以 `freshStorageMode=v2_only` 打开空数据库：首开即持久化 V2-only 模式，不再先创建 V1 对话源表。已有 V1 源表的数据库不会被这个偏好自动切换，仍返回 `legacy_compat`，等待显式维护 cutover。
- Node SQLite 回归覆盖两条边界：空生产库没有退役 V1 表且元数据为 `v2_only`；已有 legacy source 时拒绝自动切换。定向 Node SQLite `29 pass / 0 fail`，生产边界/runtime writer/store runtime `47 pass / 0 fail / 225 assertions`，TypeScript 通过。
- 改动后的桌面全量（排除 `e2e/**`，低并发运行）为 `3798 pass / 3 skip / 0 fail`（3801 tests、18524 assertions、519 files、409.07s）；3 个 skip 仍是 live 外部依赖测试。
- 验收结论：新安装的生产入口已不再把 V1 当默认运行时；历史旧库仍必须执行维护迁移，不能用启动默认值掩盖迁移缺口。

### 2026-09-19 第六十三批：历史附件迁移物化与最终低并发全量复验

- 历史图片迁移现在是 fail-closed 的 durable 物化：dry-run 校验受管附件根目录/旧 inline bytes/已有 `sha256:` reference，apply 写入 content-addressed 对象后只把 `mediaType`、`contentRef`、`byteLength` 写入 V2 消息；本地路径和原始 bytes 不进入 V2 JSON。相对路径、`../`、符号链接越界、缺失、篡改、非法 base64 或引用 hash 不一致都会阻断迁移。
- 对旧的非图片附件形状保留显式边界：在附件根目录下验证后降为 `legacyOpaque=true` 元数据，V2 消息删除 `path/data`，不把它交给图片调度器；native fact/manifest 仍保留原始审计事实和文件内容 hash，manifest hash 同样拒绝根目录逃逸。新增测试覆盖图片物化、无 durable store 阻断、opaque 元数据清洗、路径/symlink/base64 门禁和 manifest 替换文件检测。
- 最终桌面全量（排除 `e2e/**`，低并发运行）`3795 pass / 3 skip / 0 fail`（3798 tests、18523 assertions、519 files、383.10s）；真实语料、迁移 CLI/legacy migration/prompt-image 定向通过。默认高并发期间出现的 5 个真实语料 timeout 已用低并发完整复验消除；`composer-agent-models` 测试补齐独立 i18n 初始化。TypeScript、构建与 `git diff --check` 通过，Biome 退出 0 但仍报告既有 warning。
- DEV 最新重启只读证据：`v2_only`、`PRAGMA integrity_check=ok`、32 streams、22948 events/effects、1754 messages、72 runs、1832 tools、27 snapshots、74 native facts、2814 ledger rows，`conversation_followups_v2` 待处理 0 行，退役 V1 表为空。manifest 在带真实 `prompt-images` 根目录下独立 verify 通过：32 conversations、74 native facts、`factsHash=ecdb13f4`、`cutoverReady=true`；100 条缺失 tool input、1160 条缺失 output 和 34 条无 parent 证据归属继续保持未猜测。
- CDP attach/snapshot/probe 均通过：页面 `http://127.0.0.1:5173/`、标题 `Eco Coding`、`window.eco=true`、composer 可见，console `0 errors / 1 warning`，截图为 `apps/desktop/.smoke-artifacts/cdp-ui-probe.png`、`apps/desktop/.smoke-artifacts/cdp-ui-final.png`。历史会话点击在 Playwright 5 秒稳定性等待中超时，属于工具层限制，未观察到页面 console error；不把它算作点击通过。
- 验收结论：实现层已关闭历史图片迁移路径/inline 泄漏、旧附件形状误阻断和维护清单的根目录逃逸，并完成最终低并发全量复验；生产全面 V2-only 仍受生产双次重导/manifest、云端/跨设备对象复制与授权、真实物理故障与响应丢失、Supabase 弱网/重连/尾部恢复、生产大 run/真机性能、历史归属和工具字段缺口、旧 projection/bridge/迁移兼容观察期清理等门槛阻断。

### 2026-09-19 第六十二批：V2 durable 附件对象引用扫描与宽限期 GC

- `PromptImageFileStore` 现在按所有 V2 JSON-bearing 表扫描 `sha256:` 引用，并合并 composer draft/legacy follow-up 引用；只回收超过默认 24 小时宽限期且无 durable 引用的 content-addressed 对象。GC 支持 dry-run，路径和预览不会被推导成引用；V2-only 启动才执行，legacy-compatible 不执行，保守保留 append-only 历史中仍被引用的对象。
- 证据：prompt-image 定向 `13 pass / 0 fail / 36 assertions`；Node SQLite `27 pass / 0 fail`；桌面全量（排除 `e2e/**`）`3789 pass / 3 skip / 0 fail`（3792 tests、18505 assertions、519 files、699.02s）；共享 `32 pass / 2 skip / 0 fail`、232 assertions；移动 `655 pass / 0 fail`，`flutter analyze` 无问题；桌面 TypeScript、Biome error-level、构建和 `git diff --check` 通过。构建 Vite 5078 modules、main 28.16 MB、preload 60.28 KB，仅有既有构建 warning。
- 新主进程重启后的 DEV 只读审计：`v2_only`、`PRAGMA integrity_check=ok`、31 streams、22925 events/effects、1752 messages、70 runs、1832 tools、26 snapshots、74 native facts、2812 ledger rows；`conversation_followups_v2` 待处理 0 行，目标退役 V1 表（含 `thread_pending_followups`）无残留。原生 manifest 生成后独立 verify `passed`，31 conversations、74 native facts、`factsHash=55c68f4d`、`cutoverReady=true`；34 条歧义 Agent 归属和工具字段缺口保持未猜测。
- CDP attach 建立 session（工具层保留已知 `Target.createTarget` warning），snapshot/probe 均通过：`http://127.0.0.1:5173/`、`Eco Coding`、`window.eco=true`、composer 可见、console `0 errors / 1 warning`，截图 `apps/desktop/.smoke-artifacts/cdp-ui-probe.png`。
- 验收结论：本批关闭本地 content-addressed 对象孤儿回收实现缺口；生产放行仍阻断于双次全量重导/manifest、云端/跨设备对象复制与授权、真实物理故障/响应丢失、Supabase 弱网/重连/尾部恢复、生产大 run 与真机性能、34 条无 parent 证据归属、100 条缺失 tool input、1160 条缺失 output，以及旧 projection/bridge、迁移输入和兼容观察期的清理与验证。

### 2026-09-19 第六十一批：follow-up 队列完成 V2-only 物理切换与附件引用链路收口

- `thread_pending_followups` 已从公共 schema 移除；`legacy_compat` 仍可读旧表作为迁移输入，原子 cutover 逐字段迁移到 `conversation_followups_v2` 后把旧表纳入退役清单。`v2_only` 下入队、更新、排序、claim、streaming push、重试、取消、删除和 rewind 清理均按 V2 表执行，重开不会重建旧表。
- V2 图片消息只固化 `sha256:` durable content reference、`byteLength` 和有界预览；桌面对象库做 SHA-256 校验并提供 64 KiB 分块读取，移动端 ref-only 恢复/重试通过远程 chunk RPC 读原图。缺 durable ref 的路径/预览附件在 destructive edit/retry 入口返回 `missing_durable_attachment`，不回退 V1 或缩略图。
- 证据：follow-up/Node SQLite 定向 `41 pass / 0 fail / 39 assertions`；桌面全量（排除 `e2e/**`）`3787 pass / 3 skip / 0 fail`，`18499 expect()`、`519 files`、`606.83s`；共享 `32 pass / 2 skip / 0 fail`、`232 assertions`；移动 `655 pass / 0 fail`，`flutter analyze` 无问题；桌面 TypeScript、`bun run build` 和 `git diff --check` 通过。构建 Vite 5078 modules、main 28.16 MB、preload 60.28 KB，仅保留既有构建 warning。
- 新主进程重启后 DEV 审计：`v2_only`、`PRAGMA integrity_check=ok`、31 streams、22925 events/effects、1752 messages、70 runs、1832 tools、26 snapshots、74 native facts、2812 ledger rows；旧 V1 表清单为空（含 `thread_pending_followups`），`conversation_followups_v2` 当前 0 个待处理行。带 prompt-images 根目录的 `--all --verify-native-manifest` 通过：31 conversations、74 native facts、`factsHash=55c68f4d`、`cutoverReady=true`；100 条缺失 tool input、1160 条缺失 output、34 条无 parent 证据归属继续保持为空。
- CDP attach/snapshot/probe 通过：页面 `http://127.0.0.1:5173/`、标题 `Eco Coding`、`window.eco=true`、composer 可见、console `0 errors / 1 warning`，截图 `apps/desktop/.smoke-artifacts/cdp-ui-probe.png`。
- 验收结论：本批实现层已关闭 follow-up 旧表与图片路径泄漏，但生产放行仍阻断于双次全量重导/manifest、云端/跨设备附件复制与授权、对象 GC、真实物理故障/响应丢失、Supabase 弱网/重连/尾部恢复、生产大 run 与真机性能、34 条历史归属、工具字段缺口及旧兼容观察期。

### 2026-09-19 第六十批：V2-only 重试门禁移除旧 projection 读取

- Codex/ACP 非 rewind 重试在 `v2_only` 下不再从旧 `thread_user_messages` 或旧 Feed projection 判断历史内容：当前 history revision 直接读取 V2 head，用户 prompt 通过 V2 `historyTarget.activityLineId` 定位，已发生的模型消息、工具和文件变更通过 V2 read model 查询。V2 用户消息在运行时写入时补充稳定 `message.history_targeted` 事件；重复或缺失 target 都 fail-closed，不按文本或顺序猜测。
- 重试门禁按下一个 V2 用户消息划分 turn；系统错误通知不算模型进度，目标 turn 之后的工具不会污染上一轮判断，任意 assistant/agent 输出、工具或 file-change detail 都会阻断重试。V2 尚未提供原图 durable content reference 时，带图重试明确拒绝，不把缩略预览当原图重发。
- 本批定向组合（V2 store、迁移 CLI、run correction、production boundary、Node SQLite）此前为 `97 pass / 0 fail / 343 assertions`；加入历史编辑 revision、preview-only attachment 和切换缓存门禁后，store/runtime/production-boundary 子集为 `84 pass / 0 fail / 372 assertions`。`conversation-store-runtime` 与图片存储回归为 `38 pass / 0 fail / 157 assertions`；桌面 `tsc --noEmit`、Biome formatter、`git diff --check` 通过。随后桌面全量（排除 `e2e/**`）为 `3784 pass / 3 skip / 0 fail`（3787 tests、18489 assertions、519 files、664.24s），共享包为 `32 pass / 2 skip / 0 fail`（232 assertions），移动端 `flutter test` 为 `655 pass / 0 fail`、`flutter analyze` 为 `No issues found`，`bun run build` 通过（Vite 5078 modules、main 28.14 MB、preload 60.1 KB）。
- `eco-dev-cdp` 按 attach → snapshot → probe 复验通过：页面 `http://127.0.0.1:5173/`、标题 `Eco Coding`、`window.eco=true`、侧边栏 action 1、composer 可见，console `0 errors / 1 warning`，截图为 `apps/desktop/.smoke-artifacts/cdp-ui-probe.png`。
- DEV 维护只读复验目录为 `/tmp/eco-v2-final-XaOFGd`：preflight/verify 均为 `phase=v2_only`、`storageMode=v2_only`、`integrity=ok`、`cutoverReady=true`、31 conversations、74 native facts、0 blockers，manifest verify `passed`、facts hash `55c68f4d`；SQLite 为 31 streams、22925 events/effects、1752 messages、26 snapshots、1832 tools、2812 ledger rows，退役 V1 表查询为空。已知 100 条缺失 tool input、1160 条缺失 output、34 条无 parent 证据归属仍保持未猜测。
- 历史编辑/rewind 返回的 history revision 也已切到 V2 head；V2 只有预览、没有受管原图路径时返回 `missing_durable_attachment` 并 fail-closed，不会把缩略图当作原图发送。该门禁覆盖 Codex/Claude 的 destructive rewrite 入口。
- 本批只收口 V2-only 重试与历史改写的旧读面/附件引用泄漏，不构成生产全面 V2-only 放行。生产双次全量重导/manifest、真实物理故障/响应丢失、Supabase 弱网与跨端重连、附件 durable reference/跨设备权限、真机性能、大 run 负载和旧兼容观察期仍需按前序批次的门槛执行；没有 provider durable identity 的 Claude rewind 继续 fail-closed。

### 2026-09-19 第五十九批：V2-only 过渡 skeleton 读写封口与 post-cutover 运行流审计

- `ConversationStore` 的过渡 `conversation_feed_skeletons_v2` 维护入口（读/写/推进 sequence/删除）现在在 `v2_only` 立即返回；V2-only 在线 Feed 只从事件、effects 和 V2 projection 读取，skeleton 仅保留给 legacy 迁移/回放。Node SQLite 新增切换后调用这些入口的回归，确认不会重新写入 skeleton 行。
- 维护 CLI 修正了一个真实审计缺口：切换后新建的 V2 运行流没有 V1 源和 native-facts 迁移台账，但只要同时具备持久化 `desktop:user` receipt、`runtime-input` source envelope 和 `desktop:run` lifecycle，就作为 post-cutover runtime 数据记录显式 warning，不计为 native unmatched；任意不具备这三个证据的缺失台账仍保持 `native_fact_ledger_missing`、`cutoverReady=false` fail-closed。新增迁移回归覆盖两条路径。
- 本轮定向组合（V2 store、迁移 CLI、run correction、production boundary、Node SQLite）为 `94 pass / 0 fail / 331 assertions`；迁移 CLI 单文件为 `15 pass / 0 fail / 105 assertions`。桌面全量（排除 `e2e/**`）为 `3779 pass / 3 skip / 0 fail`（3782 tests、18467 assertions、519 files、566.14s）。`bunx tsc -b --pretty false`、桌面 `tsc --noEmit`、新增脚本/测试 Biome（0 errors，保留 17 条既有 warning）和 `git diff --check` 通过。
- `bun run build` 通过：Vite 5078 modules、main 28.14 MB、preload 60.1 KB；仅有既有 `node:path` externalization、动态 chunk/大 chunk warning。当前 DEV 只读维护证据目录为 `/tmp/eco-v2-final-pLlEfd`：preflight 为 `phase=v2_only`、`storageMode=v2_only`、`integrity=ok`、`cutoverReady=true`、31 conversations、74 native manifest events、0 native unmatched、0 missing/parse-error attachments、2 个已重新读取的路径附件；独立 manifest verify 为 `passed`，`nativeEventCount=74`、`conversationCount=31`、`factsHash=55c68f4d`。SQLite `PRAGMA integrity_check=ok`，当前 31 streams、22925 events/effects、1752 messages、74 native facts、26 snapshots、1832 V2 tool rows、2812 V2 ledger rows，目标退役 V1 表查询为空。
- 这批关闭的是过渡读模型误写和 post-cutover 新流误报，仍不构成生产全面 V2-only 放行：生产双次全量重导/manifest、真实 `ENOSPC`/掉电/响应丢失、Supabase 弱网/重连/尾部恢复、附件 durable reference/跨设备权限、生产大 run 与 Android/iOS 真机长会话、34 条无 parent 证据 Agent 归属、100 条缺失 tool input、1160 条缺失 output、不可验证工具字段及旧迁移/兼容观察期仍未闭合。

### 2026-09-19 第五十八批：`run.corrected` 审计事件、CAS 修复命令与迁移重放

- V2 协议新增 `run.corrected`。桌面 `ConversationV2Store.correctRun()` 只通过 append-only 事件修正 run，payload 固定保留 `authority=admin`、`actorPrincipalId`、`reason`、`expectedPreviousStatus` 和目标状态/时间；期望旧状态是 compare-and-swap，重复命令复用原始 `occurredAt` 并返回 duplicate，过期状态、缺少管理员审计字段或 V2 事件前置条件不满足时 fail-closed。read model rebuild 仍从事件重放，不能直接改表。
- 新增 `conversation:v2-correct-run` 维护 CLI：必须显式提供数据库、会话、run、操作者、原因、期望旧状态和目标状态，并且只允许在 `v2_only` 下执行。SQLite 文件回归覆盖首次修正、重复幂等、过期 CAS 拒绝和 legacy-compatible 阻断。迁移器对 `run.corrected` native fact 保存原始 event/hash，在全量重导后按原事件重放；新增 cutover 回归确认管理员、原因、失败终态、native ledger 和 event hash 全部保留。
- 验证结果：V2 store/renderer/迁移/CLI 定向合计 `79 pass / 0 fail / 336 assertions`；共享包 `32 pass / 2 skip / 0 fail`、232 assertions；移动端 `flutter test` `655 pass / 0 fail`、`flutter analyze` `No issues found`；桌面全量（排除 `e2e/**`）`3778 pass / 3 skip / 0 fail`，3781 tests、18465 assertions、519 files、593.17s。`bunx tsc -b --pretty false`、桌面 `bunx tsc --noEmit -p apps/desktop/tsconfig.json`、新增脚本/测试 Biome、`git diff --check` 均通过。
- `bun run build` 通过：Vite 5078 modules、main 28.14 MB、preload 60.1 KB；仅保留既有 `node:path` externalization/chunk-size warning。continuation 静态扫描（排除 docs、tests、e2e）对 `thread:continue`、`continueThread`、`threadContinue` 仍无命中；第二层旧 projection/compat/迁移符号扫描仍命中生产兼容桥、迁移输入和 DEV smoke，观察期清理尚未完成。
- 重启 DEV 只读审计为 `v2_only`、31 streams、22925 events/effects、1752 messages、74 native facts、26 snapshots、V2 tool rows 1832、V2 ledger rows 2812；目标退役 V1 表清单为空，`PRAGMA integrity_check=ok`。100 条缺失工具 input、1160 条缺失 output 和 34 条无 parent 证据 Agent 归属继续保持未猜测状态。按 `eco-dev-cdp` 完成 `cdp:attach`、`cdp:snap`、`smoke:cdp-probe`：页面 `http://127.0.0.1:5173/`、标题 `Eco Coding`、`window.eco=true`、composer 可见、`Eco Dev · 在线`、console `0 errors / 1 warning`，截图为 `apps/desktop/.smoke-artifacts/cdp-ui-probe.png`。
- 本批关闭了计划中“没有显式管理员修正事件/命令”的实现缺口，但不构成正式全面 V2-only 放行。生产维护窗口双次全量重导/manifest、真实 `ENOSPC`/掉电/响应丢失、Supabase 弱网/重连/尾部恢复、附件 durable reference/跨设备权限、生产大 run 真实负载与 Android/iOS 真机长会话、34 条无证据 Agent 归属、不可验证工具字段及旧迁移/兼容观察期仍未闭合。

### 2026-09-19 第五十七批：工具摘要总数驱动的孤儿 run 追页闭环

- 复审发现一个极端预算边界：bootstrap 可以裁掉某个孤儿 run 的全部工具行，却仍返回该 run 的 `toolSummaryCounts`。renderer 现在校验并保留这份总数，工具追页集合取 `toolSummaryCounts ∪ runs ∪ bootstrap/page 工具行的 runId`；older history/tool page 以单调最大值合并总数，`totalCount < tools.length`、未来 `readSeq` 和 history revision 不一致继续 fail-closed。移动 `loadTools` 仍在页写入 SQLite 后立即刷新公开 session state。
- 当前桌面 renderer 定向回归 `18 pass / 0 fail / 42 expect()`；桌面标准全量（排除 `e2e/**`）`3774 pass / 3 skip / 0 fail`，`3777 tests / 18434 expect()`，`518 files`，`389.79s`。桌面 TypeScript、`git diff --check` 和 `bun run build` 通过；构建为 Vite 5078 modules、main 28.13 MB、preload 60.1 KB，仅保留既有 `node:path` externalization/chunk-size warning。
- 移动端全量 `flutter test` `655 pass / 0 fail`，`flutter analyze` 为 `No issues found`；共享包保持 `32 pass / 2 skip / 0 fail`（232 assertions）。V1 continuation 静态扫描（排除 docs 与 boundary test）对 `thread:continue`、`continueThread`、`threadContinue` 无命中。
- DEV 只读审计仍为 `conversation_v2_storage_mode=v2_only`、29 streams、22909 events/effects、1750 messages、74 native facts、V1 退役表为空、`PRAGMA integrity_check=ok`；100 条缺失工具 input、1160 条缺失 output 和 34 条无 parent 证据 Agent 归属继续保持未猜测状态。CDP `attach/snapshot/probe` 当前复验退出 0：页面 `http://127.0.0.1:5173/`、标题 `Eco Coding`、`window.eco=true`、composer 可见、`Eco Dev · 在线`、console `0 errors / 1 warning`，截图仍为 `apps/desktop/.smoke-artifacts/cdp-ui-probe.png`。
- 本批闭合工具摘要总数驱动的孤儿 run 追页边界，不构成正式全面 V2-only 放行。生产维护窗口双次全量重导/manifest、真实 `ENOSPC`/掉电/响应丢失、Supabase 弱网/重连/尾部恢复、附件 durable reference/跨设备权限、生产大 run 真实负载与 Android/iOS 真机长会话、`run.corrected` 管理员事件、34 条无证据 Agent 归属、不可验证工具字段及旧迁移/兼容观察期仍未闭合。

### 2026-09-19 第五十六批：工具分页孤儿 run 覆盖与移动会话状态即时回读

- 桌面 renderer 的工具摘要恢复现在按“已知 V2 run ∪ bootstrap 中工具的 runId”追页；迁移/修复过程中可能只有工具事实、没有 run read model 的孤儿 run 不再被静默漏掉。移动公开的 `SessionController.loadTools` 在 SQLite page 写入后立即 `_reload()`，调用方返回时已经能观察到新工具摘要，不必等待下一次同步；桌面/移动仍共同拒绝未来 `readSeq` 与不一致 `historyRevision`。
- 最终桌面全量（排除 `e2e/**`）`3774 pass / 3 skip / 0 fail`，`3777 tests / 18432 expect()`，`518 files`，`392.32s`。renderer、production-boundary、field-conservation、real-corpus parity 四文件定向组合 `96 pass / 0 fail / 805 assertions`；其中 9 个真实脱敏会话的 V2 守恒与双端 golden 全部通过。
- 移动端全量 `flutter test` `655 pass / 0 fail`，`flutter analyze` 为 `No issues found`；桌面 `bunx tsc --noEmit -p apps/desktop/tsconfig.json`、`bun run build`、`git diff --check` 通过。构建仍为 Vite 5078 modules、main 28.13 MB、preload 60.1 KB，仅有既有 `node:path` externalization/chunk-size warning。
- V1 continuation 静态扫描（排除 docs 与 boundary test）对 `thread:continue`、`continueThread`、`threadContinue` 仍无命中。CDP `attach/snapshot/probe` 退出 0，页面 `http://127.0.0.1:5173/`、标题 `Eco Coding`、`window.eco=true`、composer 可见、`Eco Dev · 在线`，console `0 errors / 1 warning`，截图为 `apps/desktop/.smoke-artifacts/cdp-ui-probe.png`。
- 本批补齐的是大 run 工具事实在孤儿 read model 下的客户端覆盖和移动工具页即时可见性；不构成正式全面 V2-only 放行。生产维护窗口双次全量重导/manifest、真实 `ENOSPC`/掉电/响应丢失、Supabase 弱网/重连/尾部恢复、附件 durable reference/跨设备权限、生产大 run 真实负载与 Android/iOS 真机长会话、`run.corrected` 管理员事件、34 条无证据 Agent 归属、不可验证工具字段及旧迁移/兼容观察期仍未闭合。

### 2026-09-19 第五十五批：V2 工具摘要独立分页与旧 continuation 注册表清零

- 共享 V2 协议新增独立 `tools` cursor、`conversation:tools-page` 和 `toolSummaryCounts`；桌面 store/IPC/remote、renderer 恢复和移动 `DesktopRpc → SyncEngine → Cache → SessionController` 已贯通按 run 分页、opaque cursor、总数、过滤条件与完整响应字节预算。bootstrap/messages page 在预算不足时优先裁剪可独立回补的工具摘要，不丢消息；客户端会追完工具页并跨重启保存。
- 远程 command registry 已删除 `thread:continue`；桌面 E2E approval spec、DEV CDP upgrade smoke 和所有静态生产入口均改用 V2 send helper。排除文档与边界测试后的仓库扫描对 `thread:continue`、`continueThread`、`threadContinue` 无命中，旧 continuation 不再由注册表或 UI helper 提供兜底。
- 新增大运行工具页、完整响应预算、renderer page merge、移动 SQLite 重开、共享 cursor round-trip 和 corpus hydration 回归；桌面 V2 定向 corpus/field-conservation/renderer 为 `91 pass / 0 fail / 770 assertions`，标准全量为 `3774 pass / 3 skip / 0 fail`（3777 tests、18432 assertions、518 files、434.57s）。
- 移动端全量 `flutter test` 为 `655 pass / 0 fail`，`flutter analyze` 为 `No issues found`；工具页模型、SQLite 守恒和未来读序列/history revision 拒绝回归已包含在本轮；共享包为 `32 pass / 2 skip / 0 fail`（34 tests、232 assertions）；桌面 `bunx tsc -b packages/shared --force && bunx tsc --noEmit -p apps/desktop/tsconfig.json`、`bun run build`、`git diff --check` 均通过。构建为 Vite 5078 modules、main 28.13 MB、preload 60.1 KB，仅保留既有 `node:path` externalization/chunk-size warning。
- CDP DEV 复验 `cdp:attach`、`cdp:snap`、`smoke:cdp-probe` 均退出 0：页面 `http://127.0.0.1:5173/`、标题 `Eco Coding`、`window.eco=true`、composer 可见、`Eco Dev · 在线`，console `0 errors / 1 warning`，截图 `apps/desktop/.smoke-artifacts/cdp-ui-probe.png`。DEV 只读审计数据未被本批改写：`v2_only`、29 streams、22909 events/effects、1750 messages、74 native facts、V1 退役表为空、`PRAGMA integrity_check=ok`。
- 本批闭合独立工具摘要分页/响应预算和旧 continuation 注册表的实现缺口，但不构成正式全面 V2-only 放行。生产维护窗口的双次全量重导/manifest、真实 `ENOSPC`/掉电/响应丢失、Supabase 弱网/重连/尾部恢复、附件 durable reference/跨设备权限、生产大 run 真实负载与真机长会话、`run.corrected` 管理员事件、34 条无证据 Agent 归属、不可验证工具字段和旧迁移/兼容观察期仍为阻断项。

### 2026-09-19 第五十四批：桌面/移动端续写入口彻底切换 V2

- 桌面 composer 与 Git conflict 的已结束会话续写统一为 `conversation:send-message` V2 durable command：发送前持久化 runtime config，使用稳定 `clientCommandId`，保留图片附件；消息编辑/rewind 使用 V2 rewrite command 和 expected history revision。V2 bridge 不可用时直接 fail-closed，旧 `thread:continue` 不再作为兜底。
- 桌面 IPC/preload、移动 `DesktopRpc` 和移动 session 均移除 `thread:continue`/`continueThread`/`threadContinue` 入口。移动端续写必须具备 principal 和启用的 V2 controller，更新 runtime config 后进入 V2 pending command、receipt、sync 和失败保留路径。
- 生产边界 + IPC 定向 `7 pass / 0 fail / 167 assertions`；边界同时扫描 renderer/preload/mobile source，禁止旧 continuation，并正向断言桌面 helper 调用 V2 send、移动端调用 V2 controller；退役 projection/usage/activity RPC 和旧 run-event 写入口也受门禁保护。
- 桌面全量 `3771 pass / 3 skip / 0 fail`（3774 tests、18398 assertions、518 files、562.01s）；迁移 CLI 专项 `13 pass / 0 fail / 95 assertions`，备份目标不可写用例连续 100 次通过；移动端全量 `653 pass / 0 fail`，V2 sync/RPC 定向 `49 pass`，`flutter analyze` 无问题，V2 相关 Dart 格式检查无变更；桌面 TypeScript、`bun run build`、`git diff --check` 通过。构建为 Vite 5078 modules、main 28.13 MB、preload 59.84 KB，仅有既有 externalization/chunk-size warning。此前暴露的 macOS SQLite WAL 只读断言竞态已改为 `query_only` 写保护句柄，未放宽迁移失败门禁。
- DEV 审计仍为 `v2_only`、29 streams、22909 events/effects、1750 messages、74 native facts、V1 退役表为空、`PRAGMA integrity_check=ok`。工具摘要 100 条 input、1160 条 output 和 34 条无 parent 证据 Agent 归属继续保持为空。`cdp:attach`、`cdp:snap`、`smoke:cdp-probe` 均退出 0；`window.eco=true`、composer 可见、`Eco Dev · 在线`、console `0 errors / 1 warning`，截图 `apps/desktop/.smoke-artifacts/cdp-ui-probe.png`。
- 本批只收口客户端旧 continuation 入口，不构成正式全面 V2-only 放行。双次全量重导/manifest、真实物理故障与响应丢失、Supabase 弱网/重连/尾部恢复、附件 durable reference/跨设备权限、大 run 分页与大小预算、Android/iOS 真机长会话、`run.corrected` 管理员事件、历史无证据归属、不可验证工具字段和旧迁移/兼容观察期仍为阻断项。

### 2026-09-19 第五十三批：G-5 projection extras 字段守恒自动化

- `ConversationV2ProjectionExtras` 六个字段已进入自动 G-5 inventory；测试通过 TypeScript AST 对比 IPC 接口，避免以后新增 billing/context/request timing 字段时漏掉守恒审查。
- 新增 V2 snapshot 写入、重开和 `ConversationStore` 读取边界回归，覆盖 request span provider/timing/token 字段、billing、context、subagent timings/metrics；字段守恒专项现在是 `18 pass / 0 fail / 580 assertions`。
- 本轮移动端 V2 同步故障回放为 `15 pass / 0 fail`（含 100 个确定性 loss/duplicate/delay/reorder 种子）；桌面全量为 `3770 pass / 3 skip / 0 fail`（3773 tests、18388 assertions、518 files、561.03s），生产边界/字段守恒/run reconcile 三文件为 `34 pass / 0 fail / 641 assertions`。
- `bunx tsc --noEmit -p apps/desktop/tsconfig.json`、新增字段守恒测试 Biome、`git diff --check` 和 `bun run build` 均通过；构建只有既有 `node:path` externalization 与 chunk-size warning。
- 本批只补齐 G-5 的 projection extras 证据，不构成正式全面 V2-only 放行。生产维护窗口双次重导/manifest、真实物理故障和响应丢失矩阵、Supabase 弱网/跨端重连、真机性能、34 条无证据 Agent 归属、不可验证工具字段以及旧迁移/兼容观察期仍为阻断项。

### 2026-09-19 第五十批：历史账本 parent-tool identity 只做可证明归因

- `ConversationV2Store.reconcileUsageLedgerAgentAttribution` 现在同时识别账本 `parent_tool_use_id` 与 V2 agent registry 的 `parent_tool_call_id`；只有 parent tool、run 和 role 都唯一匹配时才写入 `agent_id`，否则继续保留未归属，绝不按顺序或角色猜测。新增两个同角色 Agent 的 parent-tool 回归：usage-ledger 文件 `6 pass / 0 fail / 41 expect()`，V2 store/迁移/runtime 定向 `83 pass / 0 fail / 343 expect()`。
- 最终桌面标准全量 `bun test test --timeout 60000 '--path-ignore-patterns=e2e/**'` 为 `3763 pass / 3 skip / 0 fail`（3766 tests、18371 expect()、518 files、386.85s）；桌面 TypeScript、error-level Biome、`bun run build` 和 `git diff --check` 均通过，构建只保留既有 chunk-size warning。
- DEV 重启启动维护仍扫描 34 条缺失归属；这 34 条现存历史行的 `parent_tool_use_id` 全部为空，因此没有可证明的 parent link，继续保持未归属（pi/proxy × coder/explore 分布为 8/8/9/9）。审计为 `conversation_v2_storage_mode=v2_only`、29 streams、22909 events、22909 sync effects、1750 messages（76 user，其中 70 条有 activity target、17 条有 provider target）；退役 V1 表清单为空，`PRAGMA integrity_check=ok`。工具摘要仍有 100 条缺失 input、1160 条缺失 output，因无可验证源证据保持为空。
- `eco-dev-cdp` 最终复验中 `cdp:attach`、`cdp:snap` 和 `smoke:cdp-probe` 均退出 0；页面 `http://127.0.0.1:5173/`、`Eco Coding`、`window.eco=true`、composer 可见，状态为 `Eco Dev · 在线`，console 为 `0 errors / 1 warning`，截图写入 `apps/desktop/.smoke-artifacts/cdp-ui-probe.png`。
- 本批只闭合“存在 parent-tool 证据时如何安全补偿归因”的实现与回归，不构成正式全面 V2-only 放行。生产维护窗口与双次全量重导、真实 `ENOSPC`/掉电/响应丢失矩阵、Supabase 弱网与跨端重连、真机长会话性能、34 条无证据历史归属、不可验证工具字段和旧迁移/兼容代码观察期仍是剩余门槛。

### 2026-09-19 第五十一批：V2-only native-facts 审计不再误报维护 patch

本批维护窗口操作已固化为 [`conversation-v2-maintenance-runbook.md`](./conversation-v2-maintenance-runbook.md)：fail-closed 门禁、manifest/附件/command 守恒、备份与原子切换、切换后独立复核、SQLite/CDP 冒烟、回滚和证据归档均有可执行步骤；runbook 不把 DEV 结果当作生产放行。

- 已按 runbook 只读路径在当前 DEV 库重跑 preflight、独立 verify、切换后 audit 和 SQLite 查询：`v2_only`、`cutoverReady=true`、29 conversations、74 native facts、facts hash `70540380`、`integrity=ok`、29 streams/22909 events/22909 effects/1750 messages，证据目录 `/tmp/eco-v2-runbook-check-9LXanN`；未执行 `--apply --cutover`，DEV 数据库未改写。

- `conversation-v2-migrate.ts --all` 在 `v2_only` 模式下改用不可变 `conversation_native_facts_v2` 台账中的既有 disposition，不再把 V1 已退役后的维护 patch 拿去和空源表重分类。合法的 `message.finalized` maintenance patch 不再产生 `unsupported_native_type`；V2-only 库若没有对应 native-facts 台账，仍保持未匹配并 fail-closed；路径附件没有 `--attachments-root` 时 `cutoverReady=false`。
- 新增切换后审计回归：modified native fact 在 V2-only 重开后保持 `1 modified / 0 unmatched`，native manifest event count 为 1；native-facts 台账缺失时 `cutoverReady=false`。迁移 CLI `13 pass / 0 fail / 95 assertions`；V2 store/迁移/runtime/production-boundary 定向组合 `87 pass / 0 fail / 391 assertions`。
- 桌面全量 `bun test test --timeout 60000 '--path-ignore-patterns=e2e/**'`：`3764 pass / 3 skip / 0 fail`（3767 tests、18375 assertions、518 files、402.69s）；迁移脚本与回归文件 error-level Biome、桌面 TypeScript 通过。
- `bun run build` 通过，仅保留既有 chunk-size、`node:path` externalization warning；`packages/shared` `31 pass / 2 skip / 0 fail`、231 assertions 且 `tsc` 通过；移动端 `flutter analyze` 为 `No issues found`，`flutter test` 为 `653 pass`。
- DEV 带真实附件根目录的只读维护审计：`v2_only`、29 conversations、integrity=`ok`、74 native facts（62 equivalent、9 collapsed、3 modified、0 unmatched）；独立 manifest verify 通过，facts hash `70540380`。现有 V2 为 29 streams、22909 events/effects、1750 messages，退役 V1 表为空；100 条缺失工具 input、1160 条缺失 output 与 34 条无 parent 证据 Agent 归属均继续保持为空。
- `eco-dev-cdp` attach/snapshot/probe 均退出 0；页面在线、`window.eco=true`、composer 可见，console `0 errors / 1 warning`，截图 `apps/desktop/.smoke-artifacts/cdp-ui-probe.png`。
- 本批只修正 V2-only 审计的证据来源，不构成正式全面 V2-only 放行；生产维护窗口、真实故障/网络/真机性能、历史无证据归属、不可验证工具字段和旧兼容代码观察期仍未闭合。

### 2026-09-19 第五十二批：兼容期运行账本修复与 Feed 增量 parity 收口

- 验收新增“严格读取、显式修复”的兼容期边界：无 V2 stream 的 `legacy_compat` 线程只读旧 run/agent ledger；`v2_only` 缺 V2 stream 立即阻断。V2 stream 中缺少恢复元数据的 lifecycle row 仍由严格读取拒绝，只有启动维护通过可验证 legacy row 修复，且修复过程幂等。真实 legacy_compat 副本发现并修复 39 条 malformed V2 lifecycle row；原始损坏副本本身不被标记为可放行数据。
- 真实 mixed legacy 副本在显式 reconcile 后完成 29 threads / 58 replays 的 Feed parity：`mismatched=0`、`empty feeds=0`、`skipped orphan-agent threads=0`。没有用 fallback 把缺 stream、坏 metadata 或孤儿线程伪装成成功。
- 对迁移后 provider row 的 durable sequence 晚于 prompt observedAt 的情况，skeleton 选择统一按 durable boundary；兼容 replay 的 seed prefix 会保留 candidate final，直到迟到的 user boundary 到达，Feed skeleton rules version 从 2 升为 3。当前 DEV SQLite backup 的全量回放复验为 29 threads / 58 replays，`mismatched=0`、`empty feeds=0`、`detector hits=0`；patch 回归 `199 pass / 0 fail / 6508 expect()`，run projection `13 pass / 0 fail / 47 expect()`。
- Recovery gate 对没有 V2 stream 且没有任何 legacy thread 记录的未知 conversation id 保持阻断，兼容 fallback 不能用空数组掩盖缺口。修复后桌面全量 `3767 pass / 3 skip / 0 fail`（3770 tests、18384 expect()、518 files、656.68s）；迁移 CLI `13 pass / 0 fail / 95 expect()`，`bun run build`、TypeScript、`git diff --check` 通过，构建仅有既有 warning。
- G-3 本批只记录 DEV 真数据 parity 已闭合和兼容修复可审计，仍不标记正式放行。生产双次全量重导/manifest、command/checkpoint 守恒、真实物理故障矩阵、Supabase 弱网/跨端重连、真机性能、34 条无证据 Agent attribution、不可验证工具字段及旧兼容观察期仍为阻断项。

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

- 共享 `ConversationMessage` 与 `conversation_messages_v2` 持久化受冲突拒绝保护的 `historyTarget`（`activityLineId`，可选 provider `userMessageId`）。桌面 provider event、late provider patch、迁移回填和移动端缓存只接受能匹配 V2 user message 的直接身份；同一会话内 prompt 文本只在唯一候选时回填，歧义或缺失继续留空，不生成猜测的 `sdk:`/legacy ID。新增 `message.history_targeted` 事件与 `message.history_target` effect，支持 provider 身份晚到、重放和跨端同步。
- 移动端 schema 升至 11，Feed 传递 `rewindTarget`；Claude 只有在所有用户消息都具备完整 `activityLineId + userMessageId` 时才显示 destructive retry，并通过稳定 command ID、expected revision 调用持久化 `thread:rewrite-from-message`。ACP/Codex 保持 V2 幂等的非 rewind `thread:retry-from-message`。桌面 V2-only native path 不再为缺失 provider identity 合成标识。
- 验证结果：定向桌面 V2 store/迁移/runtime `83 pass / 0 fail / 343 assertions`，字段守恒 `15 pass / 0 fail / 576 assertions`；桌面全量 `3763 pass / 3 skip / 0 fail`（3766 tests、18368 assertions、518 files、386.69s）；移动端全量 `653 pass / 0 fail`。共享/桌面 TypeScript、error-level Biome、Dart format、`flutter analyze`、`bun run build` 和 `git diff --check` 均通过；构建仅保留既有 chunk-size 等 warning。
- DEV 重启审计：`conversation_v2_storage_mode=v2_only`；29 streams、22909 events、22909 sync effects；V2 messages 共 1750 条（user 76 条，其中 70 条有 activity target、17 条有 provider target）；V1 退役表在 `sqlite_master` 中为空；`PRAGMA integrity_check=ok`。尚有 34 条历史 Agent attribution 歧义和无法从现存源证明的工具摘要字段，均保留为空，不用猜测填充。
- `eco-dev-cdp` 重启复验中，`cdp:attach` 创建了 default session 但 Playwright/Electron 报告 `Target.createTarget: Not supported`；沿该 session 的 `cdp:snap` 与 `smoke:cdp-probe` 均通过。页面 `http://127.0.0.1:5173/`、`Eco Coding`、`window.eco=true`、sidebar action 1、composer 可见，等待重连后显示 `Eco Dev · 在线`，console `0 errors / 1 warning`，截图写入 `apps/desktop/.smoke-artifacts/cdp-ui-probe.png`。该 attach 工具兼容错误不影响已建立 session 的页面读取，但仍是工具层待清理项。
- 本批闭合 V2 message 身份传播与 Claude 安全 retry 的客户端链路，但不构成正式全面 V2-only 放行。生产维护窗口与双次全量重导、真实 `ENOSPC`/掉电/响应丢失矩阵、Supabase 弱网与跨端重连、真机长会话性能、34 条历史归属歧义、不可验证工具字段和旧迁移/兼容代码观察期仍是剩余门槛。

### 2026-09-19 第四十五批：V2-only 停止过渡 Feed skeleton 维护

- `maintainThreadFeedSkeletonFromEvent` 与 `scheduleThreadRunProjectionUpdated` 现在在 `v2_only` 模式立即返回；原生 V2 事件不再重建或写入过渡 `conversation_feed_skeletons_v2`/旧 projection cache。skeleton 只保留给 `legacy_compat`、迁移和显式回放路径，V2 renderer projection 成为唯一在线 Feed 读模型。
- 新增生产边界回归，覆盖两个主进程入口及 usage ledger 边界，定向结果为 `8 pass / 0 fail / 49 assertions`；桌面 TypeScript `bunx tsc --noEmit -p apps/desktop/tsconfig.json` 退出 0，`git diff --check` 与新增测试 Biome 检查通过。主进程全文件仍有历史 warning，未把 warning 伪报成 clean。
- DEV 重启后继续为 `conversation_v2_storage_mode=v2_only`，退役表为空、`PRAGMA integrity_check=ok`；V2 计数为 29 streams、22909 events/effects、26 snapshots、74 native facts、2812 ledger rows，accounting/token-cost blocking failures 为 0，历史 Agent attribution warning 保留为 6 会话/69 事件。按 `eco-dev-cdp` attach/snapshot 后，真实会话 Feed、billing `$0.2400`、Context 33% 可读，console 为 0 errors / 1 开发环境 CSP warning；V2 强断言通过。
- 本批关闭第二个过渡 Feed 读模型在 V2-only 运行时继续被维护的缺口，不等同于正式全面 V2-only 放行。生产维护窗口与双次全量重导、真实物理 `ENOSPC`/掉电/响应丢失矩阵、Supabase 弱网与跨端重连、真机长会话性能、历史 Agent 归属补偿策略和旧迁移/兼容代码观察期仍是剩余门槛。

### 2026-09-19 第四十四批：V2-only 账务读面拒绝重建的 V1 ledger 表

本批收紧 `ConversationStore.listUsageLedgerEvents(threadId)`：V2 stream 存在且 storage mode 为 `v2_only` 时，即使外部或旧版本重新创建 `thread_usage_ledger_events`，在线读面也只返回 `conversation_usage_ledger_events_v2`。旧表只允许由启动维护事务一次性导入并退役，不能重新成为账务权威。回归先人为重建旧表并验证当前进程不混入旧行，再关闭重开验证启动维护会导入并物理退役残留表。

验证结果：usage-ledger/V2 projection/production boundary 定向组合 `18 pass / 0 fail / 85 assertions`（usage-ledger `5 pass / 0 fail / 35 assertions`）；Node SQLite `31 pass / 0 fail`；桌面标准全量 `3756 pass / 3 skip / 0 fail`，3759 tests、18344 assertions、401.70s；TypeScript、Biome、构建和 `git diff --check` 均通过。移动端 `flutter analyze` 为 `No issues found`，`flutter test` 为 `649 pass / 0 fail`。第一次并发全量曾出现一次 SQLite `SQLITE_CANTOPEN`，迁移 CLI 专项复跑 `12 pass / 0 fail / 91 assertions`，随后第二次标准全量通过；生产边界与 usage-ledger 单独复跑为 `7 pass / 0 fail / 45 assertions`，未通过修改测试来掩盖该竞态。

DEV 重启审计仍为 `conversation_v2_storage_mode=v2_only`，退役旧表清单为空、`PRAGMA integrity_check=ok`；V2 计数为 29 streams、22909 events/effects、26 snapshots、74 native facts、2812 ledger rows，accounting/token-cost blocking failures 为 0，历史 Agent attribution warning 保留为 6 会话/69 事件。按 `eco-dev-cdp` 完成 attach/snapshot，console 为 0 errors / 1 Electron CSP warning；真实会话 Feed、billing `$0.2400`、Context 33% 可读，V2 强断言通过。

本批关闭的是“残留或重建 V1 ledger 表被在线读面重新采用”的缺口，仍不构成正式全面 V2-only 放行。生产维护窗口与双次全量重导、真实物理 `ENOSPC`/掉电/响应丢失矩阵、Supabase 弱网与跨端重连、真机长会话性能、历史 Agent 归属补偿策略，以及旧迁移/兼容代码观察期仍是剩余门槛。

### 2026-09-19 第四十三批：V2-only 物理 schema 不再重建 run-attempt/feed 旧表

本批从 `ConversationStore.initialize()` 的公共 schema 移除 `thread_run_attempts`，并将其加入旧表退役清单；该表只在 `legacy_compat` 中建立，供显式迁移/reconcile 读取。V2-only 切换删除历史残留，重开不再重建。`thread_feed_skeleton` 迁移建表函数增加 storage-mode 守卫，V2-only 启动也不再短暂创建旧表。

Node SQLite 的 V2-only cutover/reopen 回归覆盖 `thread_run_attempts`，run projection 专项为 `11 pass / 0 fail / 40 assertions`；桌面全量 `3756 pass / 3 skip / 0 fail`（3759 tests、18343 assertions、397.74s），Node SQLite `31 pass / 0 fail`，TypeScript、Biome、构建和 `git diff --check` 均通过。DEV 重启后 `storage_mode=v2_only`、旧表查询为空（含 `thread_run_attempts`）、`PRAGMA integrity_check=ok`；V2 计数为 29 streams、22909 events/effects、26 snapshots、74 native facts、2812 ledger rows，账务/成本阻断差异为 0，历史 Agent attribution warning 为 6 会话/69 事件。`eco-dev-cdp` 的 attach/snapshot 均为 0 errors / 1 CSP warning，真实会话点击加载后 Feed、billing `$0.2400`、Context 33% 正常显示，V2 强断言通过。

本批关闭的是 V2-only 启动 schema 重建缺口，仍不构成正式全面 V2-only 放行；真实 `ENOSPC`/掉电与响应丢失矩阵、Supabase 弱网/跨端重连、真机性能、历史 Agent 归属补偿策略、旧迁移兼容代码观察期和生产维护窗口仍未完成。

### 2026-09-19 第四十二批：启动全库 run reconcile 收口并做成原子回归

把计划中已经定义、但源码缺失的 `ConversationStore.reconcileConversationV2Runs(threadId)` 补回，并新增 `reconcileAllConversationV2Runs()`：桌面启动会扫描仍处于 `legacy_compat` 的已迁移 V2 stream，V2 bootstrap 前也会再次按会话校验。每次 reconcile 先完整校验 `thread_run_attempts` 的 phase/status/retry/metadata，再在一个 SQLite `BEGIN IMMEDIATE` 中追加缺失、时间/元数据不一致或错误终态的生命周期权威事件；提交失败整批回滚。V2-only、缺失 V2 stream 或已退役 attempt 表均直接返回，不会凭空创建会话或把 V1 变成运行时事实源。重复启动和重复 bootstrap 均为幂等，生命周期 `timingQuality` 也纳入一致性判断。

新增 run projection 回归为 `10 pass / 0 fail / 35 assertions`，覆盖缺失 run、错误终态纠正、全库启动汇总、第二次零修复、未迁移会话不建 stream，以及损坏 metadata 在任何写入前失败；改动后桌面标准全量为 `3755 pass / 3 skip / 0 fail`（3758 tests、18338 assertions、400.87s），Node SQLite 三组共 `31 pass / 0 fail`，构建、TypeScript、Biome 和 `git diff --check` 通过。重启 DEV 后 `cdp:attach` 与 `cdp:snap` 均为 0 errors / 1 Electron CSP warning，V2 强断言和数据库审计继续通过。该批关闭了“未打开会话要等 bootstrap 才补 run”的代码缺口，但仍不等同于正式全面 V2-only 放行；真实 `ENOSPC`/掉电、更多损坏源与响应丢失、真实 Supabase 弱网与跨端重连、真机长会话性能、历史 Agent 归属补偿策略、旧迁移/兼容代码观察期和生产维护窗口仍需完成。

### 2026-09-19 第四十一批：把 V2-only 生产边界固化为回归门禁

新增 `conversation-v2-production-boundary.test.ts`：扫描生产主进程，禁止任何旧 `appendThreadRunEvent` 调用点；扫描桌面 preload/renderer 与移动端源码，禁止重新暴露已退役的 projection、usage、subagent、todo、activity 查询和旧 usage/activity RPC。专项门禁 `2 pass / 0 fail / 10 assertions`，纳入桌面标准全量后为 `3754 pass / 3 skip / 0 fail`（3757 tests、18329 assertions、397.78s）；本批 Biome、桌面 TypeScript、`bun run build`、`git diff --check` 均通过。该测试只约束客户端和运行时边界，不误删迁移器、兼容输入适配器或历史对拍代码。

这批关闭的是旧 API/旧写入口的回归保护缺口，不等同于正式全面 V2-only 放行。最新 `cdp:snap`、V2 强断言和数据库审计通过；`cdp:attach` 进程退出码为 0，但 Playwright CLI 额外报告 Electron `Target.createTarget: Not supported`，不影响已建立的 default session 或页面快照，属于测试工具兼容性待清理项。真实物理 `ENOSPC`/掉电、更多损坏源与响应丢失、真实 Supabase 弱网与跨端重连、真机长会话性能、历史 Agent 归属补偿策略、旧迁移/兼容代码观察期和生产维护窗口仍需完成。

### 2026-09-19 第四十批：全生产事务回滚审查与运行时/迁移器 `SQLITE_FULL` 回归

本批把上一批在 `ConversationV2Store` 发现的 SQLite 自动回滚问题扩展到全部生产写入边界：`ConversationV2RuntimeWriter`、`ConversationV2LegacyMigrator`、`ConversationStore` 的 27 个事务 catch，以及 `ProviderStore` 的事务 catch 都改为保护性回滚，SQLite 已自动结束事务时保留原始存储错误；迁移失败 checkpoint 自身写不进去时也不再覆盖原始错误。生产源码扫描未发现未保护的 `catch → ROLLBACK` 模式。新增 runtime append 与 legacy migration 两个真实文件库 `PRAGMA max_page_count` 故障注入，均证明 V2 cursor、event/effect 不前进。

改动后门禁：事务故障/存储定向组合 `86 pass / 0 fail / 841 assertions`；V2 账单/存储/投影/迁移/字段守恒组合 `121 pass / 0 fail / 1006 assertions`；Node SQLite 三套 gate `31 pass / 0 fail`；桌面标准 `60s` 全量 `3752 pass / 3 skip / 0 fail`，3755 tests、18319 assertions、401.77s，扩展 `120s` 全量同样 `3752 pass / 3 skip / 0 fail`、397.02s；`bunx tsc --noEmit -p apps/desktop/tsconfig.json`、`bun run build`、Biome、`git diff --check` 均通过。移动端 `flutter analyze` 为 `No issues found`，`flutter test` 为 `649 pass / 0 fail`。

DEV/CDP 复验：`cdp:snap` 和强断言通过，console `0 errors / 1 warning`；`cdp:attach` 退出码为 0，但 Playwright CLI 额外报告 Electron `Target.createTarget: Not supported`，不影响 default session 快照。旧 projection/usage/subagent/todo/activity API 静态审计为 clean，capabilities 为 protocol 2 / event schema 1 / effect 1，bootstrap 为 30 messages、8 runs、29 tools、7 todos，projection 为 139 request spans、147 ledger events。数据库审计仍为 `v2_only`、29 streams、22909 events/effects、26 snapshots、74 native facts、2812 ledger rows，退役表清单为空、`PRAGMA integrity_check=ok`，usage_state 为 0，accounting/token cost blocking failures 为 0；历史 Agent attribution warning 保留为 6 个会话/69 条。

本批关闭的是生产事务回滚掩错和 `SQLITE_FULL` 注入覆盖缺口，不等同于正式全面 V2-only 放行。真实物理 `ENOSPC`/掉电、更多损坏源与响应丢失、真实 Supabase 弱网与跨端重连、真机长会话性能、历史 Agent 归属补偿策略，以及旧迁移/兼容代码观察期仍需完成。

### 2026-09-19 第三十九批：SQLite_FULL 故障注入与事务 fail-closed

新增临时 SQLite `PRAGMA max_page_count` 故障注入，真实触发 `SQLITE_FULL`。修复 V2 写事务在 SQLite 已自动回滚时再次 `ROLLBACK` 覆盖原始错误的问题；现在保留原始存储错误，且事件、effect、head 都保持提交前状态。覆盖 append、usage ledger、stream 初始化、read-model rebuild 等 V2 事务的回滚保护，并新增字段守恒回归。

改动后门禁：V2 账单/存储/投影/迁移/字段守恒定向组合 `120 pass / 0 fail / 1001 assertions`；Node SQLite 三套 gate `31 pass / 0 fail`；桌面标准 `60s` 全量为 `3750 pass / 3 skip / 0 fail`，3753 tests、18309 assertions、401.29s，扩展 `120s` 阈值同样为 `3750 pass / 3 skip / 0 fail`、401.10s；`bunx tsc --noEmit -p apps/desktop/tsconfig.json`、`bun run build`、Biome、`git diff --check` 均通过。移动端 `flutter analyze` 无问题，`flutter test` 为 `649 pass / 0 fail`。

改动后的 DEV/CDP attach、snapshot 和强断言均通过：console `0 errors / 1 warning`；旧 projection/usage/subagent/todo/activity API 不在 `window.eco`，capabilities 为 protocol 2 / event schema 1 / effect 1，bootstrap 为 30 messages、8 runs、29 tools、7 todos，projection 为 139 request spans、147 ledger events 且含 billing/context。数据库审计为 `v2_only`、29 streams、22909 events/effects、26 snapshots、74 native facts、2812 ledger rows，退役表清单为空、`PRAGMA integrity_check=ok`，token/cost blocking failures 为 0；历史 Agent attribution warning 仍为 6 个会话/69 条。

本批关闭了 SQLite `SQLITE_FULL` 的自动故障注入和事务回滚缺口；这不等同于真实物理盘耗尽。真实 `ENOSPC`/掉电、更多损坏源与响应丢失故障矩阵，真实 Supabase 弱网与跨端重连，真机长会话性能，历史 Agent 归属补偿策略，以及旧迁移/兼容代码观察期仍需完成。

### 2026-09-19 第三十八批：工具标签确定性归一化与改动后全量复验

`conversation-v2-store` 现在把同一 `toolCallId` 的 `MCP: tool` / `MCP tool` / `tool` 占位名升级为后续具体标签（例如 `Bash`）；两个具体标签仍保留首个并记录完整性诊断，避免把标签差异误判为实体身份冲突。renderer reducer 同步接受这一种“占位名→具体名”单调升级，仍拒绝两个具体名之间的变更。新增回归覆盖升级、终态反向回放和真实语料字段守恒；`MCP: tool`/`Bash` 不再触发生产冲突诊断。

改动后门禁：V2 账单/存储/投影/迁移/字段守恒定向组合 `119 pass / 0 fail / 996 assertions`；Node SQLite 三套 gate `31 pass / 0 fail`；桌面标准 `60s` 全量为 `3749 pass / 3 skip / 0 fail`，3752 tests、18304 assertions、402.71s，扩展 `120s` 阈值同样为 `3749 pass / 3 skip / 0 fail`、397.80s；`bunx tsc --noEmit -p apps/desktop/tsconfig.json`、`bun run build`、Biome、`git diff --check` 均通过。移动端 `flutter analyze` 无问题，`flutter test` 为 `649 pass / 0 fail`。

改动后的 DEV/CDP attach、snapshot 和强断言均通过：console `0 errors / 1 warning`；旧 projection/usage/subagent/todo/activity API 不在 `window.eco`，capabilities 为 protocol 2 / event schema 1 / effect 1，bootstrap 为 30 messages、8 runs、29 tools、7 todos，projection 为 139 request spans、147 ledger events 且含 billing/context。数据库审计为 `v2_only`、29 streams、22909 events/effects、26 snapshots、74 native facts、2812 ledger rows，退役表清单为空、`PRAGMA integrity_check=ok`，token/cost blocking failures 为 0；历史 Agent attribution warning 仍为 6 个会话/69 条。全量日志仅保留测试中两个同等具体名称（`lookup`/`different`）的冲突诊断，真实占位标签路径已归一化。

本批关闭了已知的 `MCP: tool`/`Bash` 标签欠账，但不宣称正式全面 V2-only 已放行。真实磁盘不足/`ENOSPC`、更广泛损坏源与响应丢失故障矩阵，真实 Supabase 弱网与跨端重连，真机长会话性能，历史 Agent 归属补偿策略，以及旧迁移/兼容代码观察期仍需完成。

### 2026-09-19 第三十七批：附件内容守恒、最终全量回归与 V2-only 复核

维护 manifest 的附件摘要新增 `pathContentHashes`：带 `--attachments-root` 时对每个路径附件读取文件并记录 SHA-256；文件被替换、缺失、解析失败或未提供可验证根目录时，manifest verify/cutover 直接阻断，不再把“路径存在”当成“内容守恒”。新增 CLI 回归覆盖导出后替换附件、带 root 校验失败和无 root 校验失败；维护 CLI 当前为 `12 pass / 0 fail / 91 assertions`，并新增备份目标不可写、损坏 V1 attempt metadata 的 fail-closed 回归。V2-only 台账验收不再信任持久化的历史 hash：verify 必须带 `--attachments-root` 重新读取当前文件，切换完成后替换附件仍会报 `facts mismatch`。cutover 统一使用带 busy timeout 的维护数据库句柄并在必要时重开，消除短暂 `SQLITE_BUSY` 竞态。

最终门禁：V2 账单/存储/投影/迁移/字段守恒定向组合 `119 pass / 0 fail / 994 assertions`；Node SQLite 三套 gate `31 pass / 0 fail`；桌面全量在标准 `60s` 阈值下 `bun test test --timeout 60000` 与扩展 `120s` 阈值均为 `3749 pass / 3 skip / 0 fail`，3752 tests、18302 assertions（标准 385.44s，扩展 382.22s）；`bunx tsc --noEmit -p apps/desktop/tsconfig.json`、`bun run build`、Biome、`git diff --check` 均退出 0。移动端 `flutter analyze` 为 `No issues found`，`flutter test` 为 `649 pass / 0 fail`。

DEV/CDP 复核仍为 0 console errors / 1 开发环境 CSP warning；旧 projection/usage/subagent/todo/activity API 不在 `window.eco`，capabilities 为 protocol 2 / event schema 1 / effect 1，bootstrap 为 30 messages、8 runs、29 tools、7 todos，projection 为 139 request spans、147 ledger events 且含 billing/context。数据库为 `v2_only`、29 streams、22909 events/effects、26 snapshots、74 native facts、2812 ledger rows，旧表清单为空、`PRAGMA integrity_check=ok`，token/cost blocking failures 为 0；历史 Agent attribution warning 仍为 6 个会话/69 条。

本批关闭附件文件内容 hash、备份目标不可写和损坏 V1 attempt metadata 这几项 DEV 回归，但不宣称正式全面 V2-only 已放行。真实磁盘不足/`ENOSPC`、更广泛损坏源与响应丢失故障矩阵，真实 Supabase 弱网与跨端重连，真机长会话性能，历史 Agent 归属补偿策略，以及迁移/兼容代码观察期仍需完成。

### 2026-09-19 第三十六批：命令状态守恒、静态门禁清零与全量复验

维护 CLI 的 native manifest 现在同时保存并校验 V2 `commandReceipts`、`commandJobs`、`commandCheckpoints` 及历史 revision。重导前验证 accepted event、request/payload/hash 和 checkpoint 顺序；进程死在 native-facts 台账与清理提交之后时，下一次 cutover 从不可变台账恢复 event、receipt、job、checkpoint，并在事务内重新校验 command state。新增中断窗口演练覆盖 send receipt、running history retry 和 `execution.claimed` checkpoint；恢复后重复发送仍返回同一 receipt，不重复接受。

验证结果：维护 CLI `9 pass / 0 fail`、72 assertions；V2 账单/存储/投影/迁移/字段守恒定向组合 `116 pass / 0 fail`、969 assertions（迁移 CLI 与字段守恒并发连续 8 轮 `23/23`）；桌面全量 `bun test test --timeout 120000` 为 `3746 pass / 3 skip / 0 fail`，3749 tests、18283 assertions、402.18s；`bunx tsc --noEmit -p apps/desktop/tsconfig.json`、`bun run build`、Biome、`git diff --check` 均退出 0。

移动端已清理本轮 analyzer 诊断，`flutter analyze` 退出 0，`flutter test` 为 `649 pass / 0 fail`；CI 的 TypeScript 与 Flutter analyze 均为阻断式步骤。DEV/CDP 强断言脚本退出 0：旧 projection/usage/subagent/todo/activity API 均不在 `window.eco`，capabilities 为 protocol 2 / event schema 1 / effect 1，bootstrap 为 30 messages、8 runs、29 tools、7 todos，projection 为 139 request spans、147 ledger events 且含 billing/context；console 为 0 errors / 1 CSP warning。数据库仍为 `v2_only`、29 streams、22909 events/effects、26 snapshots、74 native facts、2812 ledger rows，旧表为空且 `PRAGMA integrity_check=ok`。

本批关闭 command manifest/恢复和静态门禁缺口，但不把 DEV 证据当作正式放行。附件文件内容 hash、磁盘不足/损坏源/响应丢失故障矩阵、真实 Supabase 弱网与跨端重连、真机长会话性能、历史 Agent 归属补偿策略和旧兼容代码观察期仍未完成。

### 2026-09-19 第三十五批：V2-only 维护验收 CLI 修复与全量复验

本批修复了 V1 表物理退役后维护验收命令仍依赖旧表的问题。`--all --verify-native-manifest` 在 `storageMode=v2_only` 时现在直接读取 `conversation_native_facts_v2` 不可变台账，切换后仍可核对切换前 manifest；真实 DEV 原始 manifest 复核通过，覆盖 29 个会话、74 条 native facts，`factsHash=6d2cc230`、`integrity=ok`。同时处理 macOS/Bun 连续 WAL 短进程读取的 `SQLITE_CANTOPEN` 竞态：维护读取重开 SQLite handle，持续异常时启用 `PRAGMA query_only=ON` 写保护连接，验收路径不会写库。

验证结果：维护 CLI 当时为 `9 pass / 0 fail`、66 assertions；账单/存储/投影/迁移/字段守恒定向组合 `116 pass / 0 fail`、969 assertions；桌面全量当时为 `3746 pass / 3 skip / 0 fail`，3749 tests、18277 assertions、399.62s；`bun run build`、新增脚本/测试 Biome、`git diff --check` 通过。第三十六批已重新覆盖 command-state、TypeScript 和 Flutter 静态门禁，见上方最新快照。

DEV 重启审计仍为 `v2_only`、29 streams、22909 events、22909 effects、26 snapshots、74 native facts、2812 V2 ledger rows；退役 V1 表清单为空，`PRAGMA integrity_check=ok`，全库 token/cost blocking failures 为 0，历史 Agent attribution warning 仍为 6 个会话/69 条。按 `eco-dev-cdp` 执行 attach/snapshot 和真实会话检查：旧 usage/projection/subagent/todo/activity API 不在 `window.eco`，projection 只含 V2 `billing/context/ledgerEvents/requestSpans/subagentTimings`，console 为 0 errors/1 CSP warning；最新截图：[v2-only-final-20260919.png](../../apps/desktop/.smoke-artifacts/v2-only-final-20260919.png)。

本批补齐的是 V2-only 维护验收能力与证据闭环，不能替代正式放行条件。第三十六批已推进 command receipt/job/checkpoint 与阻断式 TypeScript/Flutter 静态门禁；附件内容守恒与磁盘/损坏/响应丢失故障矩阵、真实 Supabase 弱网与跨端重连、真机性能、历史 Agent 归属补偿策略和旧迁移兼容代码观察期仍未完成。

### 2026-09-19 第三十四批：V2 账单权威化、影子账本对账和 accumulator 退场

本批把生产计费链最后一处“可能从旧聚合选择账单”的边界收紧：单次 usage 和 SDK run billing effects 追加 V2 ledger 后，直接调用 `resolveV2BillingSnapshot()`；V2 ledger 投影缺失会显式 fail-closed，不再从 `ThreadUsageAccumulator` 或旧 aggregate 补账。V2-only 启动恢复和 metrics 持久化只恢复/写入 context，`usageState` 不再出现在 `conversation:projection` extras；启动/切换事务会先严格校验历史 V2 snapshot 中的旧 accumulator，再删除它，损坏值回滚并阻断。

账单投影新增唯一的 billable-event selector：同一调用的 Proxy 行优先，SDK shadow 行跳过，同源重复行按稳定 ledger key 去重。投影和 `reconcileUsageLedgerWithBilling()` 现在共用该选择器，避免把 raw shadow rows 与去重后的 V2 snapshot 比较而产生假阳性。仅由历史 Agent 归属缺口造成的对账结果记录为 `usage_ledger.attribution_gap`，不伪造归属；真实 DEV 仍保留 6 个会话、69 条历史 warning（31 条 `pending_agent_settlement_timeout`、38 条 `agent_id_missing`）。

验证结果：账单/投影/迁移定向 `39 pass / 0 fail`、164 assertions；桌面全量 `bun test test --timeout 120000` 为 `3744 pass / 3 skip / 0 fail`，3747 tests、18269 assertions、397.89s；`bun run build`（renderer/main/preload）通过，只有既有 chunk/CSP 类 warning；`git diff --check` 通过。

真实 DEV 重启后为 `v2_only`，29 streams、22909 events、22909 effects、26 snapshots、74 native facts、2812 V2 ledger rows；退役 V1 表清单为空，`PRAGMA integrity_check=ok`，projection snapshot 中 `usageState` 为 0。全库账单审计的 token/cost blocking failures 为 0；未归属 warning 保留为显式数据质量问题。按 `eco-dev-cdp` 执行 `cdp:attach` / `cdp:snap`，console 为 0 errors / 1 Electron CSP warning；真实会话 capabilities 为 protocol 2 / event schema 1 / effect 1，bootstrap 为 30 messages、8 runs、29 tools、7 todos，projection 为 139 request spans、147 ledger events 且含 billing/context；旧 usage/projection/subagent/todo/activity API 全部缺失，V2 projection 不暴露 `usageState`。截图：[v2-only-billing-scrub-final.png](../../apps/desktop/.smoke-artifacts/v2-only-billing-scrub-final.png)。

本批关闭了 billing token/cost 对账差异这一项 DEV 阻断，但不等于正式全面 V2-only 放行。command receipt/job/checkpoint 与附件内容守恒/故障矩阵、真实 Supabase 弱网与跨端重连、真机性能、阻断式 TypeScript/Flutter 静态门禁、历史 Agent 归属补偿策略和旧迁移兼容代码观察期仍未完成。

### 2026-09-19 第三十一批：删除无消费者的旧活动线 RPC 并完成最终复验

`thread:activity-list` 已从桌面 preload、IPC 常量、主进程 handler、共享 remote-command registry 和移动端 `DesktopRpc` 删除；仓库源码不再有该 channel 或调用。它原先只读取 SDK 旧活动线，没有页面消费者；继续保留 SDK transcript 的内部读取仅用于 runtime resume，不作为对话事实源。主进程与 preload 构建通过。

删除后的回归：桌面全量 `bun test test --timeout 120000` 为 `3740 pass / 3 skip / 0 fail`，3743 tests、18251 `expect()`、399.03s；IPC/V2 renderer 定向 `22 pass / 0 fail`、共享 remote registry `3 pass / 0 fail`、移动端 DesktopRpc `35 pass / 0 fail`；`git diff --check` 和相关文件 trailing whitespace 检查通过。此前的 V2-only 表清理与历史重写 guard 仍由迁移/运行时/store 相关 `96 pass / 0 fail` 覆盖。

最终 DEV/CDP 复核保持上一批的 V2 结果：数据库为 `v2_only`、29 streams、22909 events/effects、26 snapshots、74 native facts、`integrity_check=ok`，八张退役旧表均不存在；运行中 `window.eco` 仍不含旧 projection/usage/subagent/todo/`listThreadActivity` API，V2 capabilities/bootstrap/projection 与真实 Feed 可读，snapshot console 为 `0 errors / 1 CSP warning`。最终截图为 `apps/desktop/.smoke-artifacts/v2-only-thread-after-rpc-cleanup.png`。

### 2026-09-19 第三十二批：usage ledger V2 读面、重开修复与全量复验

本批关闭一条仍暴露给生产页面的 V1 读路径：删除 `thread:usage-ledger-events-list` 的 preload/主进程/demo handler，`conversation:projection` extras 新增 `ledgerEvents`，桌面 `UsageBreakdownPanel`、ThreadInfo 浮层和 usage summary 只消费同一份 V2 projection 返回值。逐笔账单明细仍保留，但不再通过换名或兼容 fallback 继续读取旧 RPC。

存储边界新增 `conversation_usage_ledger_events_v2`。存在 V2 conversation stream 时，ledger append/list/attribution update/clear 及历史重写删除均使用 V2 表；`thread_usage_ledger_events` 仅在 `legacy_compat` 初始化时用于迁移。V2-only 启动会在 `BEGIN IMMEDIATE` 中幂等迁移残留旧 ledger 行并调用退役清理，再提交；这样即使旧版本只写入了 `v2_only` 标记而未删除旧表，下一次重开也会完成迁移后物理退役。新增磁盘回归覆盖预切换旧行、projection extras、关闭重开和人为重建残留旧表的启动修复。

验证结果：usage ledger 定向 `2 pass / 0 fail`、`19 expect()`；桌面全量 `bun test test --timeout 120000` 为 `3741 pass / 3 skip / 0 fail`，共 3744 tests、18257 `expect()`、395.51s；移动端 `flutter test` 为 `649 pass / 0 fail`；主进程/preload/renderer 构建通过，`git diff --check` 通过。`flutter analyze` 退出码仍为 1（49 条既有 lint/info/warning，0 error），本批生产 Dart 文件无新增诊断；`bunx tsc -b` 仍退出 2（81 条既有 `error TS`，本批目标文件无命中）。

DEV 实库重启后：`conversation_v2_storage_mode=v2_only`，29 streams、22909 events、22909 effects、26 projection snapshots、74 native facts、2812 条 `conversation_usage_ledger_events_v2`（覆盖 26 个会话），`PRAGMA integrity_check=ok`；`thread_activity`、`thread_coder_todos`、`thread_run_events`、`thread_user_messages`、`thread_feed_skeleton`、`thread_agent_instances`、`thread_subagent_sessions`、`thread_subagent_metrics`、`thread_usage_ledger_events` 均不存在。按 `eco-dev-cdp` 执行 `bun run cdp:attach` / `bun run cdp:snap`，快照为 0 errors / 1 CSP warning；真实会话 V2 bootstrap 为 30 messages、8 runs、29 tools、7 todos，projection 为 139 request spans、147 ledger events、billing/context，旧 usage/projection/subagent/todo/activity API 均缺失；当前视口截图为 `apps/desktop/.smoke-artifacts/v2-only-usage-ledger-v2.png`。

本批仍不把 ledger 物理迁移当作账务验收通过：当前 billing token/cost 对账差异尚未解释，command receipt/job/checkpoint、附件守恒与故障注入矩阵、真实 Supabase 弱网/跨端重连、真机性能、阻断式 TypeScript/Flutter 静态门禁和旧迁移兼容代码观察期仍是全面 V2-only 的正式放行条件。

### 2026-09-19 第三十三批：metrics snapshot 迁移输入化、损坏阻断与真实重开

本批关闭另一条旧 metrics 物理读面。`thread_metrics_snapshots` 不再由公共 schema 创建，只在 `legacy_compat` 下作为一次性迁移输入建立。切换到 V2-only 和 V2-only 重开都在同一 `BEGIN IMMEDIATE` 事务里严格解析旧 accumulator/context；只有缺失的字段才写入 `conversation_projection_snapshots_v2.usageState/context`，已存在的 V2 字段保持权威，然后删除旧表。旧 JSON 解析失败、值不是对象或 row 没有 V2 stream 时返回 `integrity_failure`，事务回滚并保留原输入，不把损坏数据降级为空快照。`listThreadMetrics()` 改为 V2 projection 读面，历史 rewind/discard/rewrite 的旧表清理改为表存在时才执行。

新增回归覆盖：预切换旧 metrics 行迁移并可从 V2 `get/listThreadMetrics` 读取；重建残留旧表后重开会删除它且不覆盖既有 V2 值；损坏 JSON 会 fail-closed、storage mode 不切换。metrics/usage ledger 定向 `4 pass / 0 fail`、`30 expect()`；桌面全量 `bun test test --timeout 120000` 为 `3743 pass / 3 skip / 0 fail`，共 3746 tests、18270 `expect()`、398.47s。主进程、preload、renderer 构建通过，`git diff --check` 通过；`bunx tsc -b` 仍退出 2，仓库既有诊断中没有本批目标文件命中。

真实 DEV 重启复核：`conversation_v2_storage_mode=v2_only`，29 streams、22909 events、22909 effects、26 projection snapshots、74 native facts、2812 条 V2 ledger；`thread_metrics_snapshots`、`thread_usage_ledger_events` 和其他退役 V1 表均不存在，`PRAGMA integrity_check=ok`。按 `eco-dev-cdp` 执行 `bun run cdp:attach` / `bun run cdp:snap`，console 为 0 errors / 1 CSP warning；V2 bootstrap 为 30 messages、8 runs、29 tools、7 todos，projection 为 139 request spans、147 ledger events 且含 billing/context；旧 projection/usage/subagent/todo/activity API 不在 `window.eco`，截图为 `apps/desktop/.smoke-artifacts/v2-only-metrics-v2.png`。

这批只证明 metrics 的旧存储读面已经迁移并物理退役，不能覆盖账单对账差异。billing token/cost、command receipt/job/checkpoint 与附件守恒/故障矩阵、真实 Supabase 弱网与跨端重连、真机性能、阻断式 TypeScript/Flutter 静态门禁和旧迁移兼容代码观察期仍未完成，因此全面 V2-only 仍未放行。

### 2026-09-18 第三十批：V2-only 物理表收口、历史重写回归与 DEV 重启复验

本批把最后一组会在 V2-only 重开时残留的 subagent 兼容表收紧：`ConversationStore.initialize()` 的公共建表段不再创建 `thread_subagent_sessions` / `thread_subagent_metrics`，这两张表只在 `legacy_compat` 的一次性迁移初始化中建立；`ConversationV2Store.retireLegacyStorageTablesInCurrentTransaction()` 在切换时同时清理它们。V2-only 的历史编辑、删除、rewind 和 compact 清理路径也不再假设旧表存在，旧兼容清理只有在表存在时执行，V2 事实仍由事件和 projection extras 维护。迁移兼容 SQL 保留在 `legacy_compat`，不构成 V2 运行时兜底。

回归证据：迁移 CLI `8 pass / 0 fail`、`61 expect()`；最终 guard 修改后的迁移/运行时/store/Node SQLite 相关集 `96 pass / 0 fail`、`272 expect()`；桌面全量 `bun test test --timeout 120000` 为 `3740 pass / 3 skip / 0 fail`，共 3743 tests、18251 `expect()`、395.44s，随后对最后的历史清理 guard 又重跑了这 96 条受影响用例；`git diff --check` 通过。全量日志仍记录已知的 `conversation-v2.tool-name-conflict` 诊断，但没有失败。移动端此前修复后的全量为 `649 pass / 0 fail`；本轮 `flutter analyze` 为 49 issues（5 warnings、44 infos，0 error），本次涉及的 V2 生产文件无诊断。仓库 `bunx tsc -b` 仍以非零退出（81 条现有诊断行，主要来自依赖/其他包），本批桌面 V2 store 文件无诊断。

DEV 重启后的数据库复核：`conversation_v2_storage_mode=v2_only`，29 个 V2 stream、22909 个 event、22909 个 sync effect、26 个 projection snapshot、74 个 native fact；`thread_activity`、`thread_coder_todos`、`thread_run_events`、`thread_user_messages`、`thread_feed_skeleton`、`thread_agent_instances`、`thread_subagent_sessions`、`thread_subagent_metrics` 均不存在，`PRAGMA integrity_check=ok`。关闭重开不会重新创建 subagent 表。

无消费者的 `thread:activity-list` 旧 RPC 也已从 preload、IPC 常量和主进程 handler 删除；SDK transcript 读取仍只作为 runtime resume 的内部输入。CDP 9333 冒烟重新执行 `attach` / `snapshot`，打开真实会话 `thr_1789530530422` 并调用运行中的 V2 preload：`window.eco` 中旧的 `getThreadRunProjection`、`getThreadRunProjectionDetail`、`getThreadUsageSnapshot`、`listSubagentSessions`、`listSubagentMetrics`、`listThreadTodos` 均不存在；V2 capabilities 为 protocol `2` / event schema `1` / effect `1`，bootstrap 为 8 runs、29 tools、30 messages、7 todos，projection 为 139 request spans 且含 billing/context。页面继续显示历史 Feed、计费 `$0.2400` 和 `Context 主 Agent 占用 33%`；快照 console 为 `0 errors / 1 开发环境 CSP warning`。最终重启后的视口截图为 `apps/desktop/.smoke-artifacts/v2-only-thread-after-rpc-cleanup.png`。

本批没有把“物理表不再存在”误报成整份计划完成。仍未闭合的生产门槛包括 billing/usage ledger 对账差异、command receipt/job/checkpoint 与附件守恒/故障矩阵、真实 Supabase 弱网与跨端重连、真机长会话性能、TypeScript/Flutter 阻断式静态门禁，以及旧迁移/兼容 RPC 和投影测试代码的最终观察期清理；因此全面 V2-only 仍未放行。

### 2026-09-18 第二十九批：桌面/移动端指标读面与子代理快照切到 V2

桌面 `conversation:projection` 现在同时返回 V2 request spans、billing、context、subagent timings 和 subagent metrics；`saveThreadMetrics`、子代理 session/metrics 的写入、读取、清理以及启动恢复均在存在 V2 stream 时读写 `conversation_projection_snapshots_v2`，不再把旧 metrics/session 表当作事实源。compact handoff、history rewind 和按 phase 清理也会在同一事务清空 V2 快照，避免旧恢复行已删除而 V2 面板仍复活。生产 renderer 已删除 `withLegacyHydration`，主 Feed、指标面板和任务面板只安装 V2 extras；历史真语料对拍的旧字段拼接仅留在测试支持代码中。

移动端 `DesktopRpc`、sync engine 和 session controller 已接入同一 `conversation:projection` extras；启动、恢复、实时指标事件以及 Feed 的 billing/context/subagent timing 均从 V2 session/cache 读取。V2 启用时不会调用旧 projection、usage、subagent RPC；兼容分支仍保留给尚未协商 V2 的旧测试/旧宿主，正式 V2-only 主机不进入这些分支。为避免兼容模式连接监听与 bootstrap 竞态，非 V2 分支恢复投影改回共享并发请求。

本批验证：桌面指标/compact/runtime 定向集 `166 pass / 0 fail`，移动端 V2 sync/session/activity/RPC 定向集 `71 pass / 0 fail`；移动端全量修复后 `655 pass / 0 fail`。桌面全量第一轮在新 V2 清理逻辑上线前暴露 2 个回归，已分别修复并由受影响用例复验：`subagent-session-store` `7 pass / 0 fail`、conversation-store runtime/V2 store `69 pass / 0 fail`；迁移 CLI 单独复验 `8 pass / 0 fail`。最终桌面全量已复跑为 `3742 pass / 3 skip / 0 fail`、`3745 tests / 18263 expect()`、396.76s。`git diff --check` 通过；全量 TypeScript 仍有 86 条仓库既有诊断，未出现本批 V2 文件诊断。

重启后的 DEV/CDP 证据：数据库 `storage_mode=v2_only`、29 个 V2 stream、22,909 个 event/effect、`integrity_check=ok`、六张退役表计数为 0；打开 `thr_1789530530422` 后 bootstrap `protocolVersion=2`、7 条 todo、30 条消息，`conversation:projection` 返回 139 个 request spans、billing/context，`window.eco.listThreadTodos` 为 `undefined`。刷新后仍相同，CDP console 为 `0 errors / 1 Electron CSP warning`。当前 preload 仍暴露旧 projection/usage/subagent 方法名，但 V2 页面不会调用；其删除和旧生产 RPC/迁移输入清理仍是全面 V2-only 的阻断项。

账单对账仍有一个真实阻断：重启前后 active thread `9530530422` 的 `usage_ledger.billing_selection_rejected` 诊断同时报告 `token_mismatch` 与 `cost_mismatch`。V2 proxy projection 记录 input/output/cacheRead=`243302/70507/13734528`、Eco cost=`0.240006168`，旧 ledger 选择为 `17514/10500/2414336`、Eco cost=`0.032340216`，legacy source-reported cost=`1.557238` 而 projection comparison=`9.846449`。该差异尚未解释或修复，不能把 V2 指标接通等同于 billing/accounting 验收通过。

### 2026-09-18 当前验收推进：原生运行时边界已切 V2，全面 V2-only 仍未放行

桌面 SDK/live 事件的生产写入口现统一进入 `ConversationV2RuntimeWriter`：运行事件、累计 delta、provider 输入源身份和幂等 receipt 在同一 SQLite 事务内提交，不再由生产入口调用 `appendThreadRunEvent`。主投影、运行事件最大序号、请求重绑、agent late-bind、Claude transcript rebind、Codex SDK user-message bind 均优先读取 V2 provider source index；用户映射和历史操作对原生 V2 追加 patch，历史修改会隐藏受影响 provider input 并拒绝迟到写入。启动时不再自动压缩旧 V1 stream。

本轮继续收掉用户消息/活动线的运行时 V1 依赖：V2 增加原生用户消息列表，`listUserMessageRecords`、`getUserMessageForEdit`、活动线读取在存在 V2 provider source 时直接从 V2 message/source index 返回；`saveUserMessageRecord` 对原生 source 直接跳过，旧 `thread_user_messages` 只服务无 source 的迁移/兼容数据。Claude SDK 首次回绑会对 V2 source 追加 `rewindTarget` patch，不再要求旧 `thread_activity` 行存在。首条用户消息的 V2 message create/finalize 先于 provider receipt，避免 receipt 先引用不存在的 V2 message。Feed skeleton 缓存也已迁到 `conversation_feed_skeletons_v2`，旧 `thread_feed_skeleton` 只在启动时做一次性导入，生产读写不再访问旧表。

原生 legacy bridge 进一步隔离：只有显式 `appendThreadRunEvent` 兼容桥接的 source 带有 `legacyCompat` 标记，Claude/Codex 原生 V2 回绑不会再更新旧活动线、用户消息或事件行。新增原生 Claude 回绑专项，确认 V2 upstream identity 可恢复且两张旧用户消息表保持 0 行。此前 `5256/5259 pass` 的数字是历史快照；本轮最新桌面全量（排除 E2E）以 `bun test test --timeout 120000` 重跑为 `3740 pass / 3 skip / 0 fail`、`3743 tests / 18256 expect()`，耗时 402.65s；Node SQLite gate `31 pass / 0 fail`。

Codex 场景回放也已移除最后一个源码级 `appendThreadRunEvent` 调用：回放先补齐确定性的 V2 run attempt，再通过 `appendConversationRuntimeEvent` 写入，重放和 Feed skeleton 都从 V2 provider source index 读取；固定场景回归 `7 pass / 0 fail`，预期产物已按 V2 投影刷新。

这条边界的桌面运行时/store/Node SQLite 定向回归为 `74 pass / 0 fail`、`209 expect()`，并额外验证原生 Claude 回绑后旧用户消息表计数保持为零。

迁移器为每条 legacy `thread_run_events` 写入 source receipt，覆盖隐藏/配对事件，并在完成或幂等重跑时强制校验 source coverage；V2 provider source index 可重建。原生运行时、迁移 CLI、字段守恒和固定真语料双端差分均已复验：定向迁移/运行时集 `18 pass / 0 fail`，字段守恒 `14 pass / 0 fail`，真实语料与 cross-end golden `65 pass / 0 fail`，Node SQLite store gate `31 pass / 0 fail`。

### 2026-09-18 当前验收推进：DEV 已完成 V2-only 切换，生产切换仍未放行

新增 `apps/desktop/scripts/conversation-v2-migrate.ts --all` 全库入口：dry-run 只读预检；`--apply` 按会话 checkpoint 迁移；`--cutover --backup <path>` 会先拒绝活跃 thread、执行 `VACUUM INTO` 备份，再全量重导、逐会话完整性校验，最后在一个 SQLite `BEGIN IMMEDIATE` 事务内写入 `v2_only` storage mode 并退役全部 V1 conversation source table（当前共 13 张；早期版本只覆盖六张）。dry-run 现在额外输出逐会话 `existingV2` inventory 和 `cutoverReady`，并把原生 V2 event 对照 V1 源分类为 `nativeEquivalentEvents`、`nativeCollapsedEvents`、`nativeModifiedEvents`、`nativeUnmatchedEvents`；只要发现不属于可恢复迁移过程的 V2 event/effect、消息、工具、详情、todo 或 command receipt/job/checkpoint，cutover 就以会话 ID 和计数 fail-closed，要求先导出、定义守恒/恢复规则，禁止覆盖。切换后启动、删除、活动线读取、历史回滚和旧事件写入均有 V2-only 行为，旧表不存在时不会再触发 SQLite 兜底查询。

dry-run 可附加 `--native-manifest <path>` 生成一次性维护窗口 manifest；该参数只接受 `--all` 只读预检，目标文件已存在时拒绝覆盖。manifest 固定包含 schema version、源库路径、SQLite integrity/storage mode、逐会话 inventory、原生事件完整元数据和原始 `payload_json`、数据库 `event_hash`、payload hash、按 V1 source/attempt 的 `matchedSourceId`、`equivalent/collapsed/modified/unmatched` 结论及原因、事件和会话级附件摘要，并用 `contentHash` 校验文件内容。它在读事务提交后以临时文件 + rename 输出，不能改变源库，也不会把 manifest 当作切换授权。已有 manifest 可用 `--verify-native-manifest <path>` 在同一只读 dry-run 中逐条重算原生事实 hash；数据库路径和生成时间不参与对账，事件原文、元数据、事件/载荷 hash、匹配结论和事件附件摘要必须完全一致，差异直接阻断。

临时磁盘 SQLite 演练已覆盖：备份保留旧源、全量迁移、原子切换、`PRAGMA integrity_check`、重开数据库仍保持 `v2_only`、旧表清单为空、切换后的历史回滚，以及活跃 thread 在备份前被拒绝；当前迁移 CLI 专项 `8 pass / 0 fail`、60 assertions，Node SQLite store 专项 `40 pass / 0 fail`，Node gate 合计 `31 pass / 0 fail`。生产用户库没有执行 `--cutover`，生产执行仍需单独维护窗口和范围确认。

切换前对真实 DEV 库只读执行 `--all --attachments-root ... --native-manifest /tmp/...`，随后用 `--verify-native-manifest` 复核：manifest 与报告的 hash 相等，facts hash 对账通过，`integrity=ok`、`storageMode=legacy_compat`，29 个会话导出 74 条原生事件；事件结论为 62 条 `equivalent`、9 条 `collapsed`、3 条 `modified`、0 条 `unmatched`。这一步只生成临时导出文件，没有写入 DEV SQLite。

2026-09-18 DEV 真库副本演练补齐了全库规模路径：原始 `desktopDev` 一致性副本有 29 个 thread，其中已有 13 个旧镜像 V2 stream；新的 dry-run inventory 返回 29 条会话记录（含 29 个可重建的 V2 feed skeleton），其中 13/13 个已有 stream 被标为 `hasExternalData=true`，`cutoverReady=false`，直接切换按设计 fail-closed 并列出会话及 V2 计数，没有修改源库。该 inventory 同时发现 18,126 条 `legacyCompat` 镜像事件、74 条原生 V2 事件、5 个 V2 附件引用（47,544 个 inline bytes、1 个 path 引用、0 个解析错误）；传入 DEV 的 `--attachments-root` 后 path 引用实际文件缺失数为 0，所以附件守恒也有可核对的基线。原生事件对照 V1 后为 62 条等价重建、9 条 `run.started` 折叠到 attempt 开始事实、3 条修改项（1 条正文空白差异、2 条用户消息附件差异）、0 条未匹配。现已用 `--reconcile-native-manifest` 将原生事实写入 `conversation_native_facts_v2`，按规则恢复 3 条 modified 事实；在 DEV 副本上 29/29 会话完成，V2 事件与 effect 各 22909 条（含 3 条 maintenance patch），`PRAGMA integrity_check=ok`，storage mode=`v2_only`，六张退役表均不存在；账本保留 74 条事实，分类为 62 equivalent、9 collapsed、3 modified。备份仍保留 11,306 条 `thread_run_events`、76 条 `thread_user_messages`。关闭重开、手动模拟“账本及清理已提交但迁移尚未开始”的中断恢复、以及第二遍 `--cutover` 均通过，第二遍返回 `idempotent=true`。这仍是 DEV 副本证据，不是生产库授权；command receipt/job/checkpoint 仍必须在正式窗口前单独导出/恢复，附件路径也必须用生产根目录重新核对。
2026-09-18 随后在停掉 DEV 桌面进程后，对真实 `desktopDev` 库执行了同一套带 `--reconcile-native-manifest` 的 `--all --apply --cutover --backup`。29/29 会话完成，返回 `phase=v2_only`、`storageMode=v2_only`、`integrity=ok`、`nativeFactsPreserved=74`、`nativeFactsReconciled=3`；数据库重开后仍为 `v2_only`，V2 为 29 个 stream、22,909 条 event/effect，68 个 run 的 lifecycle 元数据全部可恢复，6 张退役表不存在，账本 disposition 仍为 62/9/3。第二遍不带 reconcile manifest 的 cutover 返回 `idempotent=true`。`VACUUM INTO` 备份 `/tmp/eco-v2-desktopDev-backup-20260918.sqlite` 的 `PRAGMA integrity_check=ok`，并保留 76 条 `thread_user_messages`、11,306 条 `thread_run_events`。

切换后重启 DEV 并通过 CDP（9333）执行了 attach、列表快照、V2-only 会话打开、原先只有 V1 的“展示图片”会话打开、页面 reload 和 console 检查：会话列表及历史内容可见，连续快照均为 `0 errors`；console 仅有 Electron 开发环境 CSP warning。启动日志不再出现 `conversation-v2.recovery-blocked`，证明切换前缺失 stream 和旧 run lifecycle metadata 的阻断已被重导消除。该证据只覆盖 DEV，不等于生产库授权；command receipt/job/checkpoint 仍必须在正式窗口前单独导出/恢复，附件路径也必须用生产根目录重新核对。

演练还发现并修复一类真实旧日志冲突：`bash_approval.approved` 与随后实际 `tool.failed` 复用同一 `toolCallId`。批准事件现在只保持工具 `running`，拒绝仍为 `failed`，最终工具状态由 provider 终态决定；对应回归已加入 legacy adapter 测试。

启动路径也已按 storage mode 分支：`v2_only` 重开只初始化公共表和 V2 schema，不再先创建再删除六张退役表；Node 回归在关闭重开后再次检查六张表均不存在。

此前 preflight/附件盘点后的 `5257/5259 pass` 结果属于历史快照：标准 60 秒单测阈值曾在并发负载下出现真实语料 timeout；本批已用 `bun test test --timeout 60000` 重跑并通过 `3747 pass / 3 skip / 0 fail`（3750 tests、18294 assertions、382.76s），该历史阻断已关闭。真机长会话、滚动/内存/延迟预算仍需独立实测，不能用桌面单测替代。

这批仍不能宣布正式 storage version 切换：真实磁盘不足/`ENOSPC`、更广泛损坏源与响应丢失故障矩阵、旧运行时代码删除尚未完成；真实 Supabase 故障矩阵、真机长会话性能和历史 Agent 归属补偿策略仍是阻断项。command receipt/job/checkpoint、附件内容 hash、备份目标不可写与损坏 V1 attempt metadata、桌面 TypeScript 与 Flutter 静态门禁已由当前门禁覆盖。工具输出的一次性 V1 元数据迁移继续保留为兼容输入处理，不属于运行时写路径。

下一步按这个顺序推进：先补齐真实磁盘不足/`ENOSPC`、损坏源和响应丢失的自动故障矩阵，再清理仍在生产编译图中的旧投影/骨架/旧 RPC 兼容入口；随后完成真实 Supabase 弱网、跨端重连、真机长会话和性能预算验收，处理历史 Agent 归属补偿策略，最后进入正式维护窗口评审。

## 当前结论：阶段 A 通过，全面 V2-only 未通过

最近一次完整桌面门禁按当前工作目录正确排除 `e2e/**`：标准 `60s` 为 `3755 pass / 3 skip / 0 fail`、`3758 tests / 18338 expect()`、400.87s。事务故障/存储定向组合为 `86 pass / 0 fail`、841 assertions；账单/存储/投影/迁移与字段守恒组合为 `121 pass / 0 fail`、1006 assertions；Node SQLite 三套 gate 为 `31 pass / 0 fail`；移动端全量为 `649 pass / 0 fail`，`flutter analyze` 与桌面 `bunx tsc --noEmit -p apps/desktop/tsconfig.json` 均退出 0。全量日志仅保留测试中两个同等具体名称（`lookup`/`different`）的 `conversation-v2.tool-name-conflict` 诊断，真实 `MCP: tool`/`Bash` 占位标签已由确定性规则归一化。真实 DEV 全库账单审计的 token/cost blocking failures 已为 0，仍有 6 个会话、69 条历史 Agent attribution warning。直接调用 `bun test` 时必须按门禁传入 `--path-ignore-patterns=e2e/**`（从 `apps/desktop` 运行）；Playwright E2E 仍使用独立命令，不把 runner 误用结果计入桌面单测门禁。

### 2026-09-17 第二十六批：todo V2 迁移推进

todo 已完成从旧读写路径向 V2 的迁移：共享协议新增 `todo.updated` 与 `todo.list.replace`，桌面新增 `conversation_todos_v2` reducer/read model，事件序号由 reducer 强制写入 `versionSeq`。`ConversationStore.replaceCoderTodos()` 只在 SQLite 事务内追加 V2 事件，不再更新旧 todo 表；读取改为 V2 事实源，rewind 也不再删除旧 todo 备份。`thread:todo-list` 已移除 activity 抽取正常兜底。新 thread 与 V2 stream 同事务建立，旧存量 thread 不会被凭空创建空 stream。

存量迁移器已把 `thread_coder_todos` 作为一次性 V1 输入，使用稳定 source key 幂等追加 todo 事件。移动端 schema 升至 10，新增 todo model/cache/reducer/session state；任务菜单和任务面板改读 V2 session/cache，不再调用旧 `listThreadTodos`。桌面 todo/store/migration 定向回归 `88 pass / 0 fail`，移动端 V2 cache/sync/cross-end 定向回归 `35 pass / 0 fail`；相关 Flutter 生产文件 analyze 无新增问题。

历史快照：本批仍未完成全面 V2-only；旧 todo RPC 定义仍保留作观察期兼容接口，其他 SDK/live 写入入口仍有旧镜像依赖；当时不得启用正式 storage version 切换或删除 V1 表。审计确认当前没有独立的 conversation branch RPC/UI；Codex `thread/fork` 是 rewrite/retry 的外部副作用，已由 durable history command 管理。后续已继续推进到 DEV 实库切换，剩余生产旧写入口仍需清理。

### 2026-09-18 第二十七批：桌面/移动端 todo 读面 V2-only 收口

桌面渲染器不再通过 `thread:todo-list` 读取 todo；它只消费 V2 bootstrap、`todo.list.replace` effect 和已提交事件状态，并在 V2 state 缺失时保持空态/实时事件态，不回退到旧 RPC。旧 preload IPC、主进程 handler、demo handler、移动端 `DesktopRpc.listThreadTodos()` 和共享 remote command registry 条目均已删除。renderer state 新增 todo map、bootstrap 校验、effect 替换和回归覆盖，证明 todo 状态从 V2 事实源安装并按 effect 更新。

本批定向回归为 `19 pass / 0 fail`（renderer state，含 todo bootstrap/effect）与 IPC 旧命令移除检查通过；随后补加的 V2-only 用户消息读面回归为 `28 pass / 0 fail`。此批只关闭 todo 旧读桥接；`withLegacyHydration()`、requestSpans/billing/context/subagentTimings、其余旧运行时入口、真实 Supabase/真机/性能门禁仍阻断全面 V2-only。

已经具备继续推进写侧切换的基础，但还不能启用 V2-only storage version，也不能删除旧链路。

### 2026-09-18 第二十八批：重启 DEV 后验证 preload 也已 V2-only

上一批的 renderer 热更新不会替换 Electron preload；重启 `bun run dev` 后重新执行 `bun run cdp:attach` / `bun run cdp:snap`，打开含 7 条 todo 的 `thr_1789530530422`，通过页面内 V2 bootstrap 读取验证：`protocolVersion=2`、`todoCount=7`、`conversationId` 正确，`window.eco` 不再包含 `listThreadTodos`。刷新页面后再次验证结果相同；CDP 连续快照和 console 均为 `0 errors`，唯一 warning 是开发环境 Electron CSP 提示。该次验证确认旧 todo bridge 已从运行中的 preload 消失，V2 todo 数据仍可读取。由于该会话的 7 条 todo 都已 completed，产品按现有规则不展示“进行中”进度卡；展示器的 bootstrap/effect 映射由定向回归覆盖。

现场验证：

- 桌面全量严格闸门（最新 120 秒阈值）：`3740 pass / 3 skip / 0 fail`，`3743 tests / 18256 expect()`；标准阈值性能基线仍未单独清零。
- 移动端全量测试：`655 pass / 0 fail`。
- Node 原生 SQLite：`31 pass / 0 fail`。
- 固定真库脱敏语料 9 会话差分与双端 golden 已进入 CI。
- 桌面生产构建通过。
- `bunx tsc --noEmit -p apps/desktop/tsconfig.json` 已退出 0；TypeScript 步骤不再 `continue-on-error`。
- `flutter analyze` 已退出 0；移动端 workflow 已加入阻断式 analyze 步骤。

此前复核提出的 F1/F2/F3/F5/F6 已处理：`occurred_at`、provider 进度/心跳分类、属性缺失不变量、渲染级差分、固定语料、桌面 CI 与空 baseline 均已落地。原“38 红、桌面无 CI”的结论仅是历史背景，不再代表当前状态。

## 已冻结决策

### 全面 V2-only

- V2 是唯一生产事实源，不保留“V2 优先、V1 兜底”。
- 所有 SDK/live 事件直接写 V2；所有用户动作走 V2 command + durable receipt。
- 桌面和移动端只读 V2 DTO、分页、详情和同步 effect。
- 迁移失败、完整性失败或版本不兼容必须显式阻断，不得返回旧骨架或空会话。

### 迁移分叉

采用**维护窗口全量重导**：冻结旧写入并备份，先识别并无损导出现有 V2 独有数据、附件和 command receipt；无法证明守恒则停止。优先在暂存库从 V1 源重导并恢复 V2 独有数据，全部会话校验通过后原子安装、更新 stream epoch 并切换全库 storage version。旧缓存与游标显式失效，旧 command 重试不得重复执行。本次计划修改不授权清理真实用户库，正式执行需单独确认范围。

不采用迁移器接管已有 V2 stream，也不采用长期双写收敛。已有镜像 stream 含旧适配器写入的不可变错误事件，继续追加无法修复历史，混合迁移还会引入 source key 与 reducer 版本分叉。

## 阻断 V2-only 的工作

1. **G-5 字段守恒契约（部分落地）**：9 会话 effect 重放与消息/run/工具/agent 实体全字段比较、移动端 DTO 往返、共享实体属性清单守卫已落地；detail 全字段与 send receipt 已有覆盖。新增 agent.upsert 的共享协议、持久化校验与双端消费者，完整 agent 样本通过桌面增量/重复投递/rebuild 守恒；修复空 mission 丢失。移动端已用真实临时磁盘 SQLite 覆盖 agent 全可选字段、关闭重开、整页失败回滚及 cursor 守恒；桌面 send receipt 已覆盖磁盘关闭重开、rebuild 后重试不重复接受、损坏 receipt 显式失败，以及命令已接受后未关闭数据库即 `SIGKILL` 的跨进程恢复。agent 的 mission/todo/父 agent/父 tool/run/时间/任务与 delegation 已继续守恒到双端 Feed 投影；卡片展示保持 delegation 优先、mission 缺失兜底，避免把 legacy `mission_key` 当正文。message/tool 的逻辑实体、内容/实体版本、agent instance 与父调用身份也进入双端 Feed projection，桌面子代理工具行不再误标 main scope。迁移器现在把 legacy agent instance 作为 source fingerprint 的一部分并追加幂等 agent 事件，9 会话从 seq 0 重放可与 bootstrap 的 agent 注册表全字段一致。detail 在桌面 typed renderer consumer 和移动端最终 `ActivityFeedEntry` 均保留完整 source row；移动端排序/重编号不会再丢版本、父级归属或空字符串。事务提交中断/物理掉电与真实跨端传输仍待覆盖；旧错误 effect 与旧 agent invalidation 历史未被原地修改，必须全量重导。
2. **V2 命令面（部分落地）**：send receipt 与 queued 调度恢复已有覆盖；非发送命令新增独立 `conversation_command_jobs_v2` 与 append-only `conversation_command_checkpoints_v2`，具备请求哈希、expected history revision、accepted/running/completed/failed、结果/错误、accepted seq、时间戳和有序执行事实。同 key 同请求返回原 job，不同请求冲突；执行领取再次校验 history revision；真实磁盘关闭重开后 running job/checkpoint 可恢复且不会被第二次领取。Claude fork 可用唯一 recovery title 经 SDK `listSessions` 核对，旧表删除、V2 history invalidation 与 local rewrite checkpoint 可同事务提交。现已新增 `history.runtime_dispatch_prepared`，预先持久化 command 唯一 dispatch/attempt identity；该 identity 已贯穿 Claude/Codex/ACP continuation 与首个 lifecycle attempt，首次 running attempt、V2 `run.started`、`history.runtime_dispatched` 能同一 SQLite 事务提交。重复调度同一 planned attempt 明确冲突，事务内 V2 run 写失败会同时回滚 attempt 与 checkpoint。attempt 终态现在会把权威 attempt、V2 terminal run 和 command completed/failed result 同事务提交；启动时 orphaned running attempt 经现有 lifecycle 收敛为 failed 时，也会沿同一路径关闭 command。启动扫描已能分类 accepted、历史副作用未完成、待 prepare、prepared 可重调度、dispatched orphan、terminal attempt 和完整性失败；terminal 残留会自动收敛，不可能状态会耐久失败。`redispatch_prepared` 已能从 durable request 与 fork checkpoint 重建输入，在 orphan thread 状态收敛完成后复用原 planned attempt 自动调度，并跳过 rewind 和重复 user message。desktop rewrite、Claude rewind retry 与 Codex/ACP non-rewind retry 已接入稳定 principal/clientCommandId 和 durable command 链路；non-rewind retry 不伪造 fork/local rewrite checkpoint，accepted/claimed 状态可启动恢复到 prepared，首次 attempt 与 terminal result 仍走相同原子事务。ACP durable command 禁止内部自动模型重试，unstarted failure 也不再进入旧 turn 删除路径；Codex/ACP pre-attempt promise rejection 会被显式记录并把仍停在 matching prepared 的 command 耐久失败。clarification submit/dismiss、Bash approval resolution 与 plan approve/dismiss 已分别迁移为 `clarification.resolve`、`approval.resolve`、`plan.resolve`：桌面和移动端都发送 principal、稳定 clientCommandId、thread/tool identity、完整 resolution payload 与 expected revision；claim 先于内存 waiter resolution，completed job 能在 pending 已消失后响应丢失重试，payload 变化显式冲突。Bash 的一次性批准、remember-prefix、session grant、exec/network policy amendment、拒绝和取消均逐值守恒到 waiter；实际 remember/session/policy 副作用仍由 runtime 在 waiter 返回后执行。plan command 冻结 pending plan、thread/runtime/bridge 上下文；session mode 与 checkpoint、pending 删除与 checkpoint 均同事务。approved-plan 现在是可验证产物：thread 决定绝对/相对路径，规范文档以临时文件 + rename 替换，checkpoint 保存 SHA-256；所有 approve core 在 session/bridge/dispatch 前先落 snapshot。启动恢复已分类 accepted、not-started、prepared、dispatched、terminal effect 与 bridge unknown；补 approval receipt 前会基于冻结 workspace 校验路径和磁盘内容 hash，验证失败不清 pending 并耐久 `integrity_failure`。Codex、Pi、ACP、Claude 的 plan continuation 使用预分配 dispatch/attempt identity，首次 attempt、V2 `run.started`、`plan.runtime_dispatched` 原子提交；Claude 不再手写 dispatched marker，pending clear 移到 attempt 建立之后。plan attempt terminal 只更新 attempt/V2 run，不覆盖 approval receipt；pre-attempt failure 会耐久失败 command，waiter 可观测无 append 的 command failure。启动时未决 interaction command 不重放答案或权限，而是耐久 `interaction_context_lost`；新的 command ID 遇到已消失 approval 会显式失败，不再沿用旧 stale-card success。bridge waiter 本身仍无法跨重启恢复；bridge-resolved 后只有收到 durable `plan.bridge_continuation_resumed` 才清 pending/完成 receipt，否则启动恢复显式 `plan_resolution_outcome_unknown`，进程在确认前退出仍需用户重试。移动端 rewrite UI 已接账号 principal 和稳定 command ID，rewrite/retry wire adapter 均发送完整 envelope；Codex/ACP 非 rewind retry UI 已接入同一稳定 command，Claude rewind retry 在 `historyTarget.activityLineId + userMessageId` 可验证时接入同一 rewrite command，缺少 provider identity 时 fail-closed。thread delete 已用 conversation 外部 durable tombstone 迁移：最终数据库删除与 receipt completion 原子提交，双端发送完整 envelope，移动端 pending delete 在 V2 SQLite 中跨重启保存；todo 读写、同步、移动端缓存/UI 和一次性 V1 导入已完成；当前没有独立 conversation branch 产品入口，Codex `thread/fork` 已归入 durable rewrite/retry。当前尚需完成 `requestSpans`、billing、context、subagentTimings、附件 durable content reference 的生产双端与真实故障/性能门禁。
> 第二十六批状态修正：上一项末尾的“todo 与 conversation branch 仍未迁移”已过期。todo 读写、同步、移动端缓存/UI 和一次性 V1 导入已完成；当前没有独立 conversation branch 产品入口，Codex `thread/fork` 已归入 durable rewrite/retry。

3. **V2 直接写入（原生运行时已收口）**：SDK/live provider、用户消息、活动线和 Feed skeleton 的原生运行时入口已走 V2 事务/读模型；`appendThreadRunEvent` 在 `v2_only` 明确拒绝，生产源码已无调用点，旧事件/用户消息和附件路径入口仅保留给迁移/维护边界。维护窗口切换、兼容观察期和最终物理删除仍未完成。
4. **迁移切换工具（DEV 已演练，生产待放行）**：CLI 已具备预检、`VACUUM INTO` 备份、全量重导、迁移 checkpoint、逐会话完整性报告、活跃 thread 阻断、native-facts manifest 和全库原子 storage-mode 切换；command receipt/job/checkpoint 的 manifest 守恒与中断恢复已有回归。生产放行前仍需覆盖磁盘不足、损坏记录、附件内容 hash 和响应丢失故障矩阵。
5. **真实故障与性能**：Supabase 弱网/重连/末条丢失、桌面重启、Android/iOS 真机长会话和性能预算未验收。
6. **静态门槛**：TypeScript 与 Flutter analyze 已清零并改为 CI 阻断；后续代码变更必须保持这两个步骤全绿。
7. **旧运行时删除（生产入口已收口，兼容观察期未完成）**：生产 renderer 的 `withLegacyHydration()`、ActivityLogView 的 projection/viewModel fallback 和旧 Feed 入口已删除；`ThreadRunProjection*` 只作为 V2 read-model 展示 DTO，`legacy-feed-replay-*` / `legacy-feed-skeleton-*`、旧 bridge 与迁移输入仅供维护、回放和一次性迁移使用，不进入 V2-only 生产路由。兼容观察期、生产维护窗口和最终物理删除尚未完成，未完成前不放行全面 V2-only。

## 放行门槛

只有以下条件全部成立，才允许执行正式 V2-only 切换：

- G-1 至 G-5 全绿；桌面与移动端全量测试、双端 golden、真库差分全部通过。
- TypeScript 和 Flutter 静态检查阻断式通过。
- 真库副本全量重导演练连续两次结果一致；迁移中断、磁盘不足和损坏记录均能显式失败并恢复。
- 全部会话的正文哈希、用户消息多重集、run 终态/时间、工具身份、代理归属、连续 seq/effect 校验通过，未映射事件为零或有逐条批准的显式处置。
- V2 command 的幂等、receipt、接受后崩溃恢复和响应丢失通过。
- 真实 Supabase 故障矩阵与真机性能有记录和结论。

切换后只允许修复前进。若尚未接受任何 V2 新写入，可恢复整库备份；一旦接受新事件，不得恢复旧库并丢弃 V2 数据。

## 下一步

2026-09-17 第二十五批完成 thread delete 的 durable tombstone 与双端生产 envelope。完整会话删除不能复用 `conversation_command_jobs_v2`，因为成功事务会删除该 conversation 的 stream、job 和 receipt；因此新增独立于 conversation 生命周期的 `thread_delete_receipts_v2`。接受阶段校验 V2 conversation 与 expected history revision，同 key 同请求复用、不同请求冲突，并用部分唯一索引保证每个 thread 最多一条 accepted delete。外部 Claude/Pi/ACP session、agent 目录、gateway 与 prompt image 清理先执行且允许同 command 幂等重试；最后一个 SQLite 事务删除 thread-owned legacy rows、V2 stream、thread row，并把 tombstone receipt 标为 completed。故障触发器专项证明最终 DELETE 回滚时 thread、V2 stream 与 accepted receipt 同时保留；修复后重试完成，response-loss 再次调用只读 completed receipt。thread 已消失但没有 matching completed receipt 不再被当作成功。桌面 renderer 与移动端 RPC 均改发 principal/clientCommandId/threadId/expectedHistoryRevision；主进程对同 command 做 in-flight 合并，不同 command 在 store 层冲突。移动端新增 V2 SQLite pending delete 表，在首次调用前持久化 envelope，收到成功后删除；专项模拟响应丢失后重建 `DesktopRpc`，证明不重新读取已删除 thread 的 head，仍复用原 envelope，并用真实临时磁盘 SQLite 证明关闭重开守恒。针对 sqflite 默认同路径 `singleInstance` 的官方/社区语义，生产端改为按账号与桌面共享一个 V2 cache owner，避免任一会话 dispose 关闭其他会话和 durable command 共用的 native handle。桌面 store/coordinator/storage-cleanup 39/39、171 个断言，移动端 RPC/cache/session/reconnect 扩展集 47/47 通过；相关 Flutter analyze 无问题，本批 TypeScript 文件无新增诊断，过滤结果仍只有既存 Pi 与 App 队列类型错误。该命令不承诺外部资源清理 exactly-once，只承诺 accepted tombstone 可重试且最终数据库删除原子。storage cleanup 的清旧会话、清全部会话与 PI 全量清理也已统一调用同一 coordinator，不再绕过 tombstone。后续状态修正：todo 读写/同步/UI/一次性导入已完成；当前没有独立 conversation branch 产品入口，Codex `thread/fork` 已归入 durable rewrite/retry。

2026-09-17 第二十四批完成 plan approval/dismiss 的首轮生产收口。桌面与移动端 `thread:approve-plan` / `thread:dismiss-plan` 已不再接受裸 threadId：必须携带 principal、稳定 clientCommandId、threadId 与 expected history revision，approve 还把 runtime config / execution target 纳入 request hash。生产入口先接受并领取 `plan.resolve` V2 command，再执行现有 core-specific plan 路径；completed receipt 能覆盖响应丢失，同 ID changed target/config 显式冲突。durable request 同时冻结 pending plan、thread core/status/workspace/runtime config 与 bridge identity；claim 后写 `plan.context_frozen`，真正执行前再次比较当前上下文，变化会显式 `cursor_stale`。store 已新增并限制 plan 专用 checkpoint：snapshot persisted、session mode committed、bridge resolved、runtime dispatch prepared/dispatched、pending cleared、dismissal committed；其他 command 类型不能写 plan checkpoint。approved-plan 已从“只记路径”升级为确定性可验证产物：`workspace/thread` 决定绝对与相对路径，规范 Markdown 先写同目录独占临时文件再 rename，checkpoint 保存 SHA-256 与算法标识。Codex、Pi、ACP、Claude、bridge 路径全部先写 snapshot/checkpoint，再切 session mode、交付 bridge 或准备 runtime dispatch；移除了 approve route 之前那次非原子的 runtime-config 预写。启动恢复补 approval receipt 前会用冻结 workspace 重算路径并读取磁盘校验 hash；文件缺失、路径漂移、内容被改或旧 checkpoint 缺字段均 `integrity_failure`，且验证发生在 pending clear 之前。session mode 的 runtime-config 更新与 `plan.session_mode_committed`、pending-plan 删除与 `plan.pending_cleared` 分别在同一 SQLite 事务提交。四条 plan continuation 统一使用确定性 dispatch/planned-attempt identity：首次 running attempt、V2 `run.started`、`plan.runtime_dispatched` 同事务提交；Claude 已删除手写 prepared/dispatched，pending clear 改到真实 attempt 建立之后。plan attempt terminal 不会覆盖已完成的 approval receipt。dispatch waiter 同时使用 commit hint 和状态轮询，pre-attempt command failure 不再等满 15 秒。启动恢复细分 accepted、not-started、prepared、dispatched、terminal effect 和 bridge unknown；dispatched 必须校验 attempt identity 与 snapshot artifact，主目标补 pending clear 后完成 receipt，强制子代理保留 pending；bridge-resolved 仍因进程内后续状态未知失败为 `plan_resolution_outcome_unknown`，绝不自动重放。snapshot/worktree/plan recovery 专项 44/44、156 个断言，扩展定向集 101/101、320 个断言通过；相关 TypeScript 过滤未出现本批新增诊断，但全量 TypeScript 仍有既存错误，G-5 仍为部分完成。当前 plan 剩余硬缺口收敛到 bridge waiter 跨进程不可恢复。后续 command 审计确认 thread delete 不能直接复用 conversation-local job：现有 `deleteThreadFully()` 会删除该会话的 V2 stream、job 和 receipt，必须先设计库外 tombstone/删除 receipt 或保留最小 command ledger；todo 当前主要由 runtime event 驱动，Git branch 不是 conversation branch。下一步先定义 thread delete 的 durable tombstone 边界，再改双端 envelope，不能在删除事实源的同时把幂等证据一并删掉。

2026-09-17 第二十三批把 Bash approval resolve 生产入口迁到 V2 `approval.resolve` command。桌面和移动端 envelope 新增 principal、稳定 clientCommandId、threadId、toolUseId、decision、feedback 与 expected history revision；缺少登录 principal 显式失败。协调器在唤醒 waiter 前 accept/claim，成功后写 durable completed receipt；同 ID 响应丢失重试返回 `alreadyResolved=true`，不同 payload 冲突。一次性批准、remember-prefix、session grant、execpolicy/network policy amendment、denied、cancelled 七种 decision 均有逐值专项，权限记忆与策略副作用仍由原 runtime waiter 返回路径执行，不在 RPC handler 重复实现。旧 `resolveBashApprovalIdempotent()` 的“pending 不存在即成功”不再用于生产入口：新的 command ID 遇到已消失 approval 会耐久 `invalid_params`，避免把跨端 stale card 冒充成已处理 receipt。启动恢复统一扫描 clarification/approval interaction command，accepted/running 均 claim 后失败为 `interaction_context_lost`，不自动再次授权。桌面 interaction/bridge/ACP permission 专项 24/24，扩展定向集 221/221、949 个断言通过；移动端 RPC 37/37，变更文件 analyze 无问题，相关 TypeScript 无新增诊断。仓库全量 TypeScript 仍有既存错误，静态门禁未通过；G-5 仍为部分完成。下一步迁移 plan approval/dismiss：该路径包含写 approved-plan 文件、切 session mode、桥接 resolve 与可能启动 continuation，需要先定义各 core 的 durable checkpoint，不能照搬纯内存 interaction 的单步模型。

2026-09-17 第二十二批把 clarification submit/dismiss 生产入口迁到 V2 `clarification.resolve` command。桌面 renderer 和移动端 notifier 都以 principal、thread、toolUseId、resolution、回答内容与 expected history revision 生成稳定 clientCommandId，wire adapter 不再接受只有 toolUseId 的无身份请求；缺少登录 principal 显式失败。协调器先 accept/claim，再唤醒进程内 clarification waiter，成功后写 completed result；响应丢失后的同 ID submit/dismiss 即使 pending map 已清除，也能从 durable request/result 返回 `{ok:true}`，不同回答复用同 ID 返回 `idempotency_conflict`。不存在匹配 pending request 时 command 耐久失败，不伪装成已回答。进程内 waiter 无法跨重启恢复，因此启动扫描会把 accepted/running clarification command claim 后耐久失败为 `interaction_context_lost`，明确禁止自动重放可能已经交付过的用户答案。桌面协调器/bridge/store 定向集 61/61、移动端 RPC 36/36 通过；移动端变更文件 `flutter analyze` 无问题，相关 TypeScript 文件无新增诊断，`git diff --check` 通过。该批只迁移 clarification resolution；clarification request 的运行时 waiter 本身仍是进程内对象，重启后不会恢复原模型 turn。下一步迁移 Bash approval resolve，并先区分一次性批准、remember-prefix 与 session grant 三种副作用，不能把它们压成同一个可重放结果。

2026-09-17 第二十一批把 desktop Codex/ACP non-rewind retry 接入 V2 durable dispatch/recovery。durable request 冻结 canonical prompt、客户端原始 prompt、attachments、图片标记和 runtime config；只有 `history.retry + rewind=false` 允许从 `execution.claimed` 直接进入 `history.runtime_dispatch_prepared`，其他 history command 跳步会 `idempotency_conflict`。Codex 与 ACP 首个 lifecycle attempt 使用预分配 `plannedAttemptId` 和 command dispatch metadata，首次 attempt、V2 `run.started` 与 dispatched checkpoint，以及 attempt terminal、V2 terminal run 与 command terminal result，均沿既有事务边界提交；新增专项把原子证据改为真正的 non-rewind request，不再借用 local rewrite checkpoint。启动恢复已抽出可测试编排，覆盖 accepted revision unchanged → claim/prepared、accepted revision stale → durable `cursor_stale`、claimed → prepared、prepared → redispatch、unsupported core → durable `integrity_failure`。异步启动不再使用可能产生未处理拒绝的 `void promise.finally()`：显式 observer 会记录 rejected runtime，并且只在 job 仍停在 matching prepared identity 时写 `runtime_dispatch_not_started`；dispatched、terminal 或 identity 不匹配均 no-op。ACP command 首次失败后不自动第二次请求模型，unstarted failure 不进入旧 `discardUnstartedTurn` 删除路径。扩展定向集 197/197、843 个断言通过，`git diff --check` 通过；相关改动文件无 TypeScript 诊断，但仓库全量 TypeScript 仍有既存第三方、runtime、desktop 与 renderer 错误，静态门禁未通过。G-5 仍为部分完成，移动端仍无 retry UI 调用点。下一步迁移审批与澄清命令：先盘点现有 request/resolution 的持久化边界和响应丢失语义，再定义 V2 command receipt/checkpoint，不能只给旧 RPC 套 job。

2026-09-17 第二十批补齐移动端 history command envelope。`DesktopRpc.rewriteThreadFromMessage()` 与 `retryThreadFromMessage()` 都改为必传 principalId/clientCommandId，并在 wire payload 原样发送；移动端 rewrite UI 从已登录 credentials 取得 principal，缺失时显式失败，不回退匿名身份，再以 thread、目标行、prompt、attachments、expected history revision 的 canonical stable hash 生成确定性 rewrite command ID。新增 RPC 单元测试逐字段比较 rewrite/retry envelope，`desktop_rpc_test` 35/35 通过，变更文件 `flutter analyze` 无问题。当前移动端没有 retry UI 调用点，因此本批只证明 retry adapter 契约，不能算移动端 retry 端到端完成。下一步仍是 Codex/ACP non-rewind retry：先把 runtime dispatch identity 与 attempt 原子绑定扩展到非 Claude runtime，并为“claimed 但未 prepared”定义可自动恢复的 durable 状态，再接生产 RPC。

2026-09-17 第十九批把 desktop Claude rewind retry 接入与 rewrite 相同的 V2 durable command 链路。retry request 新增必填 principal/clientCommandId，renderer 用 thread、目标行、可见 prompt、图片标记和 expected history revision 生成稳定 ID。首次执行在任何破坏性动作前读取并冻结权威 edit prompt、attachments 与 upstream message identity，再 accept/claim `history.retry`；durable request 同时保存客户端原始 prompt/图片标记，保证同 ID 不同输入仍显式冲突，并让 prepared 重启恢复拥有完整运行时输入。响应丢失后的重复 RPC 会先读取既有 job，即使旧目标已被剪掉、thread 已进入 running，也只返回当前 thread，不再要求重新解析 edit 或再次调度。rewrite 协调器已参数化复用 `history.retry`，专项证明 retry job 保存 canonical prompt/attachments、客户端请求字段和 command identity。retry/recovery/store 定向集 81/81、287 个断言通过，`git diff --check` 通过；本批文件无新增 TypeScript 诊断，过滤结果仍只有既存 `App.tsx` 队列状态类型错误。Codex/ACP 的非 rewind retry 仍走旧路径：它们没有 `history.local_rewrite_committed` 这一步，当前恢复分类器和 checkpoint 顺序不能直接套用，下一步必须先定义 non-rewind retry 的 durable prepare/dispatch/recovery 状态机。

2026-09-17 第十八批把 desktop rewrite 生产 RPC 接入 V2 durable command。`ThreadRewriteFromMessageRequest` 新增必填 `principalId/clientCommandId`；renderer 使用 `desktop-local` principal，并以 thread、目标行、prompt、attachments 和 expected history revision 的稳定哈希生成 command ID。main 入口先确认会话已迁移，再 accept/claim `history.rewrite` job；重复 running/completed 请求直接返回现有 thread，不重复解析编辑目标、rewind 或 runtime dispatch，failed job 明确报错。实际 continuation 携带 command identity，因此沿用第十三至十七批的 fork、local rewrite、prepared/dispatched、attempt terminal 与启动恢复链路。新增生产协调器专项覆盖响应丢失后的同 ID 重试、同 ID 不同 prompt/attachments 冲突、accept 与 claim 之间 revision 变化耐久 `cursor_stale`、准备阶段异常耐久失败；63/63、241 个断言通过。包含恢复/store/lifecycle/UI 的扩展定向集为 164/164、710 个断言；`git diff --check` 通过，新增协调器、IPC 接线及专项测试无 TypeScript 诊断。全量 TypeScript 的既存错误仍未清零，G-5 仍为部分完成。下一步只推进 retry：Claude rewind retry 可复用当前 history command 链路；Codex/ACP 等非 rewind retry 先定义 checkpoint 与恢复语义，不能用外层 V2 job 掩盖旧执行缺口，之后再补移动端同一 command envelope。

2026-09-17 第十七批实现 `redispatch_prepared` 自动恢复。启动扫描先完成 orphan thread/lifecycle 收敛，再异步恢复 prepared command，避免旧 running 状态阻挡新调度。恢复从 durable request 读取 prompt、attachments、runtime config，从 `history.sdk_fork_created` 读取 forked session；调用 continuation 时不再传 rewind target，并设置 `skipRecordUserPrompt`，因此不会二次删除历史或重复用户消息。它直接注入 checkpoint 中原有的 `dispatchId/plannedAttemptId`，首个 attempt 仍走第十四批的原子 claim。attachments 数组、runtime config、fork decision 或 forked session identity 损坏时 command 会耐久失败为 `integrity_failure`；空 prompt 且无附件则明确 `invalid_params`，不通过丢字段继续执行。定向验证保持 84/84、295 个断言，`git diff --check` 通过，相关文件无新增 TypeScript 诊断。恢复基础闭环后，下一步是让 desktop rewrite/retry RPC 和 renderer 真正提供稳定 principal/clientCommandId、先 accept/claim V2 job 再执行，随后补移动端同一 command envelope。

2026-09-17 第十六批加入 history command 启动恢复状态机。新增纯分类器，明确区分 `claim`、`resume_history_side_effects`、`prepare_runtime_dispatch`、`redispatch_prepared`、`settle_orphaned_attempt`、`settle_from_terminal_attempt` 和 `integrity_failure`。prepared 且 planned attempt 不存在时只允许复用原 identity 重调度；prepared 已出现 attempt 但没有 dispatched checkpoint、dispatched 缺 attempt、checkpoint 与 attempt metadata 不一致均判为完整性失败，禁止重复请求外部模型。`ConversationStore.reconcileRecoverableHistoryCommands()` 已接入桌面启动 orphan recovery：terminal attempt 残留会通过现有原子终态路径关闭 command，running orphan 会先收敛为 failed，不可能状态写入 durable `integrity_failure`；仍需真实执行的 decision 只保留并输出诊断，不伪装成已恢复。定向验证 84/84、295 个断言，`git diff --check` 通过，相关文件无新增 TypeScript 诊断。下一步实现 `redispatch_prepared` 的请求重建与安全自动调度，然后才能接 production rewrite/retry principal/clientCommandId。

2026-09-17 第十五批补齐 runtime command terminal result。`ConversationV2Store` 增加可加入调用方 SQLite 事务的 command terminal transition；普通 `completeCommand`/`failCommand` 复用同一校验和幂等逻辑。`ConversationStore.upsertRunAttempt()` 会识别 attempt metadata 中的 command dispatch identity：completed attempt 将 `thread_run_attempts`、V2 `run.completed` 与 command completed result 同事务提交；failed/cancelled attempt 同理写 V2 terminal run 与结构化 command error。metadata 声明了 command dispatch 但结构损坏时显式 `integrity_failure`，不退回普通 attempt 路径。由于 `settleRecoveredLifecycleRecords()` 原本就把重启后的 running attempt 收敛为 failed，带 command metadata 的 orphaned attempt 现在也会原子关闭对应 job，不再永久 running。定向验证 80/80、284 个断言，相关文件无新增 TypeScript 诊断。剩余硬缺口是 prepared-but-not-dispatched、dispatched-but-attempt-missing、旧版本非原子残留等启动恢复分类，以及 production rewrite/retry 的稳定 principal/clientCommandId 接入。

2026-09-17 第十四批建立 runtime dispatch durable identity。checkpoint 顺序扩展为 `history.local_rewrite_committed` → `history.runtime_dispatch_prepared` → `history.runtime_dispatched`；prepared payload 固定携带 `dispatchId` 与 `plannedAttemptId`，禁止再从 local rewrite 直接跳到 dispatched。`AgentLifecycleService` 与 `runThreadRequestWithLifecycle()` 支持调用方预分配 attempt ID、metadata 和 command dispatch identity，history prune 后 rehydrate 也不再丢 metadata。`ConversationStore.upsertRunAttempt()` 新增 command 专项事务：校验 job 最后 checkpoint 与 planned attempt 一致，将 `thread_run_attempts` running 行、V2 `run.started` 和 dispatched checkpoint 一次提交；attempt 已存在时明确要求恢复而非再次调度。专项故障用例利用跨会话 run identity 冲突证明 V2 append 失败会回滚 attempt 且 job 仍停在 prepared。prepared identity 也已贯穿 `startThreadContinuation`、所有 Claude continue action runner 和首个 `runThreadRequestOnce`：command context 存在时按 principal/conversation/clientCommandId 确定性生成 dispatch/attempt ID，并由首次 lifecycle claim 原子落库。定向验证 80/80，`git diff --check` 通过；桌面全量 TypeScript 仍为既有诊断，本批相关文件无新增错误。下一步实现启动恢复分类和 command terminal result，再给 rewrite/retry RPC 增加稳定 `clientCommandId` 与 principal；这些完成前仍不宣称生产命令已切 V2。

2026-09-17 第十三批补齐非发送 command 的 append-only checkpoint 与 Claude fork 恢复身份。新增 `conversation_command_checkpoints_v2`，状态顺序固定为 `execution.claimed` → `history.sdk_fork_requested`/`history.sdk_fork_skipped` → `history.sdk_fork_created` → `history.local_rewrite_committed` → `history.runtime_dispatched`；跳步、倒退、同名不同 payload、hash 损坏均显式失败。checkpoint 可加入调用方已持有的 SQLite 事务，测试证明 rollback 不会残留假进度。`rewindThreadToActivityLine`、SDK rewind 与 ACP discard 已支持可选 durable command context，使旧表删除、V2 history event 和 local rewrite checkpoint 同事务提交。针对 `@anthropic-ai/claude-agent-sdk 0.3.266` 先查官方/社区并核对本地类型：显式 `forkSession()` 支持 title 和 `listSessions()`，但不能指定目标 UUID；因此 fork 前持久化 command 唯一 recovery title，响应丢失后零匹配才重试、唯一匹配复用、多匹配阻断，durable command 已引用的 fork 在后续失败时不再被 cleanup 删除。专项验证：store 35/35、conversation-store runtime 23/23、runtime session compat 5/5；相关文件无新增 TypeScript 诊断，桌面全量仍为既有 54 错误，runtime 全量仍有既有第三方/项目诊断。当前最后硬缺口是 runtime dispatch：`dispatchThreadContinueAction()` 为 fire-and-forget，尚无命令专属 durable run identity 可与 `history.runtime_dispatched` 原子绑定，因此 rewrite/retry RPC 继续保持旧入口，不能提前宣称崩溃恢复闭环。

2026-09-17 第十二批开始统一非发送 V2 command 基础。新增 `conversation_command_jobs_v2`，保留现有 send receipt 表避免破坏兼容；命令接受与 `command.accepted` 的 V2 `noop` 审计事件同一 SQLite 事务提交。状态机覆盖 accepted/running/completed/failed：同 principal/conversation/clientCommandId 同请求返回原 job，任一 command type、payload 或 expectedHistoryRevision 变化都返回 `idempotency_conflict`；领取执行权时再次比较当前 history revision，变化则耐久写入 `cursor_stale` failed；terminal 结果重复写必须完全一致。读取 job 会核对 request hash、terminal 字段和 accepted event，损坏数据显式 `integrity_failure`。真实临时磁盘关闭重开证明 running job 可恢复且第二次领取返回 acquired=false；store 套件 34/34，`git diff --check` 通过。全量 tsc 仍为 54 个既存错误，本批文件无诊断。这里故意没有直接把 rewrite/retry 旧 RPC 包起来：进程可能死在 SDK fork 与本地 rewind 之间，没有分阶段 checkpoint 时自动重跑会制造第二次破坏性操作。下一步先为这两个副作用定义并持久化 checkpoint/协调顺序，再接 `clientCommandId`、principal 和 durable result；不得把永久 running 当完成，也不得无条件重跑。

2026-09-17 第十一批审计 send command 的“接受后崩溃恢复”，修复 queued 图片附件丢失。桌面启动确实会扫描 `conversation_messages_v2` 中 queued 用户消息并重新调度，但原恢复代码只传 conversation/message/turn/text，完全丢弃已随 `message.accepted` 持久化的 attachments；因此带图命令在 receipt 已返回后崩溃，会被恢复成纯文本执行。现抽出受测的 durable row → runtime schedule 转换，完整恢复并 trim `mediaType/data/path`。附件结构损坏时返回 `integrity_failure`，恢复入口把消息显式终结为 failed 并记录错误，禁止静默删图后继续运行。请求/字段守恒组合 21/21；相关模块 Biome 仅保留原有两条 `any` warning；全量 tsc 仍为 54 个既存错误，本次相关文件无诊断；`git diff --check` 通过。下一步继续把编辑、删除、重试、审批与澄清纳入统一 V2 command/receipt，而不是复制只在内存调度的旧 RPC。

2026-09-17 第十批补齐桌面 Realtime → EventCenter 的合法 V2 往返，并修复发送失败后的 pending 泄漏。此前 Realtime 专项只覆盖错误目标、订阅和鉴权失败，没有证明合法 V2 command 能穿过 bind-channel broadcast envelope、remote command 校验与 EventCenter handler，再以约定的 `{channel, result}` 双层 JSON-RPC envelope 返回。现新增 `conversation:head` 全路径测试。审计同时发现 `sendOnBinding()` 在 Supabase SDK `channel.send()` 直接抛异常时保留 pending timer；返回非 `ok` 时还会 reject 一个没有交给调用者的内部 Promise，可能在当前调用已经失败后迟发 timeout/unhandled rejection。现统一为发送未成功即清 timer 并删除 pending，由当前调用直接失败。Realtime/Center/EventCenter 组合回归 38/38，Biome 与 `git diff --check` 通过。本机当前没有运行本地 Supabase 容器，因此该批是进程内真实协议组件集成，不冒充私有 Realtime 网络、设备绑定、断网重连或背压实测。

2026-09-17 第九批补齐移动端 V2 RPC wire contract。审计发现 `DesktopRpc` 的 capabilities/bootstrap/messages-page/details-page/head/sync/send-message 七条 V2 route 没有专项测试，channel 名、分页/字节预算、detail owner 过滤、sync throughSeq 或幂等 command envelope 均可能在适配层漂移而不被发现。现新增严格 recording transport 测试，逐次比较 channel 与完整 args，并验证 detail 全归属字段及空 `content/ref` 经 RPC response 解析后仍一致；send 覆盖 principal/conversation/clientCommandId/text/turnId/messageId/attachments。相关 analyze 无问题，`desktop_rpc_test` 33/33，`git diff --check` 通过。该批只关闭客户端 wire adapter 契约，不是 Supabase WebSocket 真传输证据；真实设备绑定、断连重连、响应丢失、末条 effect 与背压仍是 G-5 阻断项。

2026-09-17 第八批增加真实跨进程强杀证据。新增独立 Bun worker，在临时磁盘 SQLite 上提交 `sendMessage` command + durable receipt，向父进程发布已接受结果后保持数据库连接打开；父测试立即发送 `SIGKILL`，不运行应用清理或 `DatabaseSync.close()`。随后用新连接初始化并 rebuild，同一 principal/conversation/clientCommandId 重试必须返回完全相同 receipt，head seq 保持 acceptedSeq，消息仍只有一条。字段守恒套件 14/14、Biome 和 `git diff --check` 通过。该测试证明“命令事务已经返回成功后进程被强杀”的恢复与幂等，不覆盖 COMMIT 中途进程死亡、文件系统缓存丢失或物理掉电；G-5 下一步转向真实桌面 RPC/Supabase 传输故障矩阵，并继续保留事务中断/掉电专项。

2026-09-17 第七批补齐 detail 到移动端最终 Feed 的字段守恒。此前 `ConversationV2Detail` 已能全字段落 SQLite、经 RPC/DTO 往返，但 `buildConversationV2ToolDetailFeed()` 只把文本、run/tool/agent 和 createdSeq 写入 `ActivityFeedEntry`，versionSeq、agent instance、父 agent/父 tool 以及 content/ref 的精确空字符串语义在最终消费边界丢失。现为 Feed entry 增加完整 `conversationV2Detail` source row，并在 `withSequence()`、`withIdAtSequence()` 中显式复制；测试用全归属字段与 `content/ref = ''` 的样本验证映射及两种重编号路径。定向验证：相关生产文件 analyze 无问题，V2 activity 15/15 通过，`git diff --check` 通过。G-5 仍为部分完成，剩余硬门槛是实际桌面 RPC/Supabase 传输故障矩阵与进程强杀/掉电恢复，不把临时磁盘干净重开当作替代证据。

2026-09-17 第六批补齐 message/tool 归属事实与历史 agent 可重放性。消费端审计发现桌面把子代理工具放入卡片后仍生成 `scope=main` 且丢 `agentId`，移动端 orphan message 在留在主 Feed 时也清掉原 owner；双端同时缺少 agent instance/父调用版本事实。现已修复 scope/owner，保留 message logical entity、turn/version/content/status/channel 与 tool version/agent instance/父 agent/父 tool 元数据，并加完整归属样本。迁移审计进一步确认 `seedLegacyAgents()` 只写读模型，导致 bootstrap 有 agent 而 seq-0 replay 永远缺失；现改为把 `thread_agent_instances` 纳入 source fingerprint，并为每行追加幂等 `agent.created` 事件，产出 durable `agent.upsert`。新增迁移专项证明 bootstrap、effect replay、rebuild 和 rerun 一致；9 条真语料现同时比较 message/run/tool/agent。真实语料还纠正了一次错误展示假设：delegationPrompt 必须优先于 legacy mission_key，不能通过更新 golden 接受回归。定向验证桌面 migration 7/7、字段守恒 13/13、投影/真语料/cross-end 共 96/96，移动端 projection/activity/cross-end 41/41；G-5 剩余重点是 detail 到最终 Feed 的消费字段、真实传输和强杀/掉电恢复。

2026-09-17 第五批继续追到 Feed 消费端，发现移动端 `ConversationV2Agent` 虽已完整落 SQLite，但 `ThreadRunProjectionAgent` 丢弃 `mission`、`todoId` 和父 agent；桌面投影也用 truthy spread 再次丢掉显式空 mission。现已补齐移动端 projection model 的字段、分页/详情 merge 传递和 Feed copy，桌面投影保留显式空 mission。第六批真语料进一步确定展示优先级应是 delegationPrompt/summary 优先、mission 仅在 delegation 缺失时兜底。新增双端断言覆盖完整 agent 注册表从 renderer/projection 到卡片消费，桌面 conservation 13/13、移动端 activity/projection 31/31 通过。G-5 仍不标完成。

2026-09-17 第四批补上真实磁盘边界：移动端为 `ConversationV2Cache` 增加仅用于选择数据库工厂/路径的注入点，生产仍默认使用 sqflite；测试用官方推荐的 `sqflite_common_ffi` 打开临时磁盘库，验证 agent 全可选字段关闭重开守恒、同一 sync page 后续冲突会回滚前一 effect 与 effect hash/cursor、再次重开仍停在原 seq，随后能从原 seq 正常续写。桌面 send receipt 改为临时磁盘文件，真正关闭第一个 `DatabaseSync` 后以第二个连接重开并 rebuild，重试结果、seq、消息数不变；篡改 receipt 后显式失败且不追加事件。定向测试移动端 1/1、桌面 conservation 13/13 通过。仍不能把干净关闭重开表述成进程强杀或掉电恢复。下一步继续 G-5 的 Feed 全字段转换与历史全注册表重放，再进入完整 V2 command/receipt 面。

2026-09-17 第三批新增 agent.upsert，双端消费者同步落地，旧客户端仍对未知类型显式阻断；保留 effectVersion 1 envelope。桌面 conservation/store/renderer 57 项、移动端 conservation/sync/session 29 项定向测试通过，变更 Dart 文件 analyze 无问题；桌面 tsc 整体仍失败，本批未重跑全量门禁。下一批优先补移动端真实 SQLite agent effect 原子应用与回滚专项，以及回执磁盘重开/崩溃验证。以下第二批记录为历史快照，其 agent 协议缺口已由本批代码推进，但未完成全量验收。

2026-09-17 第二批补齐 detail 全字段 store/effect/renderer/rebuild 与移动端往返，以及 send receipt 实例重建与 rebuild 后重试；修复移动端 detail 空字符串被转为 null。定向测试桌面 12+44 项、移动端 16 项全部通过，变更 Dart 文件 analyze 无问题，本批未重跑全量门禁。上述阻断项 1 中 detail 与 receipt 已有基础覆盖，但磁盘重开、进程崩溃及所有可选字段样本仍未完成。确认 agent 生命周期只产生 detail invalidation，客户端注册表不会随增量更新，下一批优先同步实现 agent effect 与双端消费者。G-5 仍为部分完成。

先做 G-5，再做 V2 command/receipt 与 runtime writer。原因是这三项共同定义唯一写入边界；在字段契约和命令幂等尚未固定前先写迁移切换工具，会把不完整的数据模型固化进正式库。其后实现全量重导命令并演练，最后才执行维护窗口切换与旧代码删除。
