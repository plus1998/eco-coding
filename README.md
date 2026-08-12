<div align="center">
  <img src="apps/desktop/public/splash-icon.png" width="112" alt="Eco Coding Logo" />
  <h1>Eco Coding</h1>
  <p>Eco Coding 是一个基于顶尖 Agent Harness 的开源桌面 AI 编程工作台<br/>致力于以更低成本编排不同模型，提供更开放、更自由的开发体验。</p>
  <p>
    <strong>简体中文</strong> · <a href="README.en.md">English</a>
  </p>
  <p>
    <a href="https://github.com/plus1998/eco-coding/releases"><img alt="GitHub Release" src="https://img.shields.io/github/v/release/plus1998/eco-coding?include_prereleases&style=flat-square" /></a>
    <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-16a34a?style=flat-square" /></a>
    <img alt="Platforms" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-2563eb?style=flat-square" />
    <img alt="Status" src="https://img.shields.io/badge/status-beta-f59e0b?style=flat-square" />
  </p>
</div>



Eco Coding 是一个开源的多代理编程工作台。它不重新发明 Agent 内核，而是在 Codex、Claude Code 与 PI（earendil-works）之上提供可配置的模型路由、子代理编排、上下文治理、成本观测和跨设备协同。

> 当前处于 Beta 阶段。桌面端免费且已提供下载；移动端和 Center Server 已在仓库中开发，但移动端尚未公开发布。

![Eco Coding 深色主题产品全景：项目边栏、任务会话与 Agent 工作区](docs/assets/eco-product-overview-dark.jpg)

<p align="center"><sub>可见每个会话独立配置子代理、集成工具、Skills和MCP</sub></p>

## 为什么是 Eco Coding

Eco Coding 的核心价值，是把不同模型服务商和上游协议聚合到同一个可配置工作台里。你可以随心选择喜爱、低成本的供应商接入，也可以获得等同或接近 Codex 的体验；为主代理、子代理、视觉模型和其他能力分别选择服务商、模型与协议，获得更开放、更自由的开发体验。你可以随意组合 GPT、Claude、DeepSeek、Kimi，即便它们来自不同协议——`/messages`、`/responses`、`/chat/completions`。

你可以为每一个项目，甚至每一个会话，单独配置 MCP、Skills 或集成工具，避免全局注入不相关的上下文。还可以通过 Eco Coding 关注花了多少美元、缓存命中率是多少，以及缓存是否被破坏。

除此之外，Eco Coding 对 Windows 10 和 Linux Desktop 支持良好。你还能获得不限能力的 Mobile 互联：无需订阅、无需付费、无需账号，可将 Server 放心托管在自己的服务器上。

即便你还不信任小模型能力，仍然可以使用单模型；Eco Coding 更开放、更自由的能力依然很值得你尝试。

## 面向未来的编排模式

子代理 / 多代理机制本身解决的是复杂任务的分工问题。单个高能力模型可以完成复杂任务，但长时间承担搜索、实现、测试和审查，会让上下文变得嘈杂，也会让每个步骤都按最高模型单价计费。主代理可以继续直接面对用户，理解目标、作出调度并统一验收；具体工作则交给更快、更经济或本地运行的模型。子代理的价值在于独立的任务上下文、并行处理相互独立的工作，并让不同成本和能力等级的模型各司其职。

这是 Eco Coding 的核心理念。几乎每家大模型公司都在推出自己的大小模型，这也完美贴合这一趋势。例如 DeepSeek Flash 的快速与超低价、OpenCode 2 的重构理念，以及最近 GPT Luna 资费下降约 80%，都让人感到这股热浪。这一想法在几个月前已经形成，随后又见证大模型的每一步发展都在朝这个方向演进，这也促使 Eco Coding 提前推出并开源。

![Eco Coding 深色主题编排示意：主代理规划与验收，Explore、Coder、Tester 并行执行](docs/assets/eco-orchestration-future-dark.jpg)

<p align="center"><sub>主代理规划与验收，执行角色并行、独立上下文，按模型能力分层计费。</sub></p>

### 一种可复用的配置

在 Eco Coding 中，可以把 `gpt-5.6-sol` 作为主代理或规划者，负责理解需求、拆分任务、决定是否委派并统一验收；把 `gpt-5.6-luna` 配合 `max` reasoning effort 分给 Explore、Coder、Tester 等执行角色。这是一种经过实际测试可用的工作方式。长任务中实际资费降低 60%–80%。

