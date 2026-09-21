-- Date-bounded opening hours which temporarily override the normal weekly schedule.

create table if not exists public.table_booking_hour_overrides (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.cue_tables(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  weekday smallint not null check (weekday between 0 and 6),
  is_closed boolean not null default false,
  opens_at time null,
  closes_at time null,
  created_by_user_id uuid null references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  check (
    (is_closed and opens_at is null and closes_at is null)
    or
    (not is_closed and opens_at is not null and closes_at is not null and closes_at > opens_at)
  ),
  unique (table_id, starts_on, ends_on, weekday)
);

create index if not exists table_booking_hour_overrides_lookup_idx
  on public.table_booking_hour_overrides (table_id, starts_on, ends_on, weekday);

alter table public.table_booking_hour_overrides enable row level security;

drop policy if exists table_booking_hour_overrides_authenticated_read on public.table_booking_hour_overrides;
create policy table_booking_hour_overrides_authenticated_read
  on public.table_booking_hour_overrides for select to authenticated using (true);
