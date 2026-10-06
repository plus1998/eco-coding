# Codex 0.160.1 升级、接入与回归记录

验证日期：2026-10-06，macOS arm64。

Codex 内核从 **0.153.4 升级至 0.160.1**：`@openai/codex` 与六个平台包（darwin-arm64/x64、linux-arm64/x64、win32-arm64/x64）全部改为 `0.160.1`，`bun.lock` 同步；验证时 npm 的 `latest` 仍是 `0.160.1`。

本轮同时核对并修正异步提问接入：官方 `request_user_input_async` 使用 `agentMessage` 线程项，不是 JSON-RPC server request。这不是从 0.160 才出现的能力。Eco 将这条链路接进既有澄清 UI，并移除不存在的 `item/tool/requestUserInputAsync` 集成，以及 `turn/steer` 缺少 `turnId` 时按预期值视为成功的回退。

## 兼容改动

| 变化 | Eco 的处理 |
| --- | --- |
| 依赖固定 | `apps/desktop/package.json` 中主包与六个平台包统一 `0.160.1`；`packages/runtime` 新增 `./codex-version` 导出，供测试与探针读取 pin 值，避免版本断言再写死字符串。 |
| 异步提问的真实载体 | 0.160 的 `request_user_input_async` 不注册任何 server-request 方法，而是发一条 `agentMessage` 项：`id` = 工具调用 id，带 `delivery: "async"`、`phase: FinalAnswer`、`questions: [{title, options}]`。`codex-event-adapter` 新增 `onAsyncQuestions`，在 `item/started` 与 `item/completed` 都能识别该形态，线程归属未就绪时先按 Codex thread id 缓冲，`flushPendingEventsForThread` 时再补发。 |
| 映射到既有澄清 UI | `apps/desktop/src/shared/codex-async-questions.ts` 把 `title` 直接作为问题正文（官方要求标题自带上下文），`options` 作为建议选项且 `allowCustom` 恒为 `true`——上游对每个异步问题都允许自由文本。多问题按到达顺序排队，答完一个立刻展示下一个。 |
| 去重 | `codexAsyncQuestionDedupeKey` = 线程 + 轮次 + 消息 id。`item/started`/`item/completed` 是同一个项，恢复线程还会重放，同一消息不会重复弹面板。 |
| 删除伪造的协议 | 移除 `CODEX_TOOL_REQUEST_USER_INPUT_ASYNC`、`injectAsyncClarificationAnswers` 与配套的假协议测试。同步提问继续走官方 `item/tool/requestUserInput` RPC；`isBlocking` 只作为“是否阻塞轮次”的提示，不改变“这个 RPC 必须回答”。不再有任何按超时伪造用户回答的路径。 |
| 答案投递 | 回答先落库（`conversation_messages_v2`，`channel = "answer"`），再按线程状态分流：运行中 / 排队中 / `awaiting_plan` / 队列暂停 → 进既有后续队列并以 `steer` 送达活动轮次；已结束 → 普通续写新轮次。回复信封为 `<send_user_message_question_reply>[{questionItemId, question, answer}]</send_user_message_question_reply>`，`questionItemId` 按上游 `["request_user_input_async", <item id>, <index>]` 逐字节构造。 |
| 投递结果 | `ClarificationSubmitResult.delivery` 新增 `delivered` / `queued` / `unknown`。`unknown` 时 UI 保留答案与错误、**不显示成功**、不自动重发；重复提交复用同一幂等命令（`async-clarification:<clientCommandId>`），重新核对同一消息的真实状态。已失败消息不会因重试变成成功，也不会自动重发。正常完成时未回答的问题保留在面板中。 |
| `turn/steer` 校验 | 响应必须携带与期望一致的 `turnId`。空、缺失或不一致一律抛 `CodexTurnSteerFailed`（`deliveryUnknown = true`），删除“回退到期望 id 并视为成功”的行为。 |
| 模型目录与推理档位 | 目录解析继续透传 `model/list` 的模型与 `supportedReasoningEfforts`，并新增一份真实 0.160.1 抓包 fixture（8 个可见模型，含新的 `ultra` 档）作为回归基线；用户显式选择的模型与档位保持，模型不在候选列表时继续提示重新选择。 |
| 版本断言 | 0.160 的 `initialize` 握手不再回显 `codex-cli <version>`，改为 `<clientName>/<serverVersion> (<os>; <arch>) <lib> (<clientName>; <clientVersion>)`。新增 `parseCodexAppServerUserAgentVersion`，集成测试同时校验二进制 `--version` 与握手里的服务端版本是否等于 `package.json` 的 pin。 |

