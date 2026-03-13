-- Snooker frame scoring support
-- Adds per-frame points and break counters used by the web match screen.

alter table if exists public.frames
  add column if not exists team1_points integer not null default 0,
  add column if not exists team2_points integer not null default 0,
  add column if not exists breaks_over_30_team1 integer not null default 0,
  add column if not exists breaks_over_30_team2 integer not null default 0,
  add column if not exists century_breaks_team1 integer not null default 0,
  add column if not exists century_breaks_team2 integer not null default 0;

-- Keep values sane.
alter table if exists public.frames
  drop constraint if exists frames_team1_points_nonnegative_ck,
  drop constraint if exists frames_team2_points_nonnegative_ck,
  drop constraint if exists frames_breaks_over_30_team1_nonnegative_ck,
  drop constraint if exists frames_breaks_over_30_team2_nonnegative_ck,
  drop constraint if exists frames_century_breaks_team1_nonnegative_ck,
  drop constraint if exists frames_century_breaks_team2_nonnegative_ck,
  add constraint frames_team1_points_nonnegative_ck check (team1_points >= 0),
  add constraint frames_team2_points_nonnegative_ck check (team2_points >= 0),
  add constraint frames_breaks_over_30_team1_nonnegative_ck check (breaks_over_30_team1 >= 0),
  add constraint frames_breaks_over_30_team2_nonnegative_ck check (breaks_over_30_team2 >= 0),
  add constraint frames_century_breaks_team1_nonnegative_ck check (century_breaks_team1 >= 0),
  add constraint frames_century_breaks_team2_nonnegative_ck check (century_breaks_team2 >= 0);
