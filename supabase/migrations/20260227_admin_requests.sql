-- Admin privilege request workflow
create table if not exists public.admin_requests (
  id uuid primary key default gen_random_uuid(),
  requester_user_id uuid not null references auth.users(id),
  target_admin_user_id uuid not null references auth.users(id),
  location_id uuid references public.locations(id),
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  approved_by_super_at timestamptz
);

alter table public.admin_requests enable row level security;

create policy if not exists admin_requests_insert_own
  on public.admin_requests
  for insert
  to authenticated
  with check (auth.uid() = requester_user_id);

create policy if not exists admin_requests_read_parties
  on public.admin_requests
  for select
  to authenticated
  using (auth.uid() = requester_user_id or auth.uid() = target_admin_user_id);
