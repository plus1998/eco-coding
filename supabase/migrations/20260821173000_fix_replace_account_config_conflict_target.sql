-- RETURNS TABLE exposes user_id as a PL/pgSQL output variable. Referencing
-- user_id in an ON CONFLICT inference list is therefore ambiguous, so target
-- the table's named unique constraint instead.
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
    raise exception 'Encrypted secret snapshot contains duplicate keys.' using errcode = '22023';
  end if;

  -- Serialize the first insert as well as later revision updates for this account.
  -- A SELECT ... FOR UPDATE cannot lock a row that does not exist yet.
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
    user_id, secret_kind, secret_key, ciphertext, nonce, key_version, updated_at
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

revoke all on function public.eco_replace_account_config(jsonb, bigint, jsonb) from public;
grant execute on function public.eco_replace_account_config(jsonb, bigint, jsonb) to authenticated;
