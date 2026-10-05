# Claude SDK 0.3.289 真实对话冒烟记录

验证日期：2026-10-06，macOS arm64。对应升级：[升级与回归记录](claude-sdk-0.3.289-upgrade.md)。

已通过真实联网对话验证工具、审批、运行中追加消息、恢复、规则刷新、历史编辑与分叉、清空后重启及续聊。冒烟期间发现的六组兼容问题已修复，并重新执行回归。

## 测试环境与边界

- 实际链路为 **Claude Code 2.1.289 / Claude Agent SDK 0.3.289 → Eco Gateway → Responses 提供商 → deepseek-flash**。本次使用真实提供商响应；没有把本地协议模拟或 DeepSeek 响应写成 Anthropic 云端 Claude 模型的验证结果。
- 使用 `ECO_DEV_USER_DATA_SUFFIX=ClaudeUpgrade289` 的独立 Eco 测试数据目录，工作区为 `/Users/plus/.eco/projects/home`。没有修改生产 Eco 数据库，报告不包含密钥。
- 桌面操作通过 Shell CDP 9333 执行 `cdp:attach`、`cdp:snap`、`cdp:fill`、`cdp:click`。运行中追加消息及历史编辑使用公开 `window.eco` IPC 提交，并检查真实界面、SDK 历史和 SQLite 状态。
- 规则刷新测试在独立测试配置中先设置尾行 `ECO_289_RULE_A`，再改为 `ECO_289_RULE_B`。测试完成后已恢复原始个性化设置 `{}`。

## 真实对话验收

| 场景 | 验收结果 |
| --- | --- |
| 任务进度工具 | `TaskCreate → TaskGet → TaskList → Bash → TaskUpdate` 五次调用均完成；任务最终为 completed。`TaskGet`、`TaskList` 没有被算成子代理。 |
| Bash 审批 | 真实 Bash 请求进入审批，点击同意后输出 `ECO_289_FINAL_BASH`；一次任务中只执行一次 Bash。 |
| 两条运行中追加消息 | 在 Bash 审批等待阶段连续接受两条 steer，实际最终回复包含 `ECO_289_FINAL_STEER_ONE`、`ECO_289_FINAL_STEER_TWO`，没有重复执行 Bash，也没有提前关闭输入。 |
| SDK 消息 UUID | `tfu_` 转换为裸 UUID；两条追加输入的本地记录与实际 SDK 用户消息对应，工具结果的 user 帧没有占用用户提示的绑定。追加消息可作为真实 SDK fork 点。 |
| 恢复会话 | 后续真实回复正确回忆 Bash 输出和两条追加标记，SDK session ID 保持不变。 |
| system prompt 刷新 | 同一会话先遵守规则 A，更新设置后下一轮遵守规则 B；没有继续使用旧尾行，验证 `snapshot: false`。 |
| 编辑第二条历史 | 在三个普通回合后替换第二条，新回复为 `ECO_289_HISTORY_REWRITE_ONE`；原第二、第三条及其回复被 tombstone，界面中消失，第一条保留。 |
| 分叉后再编辑第一条 | 能解析分叉后当前 SDK 的新 UUID；再次编辑最早消息成功，最终只保留替换后的用户消息及 `ECO_289_HISTORY_REWRITE_TWO` 回复。 |
| 清空后重启 | `/clear` 完成后记录 `resetPending`，关闭并重启桌面应用，再发送新消息成功。回复包含 `ECO_289_CLEAR_OK`、`NO_PRIOR_CONTEXT`，实际 SDK 历史没有清空前的随机暗号。 |
| 清空后再次恢复 | 下一轮使用新会话的 resume，正确回忆 `NO_PRIOR_CONTEXT` 并输出 `ECO_289_POST_CLEAR_RESUME_OK`。最终代码又复测一次清空及恢复，得到 `ECO_289_CLEAR_FINAL_OK`、`ECO_289_RESUME_FINAL_OK`。 |
| 状态事件和正文 | `session_state_changed`、`conversation_reset` 等作为系统诊断保存，既没有覆盖最终回复，也没有显示成“连接失败”或产生假子代理卡。Eco 页面控制台为 0 错误、1 条开发环境 CSP 警告。 |

主要验收线程：

- 工具、追加、恢复和规则刷新：`thr_1791220580150`，原 SDK 会话 `b1e60be3-d46e-4c82-8308-f43535d515d6`。
- 连续历史编辑：`thr_1791223052337`。原会话 `fa529b03-221c-41dc-9fbb-19556df76b12`，编辑第二条后 `fc6c4428-6e42-4a2e-b51b-b252ba86fe7d`，再编辑第一条后 `65ac01ec-c736-422a-b17e-1f07ce47bb9b`。
- 清空与重启：`thr_1791223844897`。第一组清空后会话 `a0efeb68-4225-4707-a1d9-5b004dcdf684`，最终代码复测会话 `ab440b9e-7108-428d-a5b5-a2cbd5c37e48`，均完成真实恢复。

早期失败记录保留在测试数据中，没有修改失败状态来冒充通过。尤其 `thr_1791223052337` 的早期清空后恢复失败仍然保留，清空修复用独立线程重新验收。

## 冒烟发现并修复的问题

