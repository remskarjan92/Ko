create table if not exists public.agent_logs (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null,
  input_summary text,
  output jsonb,
  result jsonb,
  status text not null default 'success',
  execution_time integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  constraint agent_logs_status_check check (status in ('success', 'error', 'skipped'))
);

create index if not exists agent_logs_agent_name_idx
  on public.agent_logs (agent_name);

create index if not exists agent_logs_status_idx
  on public.agent_logs (status);

create index if not exists agent_logs_created_at_idx
  on public.agent_logs (created_at desc);
