-- Allow all authenticated users to view competition sign-up fields.
-- This supports showing current entry counts and names before entering.

alter table public.competition_entries enable row level security;

drop policy if exists competition_entries_read_self_or_admin on public.competition_entries;
drop policy if exists competition_entries_read_all on public.competition_entries;

create policy competition_entries_read_all
  on public.competition_entries
  for select
  to authenticated
  using (true);