1. **SDK 状态帧被当成助手回复或失败提示。** 系统诊断现在具有明确的角色与频道，renderer 将其映射为 diagnostic；根会话 ID 在 init 前出现也不会注册成子代理。
2. **`TaskList` 的旧别名被统计为子代理。** 任务进度工具归入普通工具，只有实际委派调用进入子代理统计。
3. **工具结果误绑定到追加消息。** 工具结果也使用 SDK user 帧；现在排除 `tool_result` 检查点，并从实际 SDK 用户历史绑定本地输入，不依赖到达顺序。
4. **历史编辑漏删原消息和回复。** V2 原生消息使用 canonical message ID 清理；截断边界采用 provider receipt 的 `first_seq`，避免后补 UUID 改变 `version_seq` 后将目标排到后续消息之后。
5. **分叉重新分配 UUID 后继续编辑失败。** 保留不可变的起源绑定，同时解析当前 SDK 会话的 UUID。按位置解析要求完整用户序列逐条一致；数量、文本或 UUID 不一致时明确报错。
6. **`/clear` 后跨进程恢复失败。** 清空只分配新 ID，还没有可恢复记录。现在持久化明确的 `resetPending`，下一轮用 SDK `sessionId` 初始化该 ID，并直接发送新提示。真实消息落盘后再切回 `resume`。读取实际 SDK 历史处理“用户消息落盘但上游失败”的情况；普通找不到会话的错误仍保留失败诊断。启动失败没有 init 时不附加无效累计用量身份，避免额外的 `Invalid SDK session usage identity` 错误。

社区有同类清空与恢复问题：[Claude Code #9352](https://github.com/anthropics/claude-code/issues/9352)、[会话 ID 更新问题 #56766](https://github.com/anthropics/claude-code/issues/56766)。本次具体根因由安装后的 SDK 及 Eco 真实对话复现确认。SDK `sessionId` 与 `resume` 的参数区别以安装的 0.3.289 类型定义为准。

## 实际用量核对

按 run attempt 对比 **SDK 差分结算值** 与 **提供商请求用量之和**，排除不参与收费的 `session_total` 检查点。下表三元组为输入 / 输出 / 缓存读取 token，两端逐项相等。

| 实际回合 | SDK 增量 = 提供商合计 |
| --- | --- |
| 工具和两条追加输入 | 3091 / 653 / 139520 |
| 恢复并回忆标记 | 22995 / 97 / 1152 |
| 规则刷新 | 23130 / 256 / 1152 |
| 清空前普通回合 | 2007 / 180 / 22144 |
| 第一次清空后首轮，已重启桌面 | 2017 / 331 / 22144 |
| 第一次清空后恢复 | 176 / 75 / 23424 |
| 最终代码清空后首轮 | 1973 / 170 / 22144 |
| 最终代码清空后恢复 | 183 / 76 / 23296 |

两次 `/clear` 的模型用量和费用均为零，累计检查点使用新的 reset epoch；重启后不会重新结算清空前历史。SDK 的美元成本使用其模型计价口径，不能直接当成该 Responses 提供商的美元成本；这里核对的是 token 与 Eco 使用提供商价格计算的用量。

前面三轮的账本快照在历史编辑前留存，避免将编辑后的可见历史误当作当时的完整计费证据。验证使用的提供商仍走既有的 Responses 用量解析分支；日志中的 `invalid_message_start_usage` 提示未在此次升级中消除，两端最终 token 核对通过。

## 回归结果

| 验证 | 最终结果 |
| --- | --- |
| Runtime/Desktop 全量，启用 SDK 原生进程测试 | **5774 通过、19 跳过、0 失败**；713 文件，27519 个断言，78.17 秒。 |
| Node SQLite 四个套件 | **76 通过、0 失败**。 |
| TypeScript 类型检查 | 通过。 |
| Desktop 构建 | Renderer、Main、Preload 均通过；有既有的 bundle 体积提示。 |
| Flutter 移动端 | 升级阶段已完成 **670 通过、0 失败**；本轮桌面冒烟修复没有更改移动端，未重复运行。 |

新增回归包括诊断帧在真实 V2 存储与 renderer 的投影、任务工具统计、工具结果检查点、历史晚绑定和截断、分叉 UUID 解析、reset 状态重新打开数据库、启动失败累计用量身份，以及清空后首轮上游失败的状态处理。原生 SDK 测试新增 **clear-only Query 关闭 → 初始化清空 ID → 再次 resume** 的完整跨 Query 路径。

复现命令：

```sh
ECO_CLAUDE_NATIVE_SMOKE=1 bun run test --no-mobile
ECO_CLAUDE_NATIVE_SMOKE=1 bun run test --claude-regression
bun run test --sqlite
bun run typecheck
bun run build

# 独立测试桌面；页面操作仍通过 cdp:attach / cdp:snap
ECO_DEV_USER_DATA_SUFFIX=ClaudeUpgrade289 ECO_RENDERER_PORT=5183 ECO_GATEWAY_PORT=19893 bun run dev
```

## 保留的缺口

- **旧恢复会话或未知分叉没有累计计费基线。** 首次结果只建立基线，UI 明确提示“该轮计费尚未核实”。真实 fork 测试触发了这一提示；没有猜测首轮增量，后续才按差分结算。
- 新权限提示 `defaultToNo`、禁止持久授权和 MCP 来源，以及限流、分离工具、结构化输出省略等条件分支已通过定向回归，但没有声称它们全部在本次联网对话中自然触发。真实 Bash 审批已验证；SDK 内置 MCP 在真实原生进程连接本地协议服务的测试中验证。
- Anthropic 云端模型、远程 MCP、Windows/Linux/macOS x64 未在本轮执行。19 项环境或账户相关测试仍跳过，具体范围见升级记录。
- 末轮 CDP 发送按钮两次等待元素稳定超时，数据库确认没有提交；正常 Enter 操作随后完成验收。当时页面 `document.visibilityState` 为 `hidden`，后台帧节流可能相关，但没有确认超时根因，未改动 SDK 无关的发送按钮代码。
- 独立测试环境仍提示 Cursor 缺少认证；本次结果仅涵盖 Claude Code 链路。
