# V2 存储同步计划独立验收复核

日期：2026-09-17。基线：HEAD `7210b57d` 加当前未提交工作区。此结论针对工作区，不代表该提交或远端 CI 已具备这些实现。

说明：本文是 2026-09-17 的历史复核。2026-09-18 已补齐 `--all` 全库迁移、备份、V2-only storage mode 和原子退役工具；后续批次又收口了原生 V2 writer、生产 Feed 入口、只读维护边界和静态门禁。文中阻断项保留为当日证据，不能直接当作当前代码状态；当前状态与剩余门槛以 [`conversation-storage-sync-v2-acceptance.md`](./conversation-storage-sync-v2-acceptance.md) 顶部快照为准。

当前复核提示（2026-09-21）：第八十七/八十八批已证明 `thread-run-event-live-persist.ts` 不再调用 legacy `appendThreadRunEvent`，V2-only maintenance `--all` 也会覆盖没有 `threads` 行的 durable V2 stream。本文第 1、3、4、5 项中的旧路径/旧工具结论仅是历史快照；仍未闭合的真实 Supabase 双端、物理故障、真机性能和兼容观察期门槛以验收快照为准。

## 结论：不通过全面 V2-only 验收

本次进行代码审计和本地自动化验证，不执行真实用户库迁移，不修改业务实现。既有验收快照里的历史全量测试、构建和真机记录不计为本次复测结果。

## 阻断项

1. **生产写入仍依赖 V1。** `apps/desktop/src/main/thread-run-event-live-persist.ts:190` 调用 `appendThreadRunEvent`；`conversation-store.ts:4956` 的事务方法先 UPDATE/INSERT `thread_run_events`，再调用 legacy adapter 生成 V2。这不是 V2 唯一事实源，违反计划阶段 1 和完成定义；事务原子性测试通过不能替代旧写入口清理。
2. **桌面展示尚未完全脱离旧投影。** `apps/desktop/src/renderer/ActivityLogView.tsx:893` 的 `withLegacyHydration` 仍从旧投影取 requestSpans、billing、context、subagentTimings，且在 `:1549` 实际调用。主 Feed 内容迁移不等于剩余字段契约已完成，阶段 3/6 不通过。
3. **维护窗口全库切换未交付。** `apps/desktop/scripts/conversation-v2-migrate.ts` 仅支持单会话 inspect/apply；没有编排全库写入锁、一致性备份、V2 独有数据及回执守恒、暂存库验证和原子安装/版本切换。不得把此入口作为正式切换工具。
4. **默认 inspect 不是只读操作。** 同一脚本 `:23` 在选择 inspect/apply 前无条件调用 `store.initialize()`；该方法执行 WAL 设置、建表、ALTER 和旧投影迁移（`conversation-store.ts:648`、`:1389`）。因此未传 `--apply` 也可能修改输入库。只读预检需要独立只读连接或明确的副本操作流程。此项由代码路径确认，未对真实用户库运行命令。
5. **静态检查未满足放行门槛。** 桌面 TypeScript 53 个错误；Flutter analyze 48 条诊断，其中 4 条 warning，均非零退出。`.github/workflows/desktop-tests.yml:53` 仍对类型检查设置 `continue-on-error: true`。
6. **真实传输、设备与性能证据仍未完成。** 本次没有执行 Supabase 弱网/断连/末条丢失、真实运行时全矩阵、Android/iPhone 真机、维护窗口演练或性能预算测量，不能由单元测试和固定语料代替。

## 本次验证

日志目录：`/tmp/eco-v2-acceptance-0917/`，为本机临时文件，不是提交内长期保存的 CI 产物。

| 命令 | 结果 |
| --- | --- |
| `bun test apps/desktop/test/conversation-*.test.ts` | 19 个文件，263 通过，0 失败，退出 0 |
| 在 `apps/mobile` 执行 `flutter test test/conversation_v2_*test.dart` | 63 通过，退出 0 |
| `node scripts/test-node-sqlite.mjs` | 30 通过，0 失败，退出 0 |
| `bunx tsc --noEmit -p apps/desktop/tsconfig.json` | 53 个 TS 错误，退出 2 |
| 在 `apps/mobile` 执行 `flutter analyze` | 48 条诊断，含 4 条 warning，退出 1 |
| `git diff --check` | 通过 |

本次未复跑桌面/移动端全量测试、生产构建和 UI E2E，不沿用历史计数宣称通过。后续应先关闭 V2 唯一写入与展示字段缺口，再完成迁移切换工具和静态门禁，最后按原计划补齐真实故障、真机及性能验收。
