alter table if exists public.frames enable row level security;

drop policy if exists frames_write_participant_or_admin on public.frames;
create policy frames_write_participant_or_admin
  on public.frames
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.matches m
      left join public.app_users au
        on au.id = auth.uid()
      where m.id = frames.match_id
        and (
          coalesce(au.role, 'user') in ('admin', 'owner')
          or au.linked_player_id = m.player1_id
          or au.linked_player_id = m.player2_id
          or au.linked_player_id = m.team1_player1_id
          or au.linked_player_id = m.team1_player2_id
          or au.linked_player_id = m.team2_player1_id
          or au.linked_player_id = m.team2_player2_id
        )
    )
  )
  with check (
    exists (
      select 1
      from public.matches m
      left join public.app_users au
        on au.id = auth.uid()
      where m.id = frames.match_id
        and (
          coalesce(au.role, 'user') in ('admin', 'owner')
          or au.linked_player_id = m.player1_id
          or au.linked_player_id = m.player2_id
          or au.linked_player_id = m.team1_player1_id
          or au.linked_player_id = m.team1_player2_id
          or au.linked_player_id = m.team2_player1_id
          or au.linked_player_id = m.team2_player2_id
        )
    )
  );
