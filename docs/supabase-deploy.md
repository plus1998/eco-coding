# Eco Supabase 部署指南

开源 Eco **不提供官方托管节点**。在自己的 Supabase（**Cloud** 或 **自托管 Docker**）上部署本仓库 `supabase/` 下的 schema 与 Edge Functions。

| 场景 | 文档 |
| --- | --- |
| **Supabase Cloud** | 本文下方「初次部署（云项目）」→ `--platform cloud` |
| **自托管 Docker** | **[supabase-self-host.md](supabase-self-host.md)** → `--platform self-host` |
| **本机开发** | 本文「本地开发」（`start` / `reset` / `functions:serve`，不是 deploy） |

客户端只需填写：

| 字段 | 来源 |
| --- | --- |
| Project URL | Cloud：Dashboard → Settings → API；自托管：网关 URL（如 `https://host` / `http://host:8000`） |
| anon key | Cloud：anon public；自托管：`sh run.sh secrets` |

**禁止**把 `service_role` 发给 Desktop / Mobile。

Agent 请遵循 [`.cursor/skills/eco-supabase/SKILL.md`](../.cursor/skills/eco-supabase/SKILL.md)。

---

## 前置

- Node.js 20+（`npx supabase` / 本仓库脚本）
- Cloud：Supabase 账号；自托管：Docker 主机（见自托管文档资源建议）

---

## 初次部署（云项目）

### 1. 创建项目

