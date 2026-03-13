-- Player profile update requests (name/location changes)
create table if not exists public.player_update_requests (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  requester_user_id uuid not null,
  requested_full_name text,
  requested_location_id uuid references public.locations(id),
  requested_avatar_url text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create index if not exists player_update_requests_status_idx
  on public.player_update_requests (status, created_at desc);

-- RLS
alter table public.player_update_requests enable row level security;

drop policy if exists player_update_requests_insert on public.player_update_requests;
create policy player_update_requests_insert
  on public.player_update_requests
  for insert
  to authenticated
  with check (requester_user_id = auth.uid());

drop policy if exists player_update_requests_read_admin on public.player_update_requests;
create policy player_update_requests_read_admin
  on public.player_update_requests
  for select
  to authenticated
  using (coalesce(auth.jwt() -> 'user_metadata' ->> 'role','user') = 'admin');

drop policy if exists player_update_requests_update_admin on public.player_update_requests;
create policy player_update_requests_update_admin
  on public.player_update_requests
  for update
  to authenticated
  using (coalesce(auth.jwt() -> 'user_metadata' ->> 'role','user') = 'admin');
