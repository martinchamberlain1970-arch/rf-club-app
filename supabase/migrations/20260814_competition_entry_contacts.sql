-- Private contact details used only for arranging competition fixtures.
-- No authenticated policies are created: access is exclusively through checked server routes.

create table if not exists public.competition_entry_contacts (
  competition_entry_id uuid primary key references public.competition_entries(id) on delete cascade,
  email text,
  phone text,
  updated_at timestamptz not null default now(),
  constraint competition_entry_contacts_one_method_ck check (
    nullif(trim(coalesce(email, '')), '') is not null
    or nullif(trim(coalesce(phone, '')), '') is not null
  )
);

alter table public.competition_entry_contacts enable row level security;

insert into public.competition_entry_contacts (competition_entry_id, email, phone)
select
  ce.id,
  max(coalesce(pcs.email, au.email)),
  max(pcs.phone)
from public.competition_entries ce
left join public.public_competition_signups pcs on pcs.id = ce.public_signup_id
left join public.app_users au on au.linked_player_id = ce.player_id
where coalesce(pcs.email, au.email, pcs.phone) is not null
group by ce.id
on conflict (competition_entry_id) do update set
  email = coalesce(excluded.email, public.competition_entry_contacts.email),
  phone = coalesce(excluded.phone, public.competition_entry_contacts.phone),
  updated_at = now();
