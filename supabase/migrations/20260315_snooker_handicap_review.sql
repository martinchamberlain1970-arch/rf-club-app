-- Snooker Elo to handicap review support.
-- Safe to run multiple times.

alter table if exists public.players
  add column if not exists snooker_handicap integer,
  add column if not exists snooker_handicap_base integer;

create table if not exists public.snooker_handicap_history (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  previous_handicap integer not null,
  new_handicap integer not null,
  delta integer not null,
  reason text not null,
  changed_by uuid null references auth.users(id) on delete set null,
  fixture_id uuid null,
  created_at timestamptz not null default now()
);

create index if not exists snooker_handicap_history_player_created_idx
  on public.snooker_handicap_history (player_id, created_at desc);

update public.players
set snooker_handicap_base = snooker_handicap
where snooker_handicap is not null
  and snooker_handicap_base is null;

update public.players
set rating_snooker = round(1000 - (coalesce(snooker_handicap, 0) * 5)),
    peak_rating_snooker = round(1000 - (coalesce(snooker_handicap, 0) * 5)),
    rated_matches_snooker = coalesce(rated_matches_snooker, 0)
where is_archived = false
  and snooker_handicap is not null
  and coalesce(rated_matches_snooker, 0) = 0;
