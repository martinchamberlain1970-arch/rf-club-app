-- Player rating system (pool/snooker) and per-match rating application guard.
-- Safe to run multiple times.

alter table if exists public.players
  add column if not exists rating_pool integer not null default 1000,
  add column if not exists rating_snooker integer not null default 1000,
  add column if not exists peak_rating_pool integer not null default 1000,
  add column if not exists peak_rating_snooker integer not null default 1000,
  add column if not exists rated_matches_pool integer not null default 0,
  add column if not exists rated_matches_snooker integer not null default 0;

alter table if exists public.matches
  add column if not exists rating_applied_at timestamptz,
  add column if not exists rating_delta_team1 integer,
  add column if not exists rating_delta_team2 integer;

update public.players
set
  rating_pool = coalesce(rating_pool, 1000),
  rating_snooker = coalesce(rating_snooker, 1000),
  peak_rating_pool = greatest(coalesce(peak_rating_pool, 1000), coalesce(rating_pool, 1000)),
  peak_rating_snooker = greatest(coalesce(peak_rating_snooker, 1000), coalesce(rating_snooker, 1000)),
  rated_matches_pool = coalesce(rated_matches_pool, 0),
  rated_matches_snooker = coalesce(rated_matches_snooker, 0);
