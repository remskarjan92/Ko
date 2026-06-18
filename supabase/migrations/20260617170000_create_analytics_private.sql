create schema if not exists analytics_private;

create table if not exists analytics_private.clients (
  client_install_hash text primary key,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  consent_analytics boolean not null default false,
  locale text,
  app_version text,
  opt_out_at timestamptz
);

create table if not exists analytics_private.generation_events (
  event_id uuid primary key,
  client_event_id uuid unique not null,
  client_install_hash text not null references analytics_private.clients(client_install_hash) on delete cascade,
  batch_id uuid null,
  concept_id text null,
  design_fingerprint text null,
  mode text null,
  print_visibility text null,
  listing_role text null,
  category text null,
  provider text null,
  model_name text null,
  outcome text not null,
  failure_code text null,
  latency_ms integer null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists analytics_private.interaction_events (
  event_id uuid primary key,
  client_event_id uuid unique not null,
  client_install_hash text not null references analytics_private.clients(client_install_hash) on delete cascade,
  generation_event_id uuid null references analytics_private.generation_events(event_id) on delete set null,
  event_type text not null,
  rating smallint null,
  dwell_ms integer null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists generation_events_client_created_idx
  on analytics_private.generation_events (client_install_hash, created_at desc);

create index if not exists generation_events_outcome_created_idx
  on analytics_private.generation_events (outcome, created_at desc);

create index if not exists interaction_events_client_created_idx
  on analytics_private.interaction_events (client_install_hash, created_at desc);

create index if not exists interaction_events_type_created_idx
  on analytics_private.interaction_events (event_type, created_at desc);
