-- Location requests from signup flow (reviewed by Super User)
create table if not exists public.location_requests (
  id uuid primary key default gen_random_uuid(),
  requester_user_id uuid null references auth.users(id) on delete set null,
  requester_email text not null,
  requester_full_name text not null,
  requested_location_name text not null,
  target_super_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by_user_id uuid null references auth.users(id) on delete set null,
  reviewed_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists location_requests_status_created_idx
  on public.location_requests (status, created_at desc);

create index if not exists location_requests_target_idx
  on public.location_requests (target_super_user_id, status, created_at desc);

alter table public.location_requests enable row level security;

drop policy if exists location_requests_insert_public on public.location_requests;
create policy location_requests_insert_public
  on public.location_requests
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists location_requests_select_own on public.location_requests;
create policy location_requests_select_own
  on public.location_requests
  for select
  to authenticated
  using (
    auth.uid() = requester_user_id
    or auth.uid() = target_super_user_id
  );

drop policy if exists location_requests_update_super on public.location_requests;
create policy location_requests_update_super
  on public.location_requests
  for update
  to authenticated
  using (auth.uid() = target_super_user_id)
  with check (auth.uid() = target_super_user_id);

