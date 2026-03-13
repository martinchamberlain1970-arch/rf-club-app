-- Phase 1.1: auto-generate league fixtures (round-robin, optional home/away return legs)

create or replace function public.generate_league_fixtures(
  p_season_id uuid,
  p_start_date date default null,
  p_double_round boolean default true,
  p_clear_existing boolean default true
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_role text;
  v_location_id uuid;
  v_team_count integer;
  v_rounds integer;
  v_matches_per_round integer;
  v_round integer;
  v_match integer;
  v_week_no integer := 1;
  v_created integer := 0;
  v_home uuid;
  v_away uuid;
  arr uuid[];
  temp uuid;
begin
  -- only admin / owner can generate
  select coalesce(au.role, 'user')
  into v_user_role
  from public.app_users au
  where au.id = auth.uid();

  if v_user_role not in ('admin', 'owner') then
    raise exception 'Only admin/owner can generate fixtures';
  end if;

  select s.location_id
  into v_location_id
  from public.league_seasons s
  where s.id = p_season_id;

  if v_location_id is null then
    raise exception 'Season not found';
  end if;

  select array_agg(t.id order by t.name), count(*)
  into arr, v_team_count
  from public.league_teams t
  where t.season_id = p_season_id
    and coalesce(t.is_active, true) = true;

  if v_team_count < 2 then
    raise exception 'Need at least 2 active teams to generate fixtures';
  end if;

  -- odd number => add a BYE slot (null)
  if mod(v_team_count, 2) = 1 then
    arr := arr || null;
    v_team_count := v_team_count + 1;
  end if;

  v_rounds := v_team_count - 1;
  v_matches_per_round := v_team_count / 2;

  if p_clear_existing then
    delete from public.league_fixtures where season_id = p_season_id;
  end if;

  -- first leg
  for v_round in 1..v_rounds loop
    for v_match in 1..v_matches_per_round loop
      v_home := arr[v_match];
      v_away := arr[v_team_count - v_match + 1];

      if v_home is not null and v_away is not null then
        insert into public.league_fixtures (
          season_id, location_id, week_no, fixture_date, home_team_id, away_team_id
        ) values (
          p_season_id,
          v_location_id,
          v_week_no,
          case when p_start_date is null then null else (p_start_date + ((v_week_no - 1) * interval '7 day'))::date end,
          v_home,
          v_away
        )
        on conflict do nothing;
        v_created := v_created + 1;
      end if;
    end loop;

    -- circle rotation: keep first team fixed
    temp := arr[v_team_count];
    arr := arr[1:1] || temp || arr[2:v_team_count-1];
    v_week_no := v_week_no + 1;
  end loop;

  -- return leg (swap home/away)
  if p_double_round then
    for v_round in 1..v_rounds loop
      for v_match in 1..v_matches_per_round loop
        v_home := arr[v_match];
        v_away := arr[v_team_count - v_match + 1];

        if v_home is not null and v_away is not null then
          insert into public.league_fixtures (
            season_id, location_id, week_no, fixture_date, home_team_id, away_team_id
          ) values (
            p_season_id,
            v_location_id,
            v_week_no,
            case when p_start_date is null then null else (p_start_date + ((v_week_no - 1) * interval '7 day'))::date end,
            v_away,
            v_home
          )
          on conflict do nothing;
          v_created := v_created + 1;
        end if;
      end loop;

      temp := arr[v_team_count];
      arr := arr[1:1] || temp || arr[2:v_team_count-1];
      v_week_no := v_week_no + 1;
    end loop;
  end if;

  return v_created;
end;
$$;

grant execute on function public.generate_league_fixtures(uuid, date, boolean, boolean) to authenticated;
