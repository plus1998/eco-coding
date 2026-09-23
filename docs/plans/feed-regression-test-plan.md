# Feed 回归测试计划（会话展示层的场景账本）

本文件回答三件事：**为什么现在没有回归网**、**要测哪些场景（一条一条）**、**每个场景用什么断言、算不算过**。

背景：用户在真机上对照库事件发现两个缺陷（同一轮出现 2 个「处理中」；子代理的工具行出现在主 Feed 中间），而当时 V2 相关 90 条测试全绿。缺陷不在展示层，而在 V2 读模型（缺 `occurred_at`、把 provider 任务进度行当成工具调用）——**说明现有测试的断言单位不是「用户看到的一轮」**。

---

## 1. 为什么"每次重构就一大堆问题测不出来"

四条实测事实，缺一条都成立，四条同时成立就等于没有网：

1. **当时桌面测试套件不在 CI 里。** `.github/workflows/release.yml` 只在打 tag 时跑 `test:release`，而它是 5 个文件、全是桌面更新/签名策略：
   `bun test test/desktop-update-policy.test.ts …`（apps/desktop/package.json:31），Feed 覆盖为 0。
   `.github/workflows/mobile-tests.yml` 只在 PR 时跑 `flutter test`（注释原文：`bun test never looks inside apps/mobile, which is how it drifted red unnoticed`）。当时桌面 502 个测试文件没有任何闸门；该缺口现已由 G-1/G-2 修复。
2. **当时红灯成了背景噪音。** main 上曾实测 38 个红灯 / 3519 通过（155 秒），其中 ≥20 个只在全量运行时红。该历史用于解释为什么必须保留严格闸门，不代表当前状态；当前 baseline 已清零。
3. **真库对拍工具早就写了，但从没被喂过。** `apps/desktop/scripts/feed-skeleton-parity-audit.mjs`（`bun run feed:parity`，配 `test/fixtures/feed-parity/observed-event-shapes.json`）就是"真库语料跑旧投影做金丝雀"的先例——**没有任何测试或 CI 调用它**（本次全仓 grep 只命中它自己的 usage 注释和 package.json 定义）。
4. **分层自证。** V2 单测喂 V2 输入、断言 V2 输出；旧投影自己一套等价测试；`run-projection-merge` 假设输入是"已合并好的快照"。没有任何断言跨过「真库一行 → 用户看到的一行」。本轮缺陷正好落在两层的缝里：读模型少一列（`occurred_at`）、adapter 多造一列（幽灵工具行），**两层各自的测试都可以全绿**。

结论：不是"缺测试数量"，是**缺"以可见一轮为单位的断言"**、**缺真库语料**、**缺闸门**。

## 2. 这次我具体错在哪（不再重犯的部分）

- 我只跑了「我改过的文件」的测试，然后看**别的会话**的截图当作修复验证；
- 我自己造的差分 harness 里，期望值是**我手写**的（把 `message.delta` + `message.final` 当成两行），而不是**旧链路的输出**——这违背了差分对拍的全部意义；
- 我没有一条断言覆盖「一轮的 section 数量 / 行的归属 / 行的先后 / 状态文案 / 耗时」这些用户一眼能看出的量；
- 真机验证只看了"有没有报错"，没有逐条对照库事件与渲染结果。

## 3. 判据：四层，期望值来源写死

| 层 | 输入 | 期望值来源（金标准） | 现状 |
| --- | --- | --- | --- |
| **L0 真库回放** | 真库副本（`VACUUM INTO`）+ 真实会话 id | **旧链路输出**（旧投影 → view model → turn sections），逐字段对拍 | 🟡 已建 1 个文件 5 例（`conversation-v2-projection-parity.test.ts`），需扩到全场景 |
| **L1 行为规格** | storage-free 构造的事件/attempts/agents | `thread-run-projection.test.ts`（29 例，旧链路行为说明书） | 🟡 4 例已迁到 V2 链路，剩 25 例 |
| **L2 视图模型/Feed 组装** | 投影快照 | 现有 152+80+30+29+11 例（不依赖链路的组装规则） | ✅ 已厚，但**只在被 L0/L1 喂对输入时才有意义** |
| **L3 渲染** | view model | golden 片段（HTML/Markdown）+ 移动端 widget test（135 例） | 🟡 桌面无 golden |

硬规则（写进 review checklist）：
- L0/L1 的期望**必须**来自旧链路或真实库，禁止手写"我认为应该"；
- 断言用**全字段**比较（`toEqual`），禁止 `toMatchObject` 掩盖新字段/丢字段；
- 断言单位是**用户可见的渲染结果**（section 序列、条目文本与顺序、卡片归属、状态文案、耗时、分组），不是中间对象是否存在；
- 每个用例要能证伪：临时还原实现 → 它必须变红（本轮已验证：关掉子代理分流 → 2 条立刻红）。

## 4. 场景账本

来源列：`commit`=历史修过的缺陷（"以前修过的问题必须永久测一遍"）、`真机`=本轮实测、`规格`=旧链路行为规格。
状态：✅ 已有断言 / 🟡 需迁到 V2 链路 / ❌ 无覆盖 / 🔴 已修待回归（当前红）。

### 4.1 时序与位置（P0，用户最先看到）
| # | 场景 | 来源 | 断言 | 状态 |
| --- | --- | --- | --- | --- |
| T1 | 一轮内「叙述 → 工具 → 终稿」顺序正确，且属于**同一个** section | commit `67a54b36`,`29a56867` / 真机 | section 数=1；条目顺序=按 `occurred_at` | 🟡（新增用例已绿） |
| T2 | 一轮内的 V2 行不得全部塌到同一时刻 | 真机（2 个「处理中」） | 每行 `at` = 事件 `occurred_at` | ✅ 本轮 |
| T3 | mid-turn 用户插话落在正确位置 | commit `8c212877` | 用户消息在相邻工具之间 | ❌ |
| T4 | 子代理卡片锚定在父 `tool.started` 位置 | commit `1d14564d`,`d43f87a9` | 卡片位置=父工具调用序列位 | ❌ |
| T5 | 连续思考合并后仍保持时序与耗时 | commit `4b4d4c85`,`db98e105` | 合并条目 `at`/`durationMs` 取区间 | ❌ |
| T6 | 澄清回答锚定到提问位置，不被并进 planner 流 | commit `2b1504ec` | 澄清条目位置=提问序列位 | ❌ |
| T7 | 历史回退/编辑分叉后位置仍正确 | commit `b9f31261`,`cc528ed1` | 编辑后该轮位置不变 | ❌ |
| T8 | 旧骨架（`thread_feed_skeleton`）与 V2 行混排时顺序一致 | 规格 | 同一真库语料，两个链路逐条对齐 | 🔴 部分 |

### 4.2 运行/终态状态（P0）
| # | 场景 | 来源 | 断言 | 状态 |
| --- | --- | --- | --- | --- |
| R1 | 同一轮只渲染 **1 个**状态头（本轮"2 个处理中"） | 真机 | `sections.filter(kind==="turn").length===1` | ✅ 本轮 |
| R2 | 工具完成**不等于** run 结束 | commit `52ca3b34`,`f59a7f55` | 工具完成后 run 仍 running；只有 attempt 终态才停 | ✅ |
| R3 | 压缩/思考期间不重复渲染尾部状态 | commit `e0d99e13`,`25ef5193` | 状态头数与活跃状态数一致 | ❌ |
| R4 | 子代理 API 错误 = 停止，不是"进行中" | commit `33f05ee1` | 卡片 status=stopped，无 running 文案 | ❌ |
| R5 | 会话结束后不得仍显示 running（移动端同构） | commit `884e3d8d` | 终态后 `resolveSessionRunning=false` | ✅ 移动端 |
| R6 | 用户点停止 → 立刻"停止中"，直到真正结束 | commit `d48692c8` | 中间态文案 | ❌ |
| R7 | 中断不算错误 | commit `6f30957e` | 打断行样式/文案非 error | 🟡 |
| R8 | 运行中的时长刷新（不冻结、不跳变） | commit `f0e78edf` | 每 tick 增长；终态后固定 | ❌ |
| R9 | 迟到的 run 事件不得复活已终态 run（含 retry） | 规格 | 2 次 attempt 只写 1 个终态 | ✅ |
| R10 | 权威事件可纠正错误终态（`authority: "lifecycle"`） | 真机（历史脏 run） | 纠正后时间/质量一致 | ✅ |
| R11 | follow-up 排空与 idle/resume 的状态归属 | commit `249e8ef9` | idle 后仍能排空且状态正确 | ❌ |
| R12 | 标题生成状态与运行状态互不串（移动端同构） | commit `3eb643f5` | 标题 loading ≠ 会话 running | ❌ |

### 4.3 归属、卡片、分组
| # | 场景 | 来源 | 断言 | 状态 |
| --- | --- | --- | --- | --- |
| A1 | 子代理叙事/工具**不得**进主 Feed（双端） | commit `b02af983` / 真机 | 主 Feed 无该 agentId 的行 | ✅ |
| A2 | 心跳行（`Tool: Bash (30.0s)`，`metadata.parent_tool_use_id` + `toolUseId=call_…-heartbeat-N`） | 真机（dev 库 24 条）/ commit `b02af983` | **旧链路对同一会话输出 0 条**（实测 `thr_1789531481908`：主时间线 0 + 卡片 0）→ V2 也必须丢弃，不是「归到卡片」 | ✅ adapter 已过滤；旧脏 V2 数据随全量重导清除 |
| A3 | provider 任务进度行（`Running …`）不得凭空造工具调用 | 真机（"工具出现在中间"） | 读模型无 `legacy_tool_*` 幽灵行 | ✅ 本轮 |
| A4 | 同角色并发子代理按 `agentId` 隔离（两个 Coder 不串） | 规格 | 各自时间线独立 | ✅ |
| A5 | 孤儿 agentId（找不到卡片）宁可留在主 Feed，不得隐藏内容 | 不变量 14 | 内容可见 | ✅ |
| A6 | planner 审批不得被铸成子代理卡片 | commit `c8d122e7` | 卡片集合不含审批 | ❌ |
| A7 | 子代理完成总结去重（不重复一行） | commit `ab07cab7` | 同一总结只出现 1 次 | ❌ |
| A8 | 主 Feed 只收 `scope in (main, both)`，子代理项不泄漏 | commit `52715f9b`,`817f26d6` | 主 Feed 条目集合 | ✅ 部分 |
| A9 | 跨 core（Claude/Codex/Cursor）归属一致 | commit `f59a7f55`,`25aeaaff` | 三个 core 的同一场景对拍 | ❌ |
| A10 | 角色标签 `planner/coder/explore/tool` 两端一致 | 真机（766 行 `role='planner'`） | 标签字符串相等 | ✅ `provider_role` 已进入读模型、effect 与双端 DTO |

