-- League knockout competitions + user sign-ups

create table if not exists public.league_knockout_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by_user_id uuid null references public.app_users(id) on delete set null,
  name text not null,
  competition_type text not null,
  match_mode text not null check (match_mode in ('singles','doubles','triples')),
  format_label text not null check (format_label in ('scratch','handicap')),
  age_min integer null,
  sport_type text not null default 'snooker' check (sport_type in ('snooker','billiards')),
  sort_order integer not null default 100,
  signup_open boolean not null default false,
  published boolean not null default false,
  is_active boolean not null default true,
  unique (competition_type)
);

create index if not exists league_knockout_events_sort_idx on public.league_knockout_events (sort_order, name);

create table if not exists public.league_knockout_signups (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  event_id uuid not null references public.league_knockout_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  player_id uuid null references public.players(id) on delete set null,
  status text not null default 'entered' check (status in ('entered','withdrawn')),
  unique (event_id, user_id)
);

create index if not exists league_knockout_signups_event_idx on public.league_knockout_signups (event_id, status);

alter table public.league_knockout_events enable row level security;
alter table public.league_knockout_signups enable row level security;

drop policy if exists league_knockout_events_read_all on public.league_knockout_events;
create policy league_knockout_events_read_all on public.league_knockout_events
for select to authenticated using (true);

drop policy if exists league_knockout_events_write_owner on public.league_knockout_events;
create policy league_knockout_events_write_owner on public.league_knockout_events
for all to authenticated
using (
  exists (
    select 1 from public.app_users au
    where au.id = auth.uid()
      and coalesce(au.role, 'user') = 'owner'
  )
)
with check (
  exists (
    select 1 from public.app_users au
    where au.id = auth.uid()
      and coalesce(au.role, 'user') = 'owner'
  )
);

drop policy if exists league_knockout_signups_read_all on public.league_knockout_signups;
create policy league_knockout_signups_read_all on public.league_knockout_signups
for select to authenticated using (true);

drop policy if exists league_knockout_signups_insert_self on public.league_knockout_signups;
create policy league_knockout_signups_insert_self on public.league_knockout_signups
for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.league_knockout_events e
    where e.id = event_id
      and e.published = true
      and e.signup_open = true
      and e.is_active = true
  )
);

drop policy if exists league_knockout_signups_update_self_or_owner on public.league_knockout_signups;
create policy league_knockout_signups_update_self_or_owner on public.league_knockout_signups
for update to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.app_users au
    where au.id = auth.uid()
      and coalesce(au.role, 'user') = 'owner'
  )
)
with check (
  user_id = auth.uid()
  or exists (
    select 1 from public.app_users au
    where au.id = auth.uid()
      and coalesce(au.role, 'user') = 'owner'
  )
);

insert into public.league_knockout_events
  (name, competition_type, match_mode, format_label, age_min, sport_type, sort_order, signup_open, published, is_active)
values
  ('Gary Webb (Singles Scratch)', 'gary_webb_singles_scratch', 'singles', 'scratch', null, 'snooker', 10, false, false, true),
  ('Lee Ford (Singles Handicap)', 'lee_ford_singles_handicap', 'singles', 'handicap', null, 'snooker', 20, false, false, true),
  ('Cross Cup (Doubles Scratch)', 'cross_cup_doubles_scratch', 'doubles', 'scratch', null, 'snooker', 30, false, false, true),
  ('Handicap Doubles', 'handicap_doubles', 'doubles', 'handicap', null, 'snooker', 40, false, false, true),
  ('Jack Harvey (Over 50s)', 'jack_harvey_over_50', 'singles', 'scratch', 50, 'snooker', 50, false, false, true),
  ('Fred Osbourne (Over 60s)', 'fred_osbourne_over_60', 'singles', 'scratch', 60, 'snooker', 60, false, false, true),
  ('Hamilton Cup (Billiards Singles)', 'hamilton_cup_billiards_singles', 'singles', 'scratch', null, 'billiards', 70, false, false, true),
  ('Hodge Cup (Triples)', 'hodge_cup_triples', 'triples', 'scratch', null, 'snooker', 80, false, false, true)
on conflict (competition_type) do update
set
  name = excluded.name,
  match_mode = excluded.match_mode,
  format_label = excluded.format_label,
  age_min = excluded.age_min,
  sport_type = excluded.sport_type,
  sort_order = excluded.sort_order,
  is_active = true;
