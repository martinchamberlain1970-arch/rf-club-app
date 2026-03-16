-- Competition entries should be unique per competition/player, not per requester.
-- Safe to run once in production after checking there are no duplicate player rows per competition.

alter table if exists public.competition_entries
  drop constraint if exists competition_entries_competition_id_requester_user_id_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'competition_entries_competition_id_player_id_key'
      and conrelid = 'public.competition_entries'::regclass
  ) then
    alter table public.competition_entries
      add constraint competition_entries_competition_id_player_id_key
      unique (competition_id, player_id);
  end if;
end $$;
