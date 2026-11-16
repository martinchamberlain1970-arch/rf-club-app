create table if not exists public.league_fixture_deadline_exceptions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null unique references public.matches(id),
  extended_until date not null,
  reason text not null,
  is_active boolean not null default true,
  created_by_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint league_fixture_deadline_exceptions_reason_check check (char_length(reason) between 5 and 500)
);

create index if not exists league_fixture_deadline_exceptions_active_idx
  on public.league_fixture_deadline_exceptions (is_active, extended_until);

alter table public.league_fixture_deadline_exceptions enable row level security;

drop policy if exists league_fixture_deadline_exceptions_select on public.league_fixture_deadline_exceptions;
create policy league_fixture_deadline_exceptions_select
  on public.league_fixture_deadline_exceptions
  for select
  to authenticated
  using (true);
