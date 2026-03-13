-- Snooker: record actual break values (>30) per frame per side.

alter table if exists public.frames
  add column if not exists breaks_over_30_team1_values integer[] not null default '{}',
  add column if not exists breaks_over_30_team2_values integer[] not null default '{}';