## 回归结果

| 验证 | 结果 |
| --- | --- |
| Runtime / Desktop 全量 Bun 回归（含真实 Codex App Server 门控用例） | 最新默认并发运行：**5832 通过，18 跳过，3 失败**；719 个文件，290.16 秒。三个失败均为历史迁移 CLI 用例超过 10 秒，伴随超时终止后的两条未处理断言错误。不能将本次全量标为通过。 |
| 全量失败项单独复验 | 同样的三个迁移 CLI 用例，保留原超时阈值：**3 通过、0 失败**，21.93 秒。未修改迁移实现，也未放宽测试超时。 |
| Codex 与审查修复专项（17 个文件，含真实 App Server 集成） | **167 通过，0 失败**；618 条断言，11.01 秒。 |
| 真实 App Server 集成（`ECO_CODEX_REAL_APP_SERVER_TEST=1`） | **2 通过，0 失败**：严格配置冷启动恢复、`systemError` 线程续跑、本地 Responses 网关、分叉后恢复；握手版本与 pin 一致。 |
| TypeScript 类型检查 | 通过。 |
| Desktop 生产构建 | Renderer、Main、Preload 均通过（既有产物体积提示不变）。 |
| 打包资源版本 | `asarUnpack: **/node_modules/@openai/**` 解出的真实二进制 `codex-cli 0.160.1`；dev 启动时 app-server 进程确实来自 `@openai+codex@0.160.1-darwin-arm64` 的 vendor 路径。 |
| MCP Hub 探针 | Hub 侧 pass；Codex 侧仍是既有缺口（见下）。探针自报 `codexDependency = 0.160.1`、`codexCliHarness = 0.160.1`。 |
| 桌面 UI / 真实对话 | 独立数据目录 + CDP 驱动，真实第三方模型 deepseek-flash 经本地网关完成提问、投递、审批、Ask / Plan 等交互验收；审查修复后再次核对队列、自由文本、运行中投递与官方消息绑定，页面控制台 0 错误。详见[冒烟记录](codex-0.160.1-live-smoke.md)。 |

18 个跳过项是需要环境开关或外部账户的 Supabase、Claude 原生 SDK 联网测试和 LONGCAT 冒烟。本次使用 `--no-mobile`，没有执行 Flutter 测试。跨平台未验收。

## 代码审查后的修复

- **失败续写不再误报送达**：调度器返回实际投递状态；失败、取消、删除和消息缺失均返回 `unknown`。Codex 用户消息必须有官方 `userMessageId` 才确认送达，单纯本地 `final` 不算接收确认；新调度但尚未收到确认的消息返回 `queued`。
- **回答先持久化，再完成提交命令**：在命令请求中保存官方回复信封，在命令结果中保存接受的消息标识。重启时恢复 accepted / running 命令的消息接受步骤，再由既有队列恢复流程调度；同一命令始终复用同一消息，不依赖内存问题映射，也不重放状态未知的 RPC / steer。
- **连续提问保留当前面板和草稿**：收到新题后读取后端队列首题，相同 `toolUseId` 保持现有组件；提交后读取下一题，丢弃过时的异步快照，防止覆盖新题。
- **真实握手版本解析**：支持 `Codex Desktop/0.160.1 (...)` 这类客户端名含空格的 User-Agent；真实恢复测试不再提前失败。
- **代理测试隔离**：真实代理集成测试改用 Codex 账号代理配置，避免修改 Bun 测试进程的代理环境。修复前按“代理测试 → 共享 MCP 测试”顺序稳定复现 `ConnectionRefused`，修复后相同顺序 10 项通过。保留代理读取与代理请求数断言，确认本地网关请求没有走代理。