并配上自定义提示词：

```
(等待补充)
```

### 直观的价格差异

| 路由示例 | 输入单价 | 输入价差 | 输出单价 | 输出价差 |
| --- | ---: | ---: | ---: | ---: |
| `gpt-5.6-sol` vs `gpt-5.6-luna` | `$5.00` vs `$0.20` | Sol 约 `25 倍` | `$30.00` vs `$1.20` | Sol 约 `25 倍` |
| `Claude Opus 4.8` vs `DeepSeek V4 Flash` | `$5.00` vs `$0.14` | Claude 约 `35.7 倍` | `$25.00` vs `$0.28` | Claude 约 `89.3 倍` |

### Eco Coding 在其中做什么

Eco Coding 把“模型聚合”和“任务分工”连接起来：主代理可以使用高能力模型保持目标和验收标准，Explore、Coder、Tester 等子代理可以按角色切换到更便宜、低延迟或本地模型；不同角色也可以来自不同服务商。Eco Coding 统一处理路由、协议、reasoning effort、上下文隔离、工具权限、MCP、Skills、费用和缓存观测，让用户能看到每个模型为什么被使用、花了多少钱，以及是否值得继续这样编排。

它不替用户规定“永远用哪个模型”或“必须开多少个代理”。它提供的是一层可组合的调度与观测能力：同一任务可以选择单代理或并行子代理。

## 特点与优势

### 1. 跨供应商的 Agent Team 编排

- 同一套 Agent Team 中，主代理和每个子代理都可以独立绑定服务商、模型、协议、工具权限、MCP 和 Skills。
- 主代理始终直接面对用户，维护目标、决策和验收标准。
- 内置 Explore、Architect、Coder、Reviewer、Tester 模板，也可以创建自己的角色。
- 支持并行子任务、任务状态跟踪、变更审查和窄范围验证。
- 子代理不会继续嵌套，调度边界清晰，避免失控扩张。

![Eco Coding 深色主题 Agent Team 配置：Explore、Coder、Tester 使用 MyCodex Luna](docs/assets/eco-agent-team-dark.jpg)

<p align="center"><sub>Agent Team 可独立配置角色、模型和启用状态。图中三个子代理均使用 MyCodex 的 gpt-5.6-luna。</sub></p>

### 2. Codex、Claude Code 与 PI 三 Agent Core

每个会话都可以选择 Codex、Claude Code 或 PI 作为 Agent Core。Codex / Claude 尽量保留各自官方运行方式与工具语义；**PI（v1）** 使用 `@earendil-works/pi-coding-agent` 进程内 SDK，经 Eco Gateway 调用模型，按会话注入 Skills，**不**接 Eco 子代理 / MCP / 审批。你可以在同一个项目中同时开跑不同内核的会话。

### 3. 会话级上下文与能力边界

- 项目、会话和 Worker 相互隔离，运行配置会固化到会话快照。
- MCP、Skills、内置浏览器和图片创建能力可按会话开启。
- 自动发现项目级 `.claude/skills`、`.agents/skills`、`.codex/skills`。
- 支持 Agent、Plan、Ask 三种显式会话模式。
- 跨供应商上下文压缩保留近期真实对话，并生成可继续执行的交接摘要。

### 4. 多供应商、多协议模型网关

内置网关可以把 Agent Core 与不同上游协议连接起来：

- OpenAI Responses
- Anthropic Messages
- OpenAI Chat Completions
- 自定义兼容服务与本地模型，例如 llama.cpp 暴露的 OpenAI 兼容接口

主代理与每个子代理都能使用不同路由，因此同一套编排可以同时组合云模型、本地模型和中转服务。

### 5. 独立视觉模型与开放集成

- 为视觉任务单独指定模型，不占用主代理模型。
- 接入 OpenAI 兼容或自定义图片生成 API，并通过会话工具调用。
- 配置云端 ASR，移动端录音后由已连接的桌面端完成识别请求。

### 6. 看得见的费用与缓存

- 配置或解析模型价格，按会话、Agent、模型和事件查看成本。
- 展示输入、输出、缓存读取、缓存写入和缓存命中率。
- 对比实际编排费用与按主模型单价计算的未编排估算。
- 会话闲置超过 30 分钟时提示潜在缓存失效风险。
- 检测无法由新增输入解释的显著缓存读取下降，并记录 cache-break 异常事件。

