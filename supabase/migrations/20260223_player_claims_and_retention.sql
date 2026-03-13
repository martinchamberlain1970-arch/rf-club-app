-- Player claims + GDPR retention support (idempotent)

create extension if not exists pgcrypto;

alter table if exists public.players
  add column if not exists full_name text,
  add column if not exists claimed_by uuid references auth.users(id),
  add column if not exists archived_at timestamptz,
  add column if not exists last_active_at timestamptz not null default now();

create table if not exists public.player_claim_requests (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  requester_user_id uuid not null references auth.users(id) on delete cascade,
  requested_full_name text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by_user_id uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (player_id, requester_user_id, status)
);

create index if not exists player_claim_requests_player_idx on public.player_claim_requests(player_id, status);

create or replace function public.players_archive_timestamp()
returns trigger
language plpgsql
as $$
begin
  if new.is_archived = true and coalesce(old.is_archived, false) = false then
    new.archived_at = now();
  elsif new.is_archived = false and coalesce(old.is_archived, false) = true then
    new.archived_at = null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_players_archive_timestamp on public.players;
create trigger trg_players_archive_timestamp
before update on public.players
for each row
execute function public.players_archive_timestamp();

create or replace function public.bump_player_last_active_from_match()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'complete' then
    update public.players
    set last_active_at = now()
    where id = any(array[
      new.player1_id,
      new.player2_id,
      new.team1_player1_id,
      new.team1_player2_id,
      new.team2_player1_id,
      new.team2_player2_id
    ]::uuid[]);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_matches_bump_player_activity on public.matches;
create trigger trg_matches_bump_player_activity
after insert or update on public.matches
for each row
execute function public.bump_player_last_active_from_match();

create or replace function public.purge_gdpr_players()
returns integer
language plpgsql
as $$
declare
  deleted_count integer := 0;
begin
  delete from public.players p
  where p.is_archived = true
    and p.archived_at is not null
    and p.archived_at < now() - interval '6 months'
    and coalesce(p.last_active_at, p.updated_at, p.created_at) < now() - interval '6 months';

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

-- Optional scheduler (requires pg_cron extension in your Supabase project):
-- select cron.schedule(
--   'purge-gdpr-players-monthly',
--   '0 3 1 * *',
--   $$select public.purge_gdpr_players();$$
-- );

