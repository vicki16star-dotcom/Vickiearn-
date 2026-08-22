-- VickiEarn production hardening migration.
-- Adds the task workflow and the withdrawal state helpers used by the Edge Functions.

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,
  reward_kobo bigint not null check (reward_kobo > 0),
  status text not null default 'active' check (status in ('active','paused','archived')),
  max_completions integer check (max_completions is null or max_completions > 0),
  completion_count integer not null default 0 check (completion_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.task_completions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  proof jsonb not null default '{}'::jsonb,
  reward_transaction_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique(task_id,user_id)
);

alter table public.tasks enable row level security;
alter table public.task_completions enable row level security;

drop policy if exists tasks_active_select on public.tasks;
create policy tasks_active_select on public.tasks for select to authenticated using (status = 'active' or public.is_admin());

drop policy if exists task_completions_self_select on public.task_completions;
create policy task_completions_self_select on public.task_completions for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists task_completions_self_insert on public.task_completions;
create policy task_completions_self_insert on public.task_completions for insert to authenticated with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.tasks t
    where t.id = task_id
      and t.status = 'active'
      and (t.max_completions is null or t.completion_count < t.max_completions)
  )
);

create index if not exists tasks_status_created_idx on public.tasks(status, created_at desc);
create index if not exists task_completions_user_created_idx on public.task_completions(user_id, created_at desc);

