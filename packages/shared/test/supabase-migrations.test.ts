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
