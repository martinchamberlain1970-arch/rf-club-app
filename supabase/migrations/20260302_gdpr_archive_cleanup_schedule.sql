-- Ensure archived profiles are purged after 6 months.
-- Keeps historical match rows intact by deleting only player profiles that are already archived
-- and inactive for at least 6 months.

create or replace function public.purge_gdpr_players()
returns integer
language plpgsql
as $$
declare
  deleted_count integer := 0;
begin
  delete from public.players p
  where p.is_archived = true
    and p.archived_at is not null
    and p.archived_at < now() - interval '6 months'
    and coalesce(p.last_active_at, p.updated_at, p.created_at) < now() - interval '6 months';

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule(jobid)
      from cron.job
      where jobname = 'gdpr-archived-player-purge';
    exception when others then
      null;
    end;

    perform cron.schedule(
      'gdpr-archived-player-purge',
      '0 3 * * *',
      'select public.purge_gdpr_players();'
    );
  end if;
exception when others then
  -- If cron is unavailable in this project, leave manual execution path in place.
  null;
end;
$do$;
