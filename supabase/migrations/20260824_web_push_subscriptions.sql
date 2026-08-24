-- Android/iOS/desktop Web Push subscriptions for the installed Rack & Frame PWA.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_active_idx
  on public.push_subscriptions (user_id, is_active);

alter table public.push_subscriptions enable row level security;

-- Subscriptions contain browser authentication material and are accessed only
-- through authenticated server routes using the service role.
