-- Prevent club-only players from being offered as league-link candidates.
-- Safe to run more than once.

alter table if exists public.players
  add column if not exists exclude_from_league_links boolean not null default false;

comment on column public.players.exclude_from_league_links is
  'True when this club player must not be suggested for cross-app league player linking.';
