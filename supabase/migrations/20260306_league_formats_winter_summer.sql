-- Support Winter (4 singles + 1 doubles) and Summer (6 singles) league formats.

alter table public.league_seasons
  add column if not exists handicap_enabled boolean not null default false;

alter table public.league_seasons
  alter column singles_count set default 4,
  alter column doubles_count set default 1;

alter table public.league_seasons
  drop constraint if exists league_seasons_singles_count_check,
  drop constraint if exists league_seasons_doubles_count_check,
  drop constraint if exists league_seasons_format_check;

alter table public.league_seasons
  add constraint league_seasons_format_check
  check (
    (singles_count = 4 and doubles_count = 1)
    or
    (singles_count = 6 and doubles_count = 0)
  );

alter table public.league_fixture_frames
  drop constraint if exists league_fixture_frames_slot_no_check;

alter table public.league_fixture_frames
  add constraint league_fixture_frames_slot_no_check
  check (slot_no between 1 and 10);

create or replace function public.ensure_league_fixture_frame_rows()
returns trigger
language plpgsql
as $$
declare
  v_singles integer := 4;
  v_doubles integer := 1;
  i integer;
  v_total integer;
begin
  select
    coalesce(s.singles_count, 4),
    coalesce(s.doubles_count, 1)
  into v_singles, v_doubles
  from public.league_fixtures f
  join public.league_seasons s on s.id = f.season_id
  where f.id = new.id;

  v_total := v_singles + v_doubles;

  for i in 1..v_singles loop
    insert into public.league_fixture_frames (fixture_id, slot_no, slot_type)
    values (new.id, i, 'singles')
    on conflict (fixture_id, slot_no) do nothing;
  end loop;

  for i in 1..v_doubles loop
    insert into public.league_fixture_frames (fixture_id, slot_no, slot_type)
    values (new.id, v_singles + i, 'doubles')
    on conflict (fixture_id, slot_no) do nothing;
  end loop;

  delete from public.league_fixture_frames
  where fixture_id = new.id
    and slot_no > v_total;

  return new;
end;
$$;

create or replace function public.recalc_league_fixture_points(p_fixture_id uuid)
returns void
language plpgsql
as $$
declare
  v_home integer;
  v_away integer;
  v_total integer;
  v_completed integer;
  v_expected integer;
begin
  select
    coalesce(sum(case when winner_side = 'home' then 1 else 0 end), 0),
    coalesce(sum(case when winner_side = 'away' then 1 else 0 end), 0),
    count(*),
    coalesce(sum(case when winner_side is not null or home_forfeit or away_forfeit then 1 else 0 end), 0)
  into v_home, v_away, v_total, v_completed
  from public.league_fixture_frames
  where fixture_id = p_fixture_id;

  select coalesce(s.singles_count, 4) + coalesce(s.doubles_count, 1)
  into v_expected
  from public.league_fixtures f
  join public.league_seasons s on s.id = f.season_id
  where f.id = p_fixture_id;

  if v_expected is null then
    v_expected := greatest(v_total, 1);
  end if;

  update public.league_fixtures
  set
    home_points = v_home,
    away_points = v_away,
    status = case
      when v_completed >= v_expected then 'complete'
      when (v_home + v_away) > 0 or v_completed > 0 then 'in_progress'
      else 'pending'
    end
  where id = p_fixture_id;
end;
$$;
