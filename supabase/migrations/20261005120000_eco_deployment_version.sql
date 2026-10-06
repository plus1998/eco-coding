-- Written only after the desktop Cloud deployer has verified all migrations/functions.
-- Management API uses the database owner; app users cannot forge deployment state.
create table public.eco_deployment_version (
  id boolean primary key default true check (id),
  release text not null,
  schema_version text not null,
  bundle_hash text not null,
  migration_checksums jsonb not null,
  functions jsonb not null,
  deployed_at timestamptz not null default now()
);

alter table public.eco_deployment_version enable row level security;
revoke all on public.eco_deployment_version from anon, authenticated;
