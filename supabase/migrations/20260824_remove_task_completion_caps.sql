-- VickiEarn: remove per-task completion caps.
-- max_completions remains nullable for backward compatibility, but no longer limits approvals.

update public.tasks
set max_completions = null
where max_completions is not null;

drop function if exists public.approve_task_completion(uuid);

create function public.approve_task_completion(p_completion_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.task_completions;
  t public.tasks;
  tx uuid;
begin
  if not public.is_admin() then
    raise exception 'admin access required';
  end if;

  select * into c
  from public.task_completions
  where id = p_completion_id
  for update;

  if c.id is null or c.status <> 'pending' then
    raise exception 'invalid completion';
  end if;

  select * into t
  from public.tasks
  where id = c.task_id
  for update;

  if t.status <> 'active' then
    raise exception 'task is not active';
  end if;

  insert into public.transactions(user_id,type,amount_kobo,reference,description,metadata)
  values (
    c.user_id,
    'task_reward',
    t.reward_kobo,
    'task:' || c.id,
    'Task reward',
    jsonb_build_object('task_id', t.id)
  )
  returning id into tx;

  update public.wallets
  set balance_kobo = balance_kobo + t.reward_kobo,
      lifetime_earned_kobo = lifetime_earned_kobo + t.reward_kobo,
      updated_at = now()
  where user_id = c.user_id;

  update public.task_completions
  set status = 'approved',
      reward_transaction_id = tx,
      reviewed_at = now()
  where id = c.id;

  update public.tasks
  set completion_count = completion_count + 1,
      updated_at = now()
  where id = t.id;
end;
$$;
