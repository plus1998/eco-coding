import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migrationsDir = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));

test("account config replacement targets the user_secrets constraint without PL/pgSQL ambiguity", () => {
  const coreMigration = readFileSync(`${migrationsDir}/20260820100000_eco_center_core.sql`, "utf8");
  const fixMigration = readFileSync(
    `${migrationsDir}/20260821173000_fix_replace_account_config_conflict_target.sql`,
    "utf8",
  );

  expect(coreMigration).toContain("unique (user_id, secret_kind, secret_key)");
  expect(fixMigration).toContain(
    "on conflict on constraint user_secrets_user_id_secret_kind_secret_key_key do update",
  );
  expect(fixMigration).not.toContain("on conflict (user_id, secret_kind, secret_key)");
});

test("binding updates only grant revocation and Realtime rejects disabled endpoints", () => {
  const migration = readFileSync(
    `${migrationsDir}/20260822100000_lock_down_bindings_and_realtime_devices.sql`,
    "utf8",
  );

  expect(migration).toContain("revoke update on public.device_bindings from authenticated");
  expect(migration).toContain("grant update (revoked_at) on public.device_bindings to authenticated");
  expect(migration).toContain('create policy "bindings_revoke_own"');
  expect(migration).toContain("and revoked_at is null");
  expect(migration).toContain("and revoked_at is not null");
  expect(migration).toContain("join public.devices_public desktop");
  expect(migration).toContain("desktop.disabled_at is null");
  expect(migration).toContain("join public.devices_public mobile");
  expect(migration).toContain("mobile.disabled_at is null");
  expect(migration).not.toContain("join public.devices desktop");
  expect(migration).not.toContain("join public.devices mobile");
});

test("device-session infrastructure deploys before deferred breaking enforcement", () => {
  const migration = readFileSync(`${migrationsDir}/20260822101000_bind_auth_sessions_to_devices.sql`, "utf8");
  const enforcement = readFileSync(
    fileURLToPath(
      new URL(
        "../../../supabase/deferred-migrations/20260822102000_enforce_device_sessions.sql",
        import.meta.url,
      ),
    ),
    "utf8",
  );

  expect(migration).toContain("create table public.device_sessions");
  expect(migration).toContain("session_id uuid primary key references auth.sessions (id) on delete cascade");
  expect(migration).toContain("revoke all on public.device_sessions from anon, authenticated");
  expect(migration).toContain("create or replace function public.eco_register_device_session");
  expect(migration).toContain("insert into public.devices");
  expect(migration).toContain("insert into public.device_sessions");
  expect(migration).toContain("grant execute on function public.eco_register_device_session");
  expect(migration).toContain("create or replace function public.eco_bind_device_session");
  expect(migration).toContain("grant execute on function public.eco_bind_device_session");
  expect(migration).toContain("create or replace function public.eco_disable_device_sessions");
  expect(migration).toContain("delete from public.device_sessions");
  expect(migration).toContain("grant execute on function public.eco_disable_device_sessions");
  expect(migration).toContain("to service_role");
  expect(migration).toContain("where ds.session_id = (select public.eco_current_session_id())");
  expect(migration).toContain("and ds.user_id = (select auth.uid())");
  expect(migration).toContain("and d.disabled_at is null");
  expect(migration).not.toContain('create policy "bindings_select_current_device"');
  expect(migration).not.toContain('create policy "eco_realtime_select"');
  expect(migration).not.toContain("grant insert on public.device_sessions");
  expect(migration).not.toContain("grant update on public.device_sessions");

  expect(enforcement).toContain('create policy "bindings_select_current_device"');
  expect(enforcement).toContain("public.eco_current_device_owns_binding");
  expect(enforcement).toContain("public.eco_current_device_owns_vault_claim");
  expect(enforcement).toContain("and (select public.eco_current_device_id()) is not null");
  expect(enforcement).toContain('create policy "vault_claims_insert_current_requester"');
  expect(enforcement).toContain('drop policy if exists "vault_claims_select_own"');
  expect(enforcement).toContain('create policy "vault_claims_select_current_device"');
  expect(enforcement).toContain("public.eco_current_device_can_select_vault_claim");
  expect(enforcement).toContain('create policy "user_settings_select_current_device"');
  expect(enforcement).toContain('create policy "user_secrets_select_current_device"');
  expect(enforcement).toContain("Current session is not authorized for an active Eco device.");
  expect(enforcement).toContain("on conflict on constraint user_secrets_user_id_secret_kind_secret_key_key");
});

test("device Edge Functions require session registration and device-secret proof", () => {
  const register = readFileSync(
    fileURLToPath(new URL("../../../supabase/functions/device-register/index.ts", import.meta.url)),
    "utf8",
  );
  const devices = readFileSync(
    fileURLToPath(new URL("../../../supabase/functions/_shared/devices.ts", import.meta.url)),
    "utf8",
  );
  const disable = readFileSync(
    fileURLToPath(new URL("../../../supabase/functions/device-disable/index.ts", import.meta.url)),
    "utf8",
  );

  expect(register.indexOf("if (!auth.sessionId)")).toBeLessThan(register.indexOf("await registerDevice"));
  expect(devices).toContain('admin.rpc("eco_register_device_session"');
  expect(devices).not.toContain('.from("devices")\n    .insert(');
  expect(disable).toContain("requireAuthSession(req)");
  expect(disable).toContain('requireString(body, "deviceSecret")');
  expect(disable).toContain("requireOwnedDevice(admin");
  expect(devices).toContain('admin.rpc("eco_disable_device_sessions"');
  expect(disable).not.toContain('.from("device_sessions")');
});
