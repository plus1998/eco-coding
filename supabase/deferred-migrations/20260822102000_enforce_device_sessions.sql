-- Deferred breaking enforcement. Do not apply until supported Desktop and
-- Mobile clients have rolled out device-session-register and existing users
-- have reconnected to prove their device secret.

create or replace function public.eco_current_device_owns_binding(binding_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.device_bindings b
    join public.devices desktop
      on desktop.id = b.desktop_device_id
     and desktop.user_id = b.user_id
     and desktop.kind = 'desktop'::public.eco_device_kind
     and desktop.disabled_at is null
    join public.devices mobile
      on mobile.id = b.mobile_device_id
     and mobile.user_id = b.user_id
     and mobile.kind = 'mobile'::public.eco_device_kind
     and mobile.disabled_at is null
    where b.id = binding_id
      and b.user_id = (select auth.uid())
      and b.revoked_at is null
      and (select public.eco_current_device_id()) in (
        b.desktop_device_id,
        b.mobile_device_id
      )
  );
$$;

revoke all on function public.eco_current_device_owns_binding(uuid) from public;
grant execute on function public.eco_current_device_owns_binding(uuid)
  to authenticated;

drop policy if exists "bindings_select_own" on public.device_bindings;
create policy "bindings_select_current_device"
  on public.device_bindings for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.eco_current_device_id()) in (
      desktop_device_id,
      mobile_device_id
    )
  );

drop policy if exists "bindings_revoke_own" on public.device_bindings;
create policy "bindings_revoke_current_device"
  on public.device_bindings for update to authenticated
  using (
    user_id = (select auth.uid())
    and revoked_at is null
    and (select public.eco_current_device_id()) in (
      desktop_device_id,
      mobile_device_id
    )
  )
  with check (
    user_id = (select auth.uid())
    and revoked_at is not null
    and (select public.eco_current_device_id()) in (
      desktop_device_id,
      mobile_device_id
    )
  );

create or replace function public.eco_current_device_owns_vault_claim(claim_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.vault_claims c
    join public.devices requester
      on requester.id = c.requester_device_id
     and requester.user_id = c.user_id
     and requester.disabled_at is null
    left join public.devices approver
      on approver.id = c.approver_device_id
     and approver.user_id = c.user_id
     and approver.disabled_at is null
    where c.id = claim_id
      and c.user_id = (select auth.uid())
      and c.status in ('pending', 'approved')
      and c.expires_at > now()
      and (
        (select public.eco_current_device_id()) = c.requester_device_id
        or (
          c.approver_device_id is not null
          and approver.id = c.approver_device_id
          and (select public.eco_current_device_id()) = c.approver_device_id
        )
      )
  );
$$;

revoke all on function public.eco_current_device_owns_vault_claim(uuid) from public;
grant execute on function public.eco_current_device_owns_vault_claim(uuid)
  to authenticated;

-- Requesters can read their own claims. Before an approver is selected, any
-- current active device that already owns the account vault may discover the
-- pending claim; afterwards only the selected approver retains access.
create or replace function public.eco_current_device_can_select_vault_claim(
  claim_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1
    from public.vault_claims c
    where c.id = claim_id
      and c.user_id = (select auth.uid())
      and (
        c.requester_device_id = (select public.eco_current_device_id())
        or c.approver_device_id = (select public.eco_current_device_id())
        or (
          c.approver_device_id is null
          and c.status = 'pending'
          and c.expires_at > now()
          and exists (
            select 1
            from public.devices d
            where d.id = (select public.eco_current_device_id())
              and d.user_id = c.user_id
              and d.disabled_at is null
              and d.vault_synced_at is not null
          )
        )
      )
  );
$$;

revoke all on function public.eco_current_device_can_select_vault_claim(uuid)
  from public;
grant execute on function public.eco_current_device_can_select_vault_claim(uuid)
  to authenticated;

drop policy if exists "vault_claims_select_own" on public.vault_claims;
create policy "vault_claims_select_current_device"
  on public.vault_claims for select to authenticated
  using (
    public.eco_current_device_can_select_vault_claim(id)
  );

