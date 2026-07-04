begin;

-- Atomic credit adjustment helper.
-- This locks the user row, prevents negative balances, and writes the ledger
-- entry in the same transaction so admin adjustments and generation charges
-- cannot race each other.
create or replace function public.ko_adjust_user_credits(
  p_user_id uuid,
  p_delta integer,
  p_action text,
  p_metadata jsonb default '{}'::jsonb,
  p_credit_type text default 'standard'
) returns table (
  balance_after integer,
  transaction_id uuid,
  credits_added integer,
  credits_removed integer,
  action text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_balance integer;
  v_next_balance integer;
  v_transaction_id uuid;
begin
  if p_delta is null then
    raise exception 'Delta is required';
  end if;

  if p_action is null or btrim(p_action) = '' then
    raise exception 'Action is required';
  end if;

  select credits_balance
    into v_current_balance
    from public.ko_users
   where id = p_user_id
   for update;

  if not found then
    raise exception 'User not found';
  end if;

  v_current_balance := coalesce(v_current_balance, 0);
  v_next_balance := v_current_balance + p_delta;

  if v_next_balance < 0 then
    raise exception 'Insufficient credits';
  end if;

  update public.ko_users
     set credits_balance = v_next_balance,
         updated_at = now()
   where id = p_user_id;

  insert into public.ko_credit_transactions (
    user_id,
    action,
    credit_type,
    credits_added,
    credits_removed,
    balance_after,
    metadata
  ) values (
    p_user_id,
    p_action,
    coalesce(nullif(btrim(p_credit_type), ''), 'standard'),
    greatest(p_delta, 0),
    greatest(-p_delta, 0),
    v_next_balance,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_transaction_id;

  return query
  select
    v_next_balance,
    v_transaction_id,
    greatest(p_delta, 0),
    greatest(-p_delta, 0),
    p_action;
end;
$$;

revoke all on function public.ko_adjust_user_credits(uuid, integer, text, jsonb, text) from public;
grant execute on function public.ko_adjust_user_credits(uuid, integer, text, jsonb, text) to service_role;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'ko_users_credits_balance_nonnegative'
       and conrelid = 'public.ko_users'::regclass
  ) then
    alter table public.ko_users
      add constraint ko_users_credits_balance_nonnegative
      check (credits_balance >= 0)
      not valid;
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conname = 'ko_credit_transactions_balance_after_nonnegative'
       and conrelid = 'public.ko_credit_transactions'::regclass
  ) then
    alter table public.ko_credit_transactions
      add constraint ko_credit_transactions_balance_after_nonnegative
      check (balance_after >= 0)
      not valid;
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conname = 'ko_credit_transactions_amounts_nonnegative'
       and conrelid = 'public.ko_credit_transactions'::regclass
  ) then
    alter table public.ko_credit_transactions
      add constraint ko_credit_transactions_amounts_nonnegative
      check (credits_added >= 0 and credits_removed >= 0)
      not valid;
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conname = 'ko_generation_records_credits_used_nonnegative'
       and conrelid = 'public.ko_generation_records'::regclass
  ) then
    alter table public.ko_generation_records
      add constraint ko_generation_records_credits_used_nonnegative
      check (credits_used >= 0)
      not valid;
  end if;
end $$;

commit;
