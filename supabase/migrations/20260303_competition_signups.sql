-- Competition sign-up workflow.
-- Safe to run multiple times.

alter table if exists public.competitions
  add column if not exists signup_open boolean not null default false,
  add column if not exists signup_deadline timestamptz null,
  add column if not exists max_entries integer null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'competitions_max_entries_ck'
      and conrelid = 'public.competitions'::regclass
  ) then
    alter table public.competitions
      add constraint competitions_max_entries_ck
      check (max_entries is null or max_entries > 0);
  end if;
end $$;

create table if not exists public.competition_entries (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  requester_user_id uuid not null references auth.users(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected','withdrawn')),
  reviewed_by_user_id uuid null references auth.users(id) on delete set null,
  reviewed_at timestamptz null,
  note text null,
  created_at timestamptz not null default now(),
  unique (competition_id, requester_user_id)
);

create index if not exists competition_entries_competition_status_idx
  on public.competition_entries (competition_id, status, created_at desc);

alter table public.competition_entries enable row level security;

drop policy if exists competition_entries_insert_self on public.competition_entries;
create policy competition_entries_insert_self
  on public.competition_entries
  for insert
  to authenticated
  with check (auth.uid() = requester_user_id);

drop policy if exists competition_entries_read_self_or_admin on public.competition_entries;
create policy competition_entries_read_self_or_admin
  on public.competition_entries
  for select
  to authenticated
  using (
    auth.uid() = requester_user_id
    or exists (
      select 1
      from public.app_users au
      where au.id = auth.uid()
        and coalesce(au.role, 'user') in ('admin','owner')
    )
  );

drop policy if exists competition_entries_update_self_or_admin on public.competition_entries;
create policy competition_entries_update_self_or_admin
  on public.competition_entries
  for update
  to authenticated
  using (
    auth.uid() = requester_user_id
    or exists (
      select 1
      from public.app_users au
      where au.id = auth.uid()
        and coalesce(au.role, 'user') in ('admin','owner')
    )
  )
  with check (
    auth.uid() = requester_user_id
    or exists (
      select 1
      from public.app_users au
      where au.id = auth.uid()
        and coalesce(au.role, 'user') in ('admin','owner')
    )
  );
