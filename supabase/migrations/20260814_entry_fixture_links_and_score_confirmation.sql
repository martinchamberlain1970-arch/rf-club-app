-- Give every competition entrant a private fixture link and attribute submissions
-- to the entrant so both sides of a fixture can be compared independently.

alter table if exists public.competition_entries
  add column if not exists fixture_access_token uuid not null default gen_random_uuid();

update public.competition_entries ce
set fixture_access_token = pcs.fixture_access_token
from public.public_competition_signups pcs
where pcs.id = ce.public_signup_id
  and pcs.fixture_access_token is not null;

create unique index if not exists competition_entries_fixture_access_token_idx
  on public.competition_entries (fixture_access_token);

alter table if exists public.result_submissions
  add column if not exists competition_entry_id uuid null references public.competition_entries(id) on delete set null;

update public.result_submissions rs
set competition_entry_id = ce.id
from public.competition_entries ce
where rs.competition_entry_id is null
  and rs.public_signup_id is not null
  and ce.public_signup_id = rs.public_signup_id;

update public.result_submissions rs
set competition_entry_id = ce.id
from public.matches m,
public.app_users au,
public.competition_entries ce
where rs.competition_entry_id is null
  and m.id = rs.match_id
  and au.id = rs.submitted_by_user_id
  and ce.competition_id = m.competition_id
  and ce.player_id = au.linked_player_id;

alter table public.result_submissions
  drop constraint if exists result_submissions_submitter_ck;

alter table public.result_submissions
  add constraint result_submissions_submitter_ck
  check (
    submitted_by_user_id is not null
    or public_signup_id is not null
    or competition_entry_id is not null
  );

create index if not exists result_submissions_competition_entry_idx
  on public.result_submissions (competition_entry_id, status, submitted_at desc)
  where competition_entry_id is not null;

create unique index if not exists result_submissions_entry_pending_match_idx
  on public.result_submissions (match_id, competition_entry_id)
  where competition_entry_id is not null and status = 'pending';

create or replace function public.set_result_submission_competition_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.competition_entry_id is null and new.public_signup_id is not null then
    select ce.id into new.competition_entry_id
    from public.competition_entries ce
    where ce.public_signup_id = new.public_signup_id
    limit 1;
  end if;

  if new.competition_entry_id is null and new.submitted_by_user_id is not null then
    select ce.id into new.competition_entry_id
    from public.matches m
    join public.app_users au on au.id = new.submitted_by_user_id
    join public.competition_entries ce
      on ce.competition_id = m.competition_id
     and ce.player_id = au.linked_player_id
    where m.id = new.match_id
    limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_result_submission_competition_entry on public.result_submissions;
create trigger trg_set_result_submission_competition_entry
before insert or update of submitted_by_user_id, public_signup_id, match_id
on public.result_submissions
for each row execute function public.set_result_submission_competition_entry();
