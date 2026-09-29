# Eco MCP Hub 最小探针报告

运行日期：2026-09-28（Asia/Shanghai）

## 结论

最小 Hub 的协议形态可行：共享 HTTP endpoint 只暴露 `search_tools`、`call_tool`，每次请求用 Eco 创建 session 时发放的 bearer 绑定身份。模型传入的 `clientSessionId` 只作为普通参数记录，不参与鉴权。

本轮已用真实的 Claude CLI/SDK、Codex CLI 和 PI AgentSession 跑过确定性本地模型回合。ACP 只验证了一个明确版本的 fake agent；当前环境没有可执行的 Cursor ACP，因此不能把 fake agent 结果推广到 Cursor 或“全部 ACP”。

补充的真实 Codex app-server harness 已通过：Codex Desktop CLI `0.158.0-alpha.2.1` 启动两个独立 `app-server --stdio`，分别使用独立 `CODEX_HOME`、MCP bearer 和本地确定性 Responses API。配置使用 `mcp_servers.eco_mcp.default_tools_approval_mode = "prompt"`，客户端实际收到并接受了 `mcpServer/elicitation/request`（8 次），A/B 并发完成 `search_tools → call_tool`，停止后用原 thread id resume 再次调用，Hub 记录 A=2、B=2，初始 PID 与恢复 PID 均不同。该实验还记录了两进程的启动时间与 RSS；它证明 Codex 审批协议可接通，不等于 Eco Desktop UI 已完成真实用户拒绝回合。

Codex 的结论分两层：

1. 真实 app-server 实验仍证明：同一个 server 名称和共享连接不能按 thread 切换 A/B 凭证。
2. 生产接入已改为为每个 Eco thread 使用带 thread hash 的稳定 Hub server 名称（`eco_mcp_<hash>_<suffix>`），避开进程级连接池的同名复用；若需要彻底隔离 app-server 的其它全局状态，仍应启用每 session 独立 app-server lifecycle。

## 为什么上一版有很多“未验证”

上一版主要验证了 adapter、配置构造和 Hub 本身，没有启动真实 runtime 的模型回合；因此不能从“参数被传进 SDK”推断模型实际会搜索、构造嵌套参数、处理错误或恢复。现在补了三类可复现实验：

- **真实 runtime + 本地确定性模型 API**：不依赖外部账户和模型质量，但实际启动 Claude CLI、Codex CLI、PI AgentSession 和 MCP transport。
- **真实 Hub 权限/生命周期**：撤销、旧 ID、审批、错误结果、图片/结构化结果和取消行为都有计数或日志断言。
- **ACP 明确边界**：fake agent 只证明 Eco ACP driver 的协议传递；Cursor 仍然标为未验证。

“未验证”仍保留在没有证据的地方，尤其是 Codex 同一 app-server 隔离、真实 Cursor、真实 Eco Desktop 审批 UI 的拒绝回合、Codex/Claude/PI runtime 级取消传播和真实 subagent 权限继承。Codex bridge 已有 wrapper 解包单测，真实 app-server 只做了自动接受回合。HTTP MCP 的断连与显式 `notifications/cancelled` 已分别实测：断连不会被错误解释为取消，显式通知会取消对应请求；共享 stdio upstream 的取消通知也已实测。

## 当前生产代码进展

`apps/desktop/src/main/mcp-hub.ts` 已加入 session-aware Hub 核心。它维护服务器目录，按 Eco 签发的 bearer token 绑定 session，提供工具搜索和调用，支持父子 session 权限收窄、父 session 撤销传播和立即撤销工具。`createStreamableHttpHandlers()` 只暴露 `search_tools` 与 `call_tool`，可直接交给现有 Streamable HTTP transport。

