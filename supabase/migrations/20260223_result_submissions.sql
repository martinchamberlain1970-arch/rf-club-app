-- Result submission workflow (Option A)

create table if not exists public.result_submissions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  submitted_by_user_id uuid not null,
  submitted_at timestamptz not null default now(),
  team1_score integer not null check (team1_score >= 0),
  team2_score integer not null check (team2_score >= 0),
  break_and_run boolean not null default false,
  run_out_against_break boolean not null default false,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by_user_id uuid,
  reviewed_at timestamptz,
  note text
);

create index if not exists result_submissions_match_idx on public.result_submissions(match_id, status);
