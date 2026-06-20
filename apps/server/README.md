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

## 1Panel 部署

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

1. 本地：`bun run build:server`（或 `bun run deploy:server -- root@host -b` 构建并上传）
2. 将新的 `dist/index.js`、`Dockerfile`、`docker-compose.yml` 同步到服务器编排目录
3. 1Panel → **容器** → **编排** → 选中 `eco-server` → **重建**
4. 或在服务器 SSH 执行：`cd /opt/eco/server && docker compose up -d --build`

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
