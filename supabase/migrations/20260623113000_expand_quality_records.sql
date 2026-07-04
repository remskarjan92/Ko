begin;

alter table public.ko_quality_records
  add column if not exists generation_id uuid references public.ko_generation_records(id) on delete cascade,
  add column if not exists score numeric(10,2),
  add column if not exists status text,
  add column if not exists reasoning text,
  add column if not exists detected_issues jsonb not null default '[]'::jsonb,
  add column if not exists improvement_suggestions jsonb not null default '[]'::jsonb,
  add column if not exists confidence_level numeric(10,2),
  add column if not exists suggested_fix_prompt text,
  add column if not exists prompt text,
  add column if not exists model_name text,
  add column if not exists style_key text,
  add column if not exists category text,
  add column if not exists report jsonb not null default '{}'::jsonb,
  add column if not exists user_feedback jsonb not null default '{}'::jsonb;

create index if not exists ko_quality_records_generation_idx
  on public.ko_quality_records (generation_id, created_at desc);

create index if not exists ko_quality_records_score_idx
  on public.ko_quality_records (score desc, created_at desc);

create index if not exists ko_quality_records_style_score_idx
  on public.ko_quality_records (style_key, score desc, created_at desc);

commit;
