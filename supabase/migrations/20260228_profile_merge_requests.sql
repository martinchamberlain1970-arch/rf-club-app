create table if not exists public.profile_merge_requests (
  id uuid primary key default gen_random_uuid(),
  requester_user_id uuid not null references public.app_users(id) on delete cascade,
  target_player_id uuid not null references public.players(id) on delete cascade,
  requested_display_name text not null,
  requested_full_name text not null,
  requested_age_band text not null,
  requested_location_id uuid null references public.locations(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by_user_id uuid null references public.app_users(id) on delete set null,
  reviewed_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists profile_merge_requests_status_idx
  on public.profile_merge_requests (status, created_at desc);

alter table public.profile_merge_requests enable row level security;

drop policy if exists profile_merge_requests_insert on public.profile_merge_requests;
create policy profile_merge_requests_insert
  on public.profile_merge_requests
  for insert
  to authenticated
  with check (requester_user_id = auth.uid());

drop policy if exists profile_merge_requests_read_own on public.profile_merge_requests;
create policy profile_merge_requests_read_own
  on public.profile_merge_requests
  for select
  to authenticated
  using (
    requester_user_id = auth.uid()
    or exists (
      select 1 from public.app_users au
      where au.id = auth.uid() and au.role = 'owner'
    )
  );

drop policy if exists profile_merge_requests_update_owner on public.profile_merge_requests;
create policy profile_merge_requests_update_owner
  on public.profile_merge_requests
  for update
  to authenticated
  using (
    exists (
      select 1 from public.app_users au
      where au.id = auth.uid() and au.role = 'owner'
    )
  )
  with check (
    exists (
      select 1 from public.app_users au
      where au.id = auth.uid() and au.role = 'owner'
    )
  );
