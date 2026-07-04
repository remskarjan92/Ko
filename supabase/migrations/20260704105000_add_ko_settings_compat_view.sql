begin;

create or replace view public.ko_settings as
select
  setting_key,
  setting_value,
  updated_at
from public.ko_platform_settings;

grant select on public.ko_settings to service_role;

commit;
