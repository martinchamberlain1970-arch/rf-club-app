-- Phase 1: Team-based league module (snooker nights: 4 singles + 1 doubles, 1 point per frame)

create table if not exists public.league_seasons (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by_user_id uuid null references public.app_users(id) on delete set null,
  location_id uuid not null references public.locations(id) on delete restrict,
  name text not null,
  sport_type text not null default 'snooker' check (sport_type in ('snooker')),
  points_per_frame integer not null default 1 check (points_per_frame > 0),
  singles_count integer not null default 4 check (singles_count = 4),
  doubles_count integer not null default 1 check (doubles_count = 1),
  max_night_squad integer not null default 6 check (max_night_squad between 4 and 10),
  is_active boolean not null default true
);

create index if not exists league_seasons_location_idx on public.league_seasons (location_id);

create table if not exists public.league_teams (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  season_id uuid not null references public.league_seasons(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete restrict,
  name text not null,
  is_active boolean not null default true,
  unique (season_id, name)
);

create index if not exists league_teams_season_idx on public.league_teams (season_id);
create index if not exists league_teams_location_idx on public.league_teams (location_id);

create table if not exists public.league_team_members (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  season_id uuid not null references public.league_seasons(id) on delete cascade,
  team_id uuid not null references public.league_teams(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  is_captain boolean not null default false,
  unique (season_id, team_id, player_id)
);

create index if not exists league_team_members_team_idx on public.league_team_members (team_id);
create index if not exists league_team_members_player_idx on public.league_team_members (player_id);

create table if not exists public.league_fixtures (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  season_id uuid not null references public.league_seasons(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete restrict,
  week_no integer null,
  fixture_date date null,
  home_team_id uuid not null references public.league_teams(id) on delete restrict,
  away_team_id uuid not null references public.league_teams(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','in_progress','complete')),
  home_points integer not null default 0,
  away_points integer not null default 0,
  check (home_team_id <> away_team_id),
  unique (season_id, home_team_id, away_team_id, fixture_date)
);

create index if not exists league_fixtures_season_idx on public.league_fixtures (season_id);
create index if not exists league_fixtures_location_idx on public.league_fixtures (location_id);

create table if not exists public.league_fixture_frames (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  fixture_id uuid not null references public.league_fixtures(id) on delete cascade,
  slot_no smallint not null check (slot_no between 1 and 5),
  slot_type text not null check (slot_type in ('singles','doubles')),
  home_player1_id uuid null references public.players(id) on delete set null,
  home_player2_id uuid null references public.players(id) on delete set null,
  away_player1_id uuid null references public.players(id) on delete set null,
  away_player2_id uuid null references public.players(id) on delete set null,
  home_nominated boolean not null default false,
  away_nominated boolean not null default false,
  home_forfeit boolean not null default false,
  away_forfeit boolean not null default false,
  winner_side text null check (winner_side in ('home','away')),
  unique (fixture_id, slot_no)
);

create index if not exists league_fixture_frames_fixture_idx on public.league_fixture_frames (fixture_id);

create or replace function public.ensure_league_fixture_frame_rows()
returns trigger
language plpgsql
as $$
begin
  insert into public.league_fixture_frames (fixture_id, slot_no, slot_type)
  values
    (new.id, 1, 'singles'),
    (new.id, 2, 'singles'),
    (new.id, 3, 'singles'),
    (new.id, 4, 'singles'),
    (new.id, 5, 'doubles')
  on conflict (fixture_id, slot_no) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_league_fixture_seed_frames on public.league_fixtures;
create trigger trg_league_fixture_seed_frames
after insert on public.league_fixtures
for each row execute function public.ensure_league_fixture_frame_rows();

create or replace function public.recalc_league_fixture_points(p_fixture_id uuid)
returns void
language plpgsql
as $$
declare
  v_home integer;
  v_away integer;
  v_total integer;
begin
  select
    coalesce(sum(case when winner_side = 'home' then 1 else 0 end), 0),
    coalesce(sum(case when winner_side = 'away' then 1 else 0 end), 0),
    count(*)
  into v_home, v_away, v_total
  from public.league_fixture_frames
  where fixture_id = p_fixture_id;

  update public.league_fixtures
  set
    home_points = v_home,
    away_points = v_away,
    status = case
      when v_total = 5 and (v_home + v_away) = 5 then 'complete'
      when (v_home + v_away) > 0 then 'in_progress'
      else 'pending'
    end
  where id = p_fixture_id;
end;
$$;

create or replace function public.trg_recalc_league_fixture_points()
returns trigger
language plpgsql
as $$
begin
  perform public.recalc_league_fixture_points(coalesce(new.fixture_id, old.fixture_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_recalc_league_fixture_points on public.league_fixture_frames;
create trigger trg_recalc_league_fixture_points
after insert or update or delete on public.league_fixture_frames
for each row execute function public.trg_recalc_league_fixture_points();

create or replace view public.league_table as
with base as (
  select
    s.id as season_id,
    t.id as team_id,
    t.name as team_name,
    t.location_id
  from public.league_seasons s
  join public.league_teams t on t.season_id = s.id
),
fixtures as (
  select
    f.season_id,
    f.id as fixture_id,
    f.home_team_id,
    f.away_team_id,
    f.home_points,
    f.away_points,
    f.status
  from public.league_fixtures f
  where f.status = 'complete'
),
rows as (
  select
    b.season_id,
    b.team_id,
    b.team_name,
    b.location_id,
    count(case when fx.fixture_id is not null then 1 end) as played,
    coalesce(sum(case when fx.home_team_id = b.team_id then fx.home_points when fx.away_team_id = b.team_id then fx.away_points else 0 end), 0) as frames_for,
    coalesce(sum(case when fx.home_team_id = b.team_id then fx.away_points when fx.away_team_id = b.team_id then fx.home_points else 0 end), 0) as frames_against
  from base b
  left join fixtures fx
    on fx.season_id = b.season_id
   and (fx.home_team_id = b.team_id or fx.away_team_id = b.team_id)
  group by b.season_id, b.team_id, b.team_name, b.location_id
)
select
  season_id,
  team_id,
  team_name,
  location_id,
  played,
  frames_for as points,
  frames_for,
  frames_against,
  (frames_for - frames_against) as frame_diff
from rows;

alter table public.league_seasons enable row level security;
alter table public.league_teams enable row level security;
alter table public.league_team_members enable row level security;
alter table public.league_fixtures enable row level security;
alter table public.league_fixture_frames enable row level security;

drop policy if exists league_seasons_read_all on public.league_seasons;
create policy league_seasons_read_all on public.league_seasons
for select to authenticated using (true);

drop policy if exists league_teams_read_all on public.league_teams;
create policy league_teams_read_all on public.league_teams
for select to authenticated using (true);

drop policy if exists league_team_members_read_all on public.league_team_members;
create policy league_team_members_read_all on public.league_team_members
for select to authenticated using (true);

drop policy if exists league_fixtures_read_all on public.league_fixtures;
create policy league_fixtures_read_all on public.league_fixtures
for select to authenticated using (true);

drop policy if exists league_fixture_frames_read_all on public.league_fixture_frames;
create policy league_fixture_frames_read_all on public.league_fixture_frames
for select to authenticated using (true);

drop policy if exists league_seasons_write_admin on public.league_seasons;
create policy league_seasons_write_admin on public.league_seasons
for all to authenticated
using (
  exists (select 1 from public.app_users au where au.id = auth.uid() and coalesce(au.role, 'user') in ('admin','owner'))
)
with check (
  exists (select 1 from public.app_users au where au.id = auth.uid() and coalesce(au.role, 'user') in ('admin','owner'))
);

drop policy if exists league_teams_write_admin on public.league_teams;
create policy league_teams_write_admin on public.league_teams
for all to authenticated
using (
  exists (select 1 from public.app_users au where au.id = auth.uid() and coalesce(au.role, 'user') in ('admin','owner'))
)
with check (
  exists (select 1 from public.app_users au where au.id = auth.uid() and coalesce(au.role, 'user') in ('admin','owner'))
);

drop policy if exists league_team_members_write_admin on public.league_team_members;
create policy league_team_members_write_admin on public.league_team_members
for all to authenticated
using (
  exists (select 1 from public.app_users au where au.id = auth.uid() and coalesce(au.role, 'user') in ('admin','owner'))
)
with check (
  exists (select 1 from public.app_users au where au.id = auth.uid() and coalesce(au.role, 'user') in ('admin','owner'))
);

drop policy if exists league_fixtures_write_admin on public.league_fixtures;
create policy league_fixtures_write_admin on public.league_fixtures
for all to authenticated
using (
  exists (select 1 from public.app_users au where au.id = auth.uid() and coalesce(au.role, 'user') in ('admin','owner'))
)
with check (
  exists (select 1 from public.app_users au where au.id = auth.uid() and coalesce(au.role, 'user') in ('admin','owner'))
);

drop policy if exists league_fixture_frames_write_admin on public.league_fixture_frames;
create policy league_fixture_frames_write_admin on public.league_fixture_frames
for all to authenticated
using (
  exists (select 1 from public.app_users au where au.id = auth.uid() and coalesce(au.role, 'user') in ('admin','owner'))
)
with check (
  exists (select 1 from public.app_users au where au.id = auth.uid() and coalesce(au.role, 'user') in ('admin','owner'))
);

