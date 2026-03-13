-- Enforce premium-only access for round-specific best-of configuration.
-- Applies to inserts/updates on competitions.knockout_round_best_of.

create or replace function public.enforce_premium_round_best_of_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_role text;
  v_premium boolean;
  v_cfg jsonb;
begin
  v_cfg := coalesce(new.knockout_round_best_of, '{}'::jsonb);

  if jsonb_typeof(v_cfg) <> 'object' then
    raise exception 'knockout_round_best_of must be a JSON object';
  end if;

  if v_cfg <> '{}'::jsonb then
    v_uid := auth.uid();
    if v_uid is null then
      raise exception 'Round-specific Best Of requires an authenticated user.';
    end if;

    select role, premium_unlocked
      into v_role, v_premium
    from public.app_users
    where id = v_uid;

    if not found then
      raise exception 'User profile not found for premium validation.';
    end if;

    if coalesce(v_role, 'user') <> 'owner' and not coalesce(v_premium, false) then
      raise exception 'Round-specific Best Of is a Premium feature.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists competitions_premium_round_best_of_guard on public.competitions;
create trigger competitions_premium_round_best_of_guard
before insert or update of knockout_round_best_of
on public.competitions
for each row
execute function public.enforce_premium_round_best_of_guard();
