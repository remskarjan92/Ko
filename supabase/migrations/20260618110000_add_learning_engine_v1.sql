begin;

alter table if exists analytics_private.generation_events
  add column if not exists prompt_version text;

alter table if exists analytics_private.generation_events
  add column if not exists product_type text;

create index if not exists generation_events_prompt_version_created_at_idx
  on analytics_private.generation_events (prompt_version, created_at desc);

create index if not exists generation_events_product_type_created_at_idx
  on analytics_private.generation_events (product_type, created_at desc);

create or replace view analytics_private.v_learning_concept_base as
with generation_base as (
  select
    coalesce(nullif(concept_id, ''), metadata->>'conceptId', metadata->>'clientGenerationId', 'unknown') as concept_id,
    coalesce(nullif(design_fingerprint, ''), metadata->>'conceptFingerprint', coalesce(nullif(concept_id, ''), metadata->>'conceptId', metadata->>'clientGenerationId', 'unknown')) as concept_fingerprint,
    nullif(coalesce(metadata->>'promptHash', metadata->>'prompt_hash'), '') as prompt_hash,
    nullif(coalesce(prompt_version, metadata->>'promptVersion'), '') as prompt_version,
    nullif(coalesce(product_type, metadata->>'productType'), '') as product_type,
    nullif(coalesce(listing_role, metadata->>'listingRole'), '') as listing_role,
    nullif(coalesce(category, metadata->>'category'), '') as category,
    nullif(metadata->>'targetBuyer', '') as audience,
    nullif(coalesce(mode, metadata->>'mode'), '') as mockup_style_mode,
    nullif(metadata->>'environment', '') as environment,
    nullif(metadata->>'pose', '') as pose,
    nullif(metadata->>'cameraSetup', '') as camera_setup,
    nullif(metadata->>'lighting', '') as lighting,
    nullif(metadata->>'shirtType', '') as shirt_type,
    nullif(coalesce(print_visibility, metadata->>'printVisibility'), '') as print_visibility,
    count(*) filter (where outcome in ('started', 'succeeded', 'failed'))::int as generation_count,
    0::int as rating_count,
    0::numeric(10,4) as rating_sum,
    0::int as download_count,
    0::int as export_count,
    0::int as regenerate_count,
    min(created_at) as first_seen_at,
    max(created_at) as last_seen_at
  from analytics_private.generation_events
  group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15
),
interaction_base as (
  select
    coalesce(metadata->>'conceptId', metadata->>'clientGenerationId', 'unknown') as concept_id,
    coalesce(metadata->>'conceptFingerprint', metadata->>'conceptId', metadata->>'clientGenerationId', 'unknown') as concept_fingerprint,
    nullif(coalesce(metadata->>'promptHash', metadata->>'prompt_hash'), '') as prompt_hash,
    nullif(metadata->>'promptVersion', '') as prompt_version,
    nullif(metadata->>'productType', '') as product_type,
    nullif(metadata->>'listingRole', '') as listing_role,
    nullif(metadata->>'category', '') as category,
    nullif(metadata->>'targetBuyer', '') as audience,
    nullif(metadata->>'mode', '') as mockup_style_mode,
    nullif(metadata->>'environment', '') as environment,
    nullif(metadata->>'pose', '') as pose,
    nullif(metadata->>'cameraSetup', '') as camera_setup,
    nullif(metadata->>'lighting', '') as lighting,
    nullif(metadata->>'shirtType', '') as shirt_type,
    nullif(metadata->>'printVisibility', '') as print_visibility,
    0::int as generation_count,
    count(*) filter (where event_type = 'rating_set' and rating is not null)::int as rating_count,
    coalesce(sum(rating) filter (where event_type = 'rating_set' and rating is not null), 0)::numeric(10,4) as rating_sum,
    count(*) filter (where event_type in ('download_png', 'download_zip'))::int as download_count,
    count(*) filter (where event_type = 'export_selected')::int as export_count,
    count(*) filter (where event_type = 'regenerate_clicked')::int as regenerate_count,
    min(created_at) as first_seen_at,
    max(created_at) as last_seen_at
  from analytics_private.interaction_events
  group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15
),
combined as (
  select * from generation_base
  union all
  select * from interaction_base
)
  select
    concept_id,
    coalesce(nullif(max(concept_fingerprint), ''), concept_id) as concept_fingerprint,
    nullif(max(prompt_hash), '') as prompt_hash,
    nullif(max(prompt_version), '') as prompt_version,
  nullif(max(product_type), '') as product_type,
  nullif(max(listing_role), '') as listing_role,
  nullif(max(category), '') as category,
  nullif(max(audience), '') as audience,
  nullif(max(mockup_style_mode), '') as mockup_style_mode,
  nullif(max(environment), '') as environment,
  nullif(max(pose), '') as pose,
  nullif(max(camera_setup), '') as camera_setup,
  nullif(max(lighting), '') as lighting,
  nullif(max(shirt_type), '') as shirt_type,
  nullif(max(print_visibility), '') as print_visibility,
  greatest(sum(generation_count), sum(rating_count), sum(download_count), sum(export_count), sum(regenerate_count), 1)::int as sample_count,
  sum(rating_count)::int as rating_count,
  case when sum(rating_count) = 0 then 0 else round(sum(rating_sum)::numeric / nullif(sum(rating_count), 0), 4) end as avg_rating,
  sum(download_count)::int as download_count,
  sum(export_count)::int as export_count,
  sum(regenerate_count)::int as regenerate_count,
  min(first_seen_at) as first_seen_at,
  max(last_seen_at) as last_seen_at