这部分已经有单测覆盖目录隔离、稳定工具 ID、伪造参数不影响身份、子 session 权限继承、父 session 撤销和 wrapper 形态。`McpHubGateway` 现在负责把外部 stdio/HTTP 配置适配到 Hub，并按 thread 签发 bearer；Claude、Pi、ACP、Codex 的外部和内置 HTTP MCP 都通过线程级 Hub 代理进入 runtime，内置网关仍保留执行、生命周期和底层审批 authority。Codex 使用每 thread 唯一的 Hub server 名称；descriptor 会登记到 Codex global pool，新增 descriptor 触发受控刷新，线程结束时从登记表移除。

## 版本和运行命令

### 版本来源

| 组件 | 实际版本/来源 |
| --- | --- |
| Eco Desktop | `0.1.0-beta.12`（`apps/desktop/package.json`） |
| Bun | `1.4.0` |
| Bun `process.version` | `v26.3.0` |
| Claude SDK + native CLI | `0.3.266`；取自 `packages/runtime` 和 `apps/desktop` 的匹配链接 |
| 根目录 Node 解析到的 Claude SDK | `0.3.223`；这是并存的旧链接，本轮 Claude 实验没有使用它 |
| Eco package 的 Codex 依赖 | `@openai/codex 0.153.4`（配置/driver 代码依赖） |
| 实际启动的 ChatGPT 内置 Codex CLI | `0.158.0-alpha.2.1` |
| PI | `@earendil-works/pi-coding-agent 0.85.1` |
| PI MCP adapter | `2.23.0` |
| ACP | `fake-acp-agent.mjs v0.1.0`，ACP protocol v1；不是 Cursor |

### 复现命令

```bash
# Hub、direct adapter/wiring、ACP fake agent、独立 worker fallback
bun scripts/mcp-hub-probe/run.ts | tee /tmp/eco-mcp-hub-probe.json

# Claude：真实 CLI/SDK + 本地 Anthropic SSE API
bun scripts/mcp-hub-probe/claude-real-harness.ts dynamic
bun scripts/mcp-hub-probe/claude-real-harness.ts revoked
bun scripts/mcp-hub-probe/claude-real-harness.ts write
bun scripts/mcp-hub-probe/claude-real-harness.ts write-allow
bun scripts/mcp-hub-probe/claude-real-harness.ts write-runtime-deny
bun scripts/mcp-hub-probe/claude-real-harness.ts slow
bun scripts/mcp-hub-probe/claude-isolation-harness.ts

# Codex：真实 app-server + 本地 Responses API（生产隔离验证）
bun scripts/mcp-hub-probe/codex-app-server-real-harness.ts

# Codex：ChatGPT 内置 exec CLI + 本地 Responses API
bun scripts/mcp-hub-probe/codex-real-harness.ts dynamic
bun scripts/mcp-hub-probe/codex-real-harness.ts revoked
bun scripts/mcp-hub-probe/codex-real-harness.ts write
bun scripts/mcp-hub-probe/codex-real-harness.ts write-allow

# PI：真实 AgentSession + pi-mcp-adapter + 本地 Anthropic API
bun scripts/mcp-hub-probe/pi-real-harness.ts

# 已有 MCP/runtime 回归测试
bun test \
  apps/desktop/test/mcp-streamable-http.test.ts \
  apps/desktop/test/shared-mcp-stdio-upstream.test.ts \
  apps/desktop/test/codex-mcp-session-isolation.integration.test.ts \
  apps/desktop/test/mcp-http-multi-session.test.ts \
  packages/runtime/test/pi-mcp.test.ts \
  packages/runtime/test/acp-mcp.test.ts \
  apps/desktop/test/mcp-runtime.test.ts

# 本轮最终相关目录回归（5112 pass, 17 skip, 0 fail）
bun test apps/desktop/test packages/runtime/test
```

真实 runtime harness 使用本地脚本化响应，不调用外部 provider。它们验证的是 runtime 的实际进程、工具循环和 MCP transport；不验证模型在自然语言下的工具选择质量。

## 五项验收矩阵

