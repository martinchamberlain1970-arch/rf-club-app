-- Public competition sign-ups for people who do not have an app account.
-- Guests remain separate from competition_entries until an admin creates/adds
-- the player, avoiding incomplete or duplicate player records.

create table if not exists public.public_competition_signups (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  full_name text not null,
  email text null,
  phone text null,
  note text null,
  status text not null default 'pending' check (status in ('pending', 'added', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint public_competition_signups_contact_ck
    check (nullif(trim(coalesce(email, '')), '') is not null or nullif(trim(coalesce(phone, '')), '') is not null)
);

create index if not exists public_competition_signups_competition_idx
  on public.public_competition_signups (competition_id, status, created_at desc);

create unique index if not exists public_competition_signups_email_unique_idx
  on public.public_competition_signups (competition_id, lower(email))
  where email is not null and status <> 'rejected';

create unique index if not exists public_competition_signups_phone_unique_idx
  on public.public_competition_signups (competition_id, phone)
  where phone is not null and status <> 'rejected';

alter table public.public_competition_signups enable row level security;

drop policy if exists public_competition_signups_admin_read on public.public_competition_signups;
create policy public_competition_signups_admin_read
  on public.public_competition_signups
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_users au
      where au.id = auth.uid()
        and coalesce(au.role, 'user') in ('admin', 'owner', 'super')
    )
  );

drop policy if exists public_competition_signups_admin_update on public.public_competition_signups;
create policy public_competition_signups_admin_update
  on public.public_competition_signups
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.app_users au
      where au.id = auth.uid()
        and coalesce(au.role, 'user') in ('admin', 'owner', 'super')
    )
  )
  with check (
    exists (
      select 1
      from public.app_users au
      where au.id = auth.uid()
        and coalesce(au.role, 'user') in ('admin', 'owner', 'super')
    )
  );

