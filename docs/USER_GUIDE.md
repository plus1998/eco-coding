# Eco Coding 使用指南

**简体中文** · [English](USER_GUIDE.en.md) · [返回 README](../README.md) · [技术文档](TECHNICAL.md)

本指南适用于当前 Beta。界面名称可能随迭代调整，但配置顺序和关键概念保持一致。

## 1. 安装桌面端

从 [GitHub Releases](https://github.com/plus1998/eco-coding/releases) 下载对应平台产物：

| 平台 | 文件 |
| --- | --- |
| macOS Apple Silicon | `Eco-Coding-*-mac-arm64.dmg` |
| macOS Intel | `Eco-Coding-*-mac-x64.dmg` |
| Windows 10/11 x64 | `Eco-Coding-*-win-x64.exe` |
| Linux x64 | `Eco-Coding-*-linux-x64.AppImage` |

### macOS Beta

当前 Beta 未签名和公证。macOS 可能阻止首次打开：

1. 将 Eco Coding 拖入“应用程序”。
2. 在 Finder 中按住 Control 点击应用，选择“打开”。
3. 再次确认“打开”。

不要关闭系统安全机制或执行来源不明的 `xattr` 命令。正式分发前项目会补充 Developer ID 签名和公证。

### Windows

运行 NSIS 安装器，可选择安装目录。若 SmartScreen 提示未知发布者，请先核对下载来源和 Release 中的 `SHA256SUMS`。当前安装器尚未提供商业代码签名。

### Linux

```bash
chmod +x Eco-Coding-*-linux-x64.AppImage
./Eco-Coding-*-linux-x64.AppImage
```

部分发行版需要安装 FUSE。若无法挂载，可参考 [AppImage FUSE 文档](https://github.com/AppImage/AppImageKit/wiki/FUSE)。

## 2. 第一次启动

推荐按以下顺序完成设置：

1. 添加一个本地项目目录。
2. 在“设置 -> 模型服务商”添加 Provider。
3. 为 Provider 添加至少一个候选模型并运行连通性测试。
4. 在“设置 -> 运行配置”创建主代理配置、可选提示词和子代理编排。
5. 选择新会话默认使用 Codex、Claude Code 或 PI。
6. 回到项目，新建会话并选择 Agent / Plan / Ask 模式。

API Key 会通过系统安全存储保存。系统安全存储不可用时，Eco 会明确提示，而不会假装密钥已安全保存。

## 3. 配置模型服务商

进入“设置 -> 模型服务商 -> 添加模型服务商”。

### 必填信息

- 名称：用于界面识别。
- Base URL：服务根地址。
- API Key：供应商密钥。
- API 兼容模式：Anthropic Messages、OpenAI Responses 或 OpenAI Chat Completions。
- 候选模型：真实上游 Model ID。

### Base URL 与协议

| 上游类型 | API 兼容模式 | Base URL 示例 |
| --- | --- | --- |
| Anthropic 或 Messages 兼容服务 | Anthropic Messages | `https://api.anthropic.com` |
| OpenAI Responses | OpenAI Responses | `https://api.openai.com` |
| DeepSeek/Kimi/本地 OpenAI 兼容服务 | OpenAI Chat Completions | 服务商给出的 API 根地址 |
| llama.cpp | OpenAI Chat Completions | 例如 `http://127.0.0.1:8080` |

不要把 `/v1/messages`、`/v1/responses` 或 `/v1/chat/completions` 完整端点重复写进 Base URL。若服务商要求额外前缀，使用 Provider 的 request path 设置。

保存后选择一个候选模型执行“连通性测试”。测试通过只说明当前地址、协议、密钥和模型可以完成测试请求，不代表该模型支持所有工具、视觉或长上下文能力。

## 4. 选择 Agent Core

Eco Coding 支持三种 Core：

- **Codex**：使用 OpenAI Codex runtime。
- **Claude Code**：使用 Claude Agent SDK / Claude Code runtime。
- **PI**：使用 [earendil-works/pi](https://github.com/earendil-works/pi) 的 coding-agent（`@earendil-works/pi-coding-agent`）。支持 Agent / Plan / Ask；内置 read/write/edit/bash（Ask/Plan 的 bash 仅只读 allowlist）；Eco 按会话注入 Skills 与 MCP（`.agents/skills` / `.pi/skills` + 线程私有 `pi-agent/<threadId>/skills`；Composer 选中的 MCP / 浏览器 / 图片集成经 `pi-mcp-adapter` 注入，Ask/Plan 规划阶段不暴露 MCP；设置 → 个性化「全局规则」追加进父会话系统提示）；会话 JSONL 持久化在 `userData/pi-agent/<threadId>/sessions/`（跨重启可续跑；改 MCP 会重建进程内 AgentSession 但续跑同一份 JSONL；改模型路由/思考强度会新开会话）。主代理与子代理的「思考强度」会传给 PI（`off` 关闭思考；`low`–`max` 对应 PI thinkingLevel）；Agent 模式支持按会话编排快照委派子代理；工具审批由 Eco 桥接（同 Claude BashApproval）；Plan 经 `finalize_plan` 落盘后异步确认，批准后新开 Agent（退出保留待批准计划）。**Mobile 对 PI 线程工具/计划审批未验证**。

可以在设置中指定新会话默认 Core，也可以为具体会话选择。Core 切换会改变原生工具、审批和会话恢复语义；已经运行的会话不会因为修改全局默认值而自动切换。

## 5. 创建 Agent Team

进入“设置 -> 运行配置”。一套完整配置包含：

### 主代理配置

选择主代理使用的 Provider、模型、思考强度、工具和 Skills。主代理直接与用户沟通，负责理解目标、决定是否委派以及最终验收。

### 主提示词

默认建议“跟随 Core 内置提示词”。只有确实需要补充团队规范或行为约束时，再创建自定义追加提示词。项目编码规则优先写入仓库的 `AGENTS.md`、`CLAUDE.md` 等项目文件。

### 子代理编排

从模板库加入角色，然后逐个配置：

- Provider 与模型
- 是否启用
- 工具和文件权限
- MCP Servers
- Skills
- 自定义角色提示词

常见组合：

| 角色 | 适合的模型特征 |
| --- | --- |
| Explore | 快速、便宜、长上下文读取 |
| Architect | 推理稳定、擅长跨模块分析 |
| Coder | 代码能力强、工具调用可靠 |
| Reviewer | 判断严谨、对缺陷敏感 |
| Tester | 快速、遵循命令和验收标准 |

模型名称完全由用户和服务商配置。Eco 不内置或保证某个特定商业模型可用。

### 成本策略

一个实用起点是：主代理使用质量优先模型；Explore 和 Tester 使用低延迟模型；Coder 与 Reviewer 根据任务风险选择。先观察质量和用量，再调整，不要只根据单价配置整套 Team。

## 6. 使用会话

### Agent

用于实现和修改。Agent 可以读写工作区、运行命令、询问用户并调用已配置的子代理。

### Plan

用于先规划后执行。主代理提交计划后，Eco 展示计划审批；批准后在同一逻辑会话中继续执行。

### Ask

用于只读理解、解释和分析。Ask 不会因为问题看起来简单而自动开启，需要用户显式选择。

### 会话级选项

Composer 可以为当前会话选择：

- Agent Core 与运行配置
- 主模型、辅助/视觉模型
- MCP Servers 和 Skills
- 内置浏览器、图片创建等集成
- Bash Review 与计划模式

这些选择保存在会话配置中，不会无条件污染其他项目和会话。

## 7. MCP 与 Skills

### MCP

1. 在“设置 -> 连接器”添加 MCP Server。
2. 填写名称、传输配置、命令/地址、参数和环境变量。
3. 使用“检测连接”确认握手和工具列表。
4. 在 Composer 或 Agent 模板中为目标会话启用。
5. 需要时设置工具 allowlist。

API Key 应放在 MCP 环境变量或安全配置中，不要写进公开的 Agent 提示词。

### Skills

Eco 扫描当前项目中的：

```text
.claude/skills/<name>/SKILL.md
.agents/skills/<name>/SKILL.md
.codex/skills/<name>/SKILL.md
.pi/skills/<name>/SKILL.md
```

也可以从 Skills 界面浏览和安装兼容 Skill。项目 Skill 默认属于当前项目；个人 Skill 需要显式选择。不同 Core 对目录和 Skill 能力的支持可能不同，界面会显示需要链接或不可用的状态。

PI Core 额外支持会话私有 Skills 目录（`pi-agent/<threadId>/skills`），以及用户级 `~/.pi/agent/skills`。会话 transcript 落在同线程的 `pi-agent/<threadId>/sessions/`，可在设置 → 存储中计量与清理；「全部 PI 会话」会删除对应 Eco 对话（侧边栏消失），不只清磁盘文件。会话开关控制的是注入可见性；共享工作区内的 skill 文件仍可能被带 `read`/`bash` 的会话读到，不是 OS 级隔离。

## 8. 视觉、图片创建与 ASR

### 视觉模型

在运行配置中为视觉任务选择独立模型。未设置时使用主模型。只有上游真实支持图像输入时，视觉请求才能成功。

### 图片创建

1. 在“设置 -> 集成 -> 图片创建”添加供应商配置。
2. 填写 Base URL、API Key、模型和参数。
3. 设为启用配置。
4. 在目标会话的集成菜单中开启图片创建。

每次图片创建调用都需要确认，输出保存到本地并进入任务记录。

### ASR

在 Desktop 配置 ASR Provider。当前支持兼容 `audio/transcriptions` 或 Chat Completions 的服务。移动端录音后通过已配对 Desktop 获取配置并发起识别；Desktop 离线或未配置 ASR 时，移动端会显示明确错误。

## 9. 费用与缓存

为候选模型配置输入、输出、缓存读取和缓存写入价格后，会话用量面板可以展示：

- 实际 Token 与费用
- 按 Agent、模型和事件拆分
- 缓存命中率
- 编排实际费用与未编排估算

未配置价格时仍可看到 Token，但费用可能为空或不完整。

会话闲置 30 分钟后，Composer 会提醒 Prompt cache 可能失效。若连续请求间出现显著且无法由新增输入解释的 cache-read 下降，活动流会记录异常。建议结合请求时间、系统提示词、工具列表、模型路由和多轮数据判断原因。

## 10. Center Server 与移动端

移动端尚未公开发布。开发或自托管需要 Center Server、MongoDB 和 Redis。

### 启动 Server

```bash
cp apps/server/.env.example apps/server/.env
# 编辑 .env，设置至少 32 字符的 ECO_SERVER_TOKEN_SECRET
cd apps/server
docker compose up -d --build
```

开发环境也可以从根目录启动：

```bash
ECO_SERVER_TOKEN_SECRET="your-secret-at-least-32-chars" bun run dev:server
```

真机连接时将 `ECO_SERVER_HOST` 设为 `0.0.0.0`，并使用 TLS 反向代理或仅在可信局域网测试。不要把未加密的生产 Server 直接暴露到公网。

### 配对

1. Desktop 和 Mobile 配置同一个 Center Server。
2. 登录或注册账号并注册设备。
3. Desktop 创建配对会话，显示二维码/配对码。
4. Mobile 扫码或输入配对码。
5. 绑定完成后，Mobile 可以查看会话、发送消息和处理审批。

代码执行始终发生在 Desktop；关闭 Desktop 后，Mobile 无法继续执行 Agent 任务。

### 移动端开发

```bash
cd apps/mobile
flutter pub get
flutter run --flavor dev
flutter test
```

iOS 真机需要为 `com.plus.ecoding.dev` 配置开发签名。

## 11. 更新

- Windows / Linux：正式 Release 元数据支持应用内检查、下载和重启安装。
- macOS：当前未签名 Beta 禁用自动更新，应用会引导到 GitHub Release 手动下载。
- Beta 不会自动降级到更旧的正式版渠道。

更新前建议提交或备份重要工作区。Eco 的应用更新不会主动删除项目文件，但 Agent 正在执行时不应强制退出。

## 12. 从源码开发

### 通用依赖

- Bun `1.3.14`（当前 CI 已验证版本）
- Node.js `22.14.0`（当前 CI 已验证版本）
- Git

原生模块 `node-pty` 还需要：

- macOS：Xcode Command Line Tools
- Windows：Visual Studio 2022 Build Tools、Desktop development with C++、Windows SDK
- Linux：Python 3、C/C++ build toolchain 和 Electron 所需系统库

```bash
git clone https://github.com/plus1998/eco-coding.git
cd eco-coding
bun install
bun run dev
```

常用检查：

```bash
bun run build
bun run test
bun run typecheck
bun run lint
```

本机打包：

```bash
bun run pack
```

## 13. 常见问题

### Provider 测试 404

检查 Base URL 是否错误包含了完整 `/v1/messages`、`/v1/responses` 或 `/v1/chat/completions` 后缀，并确认 API 兼容模式与服务商一致。

### 模型能对话但不能使用图片或工具

协议兼容不代表能力兼容。确认模型真实支持视觉、tool use、流式响应和所需上下文长度。

### Windows 从源码安装时报找不到 Visual Studio

安装 Visual Studio 2022 Build Tools，并勾选 Desktop development with C++ 和 Windows SDK。Eco 的 CI 使用 Node.js `22.14.0` 与 `@electron/rebuild` 重编译 `node-pty`。

### Linux AppImage 无法启动

确认文件有执行权限，并安装发行版对应的 FUSE 兼容包。

### 费用显示为 0 或缺失

为当前实际 Model ID 配置价格，确认 Provider 返回了 usage，且路由没有使用另一个别名模型。

### Mobile 显示 Desktop 离线

确认 Desktop 已连接同一 Center Server、设备绑定未撤销、WebSocket 可达，且反向代理允许 Upgrade。

## 14. 获取帮助

提交 Issue 时请提供：

- Eco Coding 版本和操作系统
- Agent Core、Provider 协议和 Model ID（删除 API Key）
- 可复现步骤
- 相关错误文本和日志片段
- 是否可以在新会话或最小项目中复现

不要提交 API Key、访问 Token、项目私密源码或包含个人信息的完整数据库。
