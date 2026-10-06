# Codex 0.160.1 真实对话冒烟记录

验证日期：2026-10-06，macOS arm64。

## 测试环境与边界

- 独立数据目录：`~/Library/Application Support/@eco/desktopCdx160Smoke`，由 dev 数据目录 `sqlite3 .backup` 播种，不影响日常开发数据；启动使用 `ECO_DEV_USER_DATA_SUFFIX=Cdx160Smoke bun run dev`。
- 内核切到 **Codex**，新对话 `thr_1791254983440`；模型覆盖为候选列表里的第三方模型 `deepseek-flash`（极高），经本地网关走 Responses 协议。
- 页面操作走 CDP（9333）：`playwright cli snapshot / find / eval / type / press`。`cli click <ref>` 在稳定等待上会超时，改用 `eval "() => el.click()"`。
- 该对话开了自动审批（替我审批）跑提问链路；测审批时切到 **请求批准**。两处都是线程级覆盖，只存在于这个一次性数据目录。
- 这是 UI 交互验收，不是性能或并发压测；页面控制台 **0 错误、1 条开发环境警告**。

## 真实对话验收

| 验收项 | 做法与结果 |
| --- | --- |
| 问题显示 | 提示模型调用 `request_user_input_async`。订阅流里出现 `agentMessage` 异步项，Feed 显示问题标题与选项，右侧「澄清问题」面板同步显示；轮次**没有**被问题挡住，正常跑完（已处理 9s）并输出 `CDX160_ASYNC_OK`。 |
| 完成后回答 | 轮次结束后问题仍在面板里。点「路线A」→ 答案作为普通消息进入新一轮（续写），模型回复「收到你的选择：路线A」并再次输出标记。 |
| 运行中回答（steer） | 提示先提问再 `sleep 60`。轮次仍在执行时点「运A」：`conversation_followups_v2` 生成 `tfu_05f194aa`，`delivery_mode = streaming_push`、`queued_during_phase = execution`、`source_run_attempt_id = attempt_execution_0_1791255213393_5`，`created_at` 与 `delivered_at` 相差 **1 ms**——即中途注入而非排队。该轮随后输出 `CDX160_STEER_OK`。同一轮里手工发送的后续消息也走同一路径（`tfu_5aa30184`，同为 `streaming_push`）。 |
| 草稿保留 | 轮次运行中在输入框打上 `DRAFT_KEEP_160`。异步问题到达时输入框被澄清面板**替换卸载**；回答后输入框重新挂载，草稿原文仍在（`DRAFT_KEEP_160`），该轮输出 `CDX160_DRAFT_OK`。 |
| 审批接受 | 「请求批准」模式下发 `curl https://example.com`。沙箱内因网络受限失败后弹出审批 dock（同意 / 同意且不再询问 / 拒绝）。点「同意」→ 命令在沙箱外重跑，返回 **200**。 |
| 审批拒绝 | 换 `https://example.org` 再次触发审批，点「拒绝」→ 模型明确回报「在沙箱外重跑该请求的授权被拒绝」，返回 `000`，轮次正常收尾，没有卡死也没有重复请求。 |
| Ask 模式 | 「更多」菜单切到 Ask，模式标签出现在输入区。发只读问题正常跑完并输出 `CDX160_ASK_OK`。 |
| Plan 模式 | 「更多」菜单切到 Plan，模型给出计划并弹出计划审批 dock（忽略 / 执行计划）。点「执行计划」→ 计划落地，`/tmp/eco-cdx160-plan/hello.txt` 生成，15 字节，内容为 `CDX160_PLAN_OK`。 |
| 多问题 | 一个轮次内连续两次提问。Feed 按**到达顺序**同时显示两条问题；面板先显示「多题一？」，答完立即切到「多题二？」，无需手动翻页。 |
| 自由文本 | 「多题二？」用「其他（自定义说明）」提交自由文本「选B2但要注意顺序」，模型正确复述并确认两题答案齐全。 |
| 继续对话 | 由上两条覆盖：完成后回答与 Ask 轮次后继续发送，均正常开启新轮次。 |

