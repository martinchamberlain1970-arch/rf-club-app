-- Approval workflow and structured labels for cue-table booking requests.

alter table public.table_reservations
  add column if not exists participant_one text null,
  add column if not exists participant_two text null,
  add column if not exists team_name text null,
  add column if not exists requester_email text null,
  add column if not exists reviewed_at timestamptz null,
  add column if not exists reviewed_by_user_id uuid null references public.app_users(id) on delete set null,
  add column if not exists rejection_reason text null;

alter table public.table_reservations drop constraint if exists table_reservations_status_check;
alter table public.table_reservations
  add constraint table_reservations_status_check
  check (status in ('pending', 'booked', 'rejected', 'cancelled'));

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.table_reservations'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%ends_at <= (starts_at +%'
  loop
    execute format('alter table public.table_reservations drop constraint %I', constraint_name);
  end loop;
end $$;

alter table public.table_reservations drop constraint if exists table_reservations_max_duration;
alter table public.table_reservations
  add constraint table_reservations_max_duration
  check (ends_at <= starts_at + interval '6 hours');

create index if not exists table_reservations_pending_idx
  on public.table_reservations (created_at)
  where status = 'pending';
