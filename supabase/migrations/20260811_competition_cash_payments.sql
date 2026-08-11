-- Record whether competition entry fees were paid through Stripe or in cash.
-- Safe to run more than once.

alter table if exists public.competition_entries
  add column if not exists payment_method text null,
  add column if not exists public_signup_id uuid null references public.public_competition_signups(id) on delete set null;

alter table if exists public.public_competition_signups
  add column if not exists payment_method text null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'competition_entries_payment_method_ck'
      and conrelid = 'public.competition_entries'::regclass
  ) then
    alter table public.competition_entries
      add constraint competition_entries_payment_method_ck
      check (payment_method is null or payment_method in ('stripe', 'cash'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'public_competition_signups_payment_method_ck'
      and conrelid = 'public.public_competition_signups'::regclass
  ) then
    alter table public.public_competition_signups
      add constraint public_competition_signups_payment_method_ck
      check (payment_method is null or payment_method in ('stripe', 'cash'));
  end if;
end $$;

create unique index if not exists competition_entries_public_signup_idx
  on public.competition_entries (public_signup_id)
  where public_signup_id is not null;

update public.competition_entries
set payment_method = 'stripe'
where payment_status = 'paid'
  and stripe_checkout_session_id is not null
  and payment_method is null;

update public.public_competition_signups
set payment_method = 'stripe'
where payment_status = 'paid'
  and stripe_checkout_session_id is not null
  and payment_method is null;
