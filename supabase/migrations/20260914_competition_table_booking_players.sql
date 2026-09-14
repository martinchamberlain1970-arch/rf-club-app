-- Link competition table bookings to the competition and both entrants.
-- Text labels remain for existing reservations and public display compatibility.

alter table public.table_reservations
  add column if not exists competition_id uuid null references public.competitions(id) on delete set null,
  add column if not exists participant_one_player_id uuid null references public.players(id) on delete set null,
  add column if not exists participant_two_player_id uuid null references public.players(id) on delete set null;

alter table public.table_reservations
  drop constraint if exists table_reservations_distinct_participants;

alter table public.table_reservations
  add constraint table_reservations_distinct_participants
  check (
    participant_one_player_id is null
    or participant_two_player_id is null
    or participant_one_player_id <> participant_two_player_id
  );

create index if not exists table_reservations_competition_idx
  on public.table_reservations (competition_id, starts_at)
  where status = 'booked';

create index if not exists table_reservations_participant_one_idx
  on public.table_reservations (participant_one_player_id, starts_at)
  where status = 'booked';

create index if not exists table_reservations_participant_two_idx
  on public.table_reservations (participant_two_player_id, starts_at)
  where status = 'booked';
