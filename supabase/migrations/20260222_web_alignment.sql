-- Rack & Frame web alignment migration (idempotent)
-- Apply in Supabase SQL editor if your project schema predates the latest web features.

create extension if not exists pgcrypto;

-- competitions: fields used by Events/Quick Match/Create Competition and progression
alter table if exists public.competitions
  add column if not exists match_mode text not null default 'singles',
  add column if not exists app_assign_opening_break boolean not null default false,
  add column if not exists knockout_round_best_of jsonb not null default '{}'::jsonb,
  add column if not exists is_archived boolean not null default false,
  add column if not exists is_completed boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'competitions_match_mode_ck'
      and conrelid = 'public.competitions'::regclass
  ) then
    alter table public.competitions
      add constraint competitions_match_mode_ck
      check (match_mode in ('singles','doubles'));
  end if;
end $$;

-- matches: singles + doubles shape, bye status, opener/winner fields
alter table if exists public.matches
  add column if not exists status text not null default 'pending',
  add column if not exists match_mode text not null default 'singles',
  add column if not exists player1_id uuid references public.players(id),
  add column if not exists player2_id uuid references public.players(id),
  add column if not exists team1_player1_id uuid references public.players(id),
  add column if not exists team1_player2_id uuid references public.players(id),
  add column if not exists team2_player1_id uuid references public.players(id),
  add column if not exists team2_player2_id uuid references public.players(id),
  add column if not exists winner_player_id uuid references public.players(id),
  add column if not exists opening_break_player_id uuid references public.players(id),
  add column if not exists next_break_team smallint,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'matches_status_ck'
      and conrelid = 'public.matches'::regclass
  ) then
    alter table public.matches
      add constraint matches_status_ck
      check (status in ('pending','in_progress','complete','bye'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'matches_match_mode_ck'
      and conrelid = 'public.matches'::regclass
  ) then
    alter table public.matches
      add constraint matches_match_mode_ck
      check (match_mode in ('singles','doubles'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'matches_next_break_team_ck'
      and conrelid = 'public.matches'::regclass
  ) then
    alter table public.matches
      add constraint matches_next_break_team_ck
      check (next_break_team in (1,2));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'matches_mode_shape_ck'
      and conrelid = 'public.matches'::regclass
  ) then
    alter table public.matches
      add constraint matches_mode_shape_ck check (
        (
          match_mode = 'singles'
          and player1_id is not null
          and player2_id is not null
          and team1_player1_id is null
          and team1_player2_id is null
          and team2_player1_id is null
          and team2_player2_id is null
        )
        or
        (
          match_mode = 'doubles'
          and player1_id is null
          and player2_id is null
          and team1_player1_id is not null
          and team1_player2_id is not null
          and team2_player1_id is not null
          and team2_player2_id is not null
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'matches_doubles_unique_players_ck'
      and conrelid = 'public.matches'::regclass
  ) then
    alter table public.matches
      add constraint matches_doubles_unique_players_ck check (
        match_mode <> 'doubles'
        or (
          team1_player1_id <> team1_player2_id
          and team2_player1_id <> team2_player2_id
          and team1_player1_id <> team2_player1_id
          and team1_player1_id <> team2_player2_id
          and team1_player2_id <> team2_player1_id
          and team1_player2_id <> team2_player2_id
        )
      );
  end if;
end $$;

-- frames: walkover and premium markers used in match save flow
alter table if exists public.frames
  add column if not exists break_and_run boolean not null default false,
  add column if not exists run_out_against_break boolean not null default false,
  add column if not exists is_walkover_award boolean not null default false;

create index if not exists matches_competition_round_match_idx
  on public.matches (competition_id, round_no, match_no);

create index if not exists matches_competition_status_idx
  on public.matches (competition_id, status);

create index if not exists frames_match_frame_no_idx
  on public.frames (match_id, frame_number);
