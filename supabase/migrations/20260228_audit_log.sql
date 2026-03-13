-- Audit log for Super User visibility.

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_user_id uuid null references public.app_users(id) on delete set null,
  actor_email text null,
  actor_role text null,
  action text not null,
  entity_type text null,
  entity_id text null,
  summary text null,
  meta jsonb not null default '{}'::jsonb
);

create index if not exists audit_logs_created_at_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_action_idx on public.audit_logs (action);
create index if not exists audit_logs_actor_email_idx on public.audit_logs (actor_email);

alter table public.audit_logs enable row level security;

drop policy if exists audit_logs_read_owner on public.audit_logs;
create policy audit_logs_read_owner
  on public.audit_logs
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

create or replace function public.log_audit(
  p_action text,
  p_entity_type text default null,
  p_entity_id text default null,
  p_summary text default null,
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

  insert into public.audit_logs (
    actor_user_id,
    actor_email,
    actor_role,
    action,
    entity_type,
    entity_id,
    summary,
    meta
  )
  values (
    v_uid,
    coalesce(v_email, ''),
    coalesce(v_role, 'user'),
    p_action,
    p_entity_type,
    p_entity_id,
    p_summary,
    coalesce(p_meta, '{}'::jsonb)
  );
end;
$$;

grant execute on function public.log_audit(text, text, text, text, jsonb) to authenticated;
