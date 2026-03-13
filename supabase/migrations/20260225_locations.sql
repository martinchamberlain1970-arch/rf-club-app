-- Locations for venues/clubs
create extension if not exists pgcrypto;

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists locations_name_lower_idx
  on public.locations (lower(name));

alter table if exists public.players
  add column if not exists location_id uuid references public.locations(id);

alter table if exists public.competitions
  add column if not exists location_id uuid references public.locations(id);