### 4.4 重复与去重
| # | 场景 | 来源 | 断言 | 状态 |
| --- | --- | --- | --- | --- |
| D1 | 增量骨架与全量重建**严格等价** | commit `9c957a14`,`67a54b36` | 两种输入产出同一投影 | 🟡（24 例存在，未在 V2 链路上） |
| D2 | 同一工具行不因 `tool.started`+`tool.completed` 出现两次 | 规格 | 工具 call id 唯一 | ✅ |
| D3 | 流式正文同 key 累积不产生重复行 | commit `e1243b1c` | 同 streamKey 只 1 行 | ✅ |
| D4 | 重复推送（跨端 Realtime）不重复渲染 | commit `020c5142` | 幂等 | 🟡 |
| D5 | 子代理完成通知重复到达只渲染一次 | commit `ab07cab7` | 1 行 | ❌ |
| D6 | 同一会话重复 bootstrap 不追加行 | 规格 | 帧间快照相等 | ✅ |

### 4.5 丢失、折叠、截断
| # | 场景 | 来源 | 断言 | 状态 |
| --- | --- | --- | --- | --- |
| L1 | running 回合正文不得被折叠/塌掉（多段） | commit `67a54b36`,`29a56867` | 段落数不变 | 🔴 main 上 38 红含此族 |
| L2 | 空正文占位行不得留下永久 streaming | 真机（issue 1） | 无空正文行 | ✅ |
| L3 | 截断的 Feed 需可继续加载（detail 分页） | commit `4f3655f9`,`6f30957e` | 分页后集合完整 | 🟡 |
| L4 | 未开始回合被丢弃后 Composer 恢复 | commit `2d2c7cf8` | 附件/文本恢复 | ❌ |
| L5 | 工具详情在 Feed 里不被裁剪掉关键字段 | 规格 | typed renderer + 移动 Feed source row 全字段守恒 | ✅ |
| L6 | 大正文/表格不被 Feed 拽离底部 | commit `7dfbd7c8` | 滚动锚定 | ❌ |
| L7 | 思考"阅后即焚"不误删其他内容 | commit `1f447ba8` | 只删思考 | ❌ |
| L8 | 草稿/附件不因切换会话丢失 | commit `2d2c7cf8` | 恢复 | ❌ |

### 4.6 流式正文与思考
| # | 场景 | 来源 | 断言 | 状态 |
| --- | --- | --- | --- | --- |
| S1 | 流式折叠按 attempt/request 隔离（不跨轮覆盖） | commit `e1243b1c` | 跨轮不互相盖 | 🟡 |
| S2 | 只有末位条目做打字机动画 | commit `ace98be8` | 唯一流式项 | ❌ |
| S3 | 思考与工具边界正确（工具不作分组边界误切） | commit `4b4d4c85` | 分组边界 | ❌ |
| S4 | 工具运行时不追加"待处理思考" | commit `0fa63304` | 无多余行 | ❌ |
| S5 | 流式正文不重复（同一 key 多帧） | commit `676ead3a`（重复叙事） | 1 行 | 🟡 |
| S6 | 本地流结算与远端补拉一致 | commit `676ead3a` | 结算后相等 | ✅ |
| S7 | Markdown 分段/表格/代码块渲染稳定 | 现有 `feed-markdown`/`streaming-markdown-partition` | golden | ✅ L3 |
| S8 | 思考摘要驼峰/句读切分 | commit `4d826dfb` | 文本相等 | ✅ |
| S9 | 中文/英文 i18n 文案不泄漏 key（`activity.named.*`） | 真机（本轮） | 无 `activity.` 前缀输出 | ✅ |
| S10 | 未知工具名不泄漏 i18n key，且两端同名单 | 真机 | 标签=工具名 | ✅ |

### 4.7 工具行标签与结构化目标
| # | 场景 | 来源 | 断言 | 状态 |
| --- | --- | --- | --- | --- |
| K1 | 结构化目标（`readTarget`/`grepTarget`）优先于 `detail` | 真机 issue 2 | 标签=`basename`/行范围 | ✅ 双端 |
| K2 | 行范围格式 `L12-40` 两端一致 | 真机 issue 2 | 字符串相等 | ✅ 双端 |
| K3 | 不出现"读取了 读取了文件"式泛化重复 | 真机 issue 2 | 无双写前缀 | ✅ 双端 |
| K4 | 工具展示用 `description`（旧链路语义）而非命令原文 | 真机（卡片标签差异） | 标签相等 | ❌ 已知差异 |
| K5 | MCP/`mcpScript`/`TaskStop` 无名工具不泛化 | 计划"尚未完成" | 有可读标签 | 🔴 |
| K6 | 联网搜索/看图/HTML 卡片标签正确 | commit `3020998f`,`213a33df`,`d3d0c6d6` | 标签与卡片类型 | ❌ |
| K7 | 技能读取显示「读取 <技能名> 技能」 | commit `3aca9e34` | 文案 | ❌ |
| K8 | 工具组沉淀期间不重复渲染尾部状态 | commit `25ef5193` | 见 R3 | ❌ |

### 4.8 耗时与时间戳
| # | 场景 | 来源 | 断言 | 状态 |
| --- | --- | --- | --- | --- |
| U1 | 一轮耗时=attempt 区间，终态后固定 | 真机（"15分50秒"） | `durationMs` 相等 | ✅ |
| U2 | 卡片耗时=代理区间（用 registry 起止） | 真机 | 相等 | ✅ 部分 |
| U3 | 用户消息时间戳取 `occurred_at` 而非写入时刻 | commit 族 / 真机 | 时间戳相等 | 🟡 |
| U4 | 运行中时长随 tick 增长、不倒退 | commit `f0e78edf` | 单调 | ❌ |
| U5 | 无 `occurred_at` 的旧行回落规则明确且稳定 | 本轮设计 | 回落=run 窗口，不用生成时刻 | ✅ |
| U6 | 跨时区/夏令时显示一致 | 规格 | 格式化 | ❌ |

### 4.9 中断、失败、取消
| # | 场景 | 来源 | 断言 | 状态 |
| --- | --- | --- | --- | --- |
| F1 | 用户中断：会话可继续，不算错误 | commit `6f30957e` | 状态 idle、无 error | 🟡 |
| F2 | 子代理失败：卡片显示失败 + 停止 | commit `33f05ee1` | status=failed/stopped | ❌ |
| F3 | 审批被拒后工具行可见为失败 | commit（denied 语义） | status=failed | ✅ |
| F4 | 资源耗尽/超时识别为失败而非卡住 | commit `ce4b634e`,`a7e2f8b4` | status=failed | ❌ |
| F5 | 连接断开/重连后状态与内容收敛 | commit `66194b6d` | 重连后相等 | 🟡 移动端 |
| F6 | 命令失败（非 0 退出）不显示为成功 | 规格 | status | ❌ |
| F7 | 取消的 run 不复活（见 R9） | 规格 | 终态 | ✅ |

### 4.10 骨架、compact、增量等价
| # | 场景 | 来源 | 断言 | 状态 |
| --- | --- | --- | --- | --- |
| G1 | 增量 patch 与全量重建严格等价 | commit `9c957a14` | 投影深度相等 | 🟡 |
| G2 | 脏骨架检测：坏了就重建 | commit `67a54b36` | 检出并重建 | 🟡 |
| G3 | 停跑后 compact 并 bump revision | commit `ed2e9730` | revision 变化 + 内容正确 | ❌ |
| G4 | compact 期间不显示尾部状态 | commit `e0d99e13` | 见 R3 | ❌ |
| G5 | 活跃 agent 时间线在骨架中实时更新 | commit `315f2507` | 卡片内容更新 | ❌ |
| G6 | 骨架子代理卡片与 attempt 终稿同轮（不重复标题） | commit `a3b8ea91` | section 数=1 | ✅ |

### 4.11 迁移、历史、旧库
| # | 场景 | 来源 | 断言 | 状态 |
| --- | --- | --- | --- | --- |
| M1 | 旧库升级后 bootstrap 可读（含代理注册表回填） | 真机（本轮 `version_seq is invalid`） | bootstrap 成功 + 计数正确 | ✅ |
| M2 | 二次 initialize 幂等（不重复播种/不漂移） | 真机 | 计数不变 | ✅ |
| M3 | `rebuildReadModels` 重放得到相同读模型 | 不变量 10 | 深度相等 | ✅ |
| M4 | 事件不可变；纠正只能靠新事件（含原因/审计） | 计划"尚未完成" | `run.corrected` 语义 | ❌ |
| M5 | 已镜像会话的重导（删派生行 → 重跑迁移器）结果正确 | 真机（本轮验证过副本） | 0 幽灵行、归属正确 | 🟡 副本已验证；待正式维护窗口执行 |
| M6 | 迁移分叉：已有镜像会话与未迁移会话的收敛 | 真机 | 全部会话可达 V2 读路径 | 🟡 已决定维护窗口全量重导；待命令、演练和正式执行 |
| M7 | 历史分页（消息/工具/详情三类游标）不重不漏 | 规格 | 并集=全集 | 🟡 |

### 4.12 附件、图片、卡片
| # | 场景 | 来源 | 断言 | 状态 |
| --- | --- | --- | --- | --- |
| P1 | 用户图片预览跨端可见（不泄漏本地路径） | 计划 | 预览可用 | 🟡 |
| P2 | display_image/HTML Artifacts 卡片正确渲染 | commit `97ce8cd3`,`d3d0c6d6` | 卡片类型 | ❌ |
| P3 | 表格预览宽布局（移动端） | commit `c714f7f0`,`d3055552` | 布局 | ✅ L3 |
| P4 | 悬浮画廊不覆盖右侧面板 | commit `edf9355a` | 层叠 | ❌ |
| P5 | 图片查看失败/超大不阻塞 Feed | 规格 | 降级可见 | ❌ |

