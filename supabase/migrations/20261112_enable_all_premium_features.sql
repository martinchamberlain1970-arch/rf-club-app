-- Premium charging is paused: make every existing and future account fully
-- enabled while retaining the premium columns and request history in case the
-- commercial model is revisited later.

alter table if exists public.app_users
  alter column premium_unlocked set default true;

update public.app_users
set premium_unlocked = true
where premium_unlocked is distinct from true;

-- Round-specific match lengths were also protected at database level. The UI
-- is now open to everyone, so remove the matching database gate as well.
drop trigger if exists competitions_premium_round_best_of_guard
  on public.competitions;

drop function if exists public.enforce_premium_round_best_of_guard();