针对性修复回归：5 个文件 **28 通过、0 失败**，涵盖真实 SQLite 文件关闭重开、三个崩溃边界、已失败消息重试、无内存映射的幂等投递、队列顺序与快照竞态。类型检查与 Renderer / Main / Preload 构建通过。真实界面及落库证据见[冒烟记录](codex-0.160.1-live-smoke.md)。

本次全量仍有执行稳定性缺口：三个迁移 CLI 测试在默认并发运行中分别于 10.14、10.07、10.05 秒超时，单独复验分别耗时 5.41、5.62、8.50 秒并通过。测试时观察到宿主有多个高 CPU 进程，因此资源争用可能参与其中，但没有证明根因；不能据此将全量失败归零。

## 复现命令

```sh
# 全量 Runtime/Desktop 测试，含真实 Codex App Server 门控用例
ECO_CODEX_REAL_APP_SERVER_TEST=1 bun run test --no-mobile

# Codex 专项
bun test packages/runtime/test/codex-version.test.ts \
  packages/runtime/test/codex-model-list.test.ts \
  packages/runtime/test/codex-event-adapter.test.ts \
  packages/runtime/test/codex-turn-steer.test.ts \
  apps/desktop/test/codex-async-questions.test.ts \
  apps/desktop/test/codex-async-question-bridge.test.ts \
  apps/desktop/test/clarification-bridge.test.ts \
  apps/desktop/test/codex-approval-bridge-clarification.test.ts \
  apps/desktop/test/conversation-interaction-command.test.ts \
  apps/desktop/test/thread-run-cleanup.test.ts

# 真实 App Server 集成
ECO_CODEX_REAL_APP_SERVER_TEST=1 bun test \
  packages/runtime/test/codex-thread-resume.integration.test.ts \
  apps/desktop/test/codex-loopback-proxy.integration.test.ts

# MCP Hub 探针
bun run scripts/mcp-hub-probe/run.ts

# 在仓库根目录执行
bun run typecheck
cd apps/desktop && bun run build
```

## 尚未验证或仍有缺口的场景

- **Codex 的 MCP 多身份隔离仍未通过**，与 0.160.1 无关：Codex 的 MCP 是进程级 global pool，`config.toml` 里的 HTTP header 是静态的，thread config 只能裁剪工具可见性，无法把 A 的连接绑定成 B。探针输出 `identity B` 的静态 header 被解析为 A。这是既有缺口，本轮没有修改也没有掩盖；Hub 侧并发取消、无 token 拒绝与顺序认领负控件均通过。
- **跨平台未执行**：Windows、Linux 与 macOS x64 的原生二进制没有在对应设备上跑过；只更新了平台依赖版本，本机仅验证 macOS arm64。
- **默认并发全量仍有三个迁移 CLI 超时**：单跑通过，原因尚未确定；见上面的全量结果。本轮未改测试阈值来掩盖问题。
- **打包只做了 build，没有重新 pack/签名**：本轮验证的是 `asarUnpack` 解析出的平台二进制版本，`release/` 下的历史产物早于本次改动，未作为证据。
- **`ultra` 档位只做透传，没有进入 Eco 的 `ThinkingEffort` 联合类型**：目录与目录同步会把 `ultra` 原样传给 Codex，但 Eco 自己的档位枚举未新增该值（没有证据表明 UI 需要它，扩大联合类型会波及 Claude SDK 路径）。
- **未知投递状态没有做真实故障注入**：`unknown` 分支覆盖在单测内，本轮没有人为制造现场失败。
- 未验证：提供商路由配置、Cursor 链路，以及本轮明确缓期的中途打断开关、历史分页、MCP 交互界面与线程附件。

## 上游依据

- `@openai/codex` 0.160.1（npm `latest`，仓库 <https://github.com/openai/codex>）
  - `codex-rs/core/src/tools/spec_plan.rs`：`request_user_input_async` 仅在 `model_info.experimental_supported_tools` 含 `request_user_input_async` 或 `send_user_message_async` 时注册，暴露面为 `DirectModelOnly`。
  - `codex-rs/tui/src/bottom_pane/async_questions/state.rs`：`questionItemId` 的 `["request_user_input_async", <item id>, <index>]` 构造与比对。
  - `codex-rs/tui/src/async_question_reply.rs`：`<send_user_message_question_reply>` 回复信封解析。
