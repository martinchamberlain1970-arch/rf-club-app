create table if not exists public.player_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  requester_user_id uuid not null references public.app_users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by_user_id uuid null references public.app_users(id) on delete set null,
  reviewed_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists player_deletion_requests_status_idx
  on public.player_deletion_requests (status, created_at desc);

alter table public.player_deletion_requests enable row level security;

drop policy if exists player_deletion_requests_insert on public.player_deletion_requests;
create policy player_deletion_requests_insert
  on public.player_deletion_requests
  for insert
  to authenticated
  with check (requester_user_id = auth.uid());

drop policy if exists player_deletion_requests_read on public.player_deletion_requests;
create policy player_deletion_requests_read
  on public.player_deletion_requests
  for select
  to authenticated
  using (
    requester_user_id = auth.uid()
    or exists (
      select 1
      from public.app_users au
      where au.id = auth.uid()
        and au.role = 'owner'
    )
  );

drop policy if exists player_deletion_requests_update_owner on public.player_deletion_requests;
create policy player_deletion_requests_update_owner
  on public.player_deletion_requests
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.app_users au
      where au.id = auth.uid()
        and au.role = 'owner'
    )
  )
  with check (
    exists (
      select 1
      from public.app_users au
      where au.id = auth.uid()
        and au.role = 'owner'
    )
  );

