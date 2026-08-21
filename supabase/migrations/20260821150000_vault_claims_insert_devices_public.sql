-- vault_claims insert policy used to subquery public.devices, but authenticated
-- has no SELECT on devices (secret_hash). That yields:
--   permission denied for table devices
-- Use devices_public (security_invoker=false) instead.

drop policy if exists "vault_claims_insert_own_requester" on public.vault_claims;

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
