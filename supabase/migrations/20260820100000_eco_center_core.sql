-- Eco Supabase Center: core identity, pairing, vault claim, settings
-- See docs/superpowers/specs/2026-08-20-supabase-center-design.md

-- Extensions
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy "profiles_update_own"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "profiles_insert_own"
  on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- devices
-- ---------------------------------------------------------------------------
create type public.eco_device_kind as enum ('desktop', 'mobile');

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind public.eco_device_kind not null,
  name text not null,
  secret_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  disabled_at timestamptz,
  vault_synced_at timestamptz
);

create index devices_user_id_idx on public.devices (user_id);
create index devices_user_kind_idx on public.devices (user_id, kind);

alter table public.devices enable row level security;

-- No authenticated SELECT/INSERT/DELETE on base table (secret_hash stays off-client).
-- Clients read devices_public; Edge Functions use service role for register/verify.
-- Owners may update non-secret fields (name, metadata, last_seen, vault_synced).
create policy "devices_update_own_metadata"
  on public.devices for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.devices from authenticated;
grant update (
  name,
  metadata,
  last_seen_at,
  vault_synced_at,
  disabled_at
) on public.devices to authenticated;

create or replace view public.devices_public
with (security_invoker = false)
as
select
  id,
  user_id,
  kind,
  name,
  metadata,
  created_at,
  last_seen_at,
  disabled_at,
  vault_synced_at
from public.devices
where user_id = (select auth.uid());

grant select on public.devices_public to authenticated;

-- ---------------------------------------------------------------------------
-- device_bindings
-- ---------------------------------------------------------------------------
create table public.device_bindings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  desktop_device_id uuid not null references public.devices (id) on delete cascade,
  mobile_device_id uuid not null references public.devices (id) on delete cascade,
  capabilities text[] not null default '{}',
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (desktop_device_id, mobile_device_id)
);

create index device_bindings_user_id_idx on public.device_bindings (user_id);

alter table public.device_bindings enable row level security;

create policy "bindings_select_own"
  on public.device_bindings for select to authenticated
  using (user_id = (select auth.uid()));

create policy "bindings_update_revoke_own"
  on public.device_bindings for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- insert via Edge Function (service role)

-- ---------------------------------------------------------------------------
-- pairing_sessions
-- ---------------------------------------------------------------------------
create table public.pairing_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  desktop_device_id uuid not null references public.devices (id) on delete cascade,
  code_hash text not null,
  bootstrap_token_hash text not null,
  expires_at timestamptz not null,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

create index pairing_sessions_user_id_idx on public.pairing_sessions (user_id);

alter table public.pairing_sessions enable row level security;

create policy "pairing_select_own"
  on public.pairing_sessions for select to authenticated
  using (user_id = (select auth.uid()));

-- writes via Edge Function

-- ---------------------------------------------------------------------------
-- vault_claims (6-digit authorize vault_key transfer)
-- ---------------------------------------------------------------------------
create type public.vault_claim_status as enum (
  'pending',
  'approved',
  'consumed',
  'expired',
  'cancelled'
);

create table public.vault_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  requester_device_id uuid not null references public.devices (id) on delete cascade,
  approver_device_id uuid references public.devices (id) on delete set null,
  code_hash text,
  requester_public_key text,
  wrapped_vault_key text,
  wrap_nonce text,
  status public.vault_claim_status not null default 'pending',
  attempt_count int not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index vault_claims_user_pending_idx
  on public.vault_claims (user_id, status)
  where status = 'pending';

alter table public.vault_claims enable row level security;

create policy "vault_claims_select_own"
  on public.vault_claims for select to authenticated
  using (user_id = (select auth.uid()));

create policy "vault_claims_insert_own_requester"
  on public.vault_claims for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and requester_device_id in (
      select d.id
      from public.devices_public d
      where d.disabled_at is null
    )
  );

create policy "vault_claims_update_own"
  on public.vault_claims for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- user_settings (non-secret JSON blob per account)
-- ---------------------------------------------------------------------------
create table public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  revision bigint not null default 1
);

alter table public.user_settings enable row level security;

create policy "user_settings_select_own"
  on public.user_settings for select to authenticated
  using (user_id = (select auth.uid()));

create policy "user_settings_upsert_own"
  on public.user_settings for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "user_settings_update_own"
  on public.user_settings for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- user_secrets (ciphertext only)