-- Device-scoped write helpers prevent a different session on the same account
-- from mutating another device or its vault claim through PostgREST.
create or replace function public.eco_update_device_profile(
  p_device_id uuid,
  p_name text,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  id uuid,
  user_id uuid,
  kind public.eco_device_kind,
  name text,
  metadata jsonb,
  created_at timestamptz,
  last_seen_at timestamptz,
  disabled_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated public.devices%rowtype;
begin
  if (select public.eco_current_device_id()) is distinct from p_device_id then
    raise exception 'Current session is not authorized for this device.'
      using errcode = '42501';
  end if;
  if nullif(trim(p_name), '') is null or length(trim(p_name)) > 120 then
    raise exception 'Device name must contain 1 to 120 characters.'
      using errcode = '22023';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'Device metadata must be a JSON object.'
      using errcode = '22023';
  end if;

  update public.devices as d
  set
    name = trim(p_name),
    metadata = p_metadata,
    last_seen_at = now()
  where d.id = p_device_id
    and d.user_id = (select auth.uid())
    and d.disabled_at is null
  returning d.* into updated;

  if not found then
    raise exception 'Active device not found for current session.'
      using errcode = '42501';
  end if;

  return query select
    updated.id,
    updated.user_id,
    updated.kind,
    updated.name,
    updated.metadata,
    updated.created_at,
    updated.last_seen_at,
    updated.disabled_at;
end;
$$;

revoke all on function public.eco_update_device_profile(uuid, text, jsonb)
  from public;
grant execute on function public.eco_update_device_profile(uuid, text, jsonb)
  to authenticated;

create or replace function public.eco_mark_device_vault_synced(
  p_device_id uuid,
  p_synced_at timestamptz default now()
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_at timestamptz;
begin
  if (select public.eco_current_device_id()) is distinct from p_device_id then
    raise exception 'Current session is not authorized for this device.'
      using errcode = '42501';
  end if;

  update public.devices d
  set vault_synced_at = p_synced_at
  where d.id = p_device_id
    and d.user_id = (select auth.uid())
    and d.disabled_at is null
  returning d.vault_synced_at into updated_at;

  if updated_at is null then
    raise exception 'Active device not found for current session.'
      using errcode = '42501';
  end if;
  return updated_at;
end;
$$;

revoke all on function public.eco_mark_device_vault_synced(uuid, timestamptz)
  from public;
grant execute on function public.eco_mark_device_vault_synced(uuid, timestamptz)
  to authenticated;

-- Settings and encrypted secrets remain account-scoped, but only sessions that
-- proved an active Eco device may access them. This prevents an unrelated Auth
-- session for the same user from reading or replacing synchronized ciphertext.
drop policy if exists "user_settings_select_own" on public.user_settings;
create policy "user_settings_select_current_device"
  on public.user_settings for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.eco_current_device_id()) is not null
  );

drop policy if exists "user_settings_upsert_own" on public.user_settings;
create policy "user_settings_insert_current_device"
  on public.user_settings for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.eco_current_device_id()) is not null
  );

drop policy if exists "user_settings_update_own" on public.user_settings;
create policy "user_settings_update_current_device"
  on public.user_settings for update to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.eco_current_device_id()) is not null
  )
  with check (
    user_id = (select auth.uid())
    and (select public.eco_current_device_id()) is not null
  );

drop policy if exists "user_secrets_select_own" on public.user_secrets;
create policy "user_secrets_select_current_device"
  on public.user_secrets for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.eco_current_device_id()) is not null
  );

drop policy if exists "user_secrets_insert_own" on public.user_secrets;
create policy "user_secrets_insert_current_device"
  on public.user_secrets for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.eco_current_device_id()) is not null
  );

drop policy if exists "user_secrets_update_own" on public.user_secrets;
create policy "user_secrets_update_current_device"
  on public.user_secrets for update to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.eco_current_device_id()) is not null
  )
  with check (
    user_id = (select auth.uid())
    and (select public.eco_current_device_id()) is not null
  );

drop policy if exists "user_secrets_delete_own" on public.user_secrets;
create policy "user_secrets_delete_current_device"
  on public.user_secrets for delete to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.eco_current_device_id()) is not null
  );

