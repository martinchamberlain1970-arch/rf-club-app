-- Per-admin feature toggles for league-first deployments.

alter table if exists public.app_users
  add column if not exists quick_match_enabled boolean not null default false;

alter table if exists public.app_users
  add column if not exists competition_create_enabled boolean not null default false;

-- Keep existing super user/admin role model, but default new admin feature flags to OFF.
update public.app_users
set quick_match_enabled = coalesce(quick_match_enabled, false),
    competition_create_enabled = coalesce(competition_create_enabled, false)
where true;

