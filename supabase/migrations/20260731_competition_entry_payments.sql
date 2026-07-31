-- Stripe-backed entry fees for public competition sign-ups.

alter table if exists public.competitions
  add column if not exists entry_fee_pence integer null
    check (entry_fee_pence is null or entry_fee_pence >= 30);

alter table if exists public.public_competition_signups
  add column if not exists payment_status text not null default 'not_required'
    check (payment_status in ('not_required', 'pending', 'paid', 'failed')),
  add column if not exists payment_amount_pence integer null,
  add column if not exists stripe_checkout_session_id text null,
  add column if not exists stripe_payment_intent_id text null,
  add column if not exists paid_at timestamptz null;

create unique index if not exists public_competition_signups_checkout_session_idx
  on public.public_competition_signups (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

update public.competitions
set entry_fee_pence = 1000
where lower(name) = lower('Greenhithe Legion Masters 2026');