缓存异常只能说明请求前缀或上游缓存行为发生变化，不能单凭一次告警判断具体服务商存在问题。Eco 提供证据，判断权留给用户。

![Eco Coding 深色主题费用与缓存面板](docs/assets/eco-cost-cache-dark.jpg)

<p align="center"><sub>一次真实只读发布核验：Sol 主代理与三个 Luna 子代理合计 $0.4875，缓存命中率 86%；按全部 Token 使用主模型单价计算的未编排估算为 $2.0864。差额 $1.5989（76.6%）只代表本次单任务估算，不代表通用节省比例。</sub></p>

### 7. 桌面、服务端与移动端全部开源

- Electron + React 桌面端：主要工作入口，本地执行 Agent 任务。
- Bun Center Server：负责设备、配对、在线状态和 RPC 路由。
- Flutter 移动端：远程查看会话、继续对话、处理审批、发送图片与语音输入。
- 全仓库使用 MIT License。

## 功能概览

| 领域 | 能力 |
| --- | --- |
| Agent Core | Codex、Claude Code、PI；每个会话独立选择（PI v1 无 MCP/子代理/审批；Skills 由 Eco 按会话注入） |
| 编排 | 自定义主代理、提示词、子代理 roster、模型和工具策略 |
| 模型路由 | 多服务商、多模型、Responses / Messages / Chat Completions 上游 |
| 会话模式 | Agent、Plan、Ask |
| 上下文 | 占用率、分段统计、自动压缩、交接恢复、文件检查点 |
| 成本 | Token、费用、缓存读写、命中率、模型/Agent/事件明细 |
| 扩展 | MCP、Skills、内置浏览器、图片创建、视觉模型、ASR |
| 工程工作流 | Git diff、检查点回退、Worktree、终端、代码审查 |
| 移动协同 | 设备配对、远程会话、审批、图片附件、语音输入 |

## 支持平台

| 平台 | 架构 | 发布产物 | 更新方式 |
| --- | --- | --- | --- |
| macOS | Apple Silicon、Intel | DMG / ZIP | 当前未签名 Beta 使用手动下载 |
| Windows 10/11 | x64 | NSIS 安装器 | 支持应用内更新 |
| Linux | x64 | AppImage | 支持应用内更新 |

## 快速开始

### 下载桌面端

前往 [GitHub Releases](https://github.com/plus1998/eco-coding/releases) 下载与你系统匹配的安装包。当前 macOS Beta 尚未签名；首次打开方式和各平台注意事项见[使用指南](docs/USER_GUIDE.md)。

### 从源码运行

建议使用当前 CI 已验证的 Bun `1.3.14`、Node.js `22.14.0`，并安装与当前平台匹配的原生构建工具。

```bash
git clone https://github.com/plus1998/eco-coding.git
cd eco-coding
bun install
bun run dev
```

首次启动后，在“设置 -> 模型服务商”中添加 API 地址、密钥和候选模型，再创建或选择一套运行配置。

## 文档

- [使用指南](docs/USER_GUIDE.md)：安装、模型配置、Agent Team、MCP、Skills、移动端与常见问题
- [技术文档](docs/TECHNICAL.md)：架构、运行时、协议网关、上下文、计费、存储和发布机制

## 仓库结构

```text
apps/
  desktop/                    Electron + React 桌面端
  gateway/                    多协议模型网关
  server/                     Center Server
  mobile/                     Flutter 移动端
packages/
  runtime/                    Agent Core、上下文与编排运行时
  shared/                     跨端协议和共享类型
  openai-anthropic-bridge/    OpenAI / Anthropic 协议转换
  model-router/               模型路由
  workspace/                  工作区与 Worktree 工作流
```

## 项目状态

Eco Coding 正在快速迭代。Beta 版本适合体验、反馈和参与开发。

当前优先事项：

- 完成 macOS 签名与公证
- 建立可复现的多代理质量与费用基准
- 完善移动端发布流程
- 补充贡献指南、安全策略和端到端测试

## 开源协议

Eco Coding 基于 [MIT License](LICENSE) 开源。项目名称、Logo 和官方发行渠道不因 MIT 代码授权而自动获得商标授权。