**合计 93 个场景**，来源：历史 `fix` 提交 480 条（本仓 desktop+mobile 相关）中与展示层相关的 ~120 条 + 本轮真机 4 条 + 旧链路规格。

### 4.13 L0 真机回放发现（2026-09-16 第二轮执行记录）

对**修复后新产生**的真机会话跑 L0 差分（旧投影 vs V2-only，真库副本 + renderer 三段），逐字段对比：

| 会话 | turn section（旧/V2） | 主 Feed 工具行（旧/V2） | 卡片（旧/V2） |
| --- | --- | --- | --- |
| `thr_1789559384838` | 1 / 1 ✅ | 4 / 2 | **3 / 2 ❌** |
| `thr_1789559379858` | 1 / 1 ✅ | 0 / 0 ✅ | **3 / 2 ❌** |
| `thr_1789559349081` | 1 / 1 ✅ | 8 / 5 | **4 / 3 ❌** |

- ✅ **R1/T1/T2 生效**：三个会话都是 1:1 的 turn section（此前的「2 个处理中」形态不再出现）。
- ✅ **A3 生效**：新数据里没有 `Running …` / 心跳幽灵行。
- ✅ **A2 已修（本轮）**：adapter 丢弃 `call_…-heartbeat-N` 心跳行（真库 24 条），红用例先失败后转绿（`does not project a tool heartbeat as a call of its own`）。**边界**：旧代码已写入读模型的心跳行（24 条 / 2 个会话）与进度行（45 条 `legacy_tool_%`）是不可变事件，需要重导该会话才能清掉（见 M5）。
- ⛔ **R13 撤回：这是对拍口径错误造成的假缺陷（本轮）**。上表「卡片 3 vs 2」比的是 `projection.agents`，而 Feed **只渲染 `kind === "subagent"` 的卡片**（`thread-run-projection-view.ts:160` 过滤主代理；移动端 `conversation_v2_projection.dart:86` 只按工具归属建卡片，主代理本来就没有卡片）。按**渲染口径**重跑：卡片 3/3、2/2、2/2、3/3 **全部相等**，即主代理从来不需要注册表行。据此已把「由 attempt 生命周期投影 planner 的 `agent.*`」的改动**整体回退**（含 `plannerAgentInstanceId` / `conversationV2PlannerEventForAttempt` / `conversationV2HasAgent` / 迁移器播种 / 两条用例），并改造对拍口径：`feedShape` 现在比 `viewModel.subagentCards`（渲染层）而不是 `projection.agents`（含被过滤的主代理）。**教训**：差分必须钉在渲染结果上，否则既会报出用户看不见的差异，也会掩盖用户看得见的差异。
- ✅ **K9 已分类：V2 正确，旧链路重复**。证据（`thr_1789559349081`，`scope='main'`）：同一 `toolUseId` 在旧事件里有两行——`seq 52 tool.started`（`@mission {"role":"eco_coder",…}`）+ `seq 56 tool.completed`（`Tool: Agent · eco_coder · …`）；`seq 59/60/67/68` 是同一 spawn 的 start/end 两行；`seq 150/151` 是 WebSearch 的 start/failed 两行。旧链路 8 行 = **3 次调用 × 2 行 + 2 条无 id 行**；V2 5 行 = 3 次调用（起止合并）× 1 行 + 2 条无 id 行 → **V2 没有丢行**，旧链路把一次调用的开始与结束各画一行。对拍口径据此把工具行归约为「调用身份 + 结局」再比较（`toolRowIdentity`），不再逐字比两条链路各自的措辞。
- ✅ **K10 已裁决为有意分歧（不再问人）工具行措辞**：同一调用，旧链路写 provider 的散文（`Tool: Bash · Fetch Sanya weather from wttr.in API`、失败写 `Tool failed: WebSearch: Tool web_search not found`），V2 写结构化事实（`Tool: Bash · curl -s "https://wttr.in/Sanya?format=j1" …`，失败由行的 `tool.failed` 状态表达）。真库 3/4 会话存在此差异，逐条一一对应、无行丢失。

  按 §5.2 裁决（默认对齐旧链路，除非有证据）：**保持 V2 现状（事实优先）**，理由是三条而不是口味：① 展示语义已定的方向就是「结构化目标优先于 `detail`」（`feed-action-kind.ts` 的 `bashRun.command`、移动端 `_actionSummaryTarget` 对齐）—— 回落 `description` 会把刚统一的东西反掉；② 旧链路的散文对失败**无法表达事实**，只能把它拼进句子（`Tool failed: WebSearch: Tool web_search not found`），而 V2 有独立状态位，信息量严格更多；③ 旧链路的文案是**同一行随事件变化**的产物（start 用 `@mission`、完成用 `description`），换一个 provider/版本就又变一次，拿它当永久基准会把不稳定当契约。

  因此这是**有意分歧**，不是回归：对拍网里用 `toolRowIdentity()` 把工具行归约为「调用身份 + 结局」比较（K9 同口径），其差异不当作红；**证据与口径都写在这里**，以后不再重开。真机清单：`thr_1789559384838`、`thr_1789559379858`、`thr_1789559349081`（对应旧/V2 行数见 4.13 表格）。
- ✅ **A10 补证（本轮修）**：子代理卡片的**标题与副标题**在 V2 会丢——注册表原先只有 `mission`（= 旧 `mission_key`，如 `gz_weather`），卡片标题用的 `taskName` 与副标题用的 `delegationSummary/delegationPrompt` 只存在于旧 `agent.started` 事件元数据里。已补：`conversation_agents_v2` 加 `task_name/delegation_summary/delegation_prompt` 三列（`ALTER` 增量 + 从旧事件日志回填 + 适配器实时写入 + shared DTO + 渲染映射），并加两条用例（升级回填、禁止用 mission key 冒充委派正文）。真机复验：能力卡片文本 4/4 会话与旧链路逐字相等。
- 备注：`Tool: Tool`（`thr_1789559349081`）两条链路都有，是 provider 的垃圾行（无 `toolUseId`），**不是**本轮缺陷。

**本轮结束时的真机差分（渲染口径，真库副本 + `reconcile`）**：turn section 4/4 ✅；渲染卡片 4/4 ✅（含标题/副标题文本）；主 Feed 条目数差异仅来自 K9（旧 8/18/19 vs V2 4/15/17）；卡片可见行差异仅来自 K10。

### 4.14 阶段 A0：测试信号修复（2026-09-16 执行记录）

闸门 G-1/G-2 的落地过程与结果。**全部数字都用同一入口复现**：`node scripts/test-gate.mjs`（= `bun test --path-ignore-patterns=apps/desktop/e2e/**` + JUnit 报告 + 已知失败清单），以及 HEAD 的干净 worktree（`git worktree add /tmp/eco-base HEAD`）做归因。

| 状态 | 全量套件失败数 | 说明 |
| --- | --- | --- |
| HEAD（干净 worktree） | **45** | 含 7 个 error；单文件单跑只剩 ~11 条 → 大部分是顺序污染 |
| 本轮开始时（WIP 树） | 40 | 与 HEAD 相同的族 |
| 本轮结束时 | **14**（全部已在 `test-baseline.json` 里逐条写明原因） | 新增失败 0 |

修掉的四个根因（都是「只在全量跑时红」的正主）：

1. **i18n 全局语言泄漏（5 个文件，清掉 20 条红）**：`composer-agent-model-labels` / `terminal-panel-storage` / `workspace-git-action-store` / `thread-follow-up-ui` / `workspace-git-section` / `composer-skills` 调 `i18n.changeLanguage("en-US")` 后不还原——`i18n` 是整个 `bun test` 进程的模块状态，于是**后面任何一个断言中文字串的文件都会红**，且红的地方与真原因毫无关系（`thread-run-projection-view` 的 7 条 Feed 断言、`ACP follow-up IPC errors localize`、`agent-template-form` 2 条…）。修法：新增 `apps/desktop/test/support/test-language.ts` 的 `withTestLanguage("en-US")`（beforeEach 设、afterEach 还原），6 个文件改为用它。
2. **`globalThis.document` 被写成只读（清掉 4 条红）**：`clipboard.test.ts` 用 `Object.defineProperty(globalThis, "document", { value })` 安装假 DOM，`writable` 默认 false；还原时又用 `defineProperty` 写回，于是这个全局**永久变成不可写**，后续 `browser-webview-pool` / `browser-guest-bridge` 安装自己的 DOM 时直接抛 `Attempted to assign to readonly property`。修法：新增 `test/support/global-document.ts`（记录原 descriptor、`writable: true` 安装、按 descriptor 还原或 delete；同时处理 async body，否则 `finally` 会在 await 之前还原）。
3. **`fileChange.previewLines` 泄漏到实时链路**（`thread-run-projection-feed` 1 条）：`trimToolMetadata` 把 `fileChange` 整体加入了白名单，连无界的 diff 预览一起发给客户端；用例本来就是盯这个的。修法：白名单保留变更头部（path/additions/deletions），裁掉 `previewLines`（详情 feed 本来就会另取）。
4. **SDK 工具元数据的 `status` 字段没进用例（8 条）**：`status: "started"` 是 `3020998f` 有意加的（`shared/thread-run-events.ts` 声明、`activity-display.ts#toolStatusToLifecycle` 消费），但同一提交没更新 `sdk-stream-activity` 的 8 条期望。修法：按新契约补齐期望（不是删断言）。

剩下 14 条已**逐条**写进 `test-baseline.json`（`node scripts/test-gate.mjs` 每次都会把它们打印出来；修好一条会变成「绿(已成历史)」并要求从清单删除，`--strict` 时直接失败）：其中 8 条是 HEAD 单跑也红的真实缺陷（图片生成 2、imageView 白名单 1、ACP 文案中文化 1、Cursor 探测失败文案 1、retry fail-closed 1、anthropic golden 1、supabase 迁移 1、test-node 1），5 条是仍未定位写脏点的顺序污染/flake（`image-gallery-float` 2、`terminal-links` 2、`browser-guest-bridge` 1）。

