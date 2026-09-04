-- One-time separation of Rack & Frame snooker Elo from the league app.
-- Rebuild every active player's club rating from eligible club matches only.
do $$
declare
  fixture record;
  player1_rating integer;
  player2_rating integer;
  player1_matches integer;
  player2_matches integer;
  expected1 numeric;
  applied_k integer;
  delta1 integer;
  next1 integer;
  next2 integer;
  eligible_count integer;
  ranked_count integer;
begin
  create temporary table club_snooker_elo_state (
    player_id uuid primary key,
    current_rating integer not null,
    peak_rating integer not null,
    rated_matches integer not null default 0
  ) on commit drop;

  insert into club_snooker_elo_state (player_id, current_rating, peak_rating, rated_matches)
  select
    id,
    greatest(100, round(1000 - coalesce(snooker_handicap_base, snooker_handicap, 0) * 5)::integer),
    greatest(100, round(1000 - coalesce(snooker_handicap_base, snooker_handicap, 0) * 5)::integer),
    0
  from players
  where coalesce(is_archived, false) = false;

  for fixture in
    select
      m.id,
      m.player1_id,
      m.player2_id,
      m.winner_player_id,
      m.updated_at
    from matches m
    join competitions c on c.id = m.competition_id
    where c.sport_type = 'snooker'
      and coalesce(c.is_practice, false) = false
      and m.status = 'complete'
      and m.match_mode = 'singles'
      and m.player1_id is not null
      and m.player2_id is not null
      and m.winner_player_id in (m.player1_id, m.player2_id)
      and not exists (
        select 1
        from frames f
        where f.match_id = m.id
          and coalesce(f.is_walkover_award, false) = true
      )
    order by m.updated_at asc nulls last, m.id asc
  loop
    select current_rating, rated_matches
      into player1_rating, player1_matches
    from club_snooker_elo_state
    where player_id = fixture.player1_id;

    select current_rating, rated_matches
      into player2_rating, player2_matches
    from club_snooker_elo_state
    where player_id = fixture.player2_id;

    if player1_rating is null or player2_rating is null then
      continue;
    end if;

    expected1 := 1.0 / (1.0 + power(10.0, (player2_rating - player1_rating) / 400.0));
    applied_k := greatest(
      case when player1_matches < 30 then 32 when player1_rating >= 1800 then 16 else 20 end,
      case when player2_matches < 30 then 32 when player2_rating >= 1800 then 16 else 20 end
    );
    delta1 := round(applied_k * ((case when fixture.winner_player_id = fixture.player1_id then 1 else 0 end) - expected1))::integer;
    next1 := greatest(100, player1_rating + delta1);
    next2 := greatest(100, player2_rating - delta1);

    update club_snooker_elo_state
    set current_rating = next1,
        peak_rating = greatest(peak_rating, next1),
        rated_matches = rated_matches + 1
    where player_id = fixture.player1_id;

    update club_snooker_elo_state
    set current_rating = next2,
        peak_rating = greatest(peak_rating, next2),
        rated_matches = rated_matches + 1
    where player_id = fixture.player2_id;

    update matches
    set rating_applied_at = coalesce(fixture.updated_at, now()),
        rating_delta_team1 = delta1,
        rating_delta_team2 = -delta1,
        elo_team1_before = player1_rating,
        elo_team2_before = player2_rating,
        elo_team1_after = next1,
        elo_team2_after = next2,
        expected_team1_probability = expected1
    where id = fixture.id;
  end loop;

  update players p
  set rating_snooker = s.current_rating,
      peak_rating_snooker = s.peak_rating,
      rated_matches_snooker = s.rated_matches
  from club_snooker_elo_state s
  where p.id = s.player_id;

  select coalesce(sum(rated_matches), 0) / 2,
         count(*) filter (where rated_matches > 0)
    into eligible_count, ranked_count
  from club_snooker_elo_state;

  insert into audit_logs (actor_role, action, entity_type, summary, meta)
  values (
    'system',
    'club_snooker_elo_rebuilt',
    'rating',
    format('Rebuilt independent club snooker Elo from %s eligible match(es).', eligible_count),
    jsonb_build_object('eligibleMatches', eligible_count, 'rankedPlayers', ranked_count, 'source', 'club_only')
  );
end $$;
