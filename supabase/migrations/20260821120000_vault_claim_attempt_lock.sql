-- Vault claim: auto-cancel after too many wrong 6-digit codes.
-- Mirrors VAULT_CLAIM_MAX_ATTEMPTS in desktop supabase-vault-claim.ts.

create or replace function public.eco_vault_claims_lock_on_attempts()
returns trigger
language plpgsql
as $$
begin
  if new.attempt_count >= 5
     and new.status = 'pending'
     and (tg_op = 'INSERT' or new.attempt_count is distinct from old.attempt_count) then
    new.status := 'cancelled';
    new.resolved_at := coalesce(new.resolved_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists vault_claims_lock_on_attempts on public.vault_claims;

create trigger vault_claims_lock_on_attempts
  before insert or update of attempt_count, status
  on public.vault_claims
  for each row
  execute function public.eco_vault_claims_lock_on_attempts();

comment on function public.eco_vault_claims_lock_on_attempts() is
  'Cancel pending vault_claims once attempt_count reaches 5 (wrong claim codes).';