from combined
where concept_id is not null and concept_id <> 'unknown'
group by concept_id;

create table if not exists analytics_private.concept_scores (
  concept_id text primary key,
  concept_fingerprint text not null,
  prompt_hash text,
  prompt_version text,
  product_type text,
  listing_role text,
  category text,
  audience text,
  mockup_style_mode text,
  environment text,
  pose text,
  camera_setup text,
  lighting text,
  shirt_type text,
  print_visibility text,
  sample_count int not null default 0,
  rating_count int not null default 0,
  avg_rating numeric(10,4) not null default 0,
  download_count int not null default 0,
  export_count int not null default 0,
  regenerate_count int not null default 0,
  download_rate numeric(10,5) not null default 0,
  export_rate numeric(10,5) not null default 0,
  regenerate_rate numeric(10,5) not null default 0,
  success_score_raw numeric(10,2) not null default 0,
  confidence_weight numeric(10,5) not null default 0,
  success_score numeric(10,2) not null default 0,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint concept_scores_success_score_raw_chk check (success_score_raw >= 0 and success_score_raw <= 100),
  constraint concept_scores_success_score_chk check (success_score >= 0 and success_score <= 100)
);

create index if not exists concept_scores_success_score_idx
  on analytics_private.concept_scores (success_score desc);

create index if not exists concept_scores_product_type_success_score_idx
  on analytics_private.concept_scores (product_type, success_score desc);

create index if not exists concept_scores_prompt_version_idx
  on analytics_private.concept_scores (prompt_version);

create index if not exists concept_scores_sample_count_idx
  on analytics_private.concept_scores (sample_count desc);

create table if not exists analytics_private.dimension_scores (
  dimension_type text not null,
  dimension_value text not null,
  product_type text not null default 'all',
  sample_count int not null default 0,
  concept_count int not null default 0,
  rating_count int not null default 0,
  avg_rating numeric(10,4) not null default 0,
  download_count int not null default 0,
  export_count int not null default 0,
  regenerate_count int not null default 0,
  download_rate numeric(10,5) not null default 0,
  export_rate numeric(10,5) not null default 0,
  regenerate_rate numeric(10,5) not null default 0,
  success_score numeric(10,2) not null default 0,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (dimension_type, dimension_value, product_type),
  constraint dimension_scores_success_score_chk check (success_score >= 0 and success_score <= 100)
);

create index if not exists dimension_scores_lookup_idx
  on analytics_private.dimension_scores (dimension_type, product_type, success_score desc);

create index if not exists dimension_scores_sample_count_idx
  on analytics_private.dimension_scores (sample_count desc);

create or replace function analytics_private.refresh_concept_scores()
returns void
language plpgsql
as $$
begin
  delete from analytics_private.concept_scores;

  insert into analytics_private.concept_scores (
    concept_id, concept_fingerprint, prompt_hash, prompt_version, product_type, listing_role, category,
    audience, mockup_style_mode, environment, pose, camera_setup, lighting, shirt_type,
    print_visibility, sample_count, rating_count, avg_rating, download_count, export_count,
    regenerate_count, download_rate, export_rate, regenerate_rate, success_score_raw,
    confidence_weight, success_score, first_seen_at, last_seen_at, updated_at
  )
  with scored as (
    select
      b.*,
      least(1, coalesce(b.download_count::numeric / nullif(b.sample_count, 0), 0)) as download_rate_calc,
      least(1, coalesce(b.export_count::numeric / nullif(b.sample_count, 0), 0)) as export_rate_calc,
      least(1, coalesce(b.regenerate_count::numeric / nullif(b.sample_count, 0), 0)) as regenerate_rate_calc,
      round(least(1.0, coalesce(b.sample_count, 0)::numeric / 10.0), 5) as confidence_weight_calc
    from analytics_private.v_learning_concept_base b
    where b.sample_count > 0
  ),
  final_scores as (
    select
      s.*,
      round(least(100, greatest(0, 100 * (
        (coalesce(s.avg_rating, 0) / 5.0) * 0.40 +
        s.download_rate_calc * 0.25 +
        s.export_rate_calc * 0.20 +
        (1 - s.regenerate_rate_calc) * 0.15
      ))), 2) as success_score_raw_calc
    from scored s
  )
  select
    concept_id,
    concept_fingerprint,
    prompt_hash,
    prompt_version,
    product_type,
    listing_role,
    category,
    audience,
    mockup_style_mode,
    environment,
    pose,
    camera_setup,
    lighting,
    shirt_type,
    print_visibility,
    sample_count,
    rating_count,
    round(avg_rating, 4),
    download_count,
    export_count,
    regenerate_count,
    round(download_rate_calc, 5),
    round(export_rate_calc, 5),
    round(regenerate_rate_calc, 5),
    success_score_raw_calc,
    confidence_weight_calc,
    round(success_score_raw_calc * confidence_weight_calc, 2),
    first_seen_at,
    last_seen_at,
    now()
  from final_scores;
