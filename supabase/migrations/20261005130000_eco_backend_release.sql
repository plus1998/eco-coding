-- The original release column contained the deploying desktop app's version.
-- Preserve it as audit data; legacy installations have no verified backend release yet.
alter table public.eco_deployment_version
  rename column release to deployed_by_desktop_version;

alter table public.eco_deployment_version
  add column backend_version text,
  add column api_version integer,
  add constraint eco_deployment_api_version_positive check (api_version > 0),
  add constraint eco_deployment_backend_metadata_complete
    check ((backend_version is null) = (api_version is null));

comment on column public.eco_deployment_version.backend_version is
  'Independent backend SemVer from supabase/deployment.json; null until a verified deployment.';
comment on column public.eco_deployment_version.api_version is
  'Eco backend API contract version; independent of desktop app and database migration versions.';
comment on column public.eco_deployment_version.deployed_by_desktop_version is
  'Desktop app version that performed the last verified deployment; audit only.';
