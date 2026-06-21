# KO Admin Evolution - Phase 1

## Scope

This phase adds the data and API foundation for the KO Admin Evolution System without replacing the existing generation pipeline.

The current generation flow remains:

Upload Design -> Analyze -> Generate Prompt -> Generate Mockups -> Display Results

Phase 1 adds:

Upload Design -> Analyze -> Generate Prompt -> Generate Mockups -> Metadata -> Admin Review -> Rating -> Failure Tracking -> Analytics

## Added Data Model

- `ko_generation_ratings`
- `ko_generation_failures`
- `ko_prompt_comparisons`
- `ko_ab_tests`
- `ko_analytics_snapshots`
- `ko_learning_insights`
- `ko_system_logs`

Existing tables are extended in a backward-compatible way:

- `ko_generation_records`
- `ko_prompt_templates`

## Admin APIs

- `GET /api/admin/review-center`
- `POST /api/admin/generations/:id/review`
- `POST /api/admin/generations/:id/rating`
- `GET /api/admin/generations/:id/failures`
- `POST /api/admin/generations/:id/failures`
- `POST /api/admin/prompt-comparisons`

## Rating Formula

- Print Visibility: 20%
- Design Accuracy: 20%
- Realism: 15%
- Product Authenticity: 15%
- Composition: 10%
- Marketing Appeal: 10%
- Etsy Readiness: 5%
- CTR Potential: 5%

## Compatibility

- No new AI providers.
- No generation architecture replacement.
- No cost increase in the generation path.
- New admin tables are optional for the existing user-facing generation workflow.
- Dashboard falls back gracefully if Phase 1 tables are not migrated yet.

## Next Phase

Phase 2 should replace popup admin UI with dedicated admin pages:

- Dashboard
- Generations
- Prompt Lab
- Analytics
- Learning Center
- Failures
- Users
- System
- Settings
