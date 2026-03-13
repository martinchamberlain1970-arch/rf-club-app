-- Add per-team counts for break & run / run out in result submissions
alter table if exists public.result_submissions
  add column if not exists break_and_run_team1 integer,
  add column if not exists break_and_run_team2 integer,
  add column if not exists run_out_against_break_team1 integer,
  add column if not exists run_out_against_break_team2 integer;
