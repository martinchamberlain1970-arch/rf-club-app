drop view if exists public.live_event_summary;

create view public.live_event_summary as
select
  c.id as competition_id,
  c.name,
  c.sport_type,
  c.competition_format,
  count(m.id)::integer as total_matches,
  count(*) filter (where m.status = any (array['complete'::text, 'bye'::text]))::integer as complete_matches,
  count(*) filter (where m.status = 'in_progress'::text)::integer as in_progress_matches
from public.competitions c
left join public.matches m
  on m.competition_id = c.id
where not c.is_archived
  and not c.is_completed
group by c.id, c.name, c.sport_type, c.competition_format;
