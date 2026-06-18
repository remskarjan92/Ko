create or replace view analytics_private.v_daily_metrics as
with generation_daily as (
  select
    date_trunc('day', created_at)::date as day,
    mode,
    print_visibility,
    listing_role,
    category,
    provider,
    model_name,
    count(*)::integer as generations_total,
    count(*) filter (where outcome = 'succeeded')::integer as generations_succeeded,
    count(*) filter (where outcome = 'failed')::integer as generations_failed,
    avg(latency_ms) filter (where latency_ms is not null) as avg_latency_ms
  from analytics_private.generation_events
  group by 1, 2, 3, 4, 5, 6, 7
),
interaction_daily as (
  select
    date_trunc('day', i.created_at)::date as day,
    coalesce(g.mode, i.metadata->>'mockupStyleMode', i.metadata->>'mode') as mode,
    coalesce(g.print_visibility, i.metadata->>'printVisibility') as print_visibility,
    coalesce(g.listing_role, i.metadata->>'listingRole') as listing_role,
    coalesce(g.category, i.metadata->>'category', i.metadata->>'categoryName') as category,
    g.provider,
    g.model_name,
    count(*) filter (where i.event_type = 'rating_set' and i.rating is not null)::integer as ratings_count,
    avg(i.rating) filter (where i.event_type = 'rating_set' and i.rating is not null) as avg_rating,
    count(*) filter (where i.event_type in ('download_png', 'download_zip'))::integer as downloads,
    count(*) filter (where i.event_type = 'export_selected')::integer as exports,
    count(*) filter (where i.event_type = 'regenerate_clicked')::integer as regenerates,
    count(*) filter (where i.event_type = 'ai_fix_clicked')::integer as ai_fixes,
    count(*) filter (where i.event_type = 'select_favorite')::integer as favorites
  from analytics_private.interaction_events i
  left join analytics_private.generation_events g on g.event_id = i.generation_event_id
  group by 1, 2, 3, 4, 5, 6, 7
)
select
  coalesce(g.day, i.day) as day,
  coalesce(g.mode, i.mode) as mode,
  coalesce(g.print_visibility, i.print_visibility) as print_visibility,
  coalesce(g.listing_role, i.listing_role) as listing_role,
  coalesce(g.category, i.category) as category,
  coalesce(g.provider, i.provider) as provider,
  coalesce(g.model_name, i.model_name) as model_name,
  coalesce(g.generations_total, 0) as generations_total,
  coalesce(g.generations_succeeded, 0) as generations_succeeded,
  coalesce(g.generations_failed, 0) as generations_failed,
  case
    when coalesce(g.generations_total, 0) = 0 then null
    else round((g.generations_succeeded::numeric / nullif(g.generations_total, 0)) * 100, 2)
  end as success_rate,
  g.avg_latency_ms,
  coalesce(i.ratings_count, 0) as ratings_count,
  i.avg_rating,
  coalesce(i.downloads, 0) as downloads,
  coalesce(i.exports, 0) as exports,
  coalesce(i.regenerates, 0) as regenerates,
  coalesce(i.ai_fixes, 0) as ai_fixes,
  coalesce(i.favorites, 0) as favorites
from generation_daily g
full outer join interaction_daily i
  on g.day = i.day
  and g.mode is not distinct from i.mode
  and g.print_visibility is not distinct from i.print_visibility
  and g.listing_role is not distinct from i.listing_role
  and g.category is not distinct from i.category
  and g.provider is not distinct from i.provider
  and g.model_name is not distinct from i.model_name;

create or replace view analytics_private.v_concept_summary as
select
  listing_role,
  category,
  mode,
  print_visibility,
  sum(generations_total)::integer as generations_total,
  case
    when sum(generations_total) = 0 then null
    else round((sum(generations_succeeded)::numeric / nullif(sum(generations_total), 0)) * 100, 2)
  end as success_rate,
  case
    when sum(ratings_count) = 0 then null
    else round((sum(coalesce(avg_rating, 0) * ratings_count)::numeric / nullif(sum(ratings_count), 0)), 2)
  end as avg_rating,
  sum(downloads)::integer as download_count,
  sum(exports)::integer as export_count,
  sum(regenerates)::integer as regenerate_count,
  sum(ai_fixes)::integer as ai_fix_count
from analytics_private.v_daily_metrics
group by listing_role, category, mode, print_visibility;
