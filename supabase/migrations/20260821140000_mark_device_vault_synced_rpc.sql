-- Safe client path to mark vault_synced_at without granting SELECT on devices
-- (secret_hash must stay hidden from authenticated clients).

create or replace function public.eco_mark_device_vault_synced(
  p_device_id uuid,
  p_synced_at timestamptz default now()
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  update public.devices d
  set vault_synced_at = p_synced_at
  where d.id = p_device_id
    and d.user_id = auth.uid()
    and d.disabled_at is null
  returning d.vault_synced_at into updated_at;

  if updated_at is null then
    raise exception 'device not found or not owned by current user';
  end if;

  return updated_at;
end;
$$;

revoke all on function public.eco_mark_device_vault_synced(uuid, timestamptz) from public;
grant execute on function public.eco_mark_device_vault_synced(uuid, timestamptz) to authenticated;

comment on function public.eco_mark_device_vault_synced(uuid, timestamptz) is
  'Mark the caller-owned device as vault-synced without exposing devices.secret_hash.';
