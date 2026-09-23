# Conversation Storage V2-only 维护窗口 Runbook

本文是生产维护窗口的可执行步骤。它只允许在应用停止写入、数据库和附件目录均可读、备份目标可写时运行；任何门禁失败都停止，不使用空源、旧表兜底或“先切再补”的方式掩盖缺口。

本文不授权生产执行，也不替代发布评审。DEV 已按同一流程完成演练；生产执行前仍必须完成真实磁盘故障、Supabase 弱网/跨端重连、真机长会话和兼容观察期验收。

## 0. 变量与窗口边界

在维护主机上进入仓库，并为每次窗口建立独立证据目录。路径必须使用生产实际路径，不能沿用 DEV 路径或旧 manifest。

```bash
set -euo pipefail

APP_ROOT=/absolute/path/to/eco-coding
DB_PATH=/absolute/path/to/eco-coding.sqlite
ATTACHMENTS_ROOT=/absolute/path/to/prompt-images
RUN_DIR=/absolute/path/to/maintenance-evidence/conversation-v2-$(date +%Y%m%d-%H%M%S)
MANIFEST="$RUN_DIR/native-manifest.json"
POST_MANIFEST="$RUN_DIR/post-cutover-native-manifest.json"
BACKUP="$RUN_DIR/pre-v2-only.sqlite"

mkdir -p "$RUN_DIR"
cd "$APP_ROOT/apps/desktop"
```

维护窗口开始后，停止桌面主进程、后台同步 worker 和会创建/更新 conversation 的任务；确认没有新的写入者。不要在预检和切换之间启动旧版本客户端。

## 1. 只读预检和 manifest 保全

先只读导出。`--native-manifest` 的目标文件必须不存在；脚本会在读事务提交后才写入 manifest，不会改变数据库。

```bash
bun scripts/conversation-v2-migrate.ts \
  --db "$DB_PATH" \
  --all \
  --attachments-root "$ATTACHMENTS_ROOT" \
  --native-manifest "$MANIFEST" \
  > "$RUN_DIR/preflight.json"
```

预检输出必须人工核对并留档：

- `integrity` 必须为 `ok`；`storageMode` 必须是当前真实模式。
- 每个 `existingV2` 条目的 `nativeUnmatchedEvents`、`attachmentParseErrors`、`attachmentMissingFiles`、`attachmentLegacyPayloads` 都必须为 `0`；有路径附件时，`attachmentPathContentHashes` 数量必须等于 `attachmentPathRefs`。
- `nativeReconciliationIssues` 不能被摘要脚本吞掉：迁移期事实缺失、来源/hash/附件不一致必须阻断。`post_cutover_runtime_without_native_ledger` 只有在**每条**未入 ledger 的 native candidate 都通过已登记 runtime/command/provider/history-repair source identity 校验，且 stream 同时具备 user receipt、runtime input source envelope 与 run lifecycle 时，才可作为显式 warning；若 migration marker 存在，每条事件的 `recorded_at` 还必须不早于 completed marker。`post_cutover_recovery_without_native_ledger` 仅用于精确 recovery tool event，且必须能在 V2 投影中确认 terminal run 与 failed tool。`maintenance_native_fact_replay` 只允许 `maintenance:native:<factId>` 精确关联到 ledger 中的 modified fact，并校验派生 event identity/payload。混合未验证行仍报 unmatched，不能把 warning 改写成无问题。
- `native-manifest.json` 的 `conversationCount`、`nativeEventCount`、`commandState` 和每个事件的原文/hash 必须与窗口记录一致。`commandState` 可以非空，但不能被忽略。
- `legacy_compat` 库若报告 `hasExternalData=true`，这表示已有 V2 数据必须经过 manifest 守恒复核；不能把 `cutoverReady=false` 当作“可以强切”。只有所有原生事实已匹配、附件内容可重新读取、command receipt/job/checkpoint 有明确恢复来源时，才允许进入第 3 步。
- `v2_only` 库的预检必须 `cutoverReady=true`。如果同一库带路径附件却没有传 `--attachments-root`，预检会 fail-closed；补齐真实附件根目录后重新生成全新的 manifest。
- `v2_only` 中切换后新增的运行流可以没有迁移台账，但必须同时具备 user receipt（桌面 V2 user event 或可核对的 command receipt）、带 source envelope 的 `runtime-input` receipt 和 `desktop:run`/`desktop:run-reconciled` lifecycle；所有其他 native row 也必须匹配已登记的 runtime writer、command job、provider patch 或 history-repair identity，才标记为 `post_cutover_runtime_without_native_ledger` warning 并计为 `0 nativeUnmatchedEvents`。已有 ledger 的 stream 也必须逐条检查 ledger 之外的 event；只有被验证的 runtime/recovery/maintenance replay 可成为 warning，额外未知行按确切数量重新计入 unmatched。仅有恢复事件时，只有 `recovery:terminal-run-tool` identity 与 terminal run/failed tool 投影一致才标记为 `post_cutover_recovery_without_native_ledger`。存在 migration marker 时，非 maintenance runtime rows 还需逐条满足 `recorded_at >= migration.updated_at`。迁移阶段、时间早于 marker、来源未知、任一证据缺失或混有未验证 native 行仍必须报告 `native_fact_ledger_missing` 并阻断；不得用 post-cutover 判定绕过 manifest 或附件门禁。

