-- Update a mobile device's public profile without granting SELECT on the
-- devices base table, which also stores secret_hash.
drop policy if exists "devices_update_own_metadata" on public.devices;
revoke update (
  name,
  metadata,
  last_seen_at,
  vault_synced_at,
  disabled_at
) on public.devices from authenticated;

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
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if nullif(trim(p_name), '') is null or length(trim(p_name)) > 120 then
    raise exception 'Device name must contain 1 to 120 characters.' using errcode = '22023';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'Device metadata must be a JSON object.' using errcode = '22023';
  end if;

  update public.devices as d
  set
    name = trim(p_name),
    metadata = p_metadata,
    last_seen_at = now()
  where d.id = p_device_id
    and d.user_id = auth.uid()
    and d.kind = 'mobile'::public.eco_device_kind
    and d.disabled_at is null
  returning d.* into updated;

  if not found then
    raise exception 'Active mobile device not found for current user.' using errcode = '42501';
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

revoke all on function public.eco_update_device_profile(uuid, text, jsonb) from public;
grant execute on function public.eco_update_device_profile(uuid, text, jsonb) to authenticated;
