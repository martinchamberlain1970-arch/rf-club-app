alter table public.matches
  add column if not exists elo_team1_before numeric null,
  add column if not exists elo_team2_before numeric null,
  add column if not exists elo_team1_after numeric null,
  add column if not exists elo_team2_after numeric null,
  add column if not exists expected_team1_probability numeric null;

create table if not exists public.weekly_league_reviews (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  week_start date not null,
  status text not null default 'draft' check (status in ('draft', 'published')),
  report_data jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  published_at timestamptz null,
  generated_by_user_id uuid null references auth.users(id) on delete set null,
  published_by_user_id uuid null references auth.users(id) on delete set null,
  unique (competition_id, week_start)
);

create index if not exists weekly_league_reviews_competition_week_idx
  on public.weekly_league_reviews (competition_id, week_start desc);

alter table public.weekly_league_reviews enable row level security;

drop policy if exists weekly_league_reviews_owner_select on public.weekly_league_reviews;
create policy weekly_league_reviews_owner_select
  on public.weekly_league_reviews for select to authenticated
  using (exists (select 1 from public.app_users au where au.id = auth.uid() and au.role = 'owner'));

drop policy if exists weekly_league_reviews_owner_insert on public.weekly_league_reviews;
create policy weekly_league_reviews_owner_insert
  on public.weekly_league_reviews for insert to authenticated
  with check (exists (select 1 from public.app_users au where au.id = auth.uid() and au.role = 'owner'));

drop policy if exists weekly_league_reviews_owner_update on public.weekly_league_reviews;
create policy weekly_league_reviews_owner_update
  on public.weekly_league_reviews for update to authenticated
  using (exists (select 1 from public.app_users au where au.id = auth.uid() and au.role = 'owner'))
  with check (exists (select 1 from public.app_users au where au.id = auth.uid() and au.role = 'owner'));