没有 jq 时也可以直接查看 JSON；不得只看进程退出码。以下命令保存一份人可读摘要，供值班记录使用：

```bash
bun -e '
const file = process.argv[1];
const report = JSON.parse(await Bun.file(file).text());
console.log(JSON.stringify({
  phase: report.phase,
  storageMode: report.storageMode,
  integrity: report.integrity,
  cutoverReady: report.cutoverReady,
  conversationCount: report.conversationCount,
  nativeManifestEventCount: report.nativeManifestEventCount,
  blockers: (report.existingV2 ?? []).filter((x) => x.nativeUnmatchedEvents > 0 || x.attachmentParseErrors > 0 || x.attachmentMissingFiles > 0 || x.attachmentLegacyPayloads > 0).map((x) => ({ conversationId: x.conversationId, nativeUnmatchedEvents: x.nativeUnmatchedEvents, attachmentParseErrors: x.attachmentParseErrors, attachmentMissingFiles: x.attachmentMissingFiles, attachmentLegacyPayloads: x.attachmentLegacyPayloads }))
}, null, 2));
' "$RUN_DIR/preflight.json" | tee "$RUN_DIR/preflight-summary.json"
```

## 2. 独立复核同一 manifest

manifest 不是切换授权。用第二个只读进程重新读取数据库和附件内容，确认事件、载荷、来源结论、command 状态和路径附件内容 hash 没有变化：

```bash
bun scripts/conversation-v2-migrate.ts \
  --db "$DB_PATH" \
  --all \
  --attachments-root "$ATTACHMENTS_ROOT" \
  --verify-native-manifest "$MANIFEST" \
  > "$RUN_DIR/preflight-verify.json"
```

必须看到 `nativeManifestVerification.status=passed`，且 `nativeEventCount`、`conversationCount` 和 `factsHash` 与 manifest 相同。验证失败时保留证据目录，停止窗口；不要重新生成 manifest 覆盖差异。

## 3. 备份、全量重导和原子切换

确认所有 thread 都不处于 `queued`、`running` 或 `awaiting_plan`。`--cutover` 会再次检查这一点，并在任何迁移写入前执行 `VACUUM INTO`；备份目标已经存在时命令会拒绝继续。

```bash
bun scripts/conversation-v2-migrate.ts \
  --db "$DB_PATH" \
  --all \
  --apply \
  --cutover \
  --backup "$BACKUP" \
  --attachments-root "$ATTACHMENTS_ROOT" \
  --reconcile-native-manifest "$MANIFEST" \
  > "$RUN_DIR/cutover.json"
```

切换结果必须同时满足：`phase=v2_only`、`storageMode=v2_only`、`integrity=ok`；`retiredTables` 必须包含全部 13 张 V1 conversation source table，且数据库中一张都不能残留；若输出 `nativeFactsPreserved`，它必须等于 manifest 的 `nativeEventCount`，`nativeFactsReconciled` 必须等于本窗口定义的修改事实数量；command receipt/job/checkpoint 恢复数量必须能与切换前 manifest 对账。

