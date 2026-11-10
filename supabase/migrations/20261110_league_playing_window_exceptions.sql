create table if not exists public.league_playing_window_exceptions (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  active_from date not null default current_date,
  expires_on date not null,
  note text not null default '',
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint league_playing_window_exceptions_dates_check check (expires_on >= active_from)
);

create unique index if not exists league_playing_window_exceptions_competition_player_idx
  on public.league_playing_window_exceptions (competition_id, player_id);

alter table public.league_playing_window_exceptions enable row level security;

drop policy if exists league_playing_window_exceptions_select on public.league_playing_window_exceptions;
create policy league_playing_window_exceptions_select
  on public.league_playing_window_exceptions
  for select
  to authenticated
  using (true);

-- Activate the agreed travel exception for Max's Masters Snooker fixtures.
insert into public.league_playing_window_exceptions (
  competition_id,
  player_id,
  active_from,
  expires_on,
  note
)
select
  competition.id,
  player.id,
  date '2026-11-10',
  date '2026-11-24',
  'Early play permitted while Max prepares to travel.'
from public.competitions competition
join public.competition_entries entry
  on entry.competition_id = competition.id
 and entry.status = 'approved'
join public.players player
  on player.id = entry.player_id
where lower(competition.name) = lower('Greenhithe Legion Masters Snooker 2026')
  and lower(coalesce(player.full_name, player.display_name)) = lower('Max Powell')
on conflict (competition_id, player_id) do update
set active_from = excluded.active_from,
    expires_on = excluded.expires_on,
    note = excluded.note,
    updated_at = now();