状态只对同一单元格写明的范围负责：`通过` 是已满足该范围，`失败` 是当前代码违反标准，`未验证` 是没有足够实测证据。

| 验证项 | Hub 探针 | Codex（Eco runtime / 内置 CLI 0.158.0） | Claude SDK/CLI 0.3.266 | PI 0.85.1 + adapter 2.23.0 | ACP fake v0.1.0 |
| --- | --- | --- | --- | --- | --- |
| 1. Session 身份隔离、并发、恢复 | **通过**：A/B 交错 12 次；同 token 重连仍是 A；伪造字段不生效 | **部分通过**：生产 runtime 为每个 thread 使用唯一 Hub server，并把 descriptor 登记到 global pool；真实双 app-server 实验通过并恢复；同 app-server 同名连接切换仍失败 | **通过**：两个真实 CLI 并发，各自 bearer；A 用 `resumeSessionId` 重复调用仍是 A | **通过**：两个真实 AgentSession 并发；A 同 session 重复；销毁后从 JSONL 恢复仍是 A | **通过（仅该 fake agent）**：两个 child 并发，`session/load` 重新传 `mcpServers`；Cursor 未验证 |
| 2. 单入口发现和执行 | **通过**：`tools/list` 只有两个 wrapper；搜索返回 schema；再由 `call_tool` 执行 | **通过（真实独立 app-server 实验）**：Responses namespace 完成 `search_tools → call_tool`；生产接入将外部和内置 MCP 合并为每 thread 一个 Hub endpoint 名称 | **通过**：真实 CLI 从 MCP wrapper 搜索 schema 并构造 nested `call_tool` | **通过**：真实 AgentSession 通过 `mcp` proxy 搜索并调用 | **通过（仅 fake agent）**：完成搜索和调用；Cursor 未验证 |
| 3. 权限变更、旧 ID、子 Agent | **通过**：A/B 不泄露；撤销后旧 ID 拒绝；A-child 随父权限收回 | **部分通过**：真实 CLI 的撤销后旧 `restricted_probe_x` 被拒；真实 Codex subagent 未验证 | **部分通过**：真实 CLI 撤销后旧 ID 被拒；真实 Claude subagent 未验证 | **未验证**：本轮只跑主 session，未跑 PI subagent/撤销回合 | **未验证**：fake agent 没有子 Agent；Cursor 未验证 |
| 4. 审批是否被统一入口绕过 | **通过（Hub 层）**：拒绝无 upstream start/count；允许只执行一次；日志含 `mock_write` 和真实参数 | **部分通过**：真实 app-server 已走 `mcpServer/elicitation/request`；Eco bridge 单测会从 `item/started` 解包真实 server/tool/args，Hub reject/allow 均生效，但真实 Eco Desktop UI 的拒绝回合未跑 | **部分通过**：真实 CLI 的 Hub reject/allow 生效；runtime callback 只看到 `mcp__eco_mcp__call_tool` wrapper，UI 展示 nested tool 未验证 | **未验证**：没有真实 PI approval UI 回合 | **未验证**：没有 Cursor `session/request_permission` 回合 |
| 5. 结果和调用生命周期 | **通过（HTTP/stdio 探针范围）**：text/image/structuredContent/isError 正常；客户端断连不会隐式取消，显式 `notifications/cancelled` 能取消 slow upstream；写操作无自动重试 | **未验证**：真实 CLI 结果/错误可见，但没有做 Codex runtime 取消/超时/断连实验 | **未验证 runtime 取消**：真实 CLI 工具循环和错误结果正常；未把 `result_probe` 的 image/structuredContent 全链路呈现到 UI | **未验证**：未跑 PI prompt abort/断连和多类型结果呈现 | **未验证**：未跑 Cursor 生命周期 |

ACP 这一列只适用于 [`fake-acp-agent.mjs`](/Users/plus/Desktop/workspace/ai/eco-coding/scripts/mcp-hub-probe/fake-acp-agent.mjs)，不能推广到其他 ACP agent。