以下情况任一出现都视为失败：活跃 thread、备份失败、SQLite integrity 非 `ok`、附件缺失/无法 hash、native fact unmatched、manifest facts mismatch、command 状态 mismatch、旧表残留、任一会话完整性校验失败。失败后保留原库和备份，不重试带有不同参数的强制切换。

## 3A. 已切到 V2-only 的 canonical 附件旧载荷修复

如果数据库已经是 `v2_only`，但预检只因 `attachmentLegacyPayloads>0` 报告 `cutoverReady=false`，不能直接编辑事件表，也不能追加一条事件假装覆盖旧历史。停止所有写入者后，使用独立备份目标执行：

```bash
REPAIR_BACKUP="$RUN_DIR/pre-attachment-repair.sqlite"
bun scripts/conversation-v2-migrate.ts \
  --db "$DB_PATH" \
  --all \
  --apply \
  --repair-legacy-attachments \
  --backup "$REPAIR_BACKUP" \
  --attachments-root "$ATTACHMENTS_ROOT" \
  > "$RUN_DIR/attachment-repair.json"
```

该命令会先做 `VACUUM INTO` 备份，在一个 `BEGIN IMMEDIATE` 事务中把 canonical message/event 的图片附件物化为受管 `sha256:` 对象引用，清洗 opaque 附件元数据，重算事件 hash 并从事件重建派生表。备份目标必须不存在；无附件根目录、活跃 thread、不可读/越界/篡改附件、native 审计不完整、重放失败或修复后仍有旧载荷时命令失败并回滚。命令成功后必须重新从第 1、2 步生成全新的 manifest 和 verify；`cutoverReady=true`、`attachmentLegacyPayloads=0`、`integrity=ok` 才能进入第 4 步。

## 4. 切换后两次审计

先生成新的切换后 manifest，确认当前库可独立审计：

```bash
bun scripts/conversation-v2-migrate.ts \
  --db "$DB_PATH" \
  --all \
  --attachments-root "$ATTACHMENTS_ROOT" \
  --native-manifest "$POST_MANIFEST" \
  > "$RUN_DIR/post-cutover.json"
```

再用切换前的 manifest 做独立守恒核对：

```bash
bun scripts/conversation-v2-migrate.ts \
  --db "$DB_PATH" \
  --all \
  --attachments-root "$ATTACHMENTS_ROOT" \
  --verify-native-manifest "$MANIFEST" \
  > "$RUN_DIR/post-cutover-verify.json"
```

两次命令都必须退出 0；post-cutover 报告必须为 `phase=v2_only`、`storageMode=v2_only`、`cutoverReady=true`、`integrity=ok`、`nativeUnmatchedEvents=0`，原 manifest verify 必须为 `passed` 且 facts hash 不变。

再执行 SQLite 层核对，并把输出写入证据目录：

```bash
sqlite3 "$DB_PATH" > "$RUN_DIR/sqlite-post-cutover.txt" <<'SQL'
.headers on
.mode column
SELECT key, value
  FROM conversation_store_meta_v2
 WHERE key = 'conversation_v2_storage_mode';
PRAGMA integrity_check;
SELECT 'streams' AS metric, COUNT(*) AS value FROM conversation_streams_v2
UNION ALL SELECT 'events', COUNT(*) FROM conversation_events_v2
UNION ALL SELECT 'effects', COUNT(*) FROM conversation_sync_effects_v2
UNION ALL SELECT 'messages', COUNT(*) FROM conversation_messages_v2
UNION ALL SELECT 'native_facts', COUNT(*) FROM conversation_native_facts_v2;
 SELECT name AS retired_table_still_present
   FROM sqlite_master
  WHERE type = 'table'
   AND name IN ('thread_activity', 'thread_coder_todos', 'thread_pending_plans',
                'thread_run_events', 'thread_user_messages', 'thread_pending_followups',
                'thread_feed_skeleton', 'thread_metrics_snapshots',
                'thread_agent_instances', 'thread_subagent_sessions',
                'thread_subagent_metrics', 'thread_run_attempts',
                'thread_usage_ledger_events');
SQL
```

