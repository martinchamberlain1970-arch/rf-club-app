-- League captain submissions + fixture publication notifications

create table if not exists public.league_result_submissions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  fixture_id uuid not null references public.league_fixtures(id) on delete cascade,
  season_id uuid not null references public.league_seasons(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete restrict,
  submitted_by_user_id uuid not null references public.app_users(id) on delete restrict,
  submitter_team_id uuid null references public.league_teams(id) on delete set null,
  frame_results jsonb not null default '[]'::jsonb,
  scorecard_photo_url text null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','needs_correction')),
  rejection_reason text null,
  reviewed_by_user_id uuid null references public.app_users(id) on delete set null,
  reviewed_at timestamptz null
);

create index if not exists league_result_submissions_fixture_idx on public.league_result_submissions (fixture_id);
create index if not exists league_result_submissions_status_idx on public.league_result_submissions (status);
create index if not exists league_result_submissions_location_idx on public.league_result_submissions (location_id);

create table if not exists public.league_fixture_publications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  season_id uuid not null references public.league_seasons(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete restrict,
  published_by_user_id uuid not null references public.app_users(id) on delete restrict,
  note text null
);

create index if not exists league_fixture_publications_location_idx on public.league_fixture_publications (location_id, created_at desc);
create index if not exists league_fixture_publications_season_idx on public.league_fixture_publications (season_id);

create or replace function public.touch_league_result_submission()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_league_result_submission on public.league_result_submissions;
create trigger trg_touch_league_result_submission
before update on public.league_result_submissions
for each row execute function public.touch_league_result_submission();

alter table public.league_result_submissions enable row level security;
alter table public.league_fixture_publications enable row level security;

drop policy if exists league_result_submissions_read_all on public.league_result_submissions;
create policy league_result_submissions_read_all on public.league_result_submissions
for select to authenticated
using (true);

drop policy if exists league_result_submissions_insert_authenticated on public.league_result_submissions;
create policy league_result_submissions_insert_authenticated on public.league_result_submissions
for insert to authenticated
with check (submitted_by_user_id = auth.uid());

drop policy if exists league_result_submissions_update_admin on public.league_result_submissions;
create policy league_result_submissions_update_admin on public.league_result_submissions
for update to authenticated
using (
  exists (
    select 1
    from public.app_users au
    where au.id = auth.uid()
      and coalesce(au.role, 'user') in ('admin', 'owner')
  )
)
with check (
  exists (
    select 1
    from public.app_users au
    where au.id = auth.uid()
      and coalesce(au.role, 'user') in ('admin', 'owner')
  )
);

drop policy if exists league_fixture_publications_read_all on public.league_fixture_publications;
create policy league_fixture_publications_read_all on public.league_fixture_publications
for select to authenticated
using (true);

drop policy if exists league_fixture_publications_insert_admin on public.league_fixture_publications;
create policy league_fixture_publications_insert_admin on public.league_fixture_publications
for insert to authenticated
with check (
  exists (
    select 1
    from public.app_users au
    where au.id = auth.uid()
      and coalesce(au.role, 'user') in ('admin', 'owner')
  )
);
