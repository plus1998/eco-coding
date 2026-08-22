-- Device bindings are created by pairing Edge Functions and revoked by clients.
-- Authenticated clients must not be able to rewrite endpoints or capabilities.
revoke update on public.device_bindings from authenticated;
grant update (revoked_at) on public.device_bindings to authenticated;

drop policy if exists "bindings_update_revoke_own" on public.device_bindings;

create policy "bindings_revoke_own"
  on public.device_bindings for update to authenticated
  using (
    user_id = (select auth.uid())
    and revoked_at is null
  )
  with check (
    user_id = (select auth.uid())
    and revoked_at is not null
  );

-- A disabled endpoint must not keep authorizing new private-channel joins.
-- devices_public is an account-scoped, security-definer view that omits
-- secret_hash; authenticated has no SELECT privilege on the devices base table.
-- Binding-to-current-session verification is added by the device_sessions
-- migration after clients can prove their stored device secret.
create or replace function public.eco_user_owns_binding(binding_id uuid)
returns boolean
language sql
stable
security invoker
as $$
  select exists (
    select 1
    from public.device_bindings b
    join public.devices_public desktop
      on desktop.id = b.desktop_device_id
     and desktop.user_id = b.user_id
     and desktop.kind = 'desktop'::public.eco_device_kind
     and desktop.disabled_at is null
    join public.devices_public mobile
      on mobile.id = b.mobile_device_id
     and mobile.user_id = b.user_id
     and mobile.kind = 'mobile'::public.eco_device_kind
     and mobile.disabled_at is null
    where b.id = binding_id
      and b.user_id = (select auth.uid())
      and b.revoked_at is null
  );
$$;
