# Eco Center Server

First-version center server for PC/mobile event routing.

## Runtime

Required environment:

```sh
ECO_SERVER_TOKEN_SECRET="at-least-32-characters-secret"
```

Optional environment:

```sh
ECO_SERVER_HOST=127.0.0.1
ECO_SERVER_PORT=3128
ECO_SERVER_INSTANCE_ID=server-a
ECO_SERVER_MONGODB_URI=mongodb://127.0.0.1:27017/eco-coding
ECO_SERVER_MONGODB_DATABASE=
ECO_SERVER_REDIS_URL=redis://127.0.0.1:6379
ECO_SERVER_REDIS_PASSWORD=
ECO_ACCESS_TOKEN_TTL_SECONDS=900
ECO_REFRESH_TOKEN_TTL_SECONDS=5184000
ECO_PAIRING_TTL_SECONDS=300
ECO_RPC_TIMEOUT_MS=30000
```

Start locally:

```sh
bun run dev:server
```

## Docker Compose (one-click deploy)

在 `apps/server/` 下创建 `.env`（可从 `.env.example` 复制），至少设置 `ECO_SERVER_TOKEN_SECRET`（32 字符以上）。Compose 会通过 `env_file` 将其注入容器；`docker-compose.yml` 里的 `environment` 仅覆盖 Mongo/Redis 为编排内服务地址。

```sh
cp apps/server/.env.example apps/server/.env
# 编辑 apps/server/.env，设置 ECO_SERVER_TOKEN_SECRET

# Start everything (MongoDB + Redis + Server)
cd apps/server && docker compose up -d --build

# Check status
docker compose ps

# View logs
docker compose logs -f server

# Stop
docker compose down
```

Data volumes (`mongo_data`, `redis_data`) persist across restarts. Use `docker compose down -v` to wipe them.

## Linux amd64 二进制部署（推荐生产）

将 Server 交叉编译为 **Linux x86_64 单文件二进制**（内嵌 Bun 运行时与全部依赖），通过 systemd 原生运行。

MongoDB / Redis 有两种方式：
- **已有实例**（1Panel、云数据库、自建等）→ 在 `.env` 里填连接串，部署时加 `--no-deps`
- **没有实例** → 部署脚本会自动用 `docker-compose.deps.yml` 启动容器

### 1. 本地构建

```sh
# 仅构建二进制（约 90MB）
bun run build:server:linux-amd64
# 产物: apps/server/dist/eco-server-linux-amd64
```

在 macOS / Windows 上也可交叉编译，无需 Linux 构建机。

### 2. 一键上传并部署

**服务器已有 MongoDB / Redis**（你的情况）：

```sh
# .env 里填好实际连接串，例如：
# ECO_SERVER_MONGODB_URI=mongodb://user:pass@192.168.31.204:27017/eco-coding?authSource=admin
# ECO_SERVER_REDIS_URL=redis://192.168.31.204:6379
# ECO_SERVER_REDIS_PASSWORD=...   # 若 Redis 需要密码
# ECO_SERVER_HOST=0.0.0.0         # 监听所有网卡，供手机/桌面连接

bun run deploy:server -- root@192.168.31.204 -B --no-deps --install-service --restart
```

**没有 MongoDB / Redis，由脚本启动容器**：

```sh
cp apps/server/.env.example apps/server/.env
# .env 使用 mongodb://127.0.0.1:27017/... 和 redis://127.0.0.1:6379

bun run deploy:server -- root@192.168.31.204 -B --install-service --restart
```

后续更新（重新编译 + 上传 + 重启）：

```sh
bun run deploy:server -- root@192.168.31.204 -B --no-deps --build --restart
```

二进制模式会上传：

| 文件 | 说明 |
|------|------|
| `eco-server` | Linux amd64 可执行文件 |
| `.env` | 环境变量（Mongo/Redis 连接串） |
| `eco-server.service` | systemd 单元模板 |
| `docker-compose.deps.yml` | 仅在不加 `--no-deps` 时上传 |

`.env` 示例（已有外部 Mongo/Redis）：

```sh
ECO_SERVER_TOKEN_SECRET=your-secret-at-least-32-chars
ECO_SERVER_HOST=0.0.0.0
ECO_SERVER_PORT=3128
ECO_SERVER_MONGODB_URI=mongodb://user:pass@192.168.31.204:27017/eco-coding?authSource=admin
ECO_SERVER_REDIS_URL=redis://192.168.31.204:6379
ECO_SERVER_REDIS_PASSWORD=your-redis-password
```

`.env` 示例（由 docker-compose.deps 提供 Mongo/Redis）：

```sh
ECO_SERVER_TOKEN_SECRET=your-secret-at-least-32-chars
ECO_SERVER_HOST=0.0.0.0
ECO_SERVER_PORT=3128
ECO_SERVER_MONGODB_URI=mongodb://127.0.0.1:27017/eco-coding
ECO_SERVER_REDIS_URL=redis://127.0.0.1:6379
```

