begin;

create extension if not exists pgcrypto;

alter table public.ko_generation_records
  add column if not exists original_design_url text,
  add column if not exists negative_prompt text,
  add column if not exists prompt_version_id uuid,
  add column if not exists scene_type text,
  add column if not exists target_audience text,
  add column if not exists duration_ms integer,
  add column if not exists estimated_cost numeric(12,4) not null default 0,
  add column if not exists review_status text not null default 'pending',
  add column if not exists reviewed_by text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists archived_at timestamptz,
  add column if not exists favorite_at timestamptz,
  add column if not exists flagged_at timestamptz;

alter table public.ko_prompt_templates
  add column if not exists author text,
  add column if not exists negative_prompt text,
  add column if not exists average_rating numeric(10,2),
  add column if not exists average_realism numeric(10,2),
  add column if not exists average_etsy_score numeric(10,2),
  add column if not exists failure_rate numeric(10,2),
  add column if not exists approval_count integer not null default 0,
  add column if not exists rejection_count integer not null default 0;

create table if not exists public.ko_generation_ratings (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null references public.ko_generation_records(id) on delete cascade,
  user_id uuid references public.ko_users(id) on delete set null,
  admin_username text,
  print_visibility smallint not null check (print_visibility between 1 and 10),
  design_accuracy smallint not null check (design_accuracy between 1 and 10),
  realism smallint not null check (realism between 1 and 10),
  product_authenticity smallint not null check (product_authenticity between 1 and 10),
  composition smallint not null check (composition between 1 and 10),
  marketing_appeal smallint not null check (marketing_appeal between 1 and 10),
  etsy_readiness smallint not null check (etsy_readiness between 1 and 10),
  ctr_potential smallint not null check (ctr_potential between 1 and 10),
  overall_score numeric(10,2) not null,
  comment text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ko_generation_failures (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null references public.ko_generation_records(id) on delete cascade,
  category text not null,
  severity text not null default 'medium',
  comment text,
  prompt_version text,
  model_name text,
  admin_username text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ko_prompt_comparisons (
  id uuid primary key default gen_random_uuid(),
  prompt_a_id uuid references public.ko_prompt_templates(id) on delete set null,
  prompt_b_id uuid references public.ko_prompt_templates(id) on delete set null,
  prompt_a_version text,
  prompt_b_version text,
  average_rating_a numeric(10,2),
  average_rating_b numeric(10,2),
  success_rate_a numeric(10,2),
  success_rate_b numeric(10,2),
  failure_rate_a numeric(10,2),
  failure_rate_b numeric(10,2),
  generation_count_a integer not null default 0,
  generation_count_b integer not null default 0,
  approval_percentage_a numeric(10,2),
  approval_percentage_b numeric(10,2),
  winner text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ko_ab_tests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'draft',
  design_url text,
  prompt_a_id uuid references public.ko_prompt_templates(id) on delete set null,
  prompt_b_id uuid references public.ko_prompt_templates(id) on delete set null,
  winner_prompt_id uuid references public.ko_prompt_templates(id) on delete set null,
  result_summary jsonb not null default '{}'::jsonb,
  created_by text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ko_analytics_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_type text not null,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ko_learning_insights (
  id uuid primary key default gen_random_uuid(),
  insight_type text not null,
  title text not null,
  summary text,
  metric_key text,
  metric_value numeric(12,4),
  confidence numeric(10,4),
  sample_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ko_system_logs (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  severity text not null default 'info',
  message text not null,
  generation_id uuid references public.ko_generation_records(id) on delete set null,
  user_id uuid references public.ko_users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ko_generation_records_review_created_idx
  on public.ko_generation_records (review_status, created_at desc);

create index if not exists ko_generation_ratings_generation_idx
  on public.ko_generation_ratings (generation_id, created_at desc);

create index if not exists ko_generation_ratings_overall_idx
  on public.ko_generation_ratings (overall_score desc, created_at desc);

create index if not exists ko_generation_failures_generation_idx
  on public.ko_generation_failures (generation_id, created_at desc);

create index if not exists ko_generation_failures_category_idx
  on public.ko_generation_failures (category, created_at desc);

create index if not exists ko_system_logs_created_idx
  on public.ko_system_logs (created_at desc);

commit;
