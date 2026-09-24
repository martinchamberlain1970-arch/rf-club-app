begin;

update public.competitions
set name = 'Greenhithe Legion Masters Pool 2026'
where name = 'Greenhithe Legion Masters 2026'
  and sport_type in ('pool_8_ball', 'pool_9_ball');

-- Reconstruct this competition's established relative handicaps from its
-- completed fixtures before the current game week. This keeps the repair
-- independent from club Elo and from later player-profile handicap reviews.
with recursive competition as (
  select id
  from public.competitions
  where name = 'Greenhithe Legion Masters Snooker 2026'
  limit 1
), directed_edges (from_player_id, to_player_id, delta) as (
  select
    m.player1_id,
    m.player2_id,
    coalesce(m.team2_handicap_start, 0) - coalesce(m.team1_handicap_start, 0)
  from public.matches m
  join competition c on c.id = m.competition_id
  where m.is_archived = false
    and m.status = 'complete'
    and m.player1_id is distinct from m.player2_id
    and m.scheduled_for < date '2026-09-21'
  union all
  select
    m.player2_id,
    m.player1_id,
    coalesce(m.team1_handicap_start, 0) - coalesce(m.team2_handicap_start, 0)
  from public.matches m
  join competition c on c.id = m.competition_id
  where m.is_archived = false
    and m.status = 'complete'
    and m.player1_id is distinct from m.player2_id
    and m.scheduled_for < date '2026-09-21'
), anchor as (
  select min(from_player_id::text)::uuid as player_id
  from directed_edges
), handicap_walk (player_id, handicap) as (
  select player_id, 0
  from anchor
  where player_id is not null
  union
  select edge.to_player_id, walk.handicap + edge.delta
  from handicap_walk walk
  join directed_edges edge on edge.from_player_id = walk.player_id
), resolved as (
  select player_id, min(handicap)::integer as handicap
  from handicap_walk
  group by player_id
), competition_handicaps as (
  select player_id, handicap - min(handicap) over () as handicap
  from resolved
), eligible as (
  select
    m.id,
    least(40, greatest(0, h1.handicap - h2.handicap))::integer as team1_start,
    least(40, greatest(0, h2.handicap - h1.handicap))::integer as team2_start
  from public.matches m
  join competition_handicaps h1 on h1.player_id = m.player1_id
  join competition_handicaps h2 on h2.player_id = m.player2_id
  join competition c on c.id = m.competition_id
  where true
    and m.is_archived = false
    and m.status = 'pending'
    and m.player1_id is distinct from m.player2_id
    and m.scheduled_for >= date '2026-09-21'
    and not exists (
      select 1 from public.frames f where f.match_id = m.id
    )
    and not exists (
      select 1 from public.result_submissions rs where rs.match_id = m.id
    )
    and not exists (
      select 1
      from public.league_reschedule_requests lrr
      where lrr.match_id = m.id
        and lrr.status = 'approved'
    )
)
update public.matches m
set
  team1_handicap_start = eligible.team1_start,
  team2_handicap_start = eligible.team2_start,
  updated_at = now()
from eligible
where m.id = eligible.id;

commit;
