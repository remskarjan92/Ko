begin;

grant usage on schema public to service_role;

grant select, insert, update, delete on table public.ko_users to service_role;
grant select, insert, update, delete on table public.ko_credit_transactions to service_role;
grant select, insert, update, delete on table public.ko_generation_records to service_role;
grant select, insert, update, delete on table public.ko_user_settings to service_role;
grant select, insert, update, delete on table public.ko_feature_costs to service_role;
grant select, insert, update, delete on table public.ko_ai_models to service_role;
grant select, insert, update, delete on table public.ko_prompt_templates to service_role;
grant select, insert, update, delete on table public.ko_quality_records to service_role;
grant select, insert, update, delete on table public.ko_research_items to service_role;
grant select, insert, update, delete on table public.ko_platform_settings to service_role;

grant usage, select on all sequences in schema public to service_role;

commit;
