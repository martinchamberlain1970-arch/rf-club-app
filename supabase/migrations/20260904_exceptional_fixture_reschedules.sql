drop index if exists public.league_reschedule_requests_one_pending_per_requester_idx;

drop policy if exists league_reschedule_requests_select on public.league_reschedule_requests;
create policy league_reschedule_requests_select
  on public.league_reschedule_requests
  for select
  to authenticated
  using (
    requester_user_id = auth.uid()
    or exists (
      select 1
      from public.app_users au
      where au.id = auth.uid()
        and coalesce(au.role, 'user') in ('owner', 'admin', 'super')
    )
  );

drop policy if exists league_reschedule_requests_insert on public.league_reschedule_requests;
create policy league_reschedule_requests_insert
  on public.league_reschedule_requests
  for insert
  to authenticated
  with check (
    requester_user_id = auth.uid()
    and status = 'pending'
    and length(trim(coalesce(note, ''))) >= 5
    and requested_scheduled_for in (
      original_scheduled_for - 7,
      original_scheduled_for + 7,
      original_scheduled_for + 14
    )
    and exists (
      select 1
      from public.app_users au
      join public.matches m on m.id = league_reschedule_requests.match_id
      where au.id = auth.uid()
        and au.linked_player_id is not null
        and au.linked_player_id in (
          m.player1_id,
          m.player2_id,
          m.team1_player1_id,
          m.team1_player2_id,
          m.team2_player1_id,
          m.team2_player2_id
        )
        and m.competition_id = league_reschedule_requests.competition_id
        and m.scheduled_for = league_reschedule_requests.original_scheduled_for
        and m.status not in ('complete', 'bye')
        and coalesce(m.is_archived, false) = false
    )
  );

drop policy if exists league_reschedule_requests_update_owner on public.league_reschedule_requests;
create policy league_reschedule_requests_update_owner
  on public.league_reschedule_requests
  for update
  to authenticated
  using (
    exists (
      select 1 from public.app_users au
      where au.id = auth.uid()
        and coalesce(au.role, 'user') in ('owner', 'admin', 'super')
    )
  )
  with check (
    exists (
      select 1 from public.app_users au
      where au.id = auth.uid()
        and coalesce(au.role, 'user') in ('owner', 'admin', 'super')
    )
  );
