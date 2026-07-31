-- Track Stripe entry fees for signed-in competition entrants.

alter table if exists public.competition_entries
  add column if not exists payment_status text not null default 'not_required'
    check (payment_status in ('not_required', 'pending', 'paid', 'failed')),
  add column if not exists payment_amount_pence integer null,
  add column if not exists stripe_checkout_session_id text null,
  add column if not exists stripe_payment_intent_id text null,
  add column if not exists paid_at timestamptz null;

create unique index if not exists competition_entries_checkout_session_idx
  on public.competition_entries (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

update public.competition_entries ce
set payment_status = 'pending', payment_amount_pence = c.entry_fee_pence
from public.competitions c
where ce.competition_id = c.id
  and c.entry_fee_pence is not null
  and c.entry_fee_pence > 0
  and ce.payment_status = 'not_required';