## 无丢失、无重复的核对

这次冒烟一共提交 6 次回答，`conversation_messages_v2` 中对应 6 条 `role = user`、`channel = answer` 的行，时间戳与点击一一对应，没有多出也没有缺失：

| 消息 | 问题 | 答案 | 投递方式 |
| --- | --- | --- | --- |
| `message_57601594` | 选择哪条路线？ | 路线A | 轮次已结束 → 续写 |
| `message_3b2f3f03` | 中途选择？ | 中A | 轮次已结束 → 续写 |
| `message_c90a216b` | 运行中选择？ | 运A | 运行中 → `streaming_push`（`tfu_05f194aa`） |
| `message_c3837492` | 草稿测试？ | 草A | 续写 |
| `message_6e04d79a` | 多题一？ | A1 | 续写 |
| `message_da2bfb73` | 多题二？ | 自由文本回答：选B2但要注意顺序 | 续写 |

只有真正落在**运行中轮次**的那次生成了后续队列行（`tfu_05f194aa`，另有同一轮里手工发送的后续消息 `tfu_5aa30184`），其余走普通续写——与 `shouldDeliverAsyncAnswerThroughFollowUpQueue` 的分流一致，不是丢投递。

## 保留的缺口

- 没有做真实的投递故障注入：`unknown` / 排队 / 重复提交分支只有单测覆盖，UI 上没有人为制造现场失败，因此「未确认时界面不显示成功」只在代码与单测层面成立。
- 点击「运A」后 1 ms 内落库并投递的是**入队确认**，不等于模型已经读完；本轮的最终标记 `CDX160_STEER_OK` 证明该轮确实读到了答案。
- 多问题在同一个轮次内是两次独立工具调用，面板是「答完一题出下一题」；单次调用内多问题时面板的上一题/下一题分页本轮没有构造出来。
- 一次 `playwright cli click <ref>` 的稳定等待超时，改用 `eval` 点击后继续，未影响结论。
- 页面上的「正在执行」文案在轮次结束后仍会短暂留存，不能当作“此刻确实在跑”的判据。因此「运行中回答」的结论只采信数据库证据（`delivery_mode = streaming_push` + `queued_during_phase = execution` + 1 ms 投递时间），不用 DOM 文案。

## 审查修复后的复验

同一独立数据目录中，新建 `thr_1791257148671`，使用 Codex 0.160.1 / deepseek-flash，通过 CDP 操作真实界面：

- 连续请求 `FIX160_FIRST`、`FIX160_SECOND`，第二题到达后面板仍显示第一题；提交自由文本 `DRAFT_FIRST_KEEP_160` 后立即切换第二题，提交 C 后模型分别确认两个答案。
- 再次连续请求 `FIX160_DRAFT_A`、`FIX160_DRAFT_B`，提交自由文本 `BEFORE_SECOND_KEEP_160` 和 C，模型确认两题均已回传。其中第一题走 `streaming_push`，对应 `tfu_3c3be732-2971-472e-b561-fef12237006c`，最终状态 `applied`。
- 四次提交对应四条用户回答消息、四条 completed 澄清命令。每条命令结果保存对应 `asyncMessage.messageId`，每条消息均绑定官方 `history_user_message_id`；没有重复接受或重复发送。页面控制台 0 错误、1 条开发环境警告。

这轮 UI 证据覆盖队列首题保留、提交后切题、自由文本回传、运行中投递及官方接收绑定。自由文本在后续问题**到达之前**的填写时间没有被完整记录，不能用模型的复述替代该项证据；该竞态由自动化队列测试覆盖。崩溃恢复与失败重试由 SQLite 文件重开和故障模拟测试覆盖，未对真实应用做强制崩溃或投递故障注入。
