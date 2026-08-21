# Eco Supabase 部署指南

开源 Eco **不提供官方托管节点**。在自己的 Supabase（**Cloud** 或 **自托管 Docker**）上部署本仓库 `supabase/` 下的 schema 与 Edge Functions。

| 场景 | 文档 |
| --- | --- |
| **Supabase Cloud** | 本文下方「初次部署（云项目）」 |
| **自托管 Docker** | **[supabase-self-host.md](supabase-self-host.md)**（人 / Agent 完整清单 + `supabase:self-host:apply`） |
| **本机开发** | 本文「本地开发」 |

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

- **Authentication → Providers → Email**：开启；开发可关闭 **Confirm email**
- **Realtime → Settings**：关闭 **Allow public access**

### 3. 关联仓库并部署

**Windows：** 不要依赖 `npx supabase`（常报 `No matching Supabase CLI binary package found for win32-x64`）。请先装官方二进制之一：

- Scoop：`scoop bucket add supabase https://github.com/supabase/scoop-bucket.git` → `scoop install supabase`
- 或从 [CLI Releases](https://github.com/supabase/cli/releases) 下载 `supabase_*_windows_amd64.zip`，把 `supabase.exe` 放到 PATH（或设 `SUPABASE_CLI=C:\path\to\supabase.exe`）

然后：

```bash
supabase login
bun run supabase:deploy -- --project-ref <你的-project-ref>
```

macOS / Linux 可用 `npx supabase login`，或同样安装全局 CLI 后用上面的 `bun run supabase:deploy`。

等价分步：

```bash
npx supabase link --project-ref <你的-project-ref>
npx supabase db push
npx supabase functions deploy device-register
npx supabase functions deploy pairing-create
npx supabase functions deploy pairing-join
```

`db push` 按 `supabase/migrations/` **文件名顺序增量**应用尚未执行的 migration。

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
bun run supabase:deploy
bun run supabase:deploy -- --db-only
bun run supabase:deploy -- --functions-only
```

规则：

1. **只追加**新的 `supabase/migrations/YYYYMMDDHHMMSS_*.sql`，不要改写已发布旧文件。
2. 函数变更用 `--functions-only` 或全量 deploy。
3. 本地可用 `bun run supabase:db:reset`（清空本地库）。

自托管增量见 [supabase-self-host.md](supabase-self-host.md) §B。

---

## 本地开发

```bash
bun run supabase:start
bun run supabase:db:reset
bun run supabase:functions:serve
bun run supabase:status
```

---

## 自托管（摘要）

完整步骤：**[supabase-self-host.md](supabase-self-host.md)**。

```bash
# 1) 官方 Docker 栈（服务器上）
curl -fsSL https://supabase.link/setup.sh | sh
cd supabase-project && sh run.sh start && sh run.sh secrets

# 2) 在 eco-coding 仓库根安装 Eco schema + 函数
bun run supabase:self-host:apply -- --compose-dir /path/to/supabase-project
```

---

## 包脚本一览

| 脚本 | 作用 |
| --- | --- |
| `bun run supabase:deploy` | Cloud：`db push` + 部署全部函数 |
| `bun run supabase:self-host:apply` | 自托管：增量 SQL + 同步 `volumes/functions` |
| `bun run supabase:db:push` | Cloud 仅 migration |
| `bun run supabase:start` / `stop` / `status` | 本地 CLI 栈 |
| `bun run supabase:functions:serve` | 本地函数 |

- Cloud 脚本：[`scripts/supabase-deploy.mjs`](../scripts/supabase-deploy.mjs)
- 自托管脚本：[`scripts/supabase-self-host-apply.mjs`](../scripts/supabase-self-host-apply.mjs)

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
