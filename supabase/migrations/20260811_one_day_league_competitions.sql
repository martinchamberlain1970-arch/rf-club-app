-- One-day round-robin competitions with optional top-four finals.
-- Safe to run more than once.

alter table if exists public.competitions
  add column if not exists league_schedule_mode text not null default 'weekly',
  add column if not exists league_finals_size integer not null default 0,
  add column if not exists league_semi_final_best_of integer,
  add column if not exists league_final_best_of integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'competitions_league_schedule_mode_ck'
      and conrelid = 'public.competitions'::regclass
  ) then
    alter table public.competitions
      add constraint competitions_league_schedule_mode_ck
      check (league_schedule_mode in ('weekly', 'one_day'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'competitions_league_finals_size_ck'
      and conrelid = 'public.competitions'::regclass
  ) then
    alter table public.competitions
      add constraint competitions_league_finals_size_ck
      check (league_finals_size in (0, 4));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'competitions_league_semi_final_best_of_ck'
      and conrelid = 'public.competitions'::regclass
  ) then
    alter table public.competitions
      add constraint competitions_league_semi_final_best_of_ck
      check (league_semi_final_best_of is null or (league_semi_final_best_of > 0 and league_semi_final_best_of % 2 = 1));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'competitions_league_final_best_of_ck'
      and conrelid = 'public.competitions'::regclass
  ) then
    alter table public.competitions
      add constraint competitions_league_final_best_of_ck
      check (league_final_best_of is null or (league_final_best_of > 0 and league_final_best_of % 2 = 1));
  end if;
end $$;
