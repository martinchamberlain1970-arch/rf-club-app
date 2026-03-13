-- 14-day Premium trial window for new users.
-- Safe to run multiple times.

alter table if exists public.app_users
  add column if not exists trial_started_at timestamptz,
  add column if not exists trial_ends_at timestamptz;

update public.app_users
set
  trial_started_at = coalesce(trial_started_at, created_at, now()),
  trial_ends_at = coalesce(trial_ends_at, coalesce(created_at, now()) + interval '14 days')
where trial_started_at is null or trial_ends_at is null;

alter table if exists public.app_users
  alter column trial_started_at set default now(),
  alter column trial_ends_at set default (now() + interval '14 days');
