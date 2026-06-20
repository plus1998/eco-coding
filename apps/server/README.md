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

```sh
# Set a strong token secret (or keep the default for dev)
export ECO_SERVER_TOKEN_SECRET="your-strong-secret-at-least-32-chars"

# Start everything (MongoDB + Redis + Server)
docker compose -f apps/server/docker-compose.yml up -d

# Check status
docker compose -f apps/server/docker-compose.yml ps

# View logs
docker compose -f apps/server/docker-compose.yml logs -f server

# Stop
docker compose -f apps/server/docker-compose.yml down
```

Data volumes (`mongo_data`, `redis_data`) persist across restarts. Use `docker compose down -v` to wipe them.

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
