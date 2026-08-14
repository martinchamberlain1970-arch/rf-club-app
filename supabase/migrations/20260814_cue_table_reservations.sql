-- App-only cue-table reservations with explicit captain/vice-captain access.

create extension if not exists btree_gist;

create table if not exists public.cue_tables (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  name text not null,
  sport_type text not null check (sport_type in ('pool', 'snooker')),
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (location_id, name)
);

create table if not exists public.table_booking_access (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  sport_type text not null check (sport_type in ('pool', 'snooker')),
  access_role text not null check (access_role in ('captain', 'vice_captain')),
  granted_by_user_id uuid null references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (player_id, sport_type)
);

create table if not exists public.table_reservations (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.cue_tables(id) on delete cascade,
  booked_by_user_id uuid not null references public.app_users(id) on delete restrict,
  booked_for_player_id uuid not null references public.players(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  purpose text not null default 'fixture' check (purpose in ('fixture', 'league_match', 'practice', 'other')),
  notes text null check (char_length(notes) <= 240),
  status text not null default 'booked' check (status in ('booked', 'cancelled')),
  cancelled_at timestamptz null,
  cancelled_by_user_id uuid null references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (ends_at <= starts_at + interval '4 hours')
);

create index if not exists table_reservations_upcoming_idx
  on public.table_reservations (starts_at, table_id)
  where status = 'booked';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'table_reservations_no_overlap') then
    alter table public.table_reservations
      add constraint table_reservations_no_overlap
      exclude using gist (
        table_id with =,
        tstzrange(starts_at, ends_at, '[)') with &&
      ) where (status = 'booked');
  end if;
end;
$$;

alter table public.cue_tables enable row level security;
alter table public.table_booking_access enable row level security;
alter table public.table_reservations enable row level security;

drop policy if exists cue_tables_authenticated_read on public.cue_tables;
create policy cue_tables_authenticated_read on public.cue_tables for select to authenticated using (true);

drop policy if exists table_reservations_authenticated_read on public.table_reservations;
create policy table_reservations_authenticated_read on public.table_reservations for select to authenticated using (true);

insert into public.cue_tables (location_id, name, sport_type, display_order)
select id, 'Pool Table', 'pool', 1
from public.locations
where lower(name) like '%greenhithe%legion%'
on conflict (location_id, name) do nothing;

insert into public.cue_tables (location_id, name, sport_type, display_order)
select id, 'Snooker Table', 'snooker', 2
from public.locations
where lower(name) like '%greenhithe%legion%'
on conflict (location_id, name) do nothing;
