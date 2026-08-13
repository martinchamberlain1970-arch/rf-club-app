-- Private fixture/result portals for entrants who do not create an app account.

alter table if exists public.public_competition_signups
  add column if not exists fixture_access_token uuid not null default gen_random_uuid();

create unique index if not exists public_competition_signups_fixture_access_token_idx
  on public.public_competition_signups (fixture_access_token);

alter table if exists public.result_submissions
  alter column submitted_by_user_id drop not null,
  add column if not exists public_signup_id uuid null references public.public_competition_signups(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'result_submissions_submitter_ck'
      and conrelid = 'public.result_submissions'::regclass
  ) then
    alter table public.result_submissions
      add constraint result_submissions_submitter_ck
      check (submitted_by_user_id is not null or public_signup_id is not null);
  end if;
end $$;

create index if not exists result_submissions_public_signup_idx
  on public.result_submissions (public_signup_id, status, submitted_at desc)
  where public_signup_id is not null;

create unique index if not exists result_submissions_guest_pending_match_idx
  on public.result_submissions (match_id, public_signup_id)
  where public_signup_id is not null and status = 'pending';
