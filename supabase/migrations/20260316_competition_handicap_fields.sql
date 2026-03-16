alter table if exists public.competitions
  add column if not exists handicap_enabled boolean not null default false;

alter table if exists public.matches
  add column if not exists team1_handicap_start integer not null default 0,
  add column if not exists team2_handicap_start integer not null default 0;
