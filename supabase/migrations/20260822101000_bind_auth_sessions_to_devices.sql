-- Bind each Supabase Auth session to the Eco device that proved possession of
-- that device's one-shot secret. Realtime authorization can then distinguish
-- multiple devices signed into the same account.
create table public.device_sessions (
  session_id uuid primary key references auth.sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  device_id uuid not null references public.devices (id) on delete cascade,
  created_at timestamptz not null default now(),
  verified_at timestamptz not null default now()
);

create index device_sessions_user_device_idx
  on public.device_sessions (user_id, device_id);

alter table public.device_sessions enable row level security;
revoke all on public.device_sessions from anon, authenticated;

-- Register a device and bind the calling Supabase Auth session in one database
-- transaction. The Edge Function generates the one-shot secret and passes only
-- its hash to this service-role-only function.
create or replace function public.eco_register_device_session(
  p_session_id uuid,
  p_user_id uuid,
  p_kind public.eco_device_kind,
  p_name text,
  p_secret_hash text,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  id uuid,
  user_id uuid,
  kind public.eco_device_kind,
  name text,
  secret_hash text,
  metadata jsonb,
  created_at timestamptz,
  last_seen_at timestamptz,
  disabled_at timestamptz,
  vault_synced_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  registered public.devices%rowtype;
begin
  if not exists (
    select 1
    from auth.sessions s
    where s.id = p_session_id
      and s.user_id = p_user_id
  ) then
    raise exception 'Supabase Auth session is not active for this user.'
      using errcode = '42501';
  end if;

  insert into public.devices (
    user_id,
    kind,
    name,
    secret_hash,
    metadata
  )
  values (
    p_user_id,
    p_kind,
    p_name,
    p_secret_hash,
    p_metadata
  )
  returning * into registered;

  insert into public.device_sessions (
    session_id,
    user_id,
    device_id,
    verified_at
  )
  values (
    p_session_id,
    p_user_id,
    registered.id,
    now()
  );

  return query select
    registered.id,
    registered.user_id,
    registered.kind,
    registered.name,
    registered.secret_hash,
    registered.metadata,
    registered.created_at,
    registered.last_seen_at,
    registered.disabled_at,
    registered.vault_synced_at;
end;
$$;

revoke all on function public.eco_register_device_session(
  uuid,
  uuid,
  public.eco_device_kind,
  text,
  text,
  jsonb
) from public, anon, authenticated;
grant execute on function public.eco_register_device_session(
  uuid,
  uuid,
  public.eco_device_kind,
  text,
  text,
  jsonb
) to service_role;

-- Keep a Supabase Auth session bound to one Eco device for its lifetime. The
-- Edge Function calls this as service_role after validating the device secret.
create or replace function public.eco_bind_device_session(
  p_session_id uuid,
  p_user_id uuid,
  p_device_id uuid,
  p_verified_at timestamptz default now()
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  bound_at timestamptz;
begin
  if not exists (
    select 1
    from auth.sessions s
    where s.id = p_session_id
      and s.user_id = p_user_id
  ) then
    raise exception 'Supabase Auth session is not active for this user.'
      using errcode = '42501';
  end if;

  insert into public.device_sessions as ds (
    session_id,
    user_id,
    device_id,
    verified_at
  )
  values (
    p_session_id,
    p_user_id,
    p_device_id,
    p_verified_at
  )
  on conflict (session_id) do update
  set verified_at = excluded.verified_at
  where ds.user_id = excluded.user_id
    and ds.device_id = excluded.device_id
  returning verified_at into bound_at;

  if bound_at is null then
    raise exception 'Supabase Auth session is already bound to another Eco device.'
      using errcode = '23505';
  end if;
  return bound_at;
end;
$$;

revoke all on function public.eco_bind_device_session(uuid, uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.eco_bind_device_session(uuid, uuid, uuid, timestamptz)
  to service_role;

-- Disable a proven device and revoke every mapped Auth session atomically. The
-- Edge Function validates the device secret before invoking this function.
create or replace function public.eco_disable_device_sessions(
  p_user_id uuid,
  p_device_id uuid,
  p_disabled_at timestamptz default now()
)
returns table (
  id uuid,
  user_id uuid,
  kind public.eco_device_kind,
  name text,
  secret_hash text,
  metadata jsonb,
  created_at timestamptz,
  last_seen_at timestamptz,
  disabled_at timestamptz,
  vault_synced_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  disabled public.devices%rowtype;
begin
  update public.devices as d
  set disabled_at = coalesce(d.disabled_at, p_disabled_at)
  where d.id = p_device_id
    and d.user_id = p_user_id
  returning d.* into disabled;

  if not found then
    raise exception 'Device not found for this user.' using errcode = '42501';
  end if;

  delete from public.device_sessions ds
  where ds.user_id = p_user_id
    and ds.device_id = p_device_id;

  return query select
    disabled.id,
    disabled.user_id,
    disabled.kind,
    disabled.name,
    disabled.secret_hash,
    disabled.metadata,
    disabled.created_at,
    disabled.last_seen_at,
    disabled.disabled_at,
    disabled.vault_synced_at;
end;
$$;

revoke all on function public.eco_disable_device_sessions(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.eco_disable_device_sessions(uuid, uuid, timestamptz)
  to service_role;

-- Edge Functions use service_role after validating the user JWT and device
-- secret. Clients cannot claim an arbitrary device by writing this table.
create or replace function public.eco_current_session_id()
returns uuid
language sql
stable
security invoker
as $$
  select case
    when coalesce((select auth.jwt() ->> 'session_id'), '')
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then ((select auth.jwt() ->> 'session_id'))::uuid
    else null
  end;
$$;

create or replace function public.eco_current_device_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select ds.device_id
  from public.device_sessions ds
  join public.devices d
    on d.id = ds.device_id
   and d.user_id = ds.user_id
   and d.disabled_at is null
  where ds.session_id = (select public.eco_current_session_id())
    and ds.user_id = (select auth.uid())
  limit 1;
$$;

revoke all on function public.eco_current_device_id() from public;
grant execute on function public.eco_current_device_id() to authenticated;

-- Device-scoped policies are intentionally staged outside supabase/migrations.
-- Apply deferred-migrations/20260822102000_enforce_device_sessions.sql only
-- after supported Desktop and Mobile clients register their Auth sessions.
