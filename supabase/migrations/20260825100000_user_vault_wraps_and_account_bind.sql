-- Account-password vault wrap + notes for binding-ensure (no pairing required).
-- Password wrap is client-side crypto; this table stores only salt + ciphertext.

-- ---------------------------------------------------------------------------
-- user_vault_wraps: vault_key wrapped with login-password-derived key
-- ---------------------------------------------------------------------------
create table public.user_vault_wraps (
  user_id uuid primary key references auth.users (id) on delete cascade,
  algorithm text not null default 'PBKDF2-SHA256-AES-256-GCM',
  salt text not null,
  iterations integer not null check (iterations >= 100000),
  nonce text not null,
  ciphertext text not null,
  updated_at timestamptz not null default now()
);

alter table public.user_vault_wraps enable row level security;

create policy "user_vault_wraps_select_own"
  on public.user_vault_wraps for select to authenticated
  using (user_id = (select auth.uid()));

create policy "user_vault_wraps_insert_own"
  on public.user_vault_wraps for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "user_vault_wraps_update_own"
  on public.user_vault_wraps for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "user_vault_wraps_delete_own"
  on public.user_vault_wraps for delete to authenticated
  using (user_id = (select auth.uid()));

comment on table public.user_vault_wraps is
  'AES-GCM ciphertext of vault_key under a PBKDF2 key from the account login password. '
  'Changing Auth password without re-wrapping on a device that holds vault_key leaves this row unlockable only with the old password.';
