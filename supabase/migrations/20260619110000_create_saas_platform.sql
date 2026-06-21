begin;

create extension if not exists pgcrypto;

create table if not exists public.ko_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  username text not null unique,
  password_hash text not null,
  plan_type text not null default 'free',
  account_status text not null default 'active',
  credits_balance integer not null default 0,
  avatar_url text,
  last_login_at timestamptz,
  blocked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ko_credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.ko_users(id) on delete cascade,
  action text not null,
  credit_type text not null default 'standard',
  credits_added integer not null default 0,
  credits_removed integer not null default 0,
  balance_after integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ko_generation_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.ko_users(id) on delete set null,
  client_generation_id text unique,
  batch_id text,
  generation_type text not null default 'mockup',
  prompt text,
  prompt_hash text,
  model_name text,
  category text,
  status text not null default 'succeeded',
  score numeric(10,2),
  credits_used integer not null default 0,
  image_url text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ko_user_settings (
  user_id uuid primary key references public.ko_users(id) on delete cascade,
  default_settings jsonb not null default '{}'::jsonb,
  saved_prompt_preferences jsonb not null default '[]'::jsonb,
  notification_preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.ko_feature_costs (
  feature_key text primary key,
  display_name text not null,
  credits integer not null default 1,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.ko_ai_models (
  id uuid primary key default gen_random_uuid(),
  model_key text not null unique,
  display_name text not null,
  provider text not null,
  status text not null default 'enabled',
  priority integer not null default 100,
  fallback_model_key text,
  response_time_ms integer,
  success_rate numeric(10,2),
  estimated_cost numeric(12,4),
  usage_count integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.ko_prompt_templates (
  id uuid primary key default gen_random_uuid(),
  prompt_key text not null unique,
  prompt_type text not null,
  version text not null default 'v1',
  prompt_text text not null,
  prompt_hash text,
  status text not null default 'active',
  score numeric(10,2),
  usage_count integer not null default 0,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.ko_quality_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.ko_users(id) on delete set null,
  issue_type text not null,
  severity text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ko_research_items (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  keyword text,
  category text,
  title text not null,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ko_platform_settings (
  setting_key text primary key,
  setting_value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.ko_feature_costs (feature_key, display_name, credits, enabled)
values
  ('mockup_generation', 'Mockup Generation', 1, true),
  ('image_fix', 'Fix Generation', 1, true),
  ('video_generation', 'Video Generation', 5, false),
  ('research_generation', 'Research Generation', 2, false)
on conflict (feature_key) do nothing;

insert into public.ko_platform_settings (setting_key, setting_value)
values
  ('credit_defaults', '{"startingCredits": 100, "refundPolicy": "manual"}'::jsonb),
  ('feature_toggles', '{"learningEnabled": true, "videoEnabled": false, "researchEnabled": true}'::jsonb)
on conflict (setting_key) do nothing;

create index if not exists ko_credit_transactions_user_created_idx
  on public.ko_credit_transactions (user_id, created_at desc);

create index if not exists ko_generation_records_user_created_idx
  on public.ko_generation_records (user_id, created_at desc);

create index if not exists ko_generation_records_status_created_idx
  on public.ko_generation_records (status, created_at desc);

create index if not exists ko_generation_records_client_generation_idx
  on public.ko_generation_records (client_generation_id);

alter table analytics_private.clients
  add column if not exists user_id uuid;

alter table analytics_private.generation_events
  add column if not exists user_id uuid;

alter table analytics_private.interaction_events
  add column if not exists user_id uuid;

alter table analytics_private.generation_events
  add column if not exists prompt_hash text;

alter table analytics_private.interaction_events
  add column if not exists prompt_hash text;

create index if not exists generation_events_user_created_idx
  on analytics_private.generation_events (user_id, created_at desc);

create index if not exists interaction_events_user_created_idx
  on analytics_private.interaction_events (user_id, created_at desc);

create index if not exists clients_user_idx
  on analytics_private.clients (user_id);

commit;