-- ---------------------------------------------------------------------------
create table public.user_secrets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  secret_kind text not null,
  secret_key text not null,
  ciphertext text not null,
  nonce text not null,
  key_version int not null default 1,
  updated_at timestamptz not null default now(),
  unique (user_id, secret_kind, secret_key)
);

create index user_secrets_user_id_idx on public.user_secrets (user_id);

alter table public.user_secrets enable row level security;

create policy "user_secrets_select_own"
  on public.user_secrets for select to authenticated
  using (user_id = (select auth.uid()));

create policy "user_secrets_insert_own"
  on public.user_secrets for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "user_secrets_update_own"
  on public.user_secrets for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "user_secrets_delete_own"
  on public.user_secrets for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- audit_logs (metadata only)
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  action text not null,
  status text not null,
  actor_device_id uuid,
  target_device_id uuid,
  rpc_method text,
  channel text,
  error_code int,
  error_message text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_user_created_idx on public.audit_logs (user_id, created_at desc);

alter table public.audit_logs enable row level security;

create policy "audit_logs_select_own"
  on public.audit_logs for select to authenticated
  using (user_id = (select auth.uid()));

create policy "audit_logs_insert_own"
  on public.audit_logs for insert to authenticated
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Realtime authorization helpers
-- Topics:
--   eco:user:{uuid}     — presence
--   eco:bind:{uuid}     — RPC room for a binding
--   eco:vault:{uuid}    — vault claim transfer room
-- ---------------------------------------------------------------------------
create or replace function public.eco_realtime_topic_user_id(topic text)
returns uuid
language sql
stable
as $$
  select case
    when topic ~ '^eco:user:[0-9a-f-]{36}$'
      then substring(topic from 10)::uuid
    else null
  end;
$$;

create or replace function public.eco_realtime_topic_binding_id(topic text)
returns uuid
language sql
stable
as $$
  select case
    when topic ~ '^eco:bind:[0-9a-f-]{36}$'
      then substring(topic from 10)::uuid
    else null
  end;
$$;

create or replace function public.eco_realtime_topic_vault_claim_id(topic text)
returns uuid
language sql
stable
as $$
  select case
    when topic ~ '^eco:vault:[0-9a-f-]{36}$'
      then substring(topic from 11)::uuid
    else null
  end;
$$;

create or replace function public.eco_user_owns_binding(binding_id uuid)
returns boolean
language sql
stable
security invoker
as $$
  select exists (
    select 1
    from public.device_bindings b
    where b.id = binding_id
      and b.user_id = (select auth.uid())
      and b.revoked_at is null
  );
$$;

create or replace function public.eco_user_owns_vault_claim(claim_id uuid)
returns boolean
language sql
stable
security invoker
as $$
  select exists (
    select 1
    from public.vault_claims c
    where c.id = claim_id
      and c.user_id = (select auth.uid())
      and c.status in ('pending', 'approved')
      and c.expires_at > now()
  );
$$;

-- realtime.messages RLS policies (private channels).
-- Cloud/self-host: RLS is already enabled on realtime.messages; ALTER TABLE is forbidden
-- (must be owner / schema locked). Only CREATE POLICY is allowed.
-- Dashboard: disable Realtime "Allow public access".
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'realtime' and table_name = 'messages'
  ) then
    execute 'drop policy if exists "eco_realtime_select" on realtime.messages';
    execute 'drop policy if exists "eco_realtime_insert" on realtime.messages';

    execute $policy$
      create policy "eco_realtime_select"
      on realtime.messages
      for select
      to authenticated
      using (
        (
          (select public.eco_realtime_topic_user_id(realtime.topic())) = (select auth.uid())
        )
        or (
          public.eco_user_owns_binding(
            (select public.eco_realtime_topic_binding_id(realtime.topic()))
          )
        )
        or (
          public.eco_user_owns_vault_claim(
            (select public.eco_realtime_topic_vault_claim_id(realtime.topic()))
          )
        )
      )
    $policy$;

    execute $policy$
      create policy "eco_realtime_insert"
      on realtime.messages
      for insert
      to authenticated
      with check (
        (
          (select public.eco_realtime_topic_user_id(realtime.topic())) = (select auth.uid())
        )
        or (
          public.eco_user_owns_binding(
            (select public.eco_realtime_topic_binding_id(realtime.topic()))
          )
        )
        or (
          public.eco_user_owns_vault_claim(
            (select public.eco_realtime_topic_vault_claim_id(realtime.topic()))
          )
        )
      )
    $policy$;
  end if;
end $$;
