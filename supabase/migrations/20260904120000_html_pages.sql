-- Eco HTML hosting (Artifacts): single-file pages with TTL + one-shot extend.
-- Public view/extend go through Edge Functions (service role). Clients never write body_html directly.

create table public.html_pages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  slug text not null,
  title text not null,
  body_html text not null,
  thread_id text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  extended_at timestamptz,
  constraint html_pages_slug_format check (slug ~ '^[A-Za-z0-9_-]{16,64}$'),
  constraint html_pages_title_len check (char_length(title) between 1 and 200),
  constraint html_pages_body_len check (char_length(body_html) between 1 and 1048576),
  constraint html_pages_expires_after_created check (expires_at > created_at)
);

create unique index html_pages_slug_uidx on public.html_pages (slug);
create index html_pages_user_created_idx on public.html_pages (user_id, created_at desc);
create index html_pages_expires_at_idx on public.html_pages (expires_at);

alter table public.html_pages enable row level security;

-- Owners may list/delete their own rows (body readable for account UI).
-- Inserts/updates go through Edge Functions with service_role.
create policy "html_pages_select_own"
  on public.html_pages for select to authenticated
  using (user_id = (select auth.uid()));

create policy "html_pages_delete_own"
  on public.html_pages for delete to authenticated
  using (user_id = (select auth.uid()));

revoke insert, update on public.html_pages from authenticated;
grant select, delete on public.html_pages to authenticated;
