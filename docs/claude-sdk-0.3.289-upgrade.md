# Claude Agent SDK 0.3.289 升级与回归记录

验证日期：2026-10-06，macOS arm64。

项目的 Claude Agent SDK 从 **0.3.266 升级至 0.3.289**，内嵌 Claude Code 为 **2.1.289**。Runtime、Desktop、四个平台的显式原生依赖版本和 `bun.lock` 已同步。验证时 npm 的 latest 仍为上述版本。

## 兼容改动

| 变化 | Eco 的处理 |
| --- | --- |
| 恢复会话的 `modelUsage`、`total_cost_usd` 累计值 | 持久化会话、重置批次和 SDK 模型对应的累计检查点，按差值结算。累计检查点不进入收费投影；重放、进程重启、模型路由变化不会重复结算。写入失败不推进检查点，累计回退明确报警并暂停该结果的结算。 |
| 已移除的 `TaskOutput` | 删除运行工具集和 UI 能力分组中的旧工具，接入 `TaskGet`。`TaskList`、`TaskGet` 属于任务进度工具，Ask/规划阶段允许只读访问，禁止委派不会额外禁止这些只读工具。 |
| 恢复时的 system prompt 快照 | 使用 `snapshot: false`，让本轮用户规则和编排追加内容重新渲染。 |
| 合批消息与后台结果 | 初始消息及追加消息使用 UUID，以 `user_message_uuid`/`user_message_uuids` 配对；一个合批结果可完成多个输入，后台空结果不能完成用户轮次。Eco 的 `tfu_` 消息 ID 在 SDK 输入边界转换为裸 UUID，非法 ID 明确报错。 |
| stdin 关闭与新会话状态事件 | 开启会话状态事件，等待用户消息、运行状态、审批回调和子代理全部收敛后关闭输入。继续保留 Eco 的追加消息 mailbox。 |
| `conversation_reset` | 捕获新的会话 ID 并重置累计用量批次；支持 reset 先于 init 到达。清空后的 ID 尚无历史时持久化初始化状态，下一轮写入首条消息后才使用 resume，支持清空后重启。 |
| 新权限提示 | 将 `defaultToNo`、`suppressAlwaysAllowRule`、MCP 来源传递至审批请求。桌面端和移动端默认选中拒绝，防止 Enter 批准；禁止持久授权时隐藏相关选项，后端同样拒绝违规持久授权。 |
| 新状态和工具结果 | 透传限流、提示、命令更新、会话状态、启动失败诊断和任务停止原因。分离执行的工具保持运行态；MCP 结构化输出被 SDK 省略时明确展示原因。 |

## 回归结果

| 验证 | 结果 |
| --- | --- |
| Runtime/Desktop 全量 Bun 回归，启用真实 SDK 原生进程测试 | **5774 通过，19 跳过，0 失败**；713 个文件，78.17 秒。包含后续真实对话冒烟发现问题的修复回归。 |
| Flutter 移动端全量测试 | **670 通过，0 失败**。包含新增的权限 JSON 解析和审批组件测试。 |
| Node SQLite 回归 | **76 通过，0 失败**，覆盖四个存储测试套件。 |
| TypeScript 类型检查 | 通过。 |
| Desktop 生产构建 | Renderer、Main、Preload 均通过；仍有既有的产物体积提示。 |
| 桌面 UI / 真实对话 | 独立数据目录，真实提供商 deepseek-flash 经 Claude Code SDK 链路验证工具、审批、两条追加输入、恢复、规则刷新、连续历史编辑和清空后重启；页面控制台 0 错误、1 条开发环境警告。详见[冒烟记录](claude-sdk-0.3.289-live-smoke.md)。 |

新增的 SDK 原生进程回归使用安装后的真实 Claude Code 二进制连接本地 Messages 协议服务，不需要账户密钥。覆盖流式消息结束、Bash 权限回调、PreToolUse hook、SDK 内置 MCP、恢复、分叉、运行中追加消息，以及 `/clear` 后关闭 Query、初始化新会话、再次恢复。实测累计输入用量为 **300 → 400 → 500**。另行完成真实提供商对话，结果及用量核对见[冒烟记录](claude-sdk-0.3.289-live-smoke.md)。

新增计费回归覆盖累计差分、序列化恢复、结果重放、提供商路由变化、多模型、同时间戳乱序、缺基线、会话重置、累计回退、写盘失败重试，以及真实 V2 SQLite 关闭后重新打开。

对应的新用例已加入 `scripts/test.mjs` 的 `--claude-regression` 测试集。

## 复现命令

```sh
# 全量 Runtime/Desktop 测试，包括真实 SDK 原生进程
ECO_CLAUDE_NATIVE_SMOKE=1 bun run test --no-mobile

# Claude 专项及 Node SQLite
ECO_CLAUDE_NATIVE_SMOKE=1 bun run test --claude-regression

# Node SQLite 单独执行
bun run test --sqlite

# 移动端
cd apps/mobile
SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk flutter test

# 在仓库根目录执行
bun run typecheck
bun run build
```

## 尚未验证或仍有缺口的场景

- 升级前的旧会话或缺少对应累计检查点的分叉，首次恢复结果无法区分历史用量和当轮增量。Eco 只记录累计基线，同时向 UI 和日志报告 `sdk_session_usage_baseline_missing`、提示“该轮计费尚未核实”；随后结果可按差分结算。此次没有猜测历史用量或隐藏这一缺口。
- 19 项跳过包括需要环境开关或账户的 Supabase Cloud/本地 Supabase、LongCat 和 Codex 联网测试。真实提供商联网对话已验证 deepseek-flash，经 Claude Code SDK 与 Responses Gateway；Anthropic 云端 Claude 模型未验证。
- Windows、Linux 和 macOS x64 原生二进制没有在对应设备上执行；已更新平台依赖版本，本机只验证 macOS arm64。
- 独立测试环境里的 Cursor 模型查询提示缺少认证，未据此声明 Cursor 联网能力通过。条件权限提示等分支和末轮 CDP 稳定等待超时的验证边界见[冒烟记录](claude-sdk-0.3.289-live-smoke.md)。

## 本机安装问题

本机默认 `MacOSX27.0.sdk` 的 `.tbd` 包含 `arm64e.x1-macos`，现有链接器不识别，导致 Desktop postinstall 的 node-pty 重建失败。本次使用已安装的 SDK 26.5 完成安装，并另行确认 postinstall 的 Rebuild Complete，没有跳过安装脚本或修改系统 SDK：

```sh
SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk bun install
cd apps/desktop
SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk bun run postinstall
```

同类问题见 [Flutter #192609](https://github.com/flutter/flutter/issues/192609) 和 [Dart SDK #64264](https://github.com/dart-lang/sdk/issues/64264)。该环境变量仅针对有这一工具链问题的本机。

## 上游依据

- [SDK 0.3.289 发布记录](https://github.com/anthropics/claude-agent-sdk-typescript/releases/tag/v0.3.289)
- [SDK 0.3.277 累计用量变化](https://github.com/anthropics/claude-agent-sdk-typescript/releases/tag/v0.3.277)
- [Claude Code 2.1.277 工具变化](https://github.com/anthropics/claude-code/releases/tag/v2.1.277)
- [SDK 累计用量社区问题 #469](https://github.com/anthropics/claude-agent-sdk-typescript/issues/469)
