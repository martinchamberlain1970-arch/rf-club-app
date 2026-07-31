-- Allow competition entries for guest-created player profiles without an app user.

alter table if exists public.competition_entries
  alter column requester_user_id drop not null;

alter table if exists public.competition_entries
  drop constraint if exists competition_entries_competition_id_requester_user_id_key;

-- Historical data can contain multiple entries made by the same requester,
-- so do not replace the old constraint with another requester-based index.
drop index if exists public.competition_entries_competition_requester_idx;