### 3. 服务器手动操作

**已有 Mongo/Redis：**

```sh
cd /opt/eco/server
chmod +x eco-server
cp eco-server.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now eco-server
journalctl -u eco-server -f
```

**需要脚本启动 Mongo/Redis 容器：**

```sh
cd /opt/eco/server
chmod +x eco-server
docker compose -f docker-compose.deps.yml up -d
cp eco-server.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now eco-server
journalctl -u eco-server -f
```

### 4. 与 Docker 全容器部署的区别

| | Docker 全容器 | 二进制 + systemd |
|--|--|--|
| 构建 | `bun run build:server` → `dist/index.js` | `bun run build:server:linux-amd64` |
| Server 进程 | Bun 容器内运行 JS | 原生二进制 + systemd |
| 依赖 | compose 内含 mongo/redis/server | 外部已有，或 compose 仅 mongo/redis |
| 更新 | 需 rebuild 镜像 | 替换二进制 + `systemctl restart` |
| 远程命令白名单 | 需 rebuild 镜像才生效 | 替换二进制即生效 |

## 1Panel 部署（Docker JS bundle）

### 1. 本地构建

先在本地将服务打包成单个可执行文件：

```sh
bun run build:server
```

这会生成 `apps/server/dist/index.js`（约 3MB，522 个模块全部打包，无外部依赖）。

### 2. 上传到 1Panel

将 `apps/server/` 整个目录上传到 1Panel 服务器，例如放到 `/opt/eco/server/`。

需要上传的关键文件：
- `dist/index.js` — 打包后的服务
- `Dockerfile` — 镜像构建文件
- `docker-compose.yml` — 编排配置
- `.dockerignore` — 忽略无关文件
- `.env` — 含 `ECO_SERVER_TOKEN_SECRET` 等密钥（**必须与 compose 同目录**）

### 3. 在 1Panel 中部署

1. 打开 1Panel → **容器** → **编排** → **创建编排**（或编辑已有编排）
2. 填写名称（如 `eco-server`），粘贴 `docker-compose.yml` 内容
3. **编排路径**必须指向已上传目录（例如 `/opt/eco/server`），且该目录内已有：
   - `dist/index.js`（本地 `bun run build:server` 生成）
   - `Dockerfile`、`docker-compose.yml`、`.env`
4. 确保 `.env` 含 `ECO_SERVER_TOKEN_SECRET`（至少 32 字符）
5. 点击 **确认** / **重建**，1Panel 会基于当前目录构建镜像

> **注意**：`docker-compose.yml` 的 `build.context` 为 `.`（编排目录本身）。不要在 1Panel 上使用 `context: ../..`，否则会出现 `lstat /opt/apps: no such file or directory`。

### 4. 更新已有编排

1. 本地：`bun run build:server`（Docker）或 `bun run build:server:linux-amd64`（二进制）
2. 部署：`bun run deploy:server -- root@host -b --restart` 或加 `-B` 使用二进制模式
3. 将新的产物同步到服务器编排目录
4. 1Panel → **容器** → **编排** → 选中 `eco-server` → **重建**
5. 或在服务器 SSH 执行：`cd /opt/eco/server && docker compose up -d --build`

### 5. 放行端口

在 1Panel 的 **防火墙** 中放行 `3128` 端口，桌面客户端通过 `http://<1Panel-IP>:3128` 连接。

## HTTP API

- `GET /health`
- `GET /v1/me`
- `POST /v1/auth/register`
- `POST /v1/auth/login`
- `POST /v1/auth/refresh`
- `POST /v1/auth/logout`
- `POST /v1/devices/register`
- `POST /v1/devices/token`
- `GET /v1/devices`
- `DELETE /v1/devices/:deviceId`
- `POST /v1/pairing`
- `GET /v1/pairing/:pairingId`
- `POST /v1/pairing/join`
- `POST /v1/pairing/claim`
- `GET /v1/bindings`
- `DELETE /v1/bindings/:bindingId`
- `GET /v1/presence`
- `GET /v1/audit-logs`

Auth model:

- Account access tokens can manage devices, bindings, presence, and audit logs.
- Device access tokens are required for WebSocket and pairing flows.
- Disabled devices immediately fail device token verification and their refresh tokens/bindings are revoked.

## WebSocket API

Connect to `/v1/rpc` with a device access token via `Authorization: Bearer <token>` or `?access_token=<token>`.

Supported JSON-RPC 2.0 methods:

- `eco.ping`
- `eco.invoke`
- `eco.event`

The server only routes commands and events. PC execution still happens on the desktop client.

## Known v1 Limits

- MongoDB is the durable store for users, devices, bindings, tokens, pairing sessions, and audit logs.
- Redis is required for presence/session TTL state and cross-instance RPC/event bus routing.
- RPC execution still happens on the connected desktop; the server only routes to the instance that owns that WebSocket.
- Full event payload history is not persisted; only audit metadata is stored.
