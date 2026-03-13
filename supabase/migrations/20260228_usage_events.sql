-- Lightweight usage analytics (separate from audit log).

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_user_id uuid null references public.app_users(id) on delete set null,
  actor_email text null,
  actor_role text null,
  path text not null,
  meta jsonb not null default '{}'::jsonb
);

create index if not exists usage_events_created_at_idx on public.usage_events (created_at desc);
create index if not exists usage_events_path_idx on public.usage_events (path);
create index if not exists usage_events_actor_role_idx on public.usage_events (actor_role);

alter table public.usage_events enable row level security;

drop policy if exists usage_events_read_owner on public.usage_events;
create policy usage_events_read_owner
  on public.usage_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_users au
      where au.id = auth.uid()
        and au.role = 'owner'
    )
  );

create or replace function public.log_usage_event(
  p_path text,
  p_meta jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_email text;
  v_role text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return;
  end if;

  select au.email, au.role
    into v_email, v_role
  from public.app_users au
  where au.id = v_uid;

  insert into public.usage_events (
    actor_user_id,
    actor_email,
    actor_role,
    path,
    meta
  )
  values (
    v_uid,
    coalesce(v_email, ''),
    coalesce(v_role, 'user'),
    p_path,
    coalesce(p_meta, '{}'::jsonb)
  );
end;
$$;

grant execute on function public.log_usage_event(text, jsonb) to authenticated;

create or replace function public.prune_usage_events(p_older_than_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.usage_events
  where created_at < now() - make_interval(days => greatest(p_older_than_days, 1));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
