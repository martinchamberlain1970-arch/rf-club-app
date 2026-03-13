-- Knockout enhancements: signup deadline, approval flow, and draw generation

alter table public.league_knockout_events
  add column if not exists signup_deadline timestamptz null;

alter table public.league_knockout_signups
  alter column status set default 'pending';

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'league_knockout_signups_status_check'
  ) then
    alter table public.league_knockout_signups
      drop constraint league_knockout_signups_status_check;
  end if;
end $$;

alter table public.league_knockout_signups
  add constraint league_knockout_signups_status_check
  check (status in ('pending', 'approved', 'rejected', 'withdrawn'));

update public.league_knockout_signups
set status = case when status = 'entered' then 'approved' else status end
where status = 'entered';

drop policy if exists league_knockout_signups_insert_self on public.league_knockout_signups;
create policy league_knockout_signups_insert_self on public.league_knockout_signups
for insert to authenticated
with check (
  user_id = auth.uid()
  and status = 'pending'
  and exists (
    select 1
    from public.league_knockout_events e
    where e.id = event_id
      and e.published = true
      and e.signup_open = true
      and e.is_active = true
      and (e.signup_deadline is null or now() <= e.signup_deadline)
  )
);

create table if not exists public.league_knockout_draw_entries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  event_id uuid not null references public.league_knockout_events(id) on delete cascade,
  round_no integer not null check (round_no > 0),
  match_no integer not null check (match_no > 0),
  slot text not null check (slot in ('home','away')),
  player_id uuid null references public.players(id) on delete set null,
  unique (event_id, round_no, match_no, slot)
);

create index if not exists league_knockout_draw_entries_event_idx
  on public.league_knockout_draw_entries(event_id, round_no, match_no);

alter table public.league_knockout_draw_entries enable row level security;

drop policy if exists league_knockout_draw_entries_read_all on public.league_knockout_draw_entries;
create policy league_knockout_draw_entries_read_all on public.league_knockout_draw_entries
for select to authenticated using (true);

drop policy if exists league_knockout_draw_entries_write_owner on public.league_knockout_draw_entries;
create policy league_knockout_draw_entries_write_owner on public.league_knockout_draw_entries
for all to authenticated
using (
  exists (
    select 1
    from public.app_users au
    where au.id = auth.uid()
      and coalesce(au.role, 'user') = 'owner'
  )
)
with check (
  exists (
    select 1
    from public.app_users au
    where au.id = auth.uid()
      and coalesce(au.role, 'user') = 'owner'
  )
);

create or replace function public.generate_league_knockout_draw(p_event_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  entrant_count integer := 0;
  bracket_size integer := 1;
  i integer := 1;
  p_home uuid;
  p_away uuid;
begin
  if not exists (
    select 1
    from public.app_users au
    where au.id = auth.uid()
      and coalesce(au.role, 'user') = 'owner'
  ) then
    raise exception 'Only super user can generate draws.';
  end if;

  delete from public.league_knockout_draw_entries where event_id = p_event_id;

  with approved as (
    select s.player_id, row_number() over (order by s.created_at, s.id) as rn
    from public.league_knockout_signups s
    where s.event_id = p_event_id
      and s.status = 'approved'
      and s.player_id is not null
  )
  select count(*) into entrant_count from approved;

  if entrant_count = 0 then
    return 0;
  end if;

  while bracket_size < entrant_count loop
    bracket_size := bracket_size * 2;
  end loop;

  while i <= bracket_size loop
    with approved as (
      select s.player_id, row_number() over (order by s.created_at, s.id) as rn
      from public.league_knockout_signups s
      where s.event_id = p_event_id
        and s.status = 'approved'
        and s.player_id is not null
    )
    select a.player_id into p_home from approved a where a.rn = i;

    with approved as (
      select s.player_id, row_number() over (order by s.created_at, s.id) as rn
      from public.league_knockout_signups s
      where s.event_id = p_event_id
        and s.status = 'approved'
        and s.player_id is not null
    )
    select a.player_id into p_away from approved a where a.rn = i + 1;

    insert into public.league_knockout_draw_entries (event_id, round_no, match_no, slot, player_id)
    values
      (p_event_id, 1, ((i + 1) / 2), 'home', p_home),
      (p_event_id, 1, ((i + 1) / 2), 'away', p_away);

    i := i + 2;
  end loop;

  return entrant_count;
end;
$$;
