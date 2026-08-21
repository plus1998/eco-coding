---
name: eco-supabase
description: >-
  Deploy and update the Eco Supabase Center (schema + Edge Functions) on a
  user-owned Supabase Cloud project OR a self-hosted Docker stack. Use when the
  user asks to set up Supabase, self-host, first deploy, incremental migrate,
  db push, deploy functions, link project-ref, or apply eco migrations to
  volumes/functions. Prefer this over the removed Bun apps/server.
---

# Eco Supabase 部署（Agent）

Eco **无官方节点**。客户端只要 **Project URL + anon key**（禁止 `service_role`）。

| 场景 | 权威文档 | 主命令 |
| --- | --- | --- |
| Cloud | [docs/supabase-deploy.md](../../../docs/supabase-deploy.md) | `bun run supabase:deploy -- --project-ref <ref>` |
| **自托管** | [docs/supabase-self-host.md](../../../docs/supabase-self-host.md) | `bun run supabase:self-host:apply -- --compose-dir <dir>` |
| 本机开发 | supabase-deploy.md「本地开发」 | `bun run supabase:start` |

Schema / 函数：[supabase/](../../../supabase/)  
设计：[docs/superpowers/specs/2026-08-20-supabase-center-design.md](../../../docs/superpowers/specs/2026-08-20-supabase-center-design.md)

## 何时用本 Skill

- 「帮我初始化 / 部署 Supabase」
- 「自建 / 自托管 / Docker / VPS 上的 Supabase」
- 「migration 怎么更新 / db push / self-host apply」
- 「部署 Edge Functions」
- 用户给了 `project-ref` 或自托管 `compose-dir`

先问清：**Cloud 还是自托管**。不要混用两套命令。

---

## Cloud：初次部署

1. 确认仓库有 `supabase/migrations` 与 `supabase/functions`。
2. 无项目则指导 https://supabase.com/dashboard 创建；索取 **project-ref**；确认用户保存了 **URL + anon**。
3. Dashboard：Email Auth 开；Realtime 关 Allow public access；开发可关 Confirm email。
4. 仓库根：

```bash
# Windows: install CLI via Scoop or GitHub release first (avoid broken npx win32 binary)
supabase login
bun run supabase:deploy -- --project-ref <PROJECT_REF>
```

5. 把 URL + anon 交给用户填 Eco；**不要**给 service_role。
6. 可选 curl `device-register` 冒烟（见 supabase-deploy.md）。

## Cloud：增量

```bash
bun run supabase:deploy
# 或 --db-only / --functions-only
```

只追加新 migration 文件，不改已发布旧 SQL。

---

## 自托管：初次部署（必须按文档）

严格按 [docs/supabase-self-host.md](../../../docs/supabase-self-host.md) §A / §D：

1. 确认服务器满足 4C/8G 建议；已装 Docker + Git。  
2. 无栈则协助官方 `setup.sh` 或 Manual install → **先** `sh utils/generate-keys.sh --update-env` → 无 SMTP 时设 `ENABLE_EMAIL_AUTOCONFIRM=true` → `sh run.sh start` / 或 Eco 最小栈 `docker compose up -d db auth rest realtime api-gw functions`。  
3. 记下 **API URL** 与 **anon**（Windows：`COMPOSE_FILE` 用 `;`；apply **不依赖**主机 `sh`）。  
4. 在 eco-coding 根目录：

```bash
bun run supabase:self-host:apply -- --compose-dir <SUPABASE_PROJECT_DIR>
```

5. Email 注册开；Realtime 勿对匿名全开放。  
6. curl `device-register` 或 `bun test packages/shared/test/supabase-selfhost.integration.test.ts` 冒烟。  
7. 回复：URL、anon、已应用 migration、已同步函数名。

## 自托管：增量

```bash
git pull   # eco-coding
bun run supabase:self-host:apply -- --compose-dir <SUPABASE_PROJECT_DIR>
```

上游 Docker 栈升级用官方 `update.sh`，然后再跑一次 `self-host:apply`（防 functions 被覆盖）。

---

## 本地开发栈

```bash
bun run supabase:start
bun run supabase:db:reset
bun run supabase:functions:serve
bun run supabase:status
```

## 禁止事项

- 不要把 `service_role` 写入客户端配置或当「填进 App 的值」教给用户
- 不要对**生产**执行 `db reset` / `docker compose down -v`
- 不要重新引入 `apps/server` 或 `deploy:server`
- 不要在未确认场景时对自托管跑 `supabase link` / Cloud `db push`

## 完成后回复用户

简述：场景（Cloud/自托管）、已执行命令、migration/函数结果、客户端两项填写值；失败则贴命令与关键错误及下一步。
