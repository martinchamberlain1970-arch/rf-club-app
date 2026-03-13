alter table if exists public.player_deletion_requests
  add column if not exists delete_all_data boolean not null default false;
