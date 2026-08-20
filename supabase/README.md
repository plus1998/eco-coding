# Eco Supabase Center

Schema and Edge Functions that replace the Bun Center Server for identity, pairing,
Realtime RPC, and account-scoped settings sync.

Design: [docs/superpowers/specs/2026-08-20-supabase-center-design.md](../docs/superpowers/specs/2026-08-20-supabase-center-design.md)

## Client setup

Desktop / Mobile require:

- `supabaseUrl` — project URL (hosted or self-hosted)
- `anonKey` — anon public key

There is no official Eco-hosted node. Users create their own Supabase project and
apply migrations in this directory.

## Local

```sh
npx supabase start
npx supabase db reset
```

Apply the SQL under `migrations/` to a cloud project via the SQL editor or CLI.