闸门本体：`.github/workflows/desktop-tests.yml`（G-1，之前 desktop 套件在 CI **零覆盖**）+ `scripts/test-gate.mjs`（G-2 的显式清单；已自验：注入一条假失败 → 退出码 1 并点名，移除 → 退出码 0）。

尚未做：G-3（`feed:parity` 进 CI、语料固化为 fixture）与 G-5（字段守恒清单）。

### 4.15 A10 批次：账号属性丢失 + 对拍网失效（2026-09-16，全面 V2 执行记录）

这一批是「用户授权全面接 V2、不接受任何 BUG」之后的第一批，起因是回答「为什么都要我裁决」时发现：A10（provider 角色标签）**本来就由不变量 17 决定**，不该问人。顺着这条线查，暴露出三个真缺陷和一个测试网缺陷。

**（1）测试网缺陷：差分对拍一直是空对空（最高优先，已修）**

`test/conversation-v2-projection-parity.test.ts` 的 `feedShape` 在读 section 的行时用的是 `entries ?? rows`，而 turn section 的行在 **`processEntries`**，standalone 行在 **`entry`**。两者都没命中 → 每个 turn section 的行列表恒为空数组，行级断言全部永真。此前「差分 6/6 全绿」在行内容上没有任何效力（卡片、attempts、section 数量是真的，行不是）。这直接解释了为什么两个真机缺陷能穿过 90 条绿测试。

同时修正对拍**基线**：旧侧不再是「裸 legacy 投影」，而是 `mergeConversationV2IntoProjection(legacy, v2)`，也就是切换前生产实际渲染的组合（骨架裁剪 + V2 回填）。拿裁剪过的旧视图去比全量 V2，会在每个「一轮有两段正文」的轮次上误报，同时掩盖真正该看的差异（被回填的行落在哪里）。

现在每行按 **文本 + role + 时间** 三元组比较（`RowShape`），并在 `feed-regression-test-plan.md` §2/§3 的口径上补一句：**行的身份 = 它说什么 + 谁写的 + 什么时候发生**。

**（2）A10：provider 角色标签在读模型里丢掉了（已修，两端）**

事实：旧链路的时间线行的 `role` 是 provider 自己的标签（真库 `main|planner` 803、`agent|coder` 57、`agent|explore` 6、`agent|general` 4、`agent|vision` 3、`main|assistant` 22），V2 把它归一成 `assistant` 并只保留归一化值。消费点两端都有：桌面 `thread-run-projection-view.ts:2377`（`role === "planner"` 决定哪一行是**最终输出**）与移动端 `projection_activity_feed.dart:1262`（同一规则）。

修法（按不变量 17「属性丢失必须可见」）：把标签作为**不可变事实**存下来，而不是猜。
- `ConversationEventInput.payload.providerRole` → `conversation_messages_v2.provider_role` / `conversation_tool_calls_v2.provider_role`（CREATE + ALTER + apply + `storedMessage`/`storedTool` 校验器 + `rowToMessage`/`rowToTool` + DTO `providerRole?`）;
- 桌面 `conversationV2MessageToTimelineItem` / `conversationV2ToolToTimelineItem`：`role = providerRole ?? 归一化角色`；
- 移动端 `ConversationV2Message`/`ConversationV2Tool` 增加 `providerRole`、`occurredAt`，投影 `role`/`at` 同规则；
- 回填 `backfillProviderRole(table)`：从 `thread_run_events` 用**与镜像相同的身份公式**（新建 `conversation-v2-legacy-identity.ts`，适配器与 store 共用，避免两份哈希公式写出不同 id）重算每行身份后回填，纯重导、不猜。

**工具行的角色不是不可变的**：真库同一次调用会从 `main|tool` 变成 `agent|coder`（`agent|coder` 64 行、`main|coder` 12 行）。第一版写成「改了就 integrity 报错」，被 `gateway-client-round-feed-replay` 直接打红（`Tool call call_… changed provider role`）。按 `status`/`name` 的语义改为**最新事件为准**。

**（3）用户提问行完全没有镜像（已修，真缺口）**

旧链路把提问画成一行的用户气泡；适配器对 `thread.status`（`liveType = thread.user_prompt`，真库 76 行，全部为 `main` scope）**完全不处理** → V2 没有这一行。当前不可见（这 76 行都在未迁移会话里），一旦迁移就会**丢内容**。已加分支：非 `message.*` 且 `role = user` 且有正文 → 镜像为 V2 用户消息（`message.created`，`status: final`）。带 `metadata.conversationV2MessageId` 的行不动（那是 V2 自己的消息，重复镜像会让同一条消息以两种 turn 身份被创建）。

注意区分：`message.*`/`thinking.*` 的 user 行**必须**继续走原分支，否则「运行期已受理的用户消息没被旧行收尾」会破（有现成用例 `reuses the accepted V2 user message identity when the legacy prompt arrives` 把它钉住，第一版就是被它拦下的）。

**（4）旧链路的提问行是重复的（记为有意分歧，V2 正确）**

修正基线后，`keeps one turn in one section…` 场景显示旧组合把提问画了**两次**（独立 entry + turn 内的 `main:prompt` 行），V2 只画一次。这不是 V2 的缺陷。处理方式：**不**放宽全局断言，而是在该用例里显式断言「旧侧重复 1 行」再对 `withoutDuplicatedPromptRows(legacy)` 比较 —— 基线带已知缺陷时必须把它钉成差异的理由，否则下一个人无法区分它和 V2 的回归。

**（5）移动端的第三个时钟（已修）**

`conversation_v2_projection.dart` 的 `_v2Timestamp(sequence)` 用**序号当微秒**造了一个墙上时钟（`at`、agent 卡片的 `startedAt/endedAt`、`generatedAt` 全用它），并且消息/工具按 `createdSeq` 排序——正是桌面「一轮被切成两段」「行跑错位置」的同一根因。现在：`occurredAt` 优先（`_v2RowTime`），排序按发生时间、序号只做 tie-break，行没有时间时保持序号顺序（**不发明时钟**）。

**证伪记录**（每条都做了「改回旧写法必须红」）：
- 桌面 A10：还原 `role` 映射 → parity 2 条红（`V2 matches the legacy Feed for a narrative/tool/final turn`、`keeps one turn in one section…`）;还原即绿。
- 移动端：还原 `role`/`at` → 新用例 `carries the provider role and the row time the Feed reads` 红（`Expected: 'planner' / Actual: 'assistant'`）;还原即绿。
- 工具角色守卫：写错即被 `gateway-client-round-feed-replay` 打红（见上）。

**验证**：桌面 V2/Feed 相关 10 个文件 **368/368**；`node scripts/test-gate.mjs` 全量 **5071 pass / 14 已知失败 / 新增 0**；移动端 `flutter test` **621/621**（含新增用例）。

### 4.16 G-3：真库语料语料库 + 真语料差分网（2026-09-16/17 执行记录）

目的：把「期望值来自旧链路输出」这条判据从**手写 L1 构造**升级为**真机会话语料**，因为手写构造只能覆盖作者想得到的情况，而用户报的缺陷全都来自真实会话里那些想不到的情况。

**（1）语料固化**