最近一轮真实 harness 摘要：Claude A/B 并发后 A resume 的 Hub upstream 身份为 `A, B, A`（并发先后顺序不固定）；PI 为 `B, A, A, A`（初次、重复、JSONL 恢复）；真实 Codex app-server 为 `A, B, B, A`（两个独立进程，初次与恢复各一次），审批请求方法为 `mcpServer/elicitation/request`；Codex dynamic 为 `B, A`，revoked 为两个 `restricted_probe_x` rejected，write 为 0 次 upstream，write-allow 为 2 次 upstream。

## 探针和日志

### Hub 探针

[`run.ts`](/Users/plus/Desktop/workspace/ai/eco-coding/scripts/mcp-hub-probe/run.ts) 中：

- `HubState.issue()` 在 Eco 创建 session 时绑定 bearer，日志只保留 SHA-256 前 12 位指纹。
- `echo_context` 服务端返回 `identity`、凭证指纹和 `requestId`；`clientSessionId` 只记录为 ignored。
- `search_tools` 返回上游工具 schema，但 `tools/list` 永远只有 `search_tools`、`call_tool`。
- `restricted_probe_x/y` 测撤销；`mock_write` 先做 Hub approval，再记录 upstream start；拒绝路径没有 upstream start。
- `result_probe` 返回 text、1×1 PNG、`structuredContent` 和 `isError:false`。
- `slow_probe` 的第一轮客户端 abort 只关闭 HTTP 交换，上游正常完成；第二轮通过同一 MCP session 发送 `notifications/cancelled`，上游收到 signal 并停止。输出为 `clientAborted=true`、`upstreamStarted=2`、`upstreamCompleted=1`、`upstreamCancelled=1`。

### 关键脱敏日志

```text
session_bound identity=A tokenFingerprint=<sha256-prefix>
session_bound identity=B tokenFingerprint=<sha256-prefix>
tools_list identity=A
search_tools identity=A query=echo returned=[echo_context]
upstream_call started identity=A tool=echo_context clientSessionId=model-forged
upstream_call started identity=B tool=echo_context clientSessionId=codex-model-forged
permission_revoked identity=A tool=restricted_probe_x
upstream_call rejected identity=A tool=restricted_probe_x
approval_rejected identity=A tool=mock_write
upstream_call completed identity=A tool=mock_write result=ok
```

真实 runtime 观察：

- Claude 的实际工具名为 `mcp__eco_mcp__search_tools`、`mcp__eco_mcp__call_tool`；`write-runtime-deny` 的 runtime callback 收到的是 wrapper 和嵌套参数。
- Codex Responses 请求暴露 namespace `mcp__eco_mcp`，函数调用使用 `namespace: "mcp__eco_mcp"`、`name: "search_tools"/"call_tool"`；真实 CLI 日志为 `mcp: eco_mcp/search_tools (completed)`。
- PI 的实际模型工具列表包含 `mcp`，adapter 内部 wrapper 为 `eco_mcp_call_tool`；Hub 最终按 bearer 识别 A/B。
- ACP fake agent 的 `session/new`、`session/load` 都收到 Eco 传入的 `mcpServers`；该行为没有 Cursor 证据。

## 共享连接与独立连接 fallback

### 共享连接的实测和代码证据

