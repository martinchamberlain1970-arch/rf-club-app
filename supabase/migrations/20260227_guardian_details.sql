-- Guardian details for minors
alter table if exists public.players
  add column if not exists guardian_name text,
  add column if not exists guardian_email text,
  add column if not exists guardian_user_id uuid references auth.users(id);

alter table if exists public.player_update_requests
  add column if not exists requested_guardian_name text,
  add column if not exists requested_guardian_email text,
  add column if not exists requested_guardian_user_id uuid;
