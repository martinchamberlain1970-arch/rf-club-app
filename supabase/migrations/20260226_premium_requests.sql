-- Premium requests + flag
alter table if exists public.app_users
  add column if not exists premium_unlocked boolean not null default false;

create table if not exists public.premium_requests (
  id uuid primary key default gen_random_uuid(),
  requester_user_id uuid not null,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create index if not exists premium_requests_status_idx
  on public.premium_requests (status, created_at desc);

alter table public.premium_requests enable row level security;

drop policy if exists premium_requests_insert on public.premium_requests;
create policy premium_requests_insert
  on public.premium_requests
  for insert
  to authenticated
  with check (requester_user_id = auth.uid());

drop policy if exists premium_requests_read_self on public.premium_requests;
create policy premium_requests_read_self
  on public.premium_requests
  for select
  to authenticated
  using (requester_user_id = auth.uid());

drop policy if exists premium_requests_read_admin on public.premium_requests;
create policy premium_requests_read_admin
  on public.premium_requests
  for select
  to authenticated
  using (coalesce(auth.jwt() -> 'user_metadata' ->> 'role','user') = 'admin');

drop policy if exists premium_requests_update_admin on public.premium_requests;
create policy premium_requests_update_admin
  on public.premium_requests
  for update
  to authenticated
  using (coalesce(auth.jwt() -> 'user_metadata' ->> 'role','user') = 'admin');
