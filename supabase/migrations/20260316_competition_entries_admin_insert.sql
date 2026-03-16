-- Allow Club Admin and Super User to insert competition entries on behalf of players.
-- Safe to run multiple times.

drop policy if exists competition_entries_insert_self on public.competition_entries;
drop policy if exists competition_entries_insert_self_or_admin on public.competition_entries;

create policy competition_entries_insert_self_or_admin
  on public.competition_entries
  for insert
  to authenticated
  with check (
    auth.uid() = requester_user_id
    or exists (
      select 1
      from public.app_users au
      where au.id = auth.uid()
        and coalesce(au.role, 'user') in ('admin','owner')
    )
  );