create or replace function public.approve_task_completion(p_completion_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare c public.task_completions; t public.tasks; tx uuid;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  select * into c from public.task_completions where id=p_completion_id for update;
  if c.id is null or c.status <> 'pending' then raise exception 'invalid completion'; end if;
  select * into t from public.tasks where id=c.task_id for update;
  if t.id is null or t.status <> 'active' then raise exception 'task is not active'; end if;
  if t.max_completions is not null and t.completion_count >= t.max_completions then raise exception 'task limit reached'; end if;
  insert into public.transactions(user_id,type,amount_kobo,reference,description,metadata)
  values(c.user_id,'task_reward',t.reward_kobo,'task:'||c.id,'Task reward',jsonb_build_object('task_id',t.id,'completion_id',c.id)) returning id into tx;
  update public.wallets set balance_kobo=balance_kobo+t.reward_kobo,lifetime_earned_kobo=lifetime_earned_kobo+t.reward_kobo,updated_at=now() where user_id=c.user_id;
  if not found then raise exception 'wallet not found'; end if;
  update public.task_completions set status='approved',reward_transaction_id=tx,reviewed_at=now() where id=c.id;
  update public.tasks set completion_count=completion_count+1,updated_at=now() where id=t.id;
end;
$$;
grant execute on function public.approve_task_completion(uuid) to authenticated;

create or replace function public.reject_task_completion(p_completion_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  update public.task_completions set status='rejected',reviewed_at=now() where id=p_completion_id and status='pending';
  if not found then raise exception 'invalid completion'; end if;
end;
$$;
grant execute on function public.reject_task_completion(uuid) to authenticated;

create or replace function public.credit_verified_deposit(p_reference text,p_amount_kobo bigint,p_user_id uuid,p_paystack_reference text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare inserted boolean := false;
begin
  if p_user_id is null or p_amount_kobo < 1 or nullif(trim(p_reference),'') is null then raise exception 'invalid deposit'; end if;
  if not exists(select 1 from auth.users where id=p_user_id) then raise exception 'user not found'; end if;
  insert into public.transactions(user_id,type,amount_kobo,reference,description,metadata)
  values(p_user_id,'deposit',p_amount_kobo,trim(p_reference),'Verified Paystack payment',jsonb_build_object('source','paystack','paystack_reference',p_paystack_reference))
  on conflict(reference) do nothing;
  if found then
    inserted := true;
    update public.wallets set balance_kobo=balance_kobo+p_amount_kobo,lifetime_earned_kobo=lifetime_earned_kobo+p_amount_kobo,updated_at=now() where user_id=p_user_id;
    if not found then raise exception 'wallet not found'; end if;
  end if;
  return jsonb_build_object('credited',inserted,'reference',trim(p_reference),'amount_kobo',p_amount_kobo);
end;
$$;
revoke all on function public.credit_verified_deposit(text,bigint,uuid,text) from public;
grant execute on function public.credit_verified_deposit(text,bigint,uuid,text) to service_role;

create or replace function public.approve_withdrawal(p_withdrawal_id uuid)
returns public.withdrawals language plpgsql security definer set search_path=public as $$
declare w public.withdrawals;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  select * into w from public.withdrawals where id=p_withdrawal_id for update;
  if w.id is null or w.status <> 'pending' then raise exception 'withdrawal is not pending'; end if;
  update public.withdrawals set status='approved',reviewed_at=now() where id=w.id returning * into w;
  return w;
end;
$$;
grant execute on function public.approve_withdrawal(uuid) to authenticated;

create or replace function public.mark_withdrawal_processing(p_withdrawal_id uuid)
returns public.withdrawals language plpgsql security definer set search_path=public as $$
declare w public.withdrawals;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  select * into w from public.withdrawals where id=p_withdrawal_id for update;
  if w.id is null or w.status <> 'approved' then raise exception 'withdrawal must be approved first'; end if;
  update public.withdrawals set status='processing' where id=w.id returning * into w;
  return w;
end;
$$;
grant execute on function public.mark_withdrawal_processing(uuid) to authenticated;

create or replace function public.complete_withdrawal(p_withdrawal_id uuid,p_paystack_reference text)
returns public.withdrawals language plpgsql security definer set search_path=public as $$
declare w public.withdrawals;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  if nullif(trim(p_paystack_reference),'') is null then raise exception 'Paystack reference required'; end if;
  select * into w from public.withdrawals where id=p_withdrawal_id for update;
  if w.id is null or w.status <> 'processing' then raise exception 'withdrawal must be processing'; end if;
  if exists(select 1 from public.withdrawals where paystack_reference=trim(p_paystack_reference) and id<>w.id) then raise exception 'Paystack reference already used'; end if;
  update public.withdrawals set status='paid',paystack_reference=trim(p_paystack_reference),paid_at=now() where id=w.id returning * into w;
  return w;
end;
$$;
grant execute on function public.complete_withdrawal(uuid,text) to authenticated;

create or replace function public.fail_withdrawal(p_withdrawal_id uuid,p_reason text)
returns public.withdrawals language plpgsql security definer set search_path=public as $$
declare w public.withdrawals;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  select * into w from public.withdrawals where id=p_withdrawal_id for update;
  if w.id is null or w.status not in ('processing','approved') then raise exception 'withdrawal cannot be failed in current state'; end if;
  update public.withdrawals set status='failed',failure_reason=coalesce(nullif(trim(p_reason),''),'Payout failed'),reviewed_at=now() where id=w.id returning * into w;
  update public.wallets set balance_kobo=balance_kobo+w.amount_kobo,updated_at=now() where user_id=w.user_id;
  insert into public.transactions(user_id,type,amount_kobo,reference,description,metadata)
  values(w.user_id,'withdrawal_reversal',w.amount_kobo,'withdrawal-failed-reversal:'||w.id,'Failed withdrawal funds returned',jsonb_build_object('withdrawal_id',w.id));
  return w;
end;
$$;
grant execute on function public.fail_withdrawal(uuid,text) to authenticated;

create or replace function public.reject_withdrawal(p_withdrawal_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare w public.withdrawals;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  select * into w from public.withdrawals where id=p_withdrawal_id for update;
  if w.id is null or w.status not in ('pending','approved') then raise exception 'withdrawal cannot be rejected in current state'; end if;
  update public.withdrawals set status='rejected',failure_reason=coalesce(nullif(trim(p_reason),''),'Rejected by administrator'),reviewed_at=now() where id=w.id;
  update public.wallets set balance_kobo=balance_kobo+w.amount_kobo,updated_at=now() where user_id=w.user_id;
  insert into public.transactions(user_id,type,amount_kobo,reference,description,metadata)
  values(w.user_id,'withdrawal_reversal',w.amount_kobo,'withdrawal-reversal:'||w.id,'Withdrawal rejected and funds returned',jsonb_build_object('withdrawal_id',w.id));
end;
$$;
grant execute on function public.reject_withdrawal(uuid,text) to authenticated;
