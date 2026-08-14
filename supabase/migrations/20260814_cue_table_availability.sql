-- Super User-controlled weekly availability and one-off table closures.

create table if not exists public.table_booking_hours (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.cue_tables(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  opens_at time not null,
  closes_at time not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (closes_at > opens_at),
  unique (table_id, weekday)
);

create table if not exists public.table_booking_blocks (
  id uuid primary key default gen_random_uuid(),
  table_id uuid null references public.cue_tables(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  category text not null check (category in ('entertainment', 'pool_home_match', 'snooker_home_match', 'maintenance', 'private_event', 'other')),
  title text not null check (char_length(title) between 1 and 120),
  notes text null check (char_length(notes) <= 240),
  created_by_user_id uuid null references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists table_booking_blocks_upcoming_idx
  on public.table_booking_blocks (starts_at, ends_at, table_id);

alter table public.table_booking_hours enable row level security;
alter table public.table_booking_blocks enable row level security;

drop policy if exists table_booking_hours_authenticated_read on public.table_booking_hours;
create policy table_booking_hours_authenticated_read on public.table_booking_hours for select to authenticated using (true);

drop policy if exists table_booking_blocks_authenticated_read on public.table_booking_blocks;
create policy table_booking_blocks_authenticated_read on public.table_booking_blocks for select to authenticated using (true);

-- Preserve the opening-time behaviour that existed before availability controls.
insert into public.table_booking_hours (table_id, weekday, opens_at, closes_at)
select table_row.id, hours.weekday, hours.opens_at::time, hours.closes_at::time
from public.cue_tables table_row
cross join (values
  (0, '11:00', '23:00'),
  (1, '13:00', '23:00'),
  (2, '13:00', '23:00'),
  (3, '13:00', '23:00'),
  (4, '13:00', '23:00'),
  (5, '11:00', '23:00'),
  (6, '11:00', '23:00')
) as hours(weekday, opens_at, closes_at)
where table_row.is_active = true
on conflict (table_id, weekday) do nothing;
