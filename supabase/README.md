# Eco Supabase Center

Schema and Edge Functions for identity, pairing, Realtime RPC, and account-scoped settings sync.

- **Deploy Cloud:** [docs/supabase-deploy.md](../docs/supabase-deploy.md)
- **Self-host Docker:** [docs/supabase-self-host.md](../docs/supabase-self-host.md)
- **Agent skill:** [.cursor/skills/eco-supabase/SKILL.md](../.cursor/skills/eco-supabase/SKILL.md)
- **Design:** [docs/superpowers/specs/2026-08-20-supabase-center-design.md](../docs/superpowers/specs/2026-08-20-supabase-center-design.md)

## Client setup

Desktop / Mobile require:

- `supabaseUrl` — project URL (Cloud or self-hosted gateway)
- `anonKey` — anon public key

There is no official Eco-hosted node.

**Never** ship `service_role` to Desktop/Mobile.

## Quick commands

```sh
# Interactive wizard (pick platform / first-time vs update)
bun run supabase:deploy

# Cloud
npx supabase login
bun run supabase:deploy -- --platform cloud --project-ref <project-ref>

# Self-hosted Docker (compose dir = official supabase-project)
bun run supabase:deploy -- --platform self-host --compose-dir /path/to/supabase-project

# Local CLI stack
npx supabase start && npx supabase db reset
npx supabase functions serve
```

## Edge Functions (Track A)

All three expect `Authorization: Bearer <user access_token>` (Supabase Auth JWT) and
`apikey: <anonKey>`. Responses never include `secret_hash` / `code_hash` /
`bootstrap_token_hash`.

Base URL: `{supabaseUrl}/functions/v1`

### `device-register`

Registers a device for the signed-in user. Returns `deviceSecret` **once**.

```sh
curl -sS -X POST "$SUPABASE_URL/functions/v1/device-register" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"kind":"desktop","name":"My Mac","metadata":{"platform":"darwin"}}'
```

Body: `{ "kind": "desktop"|"mobile", "name": string, "metadata"?: object }`  
Response `201`: `{ "device": { id, userId, kind, name, metadata, createdAt, ... }, "deviceSecret": "..." }`

### `device-session-register`

Desktop/Mobile 用 `deviceSecret` 证明设备身份，把当前 Supabase Auth `session_id`
绑定到该设备。客户端在加入 private Realtime channel 前调用，并在 token refresh / 定期
revalidation 时重复调用。Body：`{ "deviceId", "deviceSecret", "kind" }`。

设备级 RLS 强制策略单独放在
`deferred-migrations/20260822102000_enforce_device_sessions.sql`。先发布支持该函数的客户端并
等待设备重新连接，再人工执行；不要把它并入首次基础设施 rollout。

### `pairing-create`

Desktop proves ownership with `deviceSecret`, creates a short-TTL pairing session
(default 5 minutes). Plaintext `code` + `bootstrapToken` returned once; only hashes
are stored.

```sh
curl -sS -X POST "$SUPABASE_URL/functions/v1/pairing-create" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"desktopDeviceId":"'"$DESKTOP_DEVICE_ID"'","deviceSecret":"'"$DESKTOP_SECRET"'"}'
```

Response: `{ "pairingId", "code", "bootstrapToken", "expiresAt", "qrPayload" }`

### `pairing-join`

Mobile (same Auth user) joins with `code` + `bootstrapToken`, creates `device_bindings`,
and marks the pairing session claimed.

```sh
curl -sS -X POST "$SUPABASE_URL/functions/v1/pairing-join" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "code":"ABCD2345",
    "bootstrapToken":"'"$BOOTSTRAP_TOKEN"'",
    "mobileDeviceId":"'"$MOBILE_DEVICE_ID"'",
    "deviceSecret":"'"$MOBILE_SECRET"'"
  }'
```

Optional: `deviceName`, `metadata`.  
Response: `{ "pairingId", "device", "binding", "desktopDeviceId" }`