期望 storage mode 为 `v2_only`、integrity 为 `ok`，最后一条查询返回零行。备份也必须独立执行 `PRAGMA integrity_check`，并确认它仍保留需要的 V1 输入表；备份损坏或为空时不能把切换结果视为成功。

## 5. 应用启动和 CDP 冒烟

生产应用按正常发布方式重启后，执行可用的页面/主进程健康检查。DEV 或本地演练使用仓库提供的 CDP 检查：

```bash
cd "$APP_ROOT/apps/desktop"
bun run cdp:attach
bun run cdp:snap
bun run smoke:cdp-probe
```

三个命令都必须退出 0；页面可访问，`window.eco` 存在，composer 可见，状态在线，console 不得有 error。开发环境已有的 Electron CSP warning 可以记录，但不能把异常 error 当成 warning 忽略。截图和命令输出放入本次证据目录。

如果维护环境已经配置了可持续的 Supabase Center 认证会话，再执行只读 Cloud smoke：

```bash
bun run smoke:cdp-center > "$RUN_DIR/cdp-center.json"
```

该脚本只重连现有会话并读取 authenticated settings、binding、private presence 和 settings-sync；不会注册设备、撤销绑定、推送设置或写入对话。必须看到连接为 `connected`、settings 与设备凭据完整、至少一个活动 binding 且同时具备 `events:read`/`rpc:invoke`、至少一个在线 presence、settings-sync 返回 10 个域（或由当前版本明确记录域数量变化）；输出不得包含任何 token、secret、anon key 或设备标识。没有 mobile peer 时，脚本通过不等于跨设备 RPC/尾部恢复通过，仍要在真实双端窗口执行对应故障矩阵。

## 6. 回滚边界

预检、manifest verify、备份或迁移在原子提交前失败时，源库不得被当作已切换；保留失败日志和备份文件，修复根因后从新的维护窗口重新生成 manifest。切换提交后如果应用冒烟失败，先停止所有写入者并保留原库、备份、两份 manifest 和审计输出；不得在应用运行中覆盖 SQLite 文件。只有在单独审批的停机窗口内，使用已验证的备份进行数据库替换，并重新执行本 runbook 第 4、5 步。

任何“验证失败但继续启动”“缺附件时跳过 root”“native unmatched 先忽略”“command 状态先丢弃”“旧表残留靠在线兜底”的操作都不属于 V2-only 切换。

## 7. 证据归档清单

每次窗口至少归档以下文件和版本信息：

- `preflight.json`、`preflight-summary.json`、`preflight-verify.json`、`native-manifest.json`；如执行附件修复，另存 `attachment-repair.json` 和 `pre-attachment-repair.sqlite` 的完整性输出。
- `cutover.json`、`pre-v2-only.sqlite` 的完整性检查输出、`post-cutover.json`、`post-cutover-verify.json`、`post-cutover-native-manifest.json`。
- `sqlite-post-cutover.txt`、应用版本/commit、迁移脚本版本、附件根目录校验说明、维护开始/结束时间和停止写入确认人。
- CDP attach/snapshot/probe 输出、截图、启动日志和任何未决诊断。未决诊断必须进入发布结论，不能只存日志不登记。

当前 DEV 参考证据为：32 个会话、74 条 native facts、`factsHash=ecdb13f4`、22,948 events/effects、`PRAGMA integrity_check=ok`、`storageMode=v2_only`、过渡 `conversation_feed_skeletons_v2` 为 0 行，13 张退役 V1 source table 均不存在，附件旧载荷/path/inline bytes/缺失/解析错误和 native unmatched 均为 0；最新 native manifest hash 为 `0d895008`，独立 verify 已通过。审计仍保留 15 条已知 reconciliation reason，分布在 5 个有外部数据的历史会话，必须随窗口证据归档。CDP 页面在线、`window.eco=true`、composer 可见、`0 errors / 1 warning`。认证 Cloud smoke 的当前 DEV 参考为：binding `1`、presence `25/3 online`、settings-sync `10` 域（`dirty=7`、`synced=3`）；这只证明当前认证桌面读链路，不替代跨设备和故障矩阵。这些数字只能作为演练基线，不能复制到生产结论。
