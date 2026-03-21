alter table public.result_submissions enable row level security;

drop policy if exists result_submissions_select on public.result_submissions;
drop policy if exists result_submissions_insert on public.result_submissions;
drop policy if exists result_submissions_update on public.result_submissions;

create policy result_submissions_select
on public.result_submissions
for select
to authenticated
using (
  submitted_by_user_id = auth.uid()
  or exists (
    select 1
    from public.app_users au
    where au.id = auth.uid()
      and coalesce(au.role, 'user') in ('admin', 'owner')
  )
);

create policy result_submissions_insert
on public.result_submissions
for insert
to authenticated
with check (
  submitted_by_user_id = auth.uid()
  or exists (
    select 1
    from public.app_users au
    where au.id = auth.uid()
      and coalesce(au.role, 'user') in ('admin', 'owner')
  )
);

create policy result_submissions_update
on public.result_submissions
for update
to authenticated
using (
  exists (
    select 1
    from public.app_users au
    where au.id = auth.uid()
      and coalesce(au.role, 'user') in ('admin', 'owner')
  )
)
with check (
  exists (
    select 1
    from public.app_users au
    where au.id = auth.uid()
      and coalesce(au.role, 'user') in ('admin', 'owner')
  )
);
