-- Add avatar URL to players
alter table if exists public.players
  add column if not exists avatar_url text;
