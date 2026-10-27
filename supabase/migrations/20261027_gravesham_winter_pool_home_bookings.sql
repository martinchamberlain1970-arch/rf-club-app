-- Gravesham Pool Winter League 2026-27 home fixtures for both Greenhithe teams.
-- Source: https://www.gravesham8ball.co.uk/lg/2610winter/fixtures.html
-- Home league nights reserve the Pool Table from 18:00 to 23:00 Europe/London.

do $$
declare
  pool_table_id uuid;
  booking_user_id uuid;
  booking_player_id uuid;
  fixture record;
  fixture_start timestamptz;
  fixture_end timestamptz;
begin
  select ct.id
    into pool_table_id
  from public.cue_tables ct
  join public.locations l on l.id = ct.location_id
  where ct.sport_type = 'pool'
    and ct.is_active = true
    and lower(l.name) like '%greenhithe%legion%'
  order by ct.display_order, ct.created_at
  limit 1;

  select au.id, au.linked_player_id
    into booking_user_id, booking_player_id
  from public.app_users au
  where lower(au.email) = 'rackandframe.app@gmail.com'
  limit 1;

  if pool_table_id is null then
    raise exception 'Active Greenhithe Legion pool table not found';
  end if;

  if booking_user_id is null or booking_player_id is null then
    raise exception 'Rack & Frame booking account or linked player not found';
  end if;

  for fixture in
    select *
    from (values
      ('2026-11-04'::date, 'Greenhithe Legion B vs Greenhithe Legion A'),
      ('2026-11-11'::date, 'Greenhithe Legion A vs Meopham CC'),
      ('2026-11-18'::date, 'Greenhithe Legion B vs Brent Old Boys'),
      ('2026-11-25'::date, 'Greenhithe Legion A vs The Black Horse'),
      ('2026-12-02'::date, 'Greenhithe Legion B vs Traders Club A'),
      ('2026-12-09'::date, 'Greenhithe Legion A vs Rose Perry Street B'),
      ('2026-12-16'::date, 'Greenhithe Legion B vs Meopham CC'),
      ('2027-01-13'::date, 'Greenhithe Legion A vs Traders Club B'),
      ('2027-01-20'::date, 'Greenhithe Legion B vs Rose Perry Street B'),
      ('2027-01-27'::date, 'Greenhithe Legion A vs Gravesend Breakers'),
      ('2027-02-03'::date, 'Greenhithe Legion B vs Gravesend Breakers'),
      ('2027-02-10'::date, 'Greenhithe Legion A vs Greenhithe Legion B'),
      ('2027-02-24'::date, 'Greenhithe Legion B vs The Sun A'),
      ('2027-03-03'::date, 'Greenhithe Legion A vs The Sun A'),
      ('2027-03-17'::date, 'Greenhithe Legion B vs Rose Perry Street A'),
      ('2027-03-24'::date, 'Greenhithe Legion A vs Brent Old Boys'),
      ('2027-03-31'::date, 'Greenhithe Legion B vs Foresters TC'),
      ('2027-04-07'::date, 'Greenhithe Legion A vs Rose Perry Street A'),
      ('2027-04-21'::date, 'Greenhithe Legion B vs The Black Horse'),
      ('2027-04-28'::date, 'Greenhithe Legion A vs Traders Club A'),
      ('2027-05-05'::date, 'Greenhithe Legion B vs Traders Club B'),
      ('2027-05-12'::date, 'Greenhithe Legion A vs Foresters TC')
    ) as fixtures(match_date, match_name)
  loop
    fixture_start := (fixture.match_date + time '18:00') at time zone 'Europe/London';
    fixture_end := (fixture.match_date + time '23:00') at time zone 'Europe/London';

    if exists (
      select 1
      from public.table_reservations tr
      where tr.table_id = pool_table_id
        and tr.status = 'booked'
        and tr.starts_at < fixture_end
        and tr.ends_at > fixture_start
        and not (
          tr.purpose = 'league_match'
          and tr.starts_at = fixture_start
          and tr.ends_at = fixture_end
          and tr.team_name = fixture.match_name
        )
    ) then
      raise exception 'Pool-table booking clash on %', fixture.match_date;
    end if;

    if not exists (
      select 1
      from public.table_reservations tr
      where tr.table_id = pool_table_id
        and tr.status = 'booked'
        and tr.purpose = 'league_match'
        and tr.starts_at = fixture_start
        and tr.ends_at = fixture_end
        and tr.team_name = fixture.match_name
    ) then
      insert into public.table_reservations (
        table_id,
        booked_by_user_id,
        booked_for_player_id,
        starts_at,
        ends_at,
        purpose,
        team_name,
        requester_email,
        status,
        reviewed_at,
        reviewed_by_user_id
      ) values (
        pool_table_id,
        booking_user_id,
        booking_player_id,
        fixture_start,
        fixture_end,
        'league_match',
        fixture.match_name,
        'rackandframe.app@gmail.com',
        'booked',
        now(),
        booking_user_id
      );
    end if;
  end loop;
end $$;
