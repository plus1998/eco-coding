# ADR：对话存储与同步 V2 的事实源和游标

- 状态：Accepted for staged rollout
- 日期：2026-09-14
- 范围：桌面 SQLite、桌面 RPC、移动端本地缓存与实时补拉

## 决策

V2 以桌面 SQLite 的不可变 `conversation_events_v2` 为事实源。每个会话在当前
`storeEpoch` 内从 1 开始分配连续 `seq`；事件、读模型和
`conversation_sync_effects_v2` 必须在同一个写事务中提交。推送只是提交后的提示，
移动端永远以 `conversation.sync` 的持久化范围为恢复来源。

事件重试通过 `eventId` 或 `(conversationId, sourceEventKey)` 去重。相同身份但内容
不同返回 `idempotency_conflict`，不能覆盖已提交事件。消息的气泡位置使用
`createdSeq + messageId`，正文和状态更新使用 `versionSeq` 与 `contentVersion`。

## 协议版本

当前协议版本为 2，事件 schema 版本和 effect 版本均为 1。未知 effect 不能静默当作
`noop`；移动端应停在该序列并进入错误/不兼容状态。`noop` 只有在服务端明确发出时
才可推进游标。

历史游标是服务端签发的不透明值，绑定 `storeEpoch` 与 `historyRevision`。编辑、删除、
分支和重新生成会递增 `historyRevision`，旧游标返回 `cursor_stale`，客户端重新锚定
历史窗口；这与实时 `appliedSeq` 完全分离。

## 快照和补拉

`conversation.bootstrap` 返回同一读取快照中的 `snapshotSeq`、`historyRevision` 和
消息/执行摘要。客户端安装快照后，从 `snapshotSeq` 补拉到 `head.lastSeq`。收到乱序
effect 时先不推进持久化游标，改从当前 `appliedSeq` 补拉连续范围。effect 应用与游标
更新在移动端 SQLite 同一事务中完成。

## 命令幂等

`conversation.sendMessage` 用 `(principalId, conversationId, clientCommandId)` 做回执
主键，并保存请求哈希和正式 `messageId`。超时重试返回相同结果；复用键提交不同正文
返回 `idempotency_conflict`。接受命令只表示进入 `queued`，不能把它推断为运行已启动或
已完成。

## 迁移与兼容边界

V2 表和 RPC 采用分阶段切换，旧投影链路在迁移窗口内保留为过程/工具详情来源。运行时
旧事件写入现在通过事务内 adapter 同时生成 V2 事件；V1 行和 V2 日志/读模型任一失败都会
整体回滚，旧事件的原地升级则转换成新的不可变 V2 修订事件。非空 V2 数据库不允许通过
简单改写 epoch 复用序列；整体恢复需执行带归档/重建校验的专门迁移。

`conversation.sendMessage` 的接受回执之后由桌面调度到现有运行时；运行中的会话进入持久化
follow-up 队列，桌面启动会扫描未完成的 queued 用户消息并恢复调度。移动端待发命令和附件
在本地 SQLite 中保留，重连后复用原 `clientCommandId`。桌面恢复调度必须从 queued V2
message row 同时恢复正文与全部附件；附件损坏时显式失败，不能丢图后按纯文本执行。

迁移器默认只 dry-run；实际执行前必须停止桌面进程并保留 SQLite 主文件及 WAL/SHM
备份：

```sh
bun --cwd apps/desktop run conversation:v2-migrate -- \
  --db /path/to/eco-coding.sqlite --conversation THREAD_ID
bun --cwd apps/desktop run conversation:v2-migrate -- \
  --db /path/to/eco-coding.sqlite --conversation THREAD_ID --apply
```

脚本不会替调用方制作备份，也不会把迁移失败转成空会话。

## 错误可见性

访问、参数、游标、epoch、范围、幂等、存储、迁移和完整性错误都保留明确的
`conversationCode`。不得以空消息、骨架或“已同步”掩盖失败。

## 验证归属

- `apps/desktop/test/conversation-v2-store.test.ts`：事务、连续序列、去重、游标和命令回执。
- `apps/mobile/test/conversation_v2_sync_engine_test.dart`：bootstrap、连续补拉、乱序缺口和状态切换。
- `apps/desktop/test/thread-run-events.test.ts`：V1/V2 原子回滚、旧事件修订及运行时桥接。
- `scripts/conversation-round/fixtures/conversation-v2/`：双端共享事件与预期结果样本。
