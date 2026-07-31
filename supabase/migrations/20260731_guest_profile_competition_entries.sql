-- Allow competition entries for guest-created player profiles without an app user.

alter table if exists public.competition_entries
  alter column requester_user_id drop not null;

alter table if exists public.competition_entries
  drop constraint if exists competition_entries_competition_id_requester_user_id_key;

create unique index if not exists competition_entries_competition_requester_idx
  on public.competition_entries (competition_id, requester_user_id)
  where requester_user_id is not null;

create unique index if not exists competition_entries_active_player_idx
  on public.competition_entries (competition_id, player_id)
  where status in ('pending', 'approved');
