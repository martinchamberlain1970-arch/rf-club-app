-- League fixtures: support break weeks and date re-calculation

create or replace function public.league_fixture_week_date(
  p_start_date date,
  p_week_no integer,
  p_break_weeks integer[] default '{}'
)
returns date
language sql
immutable
as $$
  select (
    p_start_date
    + (
      (
        greatest(p_week_no, 1) - 1
      )
      + (
        select count(*)
        from unnest(coalesce(p_break_weeks, '{}'::integer[])) as bw(week_no)
        where bw.week_no between 1 and greatest(p_week_no, 1)
      )
    ) * interval '7 day'
  )::date;
$$;

create or replace function public.generate_league_fixtures(
  p_season_id uuid,
  p_start_date date,
  p_double_round boolean,
  p_clear_existing boolean,
  p_break_weeks integer[]
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

  if mod(v_team_count, 2) = 1 then
    arr := arr || null;
    v_team_count := v_team_count + 1;
  end if;

  v_rounds := v_team_count - 1;
  v_matches_per_round := v_team_count / 2;

  if p_clear_existing then
    delete from public.league_fixtures where season_id = p_season_id;
  end if;

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
          case
            when p_start_date is null then null
            else public.league_fixture_week_date(p_start_date, v_week_no, p_break_weeks)
          end,
          v_home,
          v_away
        )
        on conflict do nothing;
        v_created := v_created + 1;
      end if;
    end loop;

    temp := arr[v_team_count];
    arr := arr[1:1] || temp || arr[2:v_team_count-1];
    v_week_no := v_week_no + 1;
  end loop;

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
            case
              when p_start_date is null then null
              else public.league_fixture_week_date(p_start_date, v_week_no, p_break_weeks)
            end,
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
begin
  return public.generate_league_fixtures(
    p_season_id,
    p_start_date,
    p_double_round,
    p_clear_existing,
    '{}'::integer[]
  );
end;
$$;

create or replace function public.recalculate_league_fixture_dates(
  p_season_id uuid,
  p_start_date date,
  p_break_weeks integer[] default '{}'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_role text;
  v_updated integer;
begin
  select coalesce(au.role, 'user')
  into v_user_role
  from public.app_users au
  where au.id = auth.uid();

  if v_user_role not in ('admin', 'owner') then
    raise exception 'Only admin/owner can re-date fixtures';
  end if;

  update public.league_fixtures f
  set fixture_date = public.league_fixture_week_date(
    p_start_date,
    coalesce(f.week_no, 1),
    p_break_weeks
  )
  where f.season_id = p_season_id
    and f.week_no is not null;

  get diagnostics v_updated = row_count;
  return coalesce(v_updated, 0);
end;
$$;

grant execute on function public.league_fixture_week_date(date, integer, integer[]) to authenticated;
grant execute on function public.generate_league_fixtures(uuid, date, boolean, boolean, integer[]) to authenticated;
grant execute on function public.generate_league_fixtures(uuid, date, boolean, boolean) to authenticated;
grant execute on function public.recalculate_league_fixture_dates(uuid, date, integer[]) to authenticated;