`apps/desktop/scripts/feed-corpus-fixture.mjs` 产出 `apps/desktop/test/fixtures/feed-parity/conversation-corpus.json`（~995KB，6 个会话：`thr_1789558307403`(98 事件)、`thr_1789559379858`(102)、`thr_1789559384838`(84)、`thr_1789542050047`(112)、`thr_1789531481908`(574)、`thr_1788751566714`(178，4 attempts/agents，**从未迁移**））。脱敏规则：
- 自由文本 → **content-addressed** 占位符（`<key#sha256-10:lenN>`，同文本必同 token，仍能验「同一句话出现在两处」）；
- 结构化 metadata key 原样保留（`role`/`agentId`/`stage`/`toolUseId`/`liveType`…）；
- `previewLines`/`patch`/`diff`/`sections` 只留计数；`threads` 整行保留（NOT NULL 列 + FK）；
- 短（≤40 字符）`thread.status` 与 `role=system` 正文**原样保留**（`状态已更新`、`已从异常退出恢复。`），否则测不了运维状态分类。

**（2）差分网**

`apps/desktop/test/conversation-v2-real-corpus-parity.test.ts`：每个会话插进全新内存库（**剥掉** `conversationV2MessageId` 以模拟冷迁移）→ `ConversationV2LegacyMigrator.migrate()` → 旧侧 `mergeConversationV2IntoProjection(legacy, session)`，新侧 `buildConversationV2OnlyProjection(session, …)`。**每个会话 7 条断言**，其中三条是硬约束：
- `V2 invents nothing`：新链多出来的行必须为空（禁止发明）；
- `every row V2 does not draw is recorded as something else`：丢掉的行必须被生产分类解释，且每类要有**正面断言**（`agent-lifecycle` → 该 agent 必须是 V2 的卡片；`duplicate-call-row` → 它重复的 callId 必须被渲染或在卡片 `parentToolUseId` 里；`session-status` → attempts 非空）；
- `V2 is coherent on its own terms`：子代理归属行不在主 Feed、每行都有时间、卡片按时间非递减、每个 prompt 只出现一次。

**（3）这一网打出来的 4 个真缺陷（全部已修）**

1. **整会话迁移中止**：同一 `toolUseId` 在 tool 行叫 `MCP: tool`、在 bash 审批行叫 `Bash`，`applyTool` 把它当「身份变了」抛错 → 整个会话不可迁移。修法：`toolCallId` 才是身份；`MCP: tool`、`MCP tool`、`tool` 只作为占位标签，遇到具体名时确定性升级，两个具体名仍保留首个并 `logEcoDiag("conversation-v2.tool-name-conflict")`；renderer 同步接受该单调升级。`conversation-v2-store.test.ts` 同时覆盖具体名冲突（rename 保留 `lookup`、`duplicate === false`）和占位名升级为 `Bash`。
2. **冷迁移没有 agent 注册表**：`backfillAgentRegistry()` 有「`conversation_streams_v2` 存在」门控，冷迁移没有流 → 注册表为空 → ① 每个 attempt 的 planner 实例各画一张幽灵卡片（旧链 0 卡片）；② 播种后主代理实例所属的行被分流进「卡片」而**彻底消失**（7 条 tool 行）。修法：`ConversationV2Store.seedLegacyAgents(conversationId)`（在行循环**之后**调用，因为 `seedAgentFromLegacyInstance` 需要 `headSeq ≥ 1`），读侧按 `cardAgentIds = kind === "subagent"` 分流、**未注册 owner 的 tool/消息回主 Feed**（不变量 14：宁展示不藏），并把 `toolsByOwner` 拆成 `toolsByAgent` + `unownedTools`/`mainTools`（顺带修掉「无 owner 工具被丢弃」的自造 bug）。
3. **提问行重复**：冷迁移把 `thread.status`/`thread.user_prompt` 事件行与 `thread_user_messages` 行各镜像一条 → 一个 prompt 出 2 行（真机 4 prompt 出 7 行，间隔 1ms）。修法：迁移器用 `legacyPromptEventRowsRepresentedByUsers()` 丢弃与用户消息行配对的提问事件行，配对规则 = `metadata.rewindTarget.activityLineId === user.activity_line_id`（真机 43/43 成立）**或**同文本且时间差 ≤ 1000ms；rewind 重发的提问带新 activity line，仍会镜像。
4. **`bootstrap()` 是分页窗口**（默认最新 30 条）：语料测试里把一页当全量，老行会被判成「V2 丢失」。修法：测试显式 `v2.bootstrap(conversationId, 10_000, WHOLE_CONVERSATION_MAX_BYTES)`。（测试写法缺陷，但会伪装成数据丢失，必须记。）

**（4）顺序判据换代**

旧链路对「读模型行 × legacy 行」的交织位置只是近似（工具行锚定调用首行、turn 最终输出由设计排最后），**不能当顺序 oracle**。改为 `test/support/legacy-order.ts::legacyOrderFor(events)`：顺序权威 = **legacy 事件日志的 `sequence`**（tool → 该 callId 的最小/全部 sequence；消息/`thread.status` → 按文本索引），贪心对齐后逐行非递减；turn 的最终输出行标 `final: true`，不参与顺序断言但参与内容对比。换判据后 6/6 会话顺序全绿（此前 `thr_1788751566714` 报的 1 处「planner 行排在三工具之后」是最终输出设计 + 工具锚定，不是缺陷）。

**（5）丢弃行分类（实测全语料仅 ~18 行，5 类）**

`progress-narration`（`liveType=todo.updated` / `sdkTaskKind=task_progress`，含 `tool.started`+`todo.updated` 的「Tool: Bash · Running …」）、`heartbeat`（`Tool: Tool` 且无 callId）、`agent-lifecycle`（`agent.started/stopped` 且正文非空，如 `Subagent coder started`）、`session-status`（`thread.status` + `role=system`，如 `已从异常退出恢复。`）、`duplicate-call-row`（同一 call 的第二份无 callId 行）。证据：真机 legacy 有 20 条 lifecycle 文本 / 146 条 `todo.updated`，而 live V2 消息表 **0/0** —— 与线上行为一致；`todo` 的正文另由 `listTodos`（`thread_coder_todos`）提供，与 Feed 读侧切换无关（记为阶段 C 欠账）。

**（6）结论**：6 个真会话里 V2 **零消息 / 零 thinking / 零真实工具调用 / 零提问行丢失**；丢的 ~18 行全部属于上述 5 类状态类分类。

**验证**：真语料差分 **37/37**；V2 相关 6 个套件 76/76；`test-gate` 全量 5111 pass / 14 已知失败 / 新增 0。

### 4.17 基线清零：15 条红 → 0（2026-09-17 执行记录）

`test-baseline.json` 现在**为空**，全量套件 **5127 pass / 16 skip / 0 fail**（656 个文件，36 秒）。清零过程本身又打出 **5 个真缺陷**和 **2 个跨文件污染根因**，逐条记账如下（判据：先问「代码错还是用例过期」，只有能给出实现契约证据的才算用例过期）。

**真缺陷（改了实现）**

1. `thread-live-request-coordinator.ts`：生命周期事件与内容事件用同一套「同角色多活跃请求时挑 in-flight」的宽松解析，于是两条并发同角色请求时 `request.retry_scheduled` 会认到**任意一条**——重试取消的是**另一条**请求的 span。修法：新增 `ThreadLiveRequestRegistry.resolveUnique()`，生命周期（`request.*`、`thread.api_error`）只在**唯一**命中时解析；流式内容事件保持宽松（tool-loop 重叠是预期情况）。
2. `image-generation-client.ts`：参考图用 `fs.realpath()` 解析，工作区根没解析 —— macOS `/var`（以及所有临时目录）是指向 `/private/var` 的符号链接，于是**工作区内的**参考图被判成「逃逸工作区」。修法：`workspaceRoot` 同样 realpath 后再比较。
3. `test/i18n-test.tsx`（污染根因 A）：`renderLocalized()` 用 `initReactI18next` 注册了一个**用完即弃**的实例，而该插件同时会替换 react-i18next 的**进程级默认实例**。此后任何没有 `I18nextProvider` 的文件的 `useTranslation()` 都会按这个 locale 渲染 —— `image-gallery-float`（期望中文）因此只在全量跑时红。修法：实例只经 `I18nextProvider` 注入，**不注册全局**；并在 `test/i18n-default-instance.test.tsx` 把这条不变量钉住（`getI18n()` 必须始终是渲染器的实例）。
4. `test/composer-floating.test.ts`（污染根因 B）：`Object.defineProperty(globalThis, "window", { value })` 建的是**只读**属性（`writable` 默认 false），恢复时又只恢复 `value`，于是 `globalThis.window` 永久只读 —— 之后 `terminal-links.test.ts` 直接赋值就死在 `TypeError: Attempted to assign to readonly property`。修法：`test/support/global-document.ts` 泛化为 `withGlobalProperty(name, value, run)` / `withGlobalWindow()`，**恢复的是原始 descriptor**（原来是访问器就还原访问器，不存在就删除）。
5. 顺带修掉「本地化的失败原因看不见」：`SidebarCoreSelector` 的原因文案只存在于 hover tooltip，静态渲染断言不到 —— 把同一文案挂到 `title`（键盘/读屏可读，且可断言）。

**期望值过期（改了用例，每条都写明为什么是过期的一方）**

- `image-view-injection`：`INTEGRATION_IDS` 断言被写死成 `["browser", "imageGeneration"]`，而 `computerUse` 之后成为内置集成的一等公民。改为直接断言**用例本意**「imageView 不是集成开关」。
- `browser-guest-bridge`：App 改走 `LazyBrowserWebviewLayer`（懒加载 chunk），断言 `<BrowserWebviewLayer` 落空。改为断言「App 挂了懒加载包装器，且该包装器解析到 `BrowserWebviewLayer`」。
- `image-generation-client` 两条：本身是缺陷 2 的受害者（临时目录工作区），修实现后即绿。
- `conversation-store-sqlite`（test-node）：用例要求删除编排资源时按「默认编排组合引用」**抛错阻止**，而 `f7add1cd` 已把语义改成**级联清理依赖后删除**（清理那半在 `workflow-settings-store.test.ts` 断言）。改名为「deletes them independently」并断言删除后邻居仍在。
- `anthropic-messages-golden`：`request-id` 期望的是上游 provider 的 id，而网关契约（`request-id-headers.ts` 文档注释）规定客户端看到的是 **ECO 逻辑请求 id**（Claude Agent SDK 把它读成 assistant message 的 request id），provider id 走 `x-eco-provider-request-id`。改为断言两者各归其位。
- `supabase-migrations`：`device-disable` 现在允许账号所有者清理**失联的桌面设备**（无 secret 时用 `requireOwnedActiveDesktop` 证明归属，移动端仍强制 secret）。改为断言这条分支。

**工具**：`scripts/bisect-test-pollution.mjs` —— 给一组受害者文件 + 一个目录，二分找「把它排在受害者之前就会让受害者变红」的写脏点。两个已修根因就是它找出来的。两条使用前提写进了脚本注释：① 必须用**显式文件列表**（bun 按参数顺序执行；用目录参数时顺序由 bun 自己决定）；② 顺序必须保持 **readdir 顺序**而不是排序后的顺序，否则复现不出来。

**回归网**：`test/i18n-default-instance.test.tsx`（默认 i18n 实例归属）、`test/support/global-document.ts`（descriptor 级恢复）、`conversation-v2-real-corpus-parity.test.ts`（真语料差分）现在都在闸门内。

**顺带记账（不是本轮范围，但不允许藏着）**：`bunx tsc --noEmit -p apps/desktop/tsconfig.json` 全树还有 **54 条既有类型错误**（`apps/desktop/src/main/browser-cdp-proxy.ts`、`image-view-reader.ts`、`packages/openai-anthropic-bridge/src/reasoning-classify.ts` 等，`exactOptionalPropertyTypes` 居多）。CI 的类型检查步骤因此仍是 `continue-on-error: true`，但已从 `tsc -b`（增量会吞新错）改为 `--noEmit -p`（全量报错），把这笔债变成可见数字而不是静默。清偿后才能把它变成阻断项——列为新工作流，不计入 V2 重构的退出门槛（与 Feed 无关）。

### 4.18 G-4：双端渲染 golden（桌面 = 参考实现，2026-09-17 执行记录）

**（1）契约与产物**

- 输入：`test/fixtures/feed-parity/v2-bootstrap/<会话>.json` —— 运行时**自己的** bootstrap 响应（`messages/turns/runs/tools/agents`），两端拿到**同一份字节**（移动端走 RPC，桌面走 renderer store）。
- 期望：`test/fixtures/feed-parity/v2-render/<会话>.json` —— **桌面渲染**的跨端形状。桌面被选为参考实现，是因为它本身已被 4.16 的真语料差分钉在旧链路上（对拍一个「自己也被对拍过」的东西）。
- 生成：`bun apps/desktop/scripts/feed-cross-end-fixture.ts`（重新生成 = **渲染变更**，必须在 commit 说明）；断言：`apps/desktop/test/conversation-v2-cross-end-golden.test.ts`（7 条）与 `apps/mobile/test/conversation_v2_cross_end_golden_test.dart`（7 条），两端读同一批 fixture。
- 形状（`test/support/cross-end-shape.ts`）：主 Feed 行 = `{text?, role, at, callId, status?, final?}`；卡片 = `{agentId, role, kind, status, missionText, taskName, parentToolUseId, rows}`（卡片行不含 `at`）；`attempts = {attemptId, status}[]`。
- **有意的规约**：① 工具行**不比措辞**（K10：移动端本地化动作用词 + 结构化目标优先，桌面 `Tool: Name · 目标`），比 `callId`（身份）+ `status`（`tool.started/completed/failed`）；② 卡片按 **`agentId` 排序后**比较，不比列表位置 —— 两端都把卡片画在「被吸收的 spawn 行」处，列表顺序只是各自记账（两端排序都刻意用**码元序**，不引入各自运行时的 collation）；③ 移动端把连续同类工具聚合成 `actionGroup`，序列化时**展开子行**再比（分组是移动端的设计选择，不是丢行）。

**（2）这一网打出来的 6 个真缺陷（全部已修）**

1. **移动端：行的 `role` 在 Feed 的复制/合并里被丢掉。**`ActivityFeedEntry.withSequence()`/`withIdAtSequence()` 逐字段重建，新加的 `role` 不在其中；`groupConsecutiveThinkingEntries()` 合并时也没带。于是**每一行**的 provider role 都是 null（主 Feed 156 行全中）。修法：复制点补 `role`；合并行取首块作者。副作用说明：为拿到 role 而写的「按 item id 反查 role map」的兜底被删除 —— 它会掩盖同类缺陷。
2. **移动端：thinking 合并行的时间锚点取首块**（`at: first.at`），桌面取末块。合并行报告的是「思考完成」，位置应在末块（`at: last.at`）。
3. **移动端：工具行的 `callId` 在非「工具动作」分支丢失**（持久化 imageView 分支只留 `eventId`）。`thr_1789531481908` 第 142 行：桌面有 `callId`，移动端没有 —— 一个「哪次调用」在移动端不可知。
4. **移动端：工具行的结局不可比** —— 移动端 `lifecycle` 混了两套词表（工具生命周期 + bash 审批阶段），`approvalPending/approvalApproved` 无法映射成工具结局。修法：新增 `ActivityFeedEntry.toolEventType`（来自 `item.eventType`，与桌面 `item.eventType` 同一个事实），契约的 `status` 用它。
5. **移动端：attempt 终态词表与桌面不同** —— `cancelled/interrupted` 被映射成 `failed`（`thr_1788751566714` attempt 3：桌面 `cancelled`、移动端 `failed`）。修法：对齐桌面 `conversationV2RunStatusToAttemptStatus`（`cancelled/interrupted/unknown → cancelled`），移动端 UI 本来就认识 `cancelled`（`turnStatus == 'cancelled'`）。
6. **移动端：卡片 `status` 未按桌面词表映射**（`completed` vs 桌面 `stopped`）。修法：新增 `_projectionAgentStatus()`，与桌面 `agentProjectionStatus` 逐分支一致。

**（3）顺带清掉的死代码**

`lib/features/threads/conversation_v2_activity_feed.dart::buildConversationV2ActivityFeed`（+ `_ConversationV2FeedCandidate`/`_messageRank`/`_runStatusLabel`/`_runLifecycle`/`_toolLifecycle`）是**生产从不调用的第二个渲染器**（只有测试引用；生产走 `buildConversationV2Projection` + `buildActivityFeed`）。它不带 role / 归属 / 时间 / 注册表，一旦被接上就是整类分歧。删除后把仅有的两条测试改写到**生产路径**上（顺序、thinking 显示模式），断言按生产语义写：单 attempt 的 run 行就是 turn 本身；collapsed 模式把相邻 thinking 折成一行且该行位于末块。

**（4）回归网**：`apps/mobile/test/activity_feed_test.dart` 新增两条 —— 「重排一行后它的事实仍在」（`withSequence`/`withIdAtSequence` 必须保住 `role`/`toolEventType`/`toolUseId`）与「折叠的 thinking 行站在末块且保留作者」。

**（5）结论**：6 个真会话**主 Feed 逐行相等**（语料扩到 9 会话后的复检见 4.19）（文本/role/时间/callId/结局/最终输出行），卡片与 attempts 全等；桌面 7/7、移动端 7/7 绿。G-4 达成 —— 这是「删旧链路」门槛里「双端 golden」那一项的落地。

### 4.19 语料扩容 6 → 9 会话 + 真库审计（2026-09-17/18 执行记录）

**（1）为什么扩容**：4.16 的 9 条断言在 6 个会话上是绿的，但 6 个会话里没有「请求失败（`api.error`）」「同一 attempt 内重复提问」「冷迁移的大会话（1000+ 事件、5 个 attempt）」这三类形状。真库（29 线程）里 16 个会话从未迁移、13 个已有 V2 事件，语料只覆盖了其中 6 个 —— **覆盖不到的类，网就是绿的**。

**（2）真库审计先分页拉全历史，再比**（这是本轮第一个教训）

`bootstrap(id, pageSize, maxBytes)` 是**分页窗口**：单页上限 `CONVERSATION_V2_MAX_PAGE_SIZE = 100`，返回 `hasOlder`/`olderCursor`，续页走 `messagesPage(id, beforeCursor, limit, maxBytes)`。只取一页去比整个旧链路历史，会得出「V2 丢了 960 行」的**幻觉**（用生产组合 `withLegacyHydration` 分页后 13 个会话 V2 ≈ legacy，`thr_1789540220642`：legacy 1119 / V2 1115）。harness（`test/support/v2-corpus.ts::corpusBootstrap`）因此改成**按生产客户端的方式分页**（`BOOTSTRAP_PAGE_SIZE = 60`、`HISTORY_PAGE_SIZE = 100`），跨端 fixture 的输入半边也改成**拉全后的整段历史**（`feed-cross-end-fixture.ts`），否则两端拿到的输入都不是应用里会渲染的东西。

**（3）这一网打出来的 5 个真缺陷 + 2 个能力缺口（全部已修）**

1. **桌面：同一请求内的多个 thinking 块被折叠成一行、只留最新那条（内容丢失）。**`thread-run-projection-view.ts::projectionStreamDisplayKey` 对「有 requestSpans 的请求」用 `thinking:request:<requestId>` 作流键，于是同一请求里的多个 reasoning 块互相吞并（真机 `thr_1789537718627` 丢 6 块）。根因不是折叠规则本身，而是 **V2 侧的行没有「自己的逻辑身份」**：V2 message 行的 `streamKey` = messageId（不含 `:block:`），既没命中显式块键也没命中显式逻辑键，于是掉进「按请求折叠」这一档。修法：V2 message 行带 `metadata.logicalEntityId = messageId`（消息是不可变的、写入侧已按流去重，一行 message 就是一行 Feed），折叠规则据此按行身份分桶。
2. **桌面：`api.error`（失败通知）在 V2 里根本没有行 —— 迁移后「为什么失败」消失。**旧链路把这条记录渲染成 planner 角色的 Feed 行（带重试入口），V2 的 `ConversationEventType` 里没有对应类型，迁移器把它记成 `legacy_event_unmapped` 丢弃。修法：适配器把 `api.error` 镜像成 **`channel: "system"` 的 notice 消息**（`role: "system"` + `providerRole` 保留 provider 自己的标签，正文照旧，身份用行自己的 event id —— 一次重试失败可能复用同一个 requestId，按流键会把第二条通知吃掉），两端渲染器把 system 频道读成 **通知**（桌面 `eventType: "api.error"`，移动端同）；`isSupportedLegacyType` 收 `api.error`，迁移报告不再报 unmapped。
3. **桌面：客户端从不翻历史 —— 迁移过的长会话只显示最新一页。**读侧切到 V2-only 之后，`loadConversationV2RendererState` 只 `bootstrap(pageSize: 60)` + 追平 effect，**没有任何地方调用 `messagesPage`**（IPC 有，客户端没有）。于是 60 条消息以前的历史（含它们的 attempt/tool 行）在 Feed 里根本不存在。修法：渲染器状态新增 `mergeConversationV2OlderPage`（读历史不推进 `appliedSeq`；重复行按 `versionSeq` 只前进不后退），`App.tsx` 新增 `loadConversationV2OlderHistory` 一路翻到 `hasOlder === false`（游标重复即报错，不静默死循环）。这是本轮**最严重**的一个：语料网在 `thr_1789133041817` 上报的 46 个「旧链路有、V2 没有」的工具调用，全部是这一个缺口造成的（store 里 138 个调用一个不少，只是没被读出来）。
4. **桌面：同一 attempt 内两条**完全相同**的提问，丢掉一条。**`collapseRedundantMessageDisplayItems` 的本意是压掉「旧链路的回声」（累积流 + 合并行造成的重复），但判据是 `eventType ∈ {message.delta, message.final}` —— V2 里**提问行也是 `message.final`**，于是「继续」发两次（`thr_1788608485610`，12:21:53 与 12:36:05）只画一条。修法：`isMessageSpeechDisplayItem` 先排除提问行（`isProjectionUserPromptItem` 或 `role === "user"`）：提问不是 assistant 的措辞。
5. **移动端：把 `system` 频道读成「不是 answer 就是 thinking」，并且把通知读成了本轮回答。**移动端 `isThinking = channel != 'answer'`（桌面是 `channel === 'thinking'`），于是失败通知要么被折进 thinking 流（collapsed 模式下直接消失），要么被当成 `message.final` 的 assistant 叙述 —— **被 `_resolveFinalProjectionOutput` 选成「本轮最终输出」**，读者看到的「回答」是失败提示。修法：`isThinking = channel == 'thinking'`，`isNotice`（system 频道）映射成 `api.error`（与桌面同一事实）。

**（4）对拍口径的新规矩**

- **语料网的「提问行唯一」判据是错的**：它按**文本**去重，于是「同一个短消息发两次」被判成缺陷（真缺陷是「同一条提问画两行」）。改为与读模型里的 user message **多重集相等**（`userMessageIds`）—— 文本不是身份。
- **旧链路的重复通知行**：合并路径既画旧链路的 `api.error` 行（无锚点 → 落在轮次起点）又画新镜像的 V2 notice 行（合并器不认识它们是同一件事），于是旧侧一行变两行、时间还不是自己的。这是**旧链路的缺陷**，规格化在测试侧（`withoutNoticeTimes` / `withoutDuplicatedNotices`），而 **V2 侧「一条通知一行、时间取自记录」另有正面断言**（`conversation-v2-projection-parity.test.ts`），并只对旧侧做去重（V2 自己重复画一条会被抓住）。
- **移动端 golden 的会话清单必须从 fixture 目录读**：写死的 6 条 id 让 3 个新会话在移动端**从未渲染过**，套件照样绿。现在用例从 `v2-render/*.json` 读，并断言它与 `v2-bootstrap/*.json` 的集合相等。

**（5）结论**：语料 9 会话（2.7MB）桌面差分 **55 条全绿**（9×6 + 覆盖 1）；跨端 golden 桌面 **10/10**、移动端 **10/10**（9 会话 + 覆盖各 1）；桌面套件 `node scripts/test-gate.mjs --strict` **5161 pass / 16 skip / 0 fail**；移动端 `flutter test` **634 pass**。

## 5. 执行协议（一条一条）

### 2026-09-17 G-5 / V2 command 第十一批执行记录

- send receipt 已有重启恢复扫描，但 queued V2 message → runtime schedule 的转换遗漏 attachments；已接受的带图命令在桌面崩溃后会退化成纯文本执行。
- 新增受测转换，完整恢复并规范化图片 `mediaType/data/path`；恢复入口使用该结果调度。
- 损坏附件返回 `integrity_failure` 并把 queued 消息显式终结为 failed，不允许丢弃附件后继续执行。
- 定向验证：请求/字段守恒 21/21；全量 tsc 仍为 54 个既存错误，本次相关文件无诊断；`git diff --check` 通过。

### 2026-09-17 G-5 第十批执行记录

- 新增合法 V2 Realtime 往返：bind-channel broadcast 收到 `conversation:head` invoke，经真实 `DesktopEventCenter` 的 remote command 校验/handler，返回 `{channel, result}` 双层 JSON-RPC envelope。
- 修复 `SupabaseRealtimeRpc.sendOnBinding()`：SDK `channel.send()` 抛异常或返回非 `ok` 时立即清除 request timer/pending；不再保留迟发 timeout，也不 reject 未返回给调用者的内部 Promise。
- 定向验证：Realtime RPC 10/10；Realtime + Center client + EventCenter 组合 38/38；Biome、`git diff --check` 通过。
- 本机没有运行本地 Supabase 容器；本批是进程内真实组件集成，仍不能算设备绑定后的私有 Realtime 网络、断网重连、响应丢失、末条 effect 或背压验收。

### 2026-09-17 G-5 第九批执行记录

- 审计发现移动端 `DesktopRpc` 的 V2 route 没有 wire contract 专项；新增 capabilities/bootstrap/messages-page/details-page/head/sync/send-message 的 channel 与完整参数断言。
- 覆盖 pageSize/limit/maxBytes/cursor、detail 的 toolCallId/agentInstanceId 过滤、sync 的 afterSeq/throughSeq/maxEvents，以及 send 的 principal/clientCommandId/显式 turn/message id/attachments。
- detail response 使用完整父子归属、created/version seq 与空 `content/ref`，确认 RPC 解析不裁字段。
- 定向验证：相关 analyze 无问题，`desktop_rpc_test` 33/33，`git diff --check` 通过。该测试使用 recording transport，只验收 adapter 契约；真实 Supabase WebSocket、设备绑定、断连/重连、响应丢失、末条 effect 和背压仍未验收。

### 2026-09-17 G-5 第八批执行记录

- 新增独立 Bun crash worker：在真实临时磁盘 SQLite 提交 send command 与 receipt，输出已接受结果后保持连接打开，不主动 close。
- 父测试收到 receipt 后对 worker 发送 `SIGKILL`，再用新连接 initialize + rebuild；同 command 重试结果必须与原 receipt 全等，head seq 不增长，消息不重复。
- 定向验证：字段守恒 14/14，新增 worker 与测试通过 Biome，`git diff --check` 通过。
- 证据边界：已覆盖“已接受命令后的无清理进程强杀恢复”；未覆盖 COMMIT 中途死亡、OS/磁盘缓存丢失和物理掉电。G-5 仍剩真实跨端传输故障矩阵与上述事务中断/掉电专项。

### 2026-09-17 G-5 第七批执行记录

- 移动端 detail 已能全字段持久化和 DTO 往返，但最终 `ActivityFeedEntry` 只保留展示文本、run/tool/agent 与 createdSeq；versionSeq、agent instance、父 agent/父 tool 以及空字符串语义在 Feed 消费边界丢失。
- `ActivityFeedEntry` 新增完整 `conversationV2Detail` source row，`buildConversationV2ToolDetailFeed()` 写入 `ConversationV2Detail.toJson()`；`withSequence()` 与 `withIdAtSequence()` 均显式复制，避免排序、分组或重编号后二次丢字段。
- 新样本同时覆盖 agentId、agentInstanceId、parentAgentInstanceId、parentAgentId、parentToolCallId、toolCallId、createdSeq/versionSeq 及 `content/ref = ''`，并断言两种 copy 路径保持全字段相等。
- 定向验证：相关生产文件 analyze 无问题，V2 activity 15/15，`git diff --check` 通过。结合桌面现有 detail typed renderer/store 全字段守恒，L5 关闭；G-5 整体仍未关闭，剩余真实跨端传输与进程强杀/掉电恢复。

### 2026-09-17 G-5 第六批执行记录

- Feed projection 审计发现桌面子代理工具虽然被放进 agent timeline，行本身仍是 `scope=main` 且没有 `agentId`；移动端没有卡片可承载的 orphan message 留在主 Feed 时也清掉了原 owner。两处均修复为“展示位置可回主 Feed，但来源归属事实不能丢”。
- 双端 message projection 保留 logical entity、turn、version/content version、channel/status、agent instance；tool projection 保留 version、agent instance、父 agent instance、父 tool，并对卡片内工具显式设置 agent scope。
- 迁移器此前用 `seedLegacyAgents()` 直接写读模型，bootstrap 有 agent 但 immutable event/effect 没有，任何 seq-0 replay 都缺注册表；同时 agent source 行不在 fingerprint 中。现将 `thread_agent_instances` 纳入指纹/报告/校验，并为每行追加幂等 `agent.created`，持久化为 `agent.upsert`。
- 新迁移专项覆盖完整可选字段、空 mission、bootstrap 与 seq-0 replay 相等、rerun 不增 seq；9 会话真语料字段守恒现同时比较 message/run/tool/agent，并在 rebuild 后比较 agent 注册表。
- cross-end golden 抓到将 registry mission 提到首位会把 `<delegationPrompt...>` 错换成 `<missionKey...>`；未修改 golden，而是恢复 delegation 优先、mission 缺失兜底的真实语义。
- 定向验证：桌面 migration 7/7、字段守恒 13/13、投影/真语料/cross-end 合计 96/96；移动端相关 analyze 无问题，projection/activity/cross-end 41/41。
- 旧 V2 stream 的错误 effect 不做原地重写；正式维护窗口必须从 legacy source 全量重导，才能获得新的 replayable agent effects。剩余 G-5：detail 到最终 Feed 的消费字段、真实传输、进程强杀/掉电恢复。

### 2026-09-17 G-5 第五批执行记录

- 沿 agent 字段继续追到最终消费端，发现移动端 projection model 丢弃 registry 的 `mission`、`todoId`、`parentAgentInstanceId`；桌面投影则用 truthy spread 丢失显式空 mission。这些字段此前“存储正确”但未守恒到 Feed。
- 移动端 `ThreadRunProjectionAgent` 增加 mission/todo/父 agent，fromJson、增量 merge、详情 timeline copy 和 V2 projection 同步传递；第六批真语料确认展示时 delegation 优先，registry mission 只在 delegation 缺失时接替。
- 桌面 V2-only projection 保留显式空 mission；完整 agent 样本新增 projection 端全字段断言（身份、状态映射、起止时间、mission/task/delegation/todo、父 agent/父 tool、run）。
- 定向验证：桌面 conservation 13/13；移动端 conversation V2 activity + projection model 31/31。移动端 analyze 报 8 条既存 info（旧相对导入和旧单行 if），没有新增 error/warning；不把该结果写成静态门禁通过。
- 仍未验收：agent 之外各事件类型的完整 Feed 消费清单、真实跨端传输、历史 agent 注册表全量重放，以及进程强杀/掉电恢复。

### 2026-09-17 G-5 第四批执行记录

- 移动端缓存增加数据库工厂与路径注入点，生产默认仍为 sqflite；宿主测试按官方/社区推荐使用 `sqflite_common_ffi`，不再用 fake cache 代替 SQLite 事务证据。
- 临时磁盘库验证完整 agent 可选字段、空 mission、关闭重开持久化；同一 page 的第二个同版本冲突会让前一个 `agent.upsert`、effect hash 与 applied seq 一起回滚，再次重开仍保持原状态，并能从原 seq 正常续写。
- 桌面 send receipt 改用临时磁盘文件：关闭第一个连接、第二连接重开并 rebuild 后，同 command 返回完全相同结果，seq/消息不增加；损坏 receipt 后 fail-closed，仍不追加事件。
- 定向测试：移动端真实 SQLite 1/1、桌面 conservation 13/13。该证据只覆盖干净关闭重开与事务异常，不冒充进程强杀、掉电恢复或真机 SQLite 验证。
- 仍未验收：Feed 全字段转换、真实跨端传输、旧历史 agent 注册表全量重放，以及进程强杀/掉电恢复。

### 2026-09-17 G-5 第三批执行记录

- agent 生命周期改为持久化完整 `agent.upsert`，同步更新共享 union、store 支持清单/DTO 校验、桌面 reducer、移动端支持清单与 SQLite reducer；不读取 V1、不静默刷新 bootstrap。
- 校验版本倒退、同版本冲突、角色/kind 与既有 run/父级归属变化；修复空 mission 在桌面 DTO 和移动端解析中的丢失。
- 完整 agent 样本验证 started → completed 增量结果、bootstrap 对照、重复投递、read-model rebuild 与错误归属事务不增加 seq。
- 定向测试桌面 57/57、移动端 29/29；变更 Dart 文件 analyze 无问题。桌面 tsc 整体失败，全量门禁未重跑。
- 保留 effectVersion 1 envelope，旧客户端按未知 effect 显式阻断，必须双端同批发布；旧不可变 agent invalidation 历史仍需迁移重导。
- 当时未验收的移动端真实 SQLite agent effect 原子写入/失败回滚已由第四批补齐；真实跨端传输与历史全注册表重放仍未完成。

### 2026-09-17 G-5 第二批执行记录

- 共享属性清单增加 `ConversationDetailItem` 和 `ConversationSendMessageResult`。
- detail 全字段样本验证分页读取、持久化 effect、renderer 重放与 read-model rebuild；移动端验证全部归属字段及空字符串/缺失值往返。
- 修复移动端 detail 的 `content/ref` 空字符串被解析为 null，新增显式 `toJson()`。
- send receipt 当时只验证同一 SQLite 连接上的 store 实例重建和 read-model rebuild 后全字段重试一致、seq 与消息数量不增加；第四批已补磁盘关闭重开，进程强杀/掉电恢复仍未覆盖。
- 定向验证：桌面 conservation 12/12、store/renderer 44/44，移动端 conservation/models 16/16；变更 Dart 文件 analyze 无问题。本批未重跑全量门禁。
- 明确剩余缺口：agent 生命周期仅发送 `detail.invalidation`，没有 `agent.upsert`，增量无法维护注册表。下一批需共享协议、store 持久化 effect 校验、桌面与移动端消费者同步实现并加重放守恒测试；不得通过重新读取 V1 或静默 bootstrap 兜底。

### 2026-09-17 G-5 第一批执行记录

- 新增桌面 `conversation-v2-field-conservation.test.ts`：用 TypeScript AST 对比消息/run/工具/代理 DTO 的全部属性与显式字段清单；9 会话从 seq 0 重放持久化 effect，与分页读全后的 renderer 实体做全字段比较，再验证消息/run 的读表重建结果。
- 新增移动端 `conversation_v2_field_conservation_test.dart`：读取同一批 9 会话 bootstrap，消息/run/工具/代理的解析、序列化、JSON 缓存往返做完整对象比较，消息同时经过 `copyWith()`。
- 首跑桌面 1 绿 9 红，定位到 `getMessage()` SQL 漏选 `agent_id`、`agent_instance_id`、`occurred_at`、`provider_role`。`message.create` effect 由该查询构造，所以 bootstrap 有字段而 effect 永久缺字段。已补齐查询，新产生的 effect 守恒；已有错误 effect 不会被本次代码修改重写，仍须按主计划做受控重导。
- 首跑移动端 1 绿 9 红，缺省 attachments 被 `_optionalList` 转成空数组，缓存序列化增添了 wire 不存在的属性；消息解析已保留缺省与显式空数组的区别。
- 两端新增测试各 10/10 通过。这是 G-5 的部分覆盖，不标整体完成：detail、command receipt、全部可选字段非空样本、代理增量同步及 Feed 全字段转换仍待补齐。
- 本批全量验证：`node scripts/test-gate.mjs --strict` 为 5171 pass / 16 skip / 0 fail；`flutter test` 为 644 pass / 0 fail。改动的移动端模型与新测试 `flutter analyze` 无诊断。全量 TypeScript 仍有既有静态错误，未标通过。

1. **顺序**：P0 = 4.1/4.2/4.3 中所有 🔴 与 ❌，其次 4.4–4.8，最后 4.9–4.12。
2. **分歧裁决规则**（不把技术判断推给人，2026-09-16 补）：
   a. 默认**对齐旧链路**：新链路与旧链路渲染不同即为回归，除非能给出证据。
   b. 要判定「V2 更正确」必须同时具备：真库/渲染证据（会话 id 或截图级复现）+ 一条把它钉住的用例（在对比处显式断言旧侧的缺陷）+ 本文件记账。三者缺一，一律按回归处理。
   c. **对拍基线是生产渲染组合**，不是某一侧的中间产物：旧侧 = `mergeConversationV2IntoProjection(legacy, v2)`，新侧 = `withLegacyHydration(buildConversationV2OnlyProjection(v2))`。行的身份 = 文本 + role + 时间。
   d. 涉及**删除/重写用户数据**的操作：先在 `VACUUM INTO` 副本上跑通并给出前后对照，再走应用自身的幂等启动路径落库；不允许手工改库（计划正文「不做数据手术」）。
   e. 需要人裁决的只有**产品取向**（例如同一个事实的两种文案取舍）与**不可逆的破坏范围**；技术正误、与不变量的一致性、测试怎么写，由实现者按 a–d 决定并留证。
3. **每个场景的步骤**（固定模板，不允许跳步）：
   a. 选一条真库语料（真实会话 id）或 L1 构造场景；
   b. 写出**会失败的**用例（期望=旧链路输出）；
   c. **证伪**：临时还原实现或注入缺陷，确认用例变红；
   d. 修复，确认用例转绿且不破坏既有用例；
   e. 更新本文件状态行 + 记录会话 id/commit。
4. **每个场景必须有**：语料标识、旧行为、断言、跨端等价（桌面/移动端同构）。
5. **禁止**：`toMatchObject` 当全量断言、只断言"存在"、用自己的输出当期望、把"不影响使用"当验收。
6. 每完成 10 个场景跑一次全量桌面+移动端套件，红灯不许进 baseline。

## 6. 闸门（不通过不许合并/不许删旧代码）

- **G-1** ✅ 已落地：`.github/workflows/desktop-tests.yml` 跑 `node scripts/test-gate.mjs`（桌面 bun 套件，实测 23 秒），PR 阻断；桌面套件此前在 CI 零覆盖。
- **G-2** ✅ 已完成：45 红 → 14 红 → **0 红**（`test-baseline.json` 为空），`node scripts/test-gate.mjs` 全量 5127 pass / 16 skip / 0 fail。跨文件全局态污染的 4 个根因全部定位并修掉（i18n 语言泄漏、`globalThis.document` 只读、`globalThis.window` 只读、`renderLocalized` 抢注默认 i18n 实例），并各留一条守卫用例；定位工具是 `scripts/bisect-test-pollution.mjs`。清单机制保留：新失败必须先修，或写清原因列进来；列进来之后修好会被 `--strict` 要求删除。
- **G-3** ✅ 差分网已落地（真库语料 fixture **9 会话** + 真语料差分套件 **55 条**，见 4.16/4.19），并**已在 CI 内**：套件落在 `apps/desktop/test/`，由 `.github/workflows/desktop-tests.yml` 的 `node scripts/test-gate.mjs --strict` 覆盖；双端 golden（4.18）的移动端一半由 `.github/workflows/mobile-tests.yml` 的 `flutter test` 覆盖，两端读同一批 fixture。
  - `bun run feed:parity`（`apps/desktop/scripts/feed-skeleton-parity-audit.mjs`）是**针对用户真机库**的骨架对拍审计，需要真实数据库，**结构上不能进 CI**，也不进闸门；它在本地按需跑（`bun run feed:parity -- "$HOME/Library/Application Support/@eco/desktopDev/eco-coding.sqlite"`）。CI 里能跑的那一半 = 语料套件 + 双端 golden，二者都已进。
- **G-4** ✅ 已完成（见 4.18/4.19）：双端 golden 落地（同一份 bootstrap 语料 → 桌面 **10/10**、移动端 **10/10** 断言同一份 fixture，9 会话全覆盖），过程中打出并修掉 **6 个移动端真缺陷** + 4.19 的 5 个真缺陷，另删掉一个生产不调用的第二渲染器。
- **G-5** ⛔ 阻断 V2-only 切换：字段守恒契约——每种事件类型一张「必须活到消费端」的字段清单，全字段比较（`occurred_at`、`providerRole`、`agentId`、`agentInstanceId`、`parentToolCallId`、`status`、`runId`、`contentVersion`…），新增列必须同时进清单，否则测试失败。

## 7. 下一批：V2-only 切换关键路径

1. **G-5 字段守恒**：先建立事件 → 读模型 → effect → TypeScript/Dart DTO → Feed 的全字段契约，避免继续在两端补洞。
2. **V2 command + receipt**：发送、审批、澄清、计划/todo、编辑、删除、重试/分支全部脱离旧 RPC；覆盖接受后崩溃、重复提交和结果丢失。
3. **V2 runtime writer**：SDK/live 事件直接进入 V2 事务入口；删除生产路径对 legacy adapter 的依赖，禁止同时写两套事实。
4. **迁移命令**：实现 V2 独有数据/附件/receipt 守恒预检、备份、暂存库全量重导、校验、checkpoint、恢复、epoch 更新与全库 storage version 原子切换；无法证明无损则停止。
5. **迁移演练**：在最新真库 `VACUUM INTO` 副本上跑两遍；覆盖已有 V2 stream、未迁移会话、损坏记录、迁移中断和磁盘不足。
6. **P0 可见语义**：补齐仍为 ❌/🟡 的 T3–T8、R3–R8、A6–A9、D4/D5、L3/L5，并把有意分歧逐条钉在测试中。
7. **真实传输与真机**：Supabase 末条丢失/重连/背压、桌面重启、Android/iOS 长会话和性能预算。
8. **静态门槛**：清零 TypeScript 错误与 Flutter analyze warning，并改成 CI 阻断。
9. **原子切换**：维护窗口执行全量重导；任一会话校验失败则不切换。
10. **删旧运行时**：删除 `withLegacyHydration()`、旧写入口、旧 RPC、骨架合并和旧投影生产引用；观察期后再移除对拍基准。

每完成一项都重跑 L0 全场景、双端 golden、桌面/移动端全量套件，并更新本文件状态；不得等到切换前一次性补测试。

---

维护约定：这是**活账本**。每修一个展示层缺陷，先加场景行再修；每次重构前，先看哪些行的期望来自"旧链路输出"，那些行在新链路上必须仍然绿。