end;
$$;

create or replace function analytics_private.refresh_dimension_scores()
returns void
language plpgsql
as $$
begin
  delete from analytics_private.dimension_scores;

  insert into analytics_private.dimension_scores (
    dimension_type, dimension_value, product_type, sample_count, concept_count, rating_count,
    avg_rating, download_count, export_count, regenerate_count, download_rate, export_rate,
    regenerate_rate, success_score, first_seen_at, last_seen_at, updated_at
  )
  with expanded_specific as (
    select
      coalesce(nullif(cs.product_type, ''), 'unknown') as product_type,
      d.dimension_type,
      d.dimension_value,
      cs.concept_id,
      cs.concept_fingerprint,
      cs.prompt_version,
      cs.product_type as source_product_type,
      cs.listing_role,
      cs.category,
      cs.audience,
      cs.mockup_style_mode,
      cs.environment,
      cs.pose,
      cs.camera_setup,
      cs.lighting,
      cs.shirt_type,
      cs.print_visibility,
      cs.sample_count,
      cs.rating_count,
      cs.avg_rating,
      cs.download_count,
      cs.export_count,
      cs.regenerate_count,
      cs.download_rate,
      cs.export_rate,
      cs.regenerate_rate,
      cs.success_score_raw,
      cs.confidence_weight,
      cs.success_score,
      cs.first_seen_at,
      cs.last_seen_at,
      cs.updated_at
    from analytics_private.concept_scores cs
    cross join lateral (
      values
        ('listing_role', cs.listing_role),
        ('mockup_style_mode', cs.mockup_style_mode),
        ('environment', cs.environment),
        ('camera_setup', cs.camera_setup),
        ('pose', cs.pose),
        ('lighting', cs.lighting),
        ('shirt_type', cs.shirt_type),
        ('print_visibility', cs.print_visibility),
        ('audience', cs.audience),
        ('category', cs.category),
        ('product_type', cs.product_type)
    ) as d(dimension_type, dimension_value)
    where cs.sample_count > 0
      and d.dimension_value is not null
      and d.dimension_value <> ''
  ),
  expanded as (
    select * from expanded_specific
    union all
    select 'all' as product_type, dimension_type, dimension_value, concept_id, concept_fingerprint,
      prompt_version, source_product_type, listing_role, category, audience,
      mockup_style_mode, environment, pose, camera_setup, lighting, shirt_type, print_visibility,
      sample_count, rating_count, avg_rating, download_count, export_count, regenerate_count,
      download_rate, export_rate, regenerate_rate, success_score_raw, confidence_weight,
      success_score, first_seen_at, last_seen_at, updated_at
    from expanded_specific
  )
  select
    dimension_type,
    dimension_value,
    product_type,
    sum(sample_count)::int,
    count(distinct concept_id)::int,
    sum(rating_count)::int,
    round(coalesce(sum(avg_rating * greatest(rating_count, 1)) / nullif(sum(greatest(rating_count, 1)), 0), 0), 4),
    sum(download_count)::int,
    sum(export_count)::int,
    sum(regenerate_count)::int,
    round(coalesce(sum(download_count)::numeric / nullif(sum(sample_count), 0), 0), 5),
    round(coalesce(sum(export_count)::numeric / nullif(sum(sample_count), 0), 0), 5),
    round(coalesce(sum(regenerate_count)::numeric / nullif(sum(sample_count), 0), 0), 5),
    round(coalesce(sum(success_score * sample_count)::numeric / nullif(sum(sample_count), 0), 0), 2),
    min(first_seen_at),
    max(last_seen_at),
    now()
  from expanded
  group by dimension_type, dimension_value, product_type;
end;
$$;

create or replace function analytics_private.refresh_learning_scores()
returns void
language plpgsql
as $$
begin
  perform analytics_private.refresh_concept_scores();
  perform analytics_private.refresh_dimension_scores();
end;
$$;

commit;
