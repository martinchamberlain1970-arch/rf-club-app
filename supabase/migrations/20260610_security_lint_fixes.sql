-- Supabase security lint fixes for Rack & Frame.
-- Idempotent and safe to re-run.

-- Preserve existing live admin access before RLS policies stop trusting
-- user-editable auth.user_metadata.
do $$
begin
  if to_regclass('public.app_users') is not null
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'app_users'
        and column_name = 'id'
    )
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'app_users'
        and column_name = 'email'
    )
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'app_users'
        and column_name = 'role'
    )
  then
    insert into public.app_users (id, email, role)
    select
      u.id,
      u.email,
      lower(u.raw_user_meta_data ->> 'role')
    from auth.users u
    where lower(coalesce(u.raw_user_meta_data ->> 'role', '')) in ('admin', 'owner')
    on conflict (id) do update
      set role = excluded.role;
  end if;
end $$;

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.app_users au
    where au.id = auth.uid()
      and coalesce(au.role, 'user') in ('admin', 'owner')
  );
$$;

revoke all on function public.is_app_admin() from public;
grant execute on function public.is_app_admin() to authenticated;

-- Security-definer view lint: make the view run with the querying user's
-- permissions/RLS instead of the view owner's.
alter view if exists public.live_event_summary
  set (security_invoker = true);

-- Tables exposed through PostgREST need RLS enabled before Supabase considers
-- them safe. Policies below preserve the existing app flows.
alter table if exists public.locations enable row level security;

drop policy if exists locations_read_all on public.locations;
create policy locations_read_all
  on public.locations
  for select
  to anon, authenticated
  using (true);

drop policy if exists locations_write_admin on public.locations;
create policy locations_write_admin
  on public.locations
  for all
  to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

alter table if exists public.player_claim_requests enable row level security;

drop policy if exists player_claim_requests_insert_own on public.player_claim_requests;
create policy player_claim_requests_insert_own
  on public.player_claim_requests
  for insert
  to authenticated
  with check (requester_user_id = auth.uid());

drop policy if exists player_claim_requests_read_own_or_admin on public.player_claim_requests;
create policy player_claim_requests_read_own_or_admin
  on public.player_claim_requests
  for select
  to authenticated
  using (
    requester_user_id = auth.uid()
    or reviewed_by_user_id = auth.uid()
    or public.is_app_admin()
  );

drop policy if exists player_claim_requests_update_admin on public.player_claim_requests;
create policy player_claim_requests_update_admin
  on public.player_claim_requests
  for update
  to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

alter table if exists public.snooker_handicap_history enable row level security;

drop policy if exists snooker_handicap_history_read_all on public.snooker_handicap_history;
create policy snooker_handicap_history_read_all
  on public.snooker_handicap_history
  for select
  to anon, authenticated
  using (true);

drop policy if exists snooker_handicap_history_write_admin on public.snooker_handicap_history;
create policy snooker_handicap_history_write_admin
  on public.snooker_handicap_history
  for all
  to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

-- Replace policies that trusted auth.user_metadata with the server-maintained
-- app_users role table.
drop policy if exists matches_admin_read on public.matches;
create policy matches_admin_read
  on public.matches
  for select
  to authenticated
  using (public.is_app_admin());

drop policy if exists players_admin_read on public.players;
create policy players_admin_read
  on public.players
  for select
  to authenticated
  using (public.is_app_admin());

drop policy if exists competitions_admin_read on public.competitions;
create policy competitions_admin_read
  on public.competitions
  for select
  to authenticated
  using (public.is_app_admin());

drop policy if exists frames_admin_insert on public.frames;
create policy frames_admin_insert
  on public.frames
  for insert
  to authenticated
  with check (public.is_app_admin());

drop policy if exists frames_admin_update on public.frames;
create policy frames_admin_update
  on public.frames
  for update
  to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

drop policy if exists app_users_admin_read on public.app_users;
create policy app_users_admin_read
  on public.app_users
  for select
  to authenticated
  using (public.is_app_admin());

drop policy if exists app_users_admin_update on public.app_users;
create policy app_users_admin_update
  on public.app_users
  for update
  to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

drop policy if exists players_avatar_update on public.players;
create policy players_avatar_update
  on public.players
  for update
  to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

drop policy if exists player_update_requests_read_admin on public.player_update_requests;
create policy player_update_requests_read_admin
  on public.player_update_requests
  for select
  to authenticated
  using (public.is_app_admin());

drop policy if exists player_update_requests_update_admin on public.player_update_requests;
create policy player_update_requests_update_admin
  on public.player_update_requests
  for update
  to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

drop policy if exists premium_requests_read_admin on public.premium_requests;
create policy premium_requests_read_admin
  on public.premium_requests
  for select
  to authenticated
  using (public.is_app_admin());

drop policy if exists premium_requests_update_admin on public.premium_requests;
create policy premium_requests_update_admin
  on public.premium_requests
  for update
  to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());
