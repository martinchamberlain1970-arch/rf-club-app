-- Snooker: store highest break per player per frame.

alter table if exists public.frames
  add column if not exists high_break_team1 integer not null default 0,
  add column if not exists high_break_team2 integer not null default 0;

alter table if exists public.frames
  drop constraint if exists frames_high_break_team1_nonnegative_ck,
  drop constraint if exists frames_high_break_team2_nonnegative_ck,
  add constraint frames_high_break_team1_nonnegative_ck check (high_break_team1 >= 0),
  add constraint frames_high_break_team2_nonnegative_ck check (high_break_team2 >= 0);
