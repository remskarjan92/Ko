begin;

-- Fast admin user lists and status-filtered account lookups.
create index if not exists ko_users_created_at_idx
  on public.ko_users (created_at desc);

create index if not exists ko_users_account_status_created_idx
  on public.ko_users (account_status, created_at desc);

-- Admin transaction timelines are ordered newest-first.
create index if not exists ko_credit_transactions_created_at_idx
  on public.ko_credit_transactions (created_at desc);

-- User history pages commonly filter by user and status, then sort by newest first.
create index if not exists ko_generation_records_user_status_created_idx
  on public.ko_generation_records (user_id, status, created_at desc);

-- Admin generation timelines and recent-activity panels sort by newest first.
create index if not exists ko_generation_records_created_at_idx
  on public.ko_generation_records (created_at desc);

-- Recent rating and failure queues are displayed newest-first in admin review views.
create index if not exists ko_generation_ratings_created_at_idx
  on public.ko_generation_ratings (created_at desc);

create index if not exists ko_generation_failures_created_at_idx
  on public.ko_generation_failures (created_at desc);

-- Admin prompt/model settings are listed in display order.
create index if not exists ko_prompt_templates_updated_at_idx
  on public.ko_prompt_templates (updated_at desc);

create index if not exists ko_ai_models_priority_idx
  on public.ko_ai_models (priority asc);

-- Operational tables that are read newest-first in admin tools.
create index if not exists ko_quality_records_created_at_idx
  on public.ko_quality_records (created_at desc);

create index if not exists ko_research_items_created_at_idx
  on public.ko_research_items (created_at desc);

-- Analytics join path used by the learning bundle view.
create index if not exists interaction_events_generation_event_id_idx
  on analytics_private.interaction_events (generation_event_id);

commit;