1. [Dashboard](https://supabase.com/dashboard) → **New project**
2. 保存数据库密码
3. **Project Settings → General**：复制 **Reference ID**（`project-ref`）
4. **Project Settings → API**：复制 **URL** 与 **anon public**

### 2. 认证与 Realtime

- **Authentication → Providers → Email**：开启  
- **Confirm email**：生产建议开启；本地自托管开发可关  
- **Realtime → Settings**：关闭 **Allow public access**

#### 邮箱确认（Confirm email 开启时）

Supabase **没有**像 Vercel 那样的整站静态托管；确认成功页用本仓库 Edge Function 托管：

`https://<PROJECT_REF>.supabase.co/functions/v1/auth-email-confirmed`

1. Desktop 注册若未立刻返回 session，会提示「查收邮件 → 确认 → 再登录」。  
2. 部署函数后，在 Dashboard：  
   - **Authentication → URL Configuration → Site URL**  
     设为上面的 `auth-email-confirmed` 地址  
   - **Redirect URLs** 中加入同一地址  
3. 用户点邮件链接 → 打开该页（「邮箱已确认」）→ 回 Eco **登录**。

部署该函数：

```bash
supabase functions deploy auth-email-confirmed
# 或全量：bun run supabase:deploy -- --platform cloud --project-ref <ref>
```

### 3. 关联仓库并部署

**Windows：** 不要依赖 `npx supabase`（常报 `No matching Supabase CLI binary package found for win32-x64`）。请先装官方二进制之一：

- Scoop：`scoop bucket add supabase https://github.com/supabase/scoop-bucket.git` → `scoop install supabase`
- 或从 [CLI Releases](https://github.com/supabase/cli/releases) 下载 `supabase_*_windows_amd64.zip`，把 `supabase.exe` 放到 PATH（或设 `SUPABASE_CLI=C:\path\to\supabase.exe`）

然后：

```bash
supabase login
bun run supabase:deploy -- --platform cloud --project-ref <你的-project-ref>
```

macOS / Linux 可用 `npx supabase login`，或同样安装全局 CLI 后用上面的 `bun run supabase:deploy`。

`link` / `db push` / `functions deploy` **不必**再走仓库 npm 脚本：`--platform cloud` 已经做完。若要单独排障，直接用官方 CLI：

```bash
npx supabase link --project-ref <你的-project-ref>
npx supabase db push
npx supabase functions deploy device-register
npx supabase functions deploy device-session-register
npx supabase functions deploy pairing-create
npx supabase functions deploy pairing-join
npx supabase functions deploy device-disable
npx supabase functions deploy auth-email-confirmed
```

`db push` 按 `supabase/migrations/` **文件名顺序增量**应用尚未执行的 migration。

设备 session 基础设施会随常规 migration 部署，但设备级 RLS 强制策略位于
`supabase/deferred-migrations/20260822102000_enforce_device_sessions.sql`，不会被
`db push` 自动执行。必须先发布包含 `device-session-register` 的 Desktop/Mobile，等现有
设备重新连接并完成 secret proof，再单独审核、执行该 SQL。提前执行会让旧客户端立即
失去 private Realtime、binding 与 Vault claim 权限。

### 4. 填入 Eco

Desktop / Mobile：Project URL + anon key → 邮箱注册/登录。

### 5. 冒烟（可选）

```bash
curl -sS -X POST "$SUPABASE_URL/functions/v1/device-register" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"kind":"desktop","name":"Smoke Test"}'
```

应返回 `201` 与一次性 `deviceSecret`。

---

## 增量更新（云项目，已部署）

```bash
bun run supabase:deploy -- --platform cloud
bun run supabase:deploy -- --platform cloud --db-only
bun run supabase:deploy -- --platform cloud --functions-only
```

规则：

1. **只追加**新的 `supabase/migrations/YYYYMMDDHHMMSS_*.sql`，不要改写已发布旧文件。
2. 函数变更用 `--functions-only` 或全量 deploy。
3. 本地可用 `npx supabase db reset`（清空本地库）。

自托管增量见 [supabase-self-host.md](supabase-self-host.md) §B。

---

## 本地开发

```bash
npx supabase start
npx supabase db reset
npx supabase functions serve
npx supabase status
```

---

## 自托管（摘要）

完整步骤：**[supabase-self-host.md](supabase-self-host.md)**。

```bash
# 1) 官方 Docker 栈（服务器上）
curl -fsSL https://supabase.link/setup.sh | sh
cd supabase-project && sh run.sh start && sh run.sh secrets

# 2) 在 eco-coding 仓库根安装 Eco schema + 函数
bun run supabase:deploy -- --platform self-host --compose-dir /path/to/supabase-project
```

---

## 包脚本一览

部署只有一条入口：

```bash
# 交互向导（推荐）：选平台 → 首次/更新 → 按提示填写
bun run supabase:deploy

# 非交互（CI）
bun run supabase:deploy -- --platform cloud --project-ref <ref>
bun run supabase:deploy -- --platform self-host --compose-dir <dir>
```

| 脚本 | 作用 |
| --- | --- |
| `bun run supabase:deploy` | 交互向导，或带 `--platform` 的脚本化部署 |

本机开发栈直接用官方 CLI（仓库不再包一层）：`npx supabase start` / `stop` / `status` / `db reset` / `functions serve`。`db reset` 只清本地库，不要对生产跑。

`npx supabase link` / `db push` 不是仓库脚本：Cloud 部署已包含它们；排障时直接调官方 CLI。

实现：[`scripts/supabase-deploy.mjs`](../scripts/supabase-deploy.mjs) 按平台转到 Cloud 逻辑 / [`supabase-self-host-apply.mjs`](../scripts/supabase-self-host-apply.mjs)。

---

## 故障排查

| 现象 | 处理 |
| --- | --- |
| `db push` 要数据库密码 | Cloud 项目 DB password |
| `must be owner of table messages` | 勿 `ALTER realtime.messages`（RLS 已默认开启）；只建 policy 后重跑 `db push` |
| 函数 401 | access token / anon 是否同一项目；`verify_jwt` |
| Realtime 进不了私有频道 | 关 public access；确认 migration RLS |
| Desktop 连不上 | URL/anon；邮箱是否需确认 |
| Free 项目暂停 | Dashboard 恢复 |
| 自托管 OOM / 函数 404 | 见 [supabase-self-host.md](supabase-self-host.md) §E |

---

## 目录

```text
supabase/
  config.toml
  migrations/
  functions/
docs/supabase-deploy.md       # 本文（Cloud + 总览）
docs/supabase-self-host.md    # 自托管专用
```
