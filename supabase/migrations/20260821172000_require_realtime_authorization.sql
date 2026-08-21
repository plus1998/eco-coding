-- Private Broadcast/Presence cannot work without realtime.messages policies.
-- Do not silently skip this setup: a deployment without Realtime must fail.
do $$
begin
  if to_regclass('realtime.messages') is null then
    raise exception
      'Eco Realtime setup failed: realtime.messages does not exist. Enable/start Supabase Realtime before applying migrations.';
  end if;

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
end $$;
