-- Atomic wallet debiting and withdrawal state transitions.
-- Run after the existing VickiEarn schema.

create or replace function public.create_withdrawal_request(
  p_amount_kobo bigint,
  p_account_name text,
  p_account_number text,
  p_bank_code text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_balance bigint;
  v_id uuid;
begin
  if v_user is null then raise exception 'authentication required'; end if;
  if p_amount_kobo < 500000 then raise exception 'minimum withdrawal is 5000 NGN'; end if;
  if p_account_name is null or length(trim(p_account_name)) < 2 then raise exception 'invalid account name'; end if;
  if p_account_number is null or p_account_number !~ '^[0-9]{10}$' then raise exception 'invalid account number'; end if;
  if p_bank_code is null or length(trim(p_bank_code)) = 0 then raise exception 'bank code required'; end if;

  -- Lock the wallet row so concurrent withdrawal requests cannot spend the same balance.
  select balance_kobo into v_balance from public.wallets where user_id = v_user for update;
  if v_balance is null then raise exception 'wallet not found'; end if;
  if v_balance < p_amount_kobo then raise exception 'insufficient balance'; end if;

  -- Reserve funds immediately by debiting the wallet.
  update public.wallets
    set balance_kobo = balance_kobo - p_amount_kobo,
        updated_at = now()
  where user_id = v_user;

  insert into public.withdrawals(user_id, amount_kobo, status, account_name, account_number, bank_code)
  values(v_user, p_amount_kobo, 'pending', trim(p_account_name), p_account_number, trim(p_bank_code))
  returning id into v_id;

  insert into public.transactions(user_id, type, amount_kobo, reference, description, metadata)
  values(v_user, 'withdrawal', p_amount_kobo, 'withdrawal:' || v_id, 'Withdrawal reserved', jsonb_build_object('withdrawal_id', v_id));

  return v_id;
end;
$$;

revoke all on function public.create_withdrawal_request(bigint,text,text,text) from public;
grant execute on function public.create_withdrawal_request(bigint,text,text,text) to authenticated;

create or replace function public.reject_withdrawal(
  p_withdrawal_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  w public.withdrawals;
  v_actor uuid := auth.uid();
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  select * into w from public.withdrawals where id = p_withdrawal_id for update;
  if w.id is null then raise exception 'withdrawal not found'; end if;
  if w.status not in ('pending','approved') then raise exception 'withdrawal cannot be rejected in current state'; end if;

  update public.withdrawals set status='rejected', failure_reason=coalesce(nullif(trim(p_reason),''),'Rejected by administrator'), reviewed_at=now() where id=w.id;
  update public.wallets set balance_kobo=balance_kobo+w.amount_kobo, updated_at=now() where user_id=w.user_id;
  insert into public.transactions(user_id,type,amount_kobo,reference,description,metadata)
  values(w.user_id,'withdrawal_reversal',w.amount_kobo,'withdrawal-reversal:'||w.id,'Withdrawal rejected and funds returned',jsonb_build_object('withdrawal_id',w.id,'actor_id',v_actor));
end;
$$;

revoke all on function public.reject_withdrawal(uuid,text) from public;
grant execute on function public.reject_withdrawal(uuid,text) to authenticated;

create or replace function public.approve_withdrawal(p_withdrawal_id uuid)
returns public.withdrawals
language plpgsql
security definer
set search_path = public
as $$
declare w public.withdrawals;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  select * into w from public.withdrawals where id=p_withdrawal_id for update;
  if w.id is null then raise exception 'withdrawal not found'; end if;
  if w.status <> 'pending' then raise exception 'withdrawal is not pending'; end if;
  update public.withdrawals set status='approved', reviewed_at=now() where id=w.id returning * into w;
  return w;
end;
$$;

revoke all on function public.approve_withdrawal(uuid) from public;
grant execute on function public.approve_withdrawal(uuid) to authenticated;

create or replace function public.mark_withdrawal_processing(p_withdrawal_id uuid)
returns public.withdrawals
language plpgsql
security definer
set search_path = public
as $$
declare w public.withdrawals;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  select * into w from public.withdrawals where id=p_withdrawal_id for update;
  if w.id is null or w.status <> 'approved' then raise exception 'withdrawal must be approved first'; end if;
  update public.withdrawals set status='processing' where id=w.id returning * into w;
  return w;
end;
$$;

revoke all on function public.mark_withdrawal_processing(uuid) from public;
grant execute on function public.mark_withdrawal_processing(uuid) to authenticated;

create or replace function public.complete_withdrawal(p_withdrawal_id uuid, p_paystack_reference text)
returns public.withdrawals
language plpgsql
security definer
set search_path = public
as $$
declare w public.withdrawals;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  if p_paystack_reference is null or length(trim(p_paystack_reference)) = 0 then raise exception 'Paystack reference required'; end if;
  select * into w from public.withdrawals where id=p_withdrawal_id for update;
  if w.id is null or w.status <> 'processing' then raise exception 'withdrawal must be processing'; end if;
  if exists(select 1 from public.withdrawals where paystack_reference=trim(p_paystack_reference) and id<>w.id) then raise exception 'Paystack reference already used'; end if;
  update public.withdrawals set status='paid', paystack_reference=trim(p_paystack_reference), paid_at=now() where id=w.id returning * into w;
  return w;
end;
$$;

revoke all on function public.complete_withdrawal(uuid,text) from public;
grant execute on function public.complete_withdrawal(uuid,text) to authenticated;

create or replace function public.fail_withdrawal(p_withdrawal_id uuid, p_reason text)
returns public.withdrawals
language plpgsql
security definer
set search_path = public
as $$
declare w public.withdrawals;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  select * into w from public.withdrawals where id=p_withdrawal_id for update;
  if w.id is null or w.status not in ('processing','approved') then raise exception 'withdrawal cannot be failed in current state'; end if;
  update public.withdrawals set status='failed', failure_reason=coalesce(nullif(trim(p_reason),''),'Payout failed'), reviewed_at=now() where id=w.id returning * into w;
  update public.wallets set balance_kobo=balance_kobo+w.amount_kobo, updated_at=now() where user_id=w.user_id;
  insert into public.transactions(user_id,type,amount_kobo,reference,description,metadata)
  values(w.user_id,'withdrawal_reversal',w.amount_kobo,'withdrawal-failed-reversal:'||w.id,'Failed withdrawal funds returned',jsonb_build_object('withdrawal_id',w.id));
  return w;
end;
$$;

revoke all on function public.fail_withdrawal(uuid,text) from public;
grant execute on function public.fail_withdrawal(uuid,text) to authenticated;
