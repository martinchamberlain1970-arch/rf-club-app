create table if not exists public.league_reschedule_requests (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  competition_id uuid not null references public.competitions(id) on delete cascade,
  requester_user_id uuid not null references auth.users(id) on delete cascade,
  requester_player_id uuid null references public.players(id) on delete set null,
  original_scheduled_for date not null,
  requested_scheduled_for date not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by_user_id uuid null references auth.users(id) on delete set null,
  reviewed_at timestamptz null,
  note text null,
  created_at timestamptz not null default now()
);

create index if not exists league_reschedule_requests_match_idx
  on public.league_reschedule_requests (match_id, created_at desc);

create unique index if not exists league_reschedule_requests_one_pending_per_requester_idx
  on public.league_reschedule_requests (requester_user_id)
  where status = 'pending';

create unique index if not exists league_reschedule_requests_one_pending_per_match_idx
  on public.league_reschedule_requests (match_id)
  where status = 'pending';

alter table public.league_reschedule_requests enable row level security;

drop policy if exists league_reschedule_requests_select on public.league_reschedule_requests;
create policy league_reschedule_requests_select
  on public.league_reschedule_requests
  for select
  to authenticated
  using (
    requester_user_id = auth.uid()
    or exists (
      select 1
      from public.app_users au
      where au.id = auth.uid()
        and coalesce(au.role, 'user') = 'owner'
    )
  );

drop policy if exists league_reschedule_requests_insert on public.league_reschedule_requests;
create policy league_reschedule_requests_insert
  on public.league_reschedule_requests
  for insert
  to authenticated
  with check (
    requester_user_id = auth.uid()
    and status = 'pending'
  );

drop policy if exists league_reschedule_requests_update_owner on public.league_reschedule_requests;
create policy league_reschedule_requests_update_owner
  on public.league_reschedule_requests
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.app_users au
      where au.id = auth.uid()
        and coalesce(au.role, 'user') = 'owner'
    )
  )
  with check (
    exists (
      select 1
      from public.app_users au
      where au.id = auth.uid()
        and coalesce(au.role, 'user') = 'owner'
    )
  );