- [`mcp-streamable-http.ts`](/Users/plus/Desktop/workspace/ai/eco-coding/apps/desktop/src/main/mcp-streamable-http.ts) 把 Authorization token 传给 `listTools`/`callTool`；Hub 每次请求都能可信识别 A/B。
- `mcp-streamable-http.ts` 不把传输断连当作 MCP cancellation；只有同一 bearer/session scope 的 `notifications/cancelled` 才触发对应请求的 `AbortSignal`。这符合 Streamable HTTP 的请求取消语义，也避免网络抖动误取消写操作。
- `scripts/mcp-hub-probe/run.ts` 同时覆盖断连和显式取消：前者不取消上游，后者只取消匹配 request id 的上游调用。
- `Mcp-Session-Id` 只由 HTTP initialize 生成和回写，本探针不把它当权限依据；权限来自 Eco session binding bearer。
- [`browser-mcp-router.ts`](/Users/plus/Desktop/workspace/ai/eco-coding/apps/desktop/src/main/browser-mcp-router.ts) 的无 token fallback 是 FIFO/`tool.started` claim，不能作为最高优先级身份证明。
- [`shared-mcp-stdio-upstream.ts`](/Users/plus/Desktop/workspace/ai/eco-coding/apps/desktop/src/main/shared-mcp-stdio-upstream.ts) 共享 child 并串行化 JSON-RPC，但不会自动产生 session 身份。
- [`codex-runtime-run.ts`](/Users/plus/Desktop/workspace/ai/eco-coding/apps/desktop/src/main/codex-runtime-run.ts) 明确使用进程级 MCP pool；这是 Codex shared-runtime 失败的直接代码依据。
- [`browser-mcp-auth.ts`](/Users/plus/Desktop/workspace/ai/eco-coding/apps/desktop/src/main/browser-mcp-auth.ts) 保存 `threadId → bearer token`；这是 Eco 创建 session 时的可信绑定来源。
- [`mcp-runtime.ts`](/Users/plus/Desktop/workspace/ai/eco-coding/apps/desktop/src/main/mcp-runtime.ts) 将 Claude/Codex 的 HTTP header、timeout 和 runtime 配置展开；它不会把动态搜索结果注册成原生 runtime tool。
- [`shared-mcp-stdio-upstream.ts`](/Users/plus/Desktop/workspace/ai/eco-coding/apps/desktop/src/main/shared-mcp-stdio-upstream.ts) 的 `callTool/listTools` 接受 `AbortSignal`；取消 pending JSON-RPC 后发送 MCP `notifications/cancelled`，并从 pending map 移除请求。该行为由 `shared-mcp-stdio-upstream.test.ts` 的 fake stdio child 验证。
- [`pi-mcp-session.ts`](/Users/plus/Desktop/workspace/ai/eco-coding/apps/desktop/src/main/pi-mcp-session.ts) 按 Composer/session 选择过滤 PI 的 MCP map；PI driver 再按 MCP fingerprint 决定是否重建 AgentSession。
- [`acp-runtime-run.ts`](/Users/plus/Desktop/workspace/ai/eco-coding/apps/desktop/src/main/acp-runtime-run.ts) 把 Eco 选择的 MCP map 传给 ACP `session/new` / continuation；具体 child 生命周期在 runtime 的 `acp-agent-driver.ts`。

### 独立连接/进程 fallback

Hub worker fallback 的最新实测：

```text
processCount=2
startupMs: A=25, B=25
```

两个 worker 各自固定身份，无凭证调用仍能正确得到 A/B。worker 重启会丢失内存中的 binding、审批和计数；生产实现需要持久化绑定或在恢复时重新创建 session。真实 Codex CLI fallback 也使用 `concurrentProcesses=2`、每个进程单独 `CODEX_HOME`；一次实测进程存活时间为 A=3440 ms、B=2521 ms（包含 CLI 初始化和本地模型回合），该实验不证明 shared app-server 能隔离。

新增 [`codex-mcp-session-isolation.integration.test.ts`](/Users/plus/Desktop/workspace/ai/eco-coding/apps/desktop/test/codex-mcp-session-isolation.integration.test.ts) 用 fake app-server 可复现地启动两个 `CodexRuntimeLifecycle` 实例：A/B 各自有独立进程、`CODEX_HOME` 和 `config.toml`，MCP `/tools/list` 收到的 Authorization 分别为 A/B；停止后用 A 的同一 home 重启，静态 header 和 `runCount=2` 均恢复。该测试测量的是 Eco lifecycle 的进程/配置隔离边界，不把 fake app-server 当成真实 Codex rollout 恢复证据。

