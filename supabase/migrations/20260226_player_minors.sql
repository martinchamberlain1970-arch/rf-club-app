-- Age band + guardian consent controls
alter table if exists public.players
  add column if not exists age_band text not null default '18_plus',
  add column if not exists guardian_consent boolean not null default false,
  add column if not exists guardian_consent_at timestamptz;

-- Update request fields for age/consent
alter table if exists public.player_update_requests
  add column if not exists requested_age_band text,
  add column if not exists requested_guardian_consent boolean;

-- Premium request workflow fields
alter table if exists public.premium_requests
  add column if not exists admin_approved boolean not null default false,
  add column if not exists guardian_consent boolean not null default false,
  add column if not exists approved_by_admin_at timestamptz,
  add column if not exists approved_by_super_at timestamptz;