create or replace function public.eco_replace_account_config(
  p_payload jsonb,
  p_expected_revision bigint,
  p_secrets jsonb
)
returns table (
  user_id uuid,
  payload jsonb,
  updated_at timestamptz,
  revision bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_revision bigint;
  next_revision bigint;
  account_id uuid := auth.uid();
  changed_at timestamptz := now();
begin
  if account_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if (select public.eco_current_device_id()) is null then
    raise exception 'Current session is not authorized for an active Eco device.'
      using errcode = '42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Settings payload must be a JSON object.' using errcode = '22023';
  end if;
  if p_secrets is null or jsonb_typeof(p_secrets) <> 'array' then
    raise exception 'Secrets snapshot must be a JSON array.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_secrets) > 1000 then
    raise exception 'Secrets snapshot exceeds 1000 entries.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_secrets) as s(
      secret_kind text,
      secret_key text,
      ciphertext text,
      nonce text,
      key_version int
    )
    where s.secret_kind not in ('provider', 'asr', 'image', 'workflow', 'proxy')
      or nullif(s.secret_key, '') is null
      or nullif(s.ciphertext, '') is null
      or nullif(s.nonce, '') is null
      or s.key_version <> 1
  ) then
    raise exception 'Invalid encrypted secret snapshot.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_secrets) as s(secret_kind text, secret_key text)
    group by s.secret_kind, s.secret_key
    having count(*) > 1
  ) then
    raise exception 'Encrypted secret snapshot contains duplicate keys.'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(account_id::text, 0)
  );

  select us.revision into current_revision
  from public.user_settings as us
  where us.user_id = account_id
  for update;

  if current_revision is null then
    if p_expected_revision is not null then
      raise exception 'settings_sync_conflict' using errcode = '40001';
    end if;
    next_revision := 1;
    insert into public.user_settings (user_id, payload, updated_at, revision)
    values (account_id, p_payload, changed_at, next_revision);
  else
    if p_expected_revision is null or current_revision <> p_expected_revision then
      raise exception 'settings_sync_conflict' using errcode = '40001';
    end if;
    next_revision := current_revision + 1;
    update public.user_settings as us
    set payload = p_payload, updated_at = changed_at, revision = next_revision
    where us.user_id = account_id;
  end if;

  delete from public.user_secrets as existing
  where existing.user_id = account_id
    and not exists (
      select 1
      from jsonb_to_recordset(p_secrets) as incoming(
        secret_kind text,
        secret_key text,
        ciphertext text,
        nonce text,
        key_version int
      )
      where incoming.secret_kind = existing.secret_kind
        and incoming.secret_key = existing.secret_key
    );

  insert into public.user_secrets (
    user_id,
    secret_kind,
    secret_key,
    ciphertext,
    nonce,
    key_version,
    updated_at
  )
  select
    account_id,
    incoming.secret_kind,
    incoming.secret_key,
    incoming.ciphertext,
    incoming.nonce,
    incoming.key_version,
    changed_at
  from jsonb_to_recordset(p_secrets) as incoming(
    secret_kind text,
    secret_key text,
    ciphertext text,
    nonce text,
    key_version int
  )
  on conflict on constraint user_secrets_user_id_secret_kind_secret_key_key do update
  set ciphertext = excluded.ciphertext,
      nonce = excluded.nonce,
      key_version = excluded.key_version,
      updated_at = excluded.updated_at;

  return query
  select us.user_id, us.payload, us.updated_at, us.revision
  from public.user_settings as us
  where us.user_id = account_id;
end;
$$;

revoke all on function public.eco_replace_account_config(jsonb, bigint, jsonb)
  from public;
grant execute on function public.eco_replace_account_config(jsonb, bigint, jsonb)
  to authenticated;

drop policy if exists "vault_claims_insert_own_requester"
  on public.vault_claims;
create policy "vault_claims_insert_current_requester"
  on public.vault_claims for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and requester_device_id = (select public.eco_current_device_id())
  );

drop policy if exists "vault_claims_update_own" on public.vault_claims;

create or replace function public.eco_current_device_can_update_vault_claim(
  claim_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1
    from public.vault_claims c
    where c.id = claim_id
      and c.user_id = (select auth.uid())
      and (
        c.requester_device_id = (select public.eco_current_device_id())
        or c.approver_device_id = (select public.eco_current_device_id())
        or (
          c.approver_device_id is null
          and c.status = 'pending'
          and exists (
            select 1
            from public.devices d
            where d.id = (select public.eco_current_device_id())
              and d.user_id = c.user_id
              and d.disabled_at is null
              and d.vault_synced_at is not null
          )
        )
      )
  );
$$;

revoke all on function public.eco_current_device_can_update_vault_claim(uuid)
  from public;
grant execute on function public.eco_current_device_can_update_vault_claim(uuid)
  to authenticated;

create policy "vault_claims_update_current_device"
  on public.vault_claims for update to authenticated
  using (
    public.eco_current_device_can_update_vault_claim(id)
  )
  with check (
    user_id = (select auth.uid())
    and (
      requester_device_id = (select public.eco_current_device_id())
      or approver_device_id = (select public.eco_current_device_id())
    )
  );

-- Private Presence is account-wide but still requires the current Auth session
-- to have proved an active Eco device. Bind and vault topics additionally
-- require that device to be an endpoint of the referenced resource.
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
          and (select public.eco_current_device_id()) is not null
        )
        or (
          public.eco_current_device_owns_binding(
            (select public.eco_realtime_topic_binding_id(realtime.topic()))
          )
        )
        or (
          public.eco_current_device_owns_vault_claim(
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
          and (select public.eco_current_device_id()) is not null
        )
        or (
          public.eco_current_device_owns_binding(
            (select public.eco_realtime_topic_binding_id(realtime.topic()))
          )
        )
        or (
          public.eco_current_device_owns_vault_claim(
            (select public.eco_realtime_topic_vault_claim_id(realtime.topic()))
          )
        )
      )
    $policy$;
  end if;
end $$;
