-- Optional Monday-to-Sunday pauses in weekly club competitions.

alter table if exists public.competitions
  add column if not exists league_break_weeks date[] not null default '{}'::date[];
