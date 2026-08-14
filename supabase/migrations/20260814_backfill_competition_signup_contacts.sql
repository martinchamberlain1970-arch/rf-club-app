-- Restore links between legacy public signups and the competition entries created from them.
-- New guest approvals already write public_signup_id directly; this repairs earlier records.

with candidates as (
  select
    ce.id as entry_id,
    (array_agg(pcs.id))[1] as signup_id
  from public.competition_entries ce
  join public.players p on p.id = ce.player_id
  join public.public_competition_signups pcs
    on pcs.competition_id = ce.competition_id
   and pcs.status = 'added'
   and regexp_replace(lower(trim(pcs.full_name)), '[^a-z0-9]+', '', 'g') =
       regexp_replace(lower(trim(coalesce(p.full_name, p.display_name))), '[^a-z0-9]+', '', 'g')
  where ce.public_signup_id is null
  group by ce.id
  having count(*) = 1
)
update public.competition_entries ce
set public_signup_id = candidates.signup_id
from candidates
where ce.id = candidates.entry_id
  and not exists (
    select 1 from public.competition_entries linked
    where linked.public_signup_id = candidates.signup_id
  );

-- The junior profile uses "Teddy" while the original parent signup used "Ted".
update public.competition_entries ce
set public_signup_id = pcs.id
from public.players p, public.public_competition_signups pcs
where ce.player_id = p.id
  and ce.competition_id = 'eb3561a5-b78e-4dc5-842a-783cf1e85a78'
  and pcs.competition_id = ce.competition_id
  and ce.public_signup_id is null
  and lower(trim(coalesce(p.full_name, p.display_name))) = 'teddy manktelow'
  and lower(trim(pcs.full_name)) = 'ted manktelow'
  and pcs.status = 'added'
  and not exists (
    select 1 from public.competition_entries linked
    where linked.public_signup_id = pcs.id
  );

insert into public.competition_entry_contacts (competition_entry_id, email, phone)
select ce.id, pcs.email, pcs.phone
from public.competition_entries ce
join public.public_competition_signups pcs on pcs.id = ce.public_signup_id
where nullif(trim(coalesce(pcs.email, '')), '') is not null
   or nullif(trim(coalesce(pcs.phone, '')), '') is not null
on conflict (competition_entry_id) do update set
  email = coalesce(public.competition_entry_contacts.email, excluded.email),
  phone = coalesce(public.competition_entry_contacts.phone, excluded.phone),
  updated_at = now();