这个 fallback 的资源成本是每个 session 一个 app-server child、一个 stdio client 和一套 Codex home；本测试只断言 PID 独立与可重启，没有给出真实 Codex 的内存/启动基准。重启后能恢复配置和 MCP 身份，真实 thread/rollout 是否可继续仍需在真实 app-server 上单独验证。

PI 的 session 级隔离来自 [`pi-coding-agent-driver.ts`](/Users/plus/Desktop/workspace/ai/eco-coding/packages/runtime/src/pi-coding-agent-driver.ts) 的 MCP fingerprint 重建；ACP 由 [`acp-agent-driver.ts`](/Users/plus/Desktop/workspace/ai/eco-coding/packages/runtime/src/acp-agent-driver.ts) 按 thread 持有 child connection，并在 `session/load` 重传 MCP；Claude 将 session MCP map 放入每次 SDK query。

## 已知缺口

1. Codex 同一 app-server/global pool 对同名 server 按 session 换凭证仍失败；生产路径已使用带 thread hash 的唯一 server 名称，global pool 只登记 Hub descriptor，并在新增或回收 descriptor 时触发受控刷新，但本轮没有用真实 Eco Desktop 回合验证“活动线程存在时新增 thread 等待刷新后继续”的完整链路。每 session 独立 app-server lifecycle 尚未成为默认调度策略。
2. Codex bridge 已能在有 `item/started` 证据时把 Hub wrapper 审批解包成真实上游工具和参数；Codex app-server 在协议层可能省略调用身份，缺少 started 事件时仍只能显示 wrapper。真实 Eco Desktop UI 的拒绝回合和并发审批仍未验证。
3. 四个 runtime 的内置 `eco_*` 都已通过线程级 HTTP proxy 进入 Hub；Hub wrapper 的嵌套权限处理覆盖 Claude/Pi，Codex bridge 有解包单测，ACP 的真实 nested approval UI 仍未完成验证。
4. HTTP handler 和共享 stdio upstream 已支持 `AbortSignal`/`notifications/cancelled`，但各 runtime 的取消入口仍未全部接通：Codex/Claude/PI 的 MCP client 是否在用户停止时断开 HTTP，以及外部 MCP 是否真正执行 cancellation，仍未验证；浏览器 CDP、已开始的本地文件写入、图像生成或 HTML 发布等不可取消阶段只能在阶段边界检查 signal，不能回滚已经产生的副作用。
5. 没有 Cursor ACP 可执行版本，因此 ACP 的真实 agent、审批、撤销和取消仍是未验证。
6. `McpHubGateway` 当前实例化的核心 Hub 没有注入生产级 `authorizeCall` 回调；通用外部 MCP 的审批仍依赖各 runtime 的原生/线程权限路径，Hub 层的审批拒绝证据只覆盖最小探针和单元测试。若产品要求所有外部 MCP 都由 Eco 统一弹窗审批，需要继续接入持久化 approval bridge，再把 wrapper 的嵌套工具映射到该 bridge。

## 基线测试

本轮 `bun test apps/desktop/test packages/runtime/test` 全量相关回归为 `5112 pass, 17 skip, 0 fail`（5129 项、634 个文件）；另有桌面 `tsc --noEmit`、`build:main` 和 `git diff --check` 通过。真实 Codex app-server、Claude isolation、PI real harness 和最小 Hub 探针均在本轮重新执行并通过各自声明的范围；这些结果不替代真实 Cursor ACP、Eco Desktop UI 拒绝回合和 runtime 取消 UI 的验证。

本轮没有把全仓库 `tsc` 作为通过标准；定向类型扫描还会触及仓库已有的 `model-router` / `runtime` 类型错误。新增 harness 均由 Bun 实际执行通过。
