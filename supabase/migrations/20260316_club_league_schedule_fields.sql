-- Club league competition scheduling support.
-- Safe to run multiple times.

alter table if exists public.competitions
  add column if not exists league_meetings integer,
  add column if not exists league_start_date date;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'competitions_league_meetings_ck'
      and conrelid = 'public.competitions'::regclass
  ) then
    alter table public.competitions
      add constraint competitions_league_meetings_ck
      check (league_meetings is null or league_meetings between 1 and 4);
  end if;
end $$;

alter table if exists public.matches
  add column if not exists scheduled_for date;

create index if not exists matches_competition_scheduled_for_idx
  on public.matches (competition_id, scheduled_for);
