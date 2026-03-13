-- League weekly result entry enhancements:
-- 1) Allow storing nominated player names (info only)
-- 2) Store snooker breaks 30+ per fixture

alter table if exists public.league_fixture_frames
  add column if not exists home_nominated_name text null,
  add column if not exists away_nominated_name text null,
  add column if not exists home_points_scored integer null check (home_points_scored >= 0),
  add column if not exists away_points_scored integer null check (away_points_scored >= 0);

create table if not exists public.league_fixture_breaks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  fixture_id uuid not null references public.league_fixtures(id) on delete cascade,
  player_id uuid null references public.players(id) on delete set null,
  entered_player_name text null,
  break_value integer not null check (break_value >= 30)
);

create index if not exists league_fixture_breaks_fixture_idx
  on public.league_fixture_breaks (fixture_id);

create index if not exists league_fixture_breaks_player_idx
  on public.league_fixture_breaks (player_id);

alter table public.league_fixture_breaks enable row level security;

drop policy if exists league_fixture_breaks_read_all on public.league_fixture_breaks;
create policy league_fixture_breaks_read_all on public.league_fixture_breaks
for select to authenticated using (true);

drop policy if exists league_fixture_breaks_write_admin on public.league_fixture_breaks;
create policy league_fixture_breaks_write_admin on public.league_fixture_breaks
for all to authenticated
using (
  exists (
    select 1
    from public.app_users au
    where au.id = auth.uid()
      and coalesce(au.role, 'user') in ('admin', 'owner')
  )
)
with check (
  exists (
    select 1
    from public.app_users au
    where au.id = auth.uid()
      and coalesce(au.role, 'user') in ('admin', 'owner')
  )
);
