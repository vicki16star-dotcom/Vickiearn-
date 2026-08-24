-- VickiEarn production database foundation
-- Run this entire file in Supabase SQL Editor.

create extension if not exists pgcrypto;

create type public.transaction_type as enum ('task_reward','referral_reward','deposit','withdrawal','withdrawal_reversal','adjustment');
create type public.withdrawal_status as enum ('pending','approved','processing','paid','rejected','failed');
create type public.task_status as enum ('active','paused','archived');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  referral_code text not null unique,
  referred_by uuid references public.profiles(id) on delete set null,
  role text not null default 'user' check (role in ('user','admin')),
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance_kobo bigint not null default 0 check (balance_kobo >= 0),
  lifetime_earned_kobo bigint not null default 0 check (lifetime_earned_kobo >= 0),
  updated_at timestamptz not null default now()
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type public.transaction_type not null,
  amount_kobo bigint not null check (amount_kobo > 0),
  reference text unique,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,
  reward_kobo bigint not null check (reward_kobo > 0),
  status public.task_status not null default 'active',
  max_completions integer,
  completion_count integer not null default 0 check (completion_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.task_completions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  proof jsonb not null default '{}'::jsonb,
  reward_transaction_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique(task_id, user_id)
);

create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.profiles(id) on delete cascade,
  referred_id uuid not null unique references public.profiles(id) on delete cascade,
  reward_transaction_id uuid references public.transactions(id) on delete set null,
  qualified_at timestamptz,
  created_at timestamptz not null default now(),
  check (referrer_id <> referred_id)
);

create table public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount_kobo bigint not null check (amount_kobo >= 500000),
  status public.withdrawal_status not null default 'pending',
  paystack_reference text unique,
  account_name text,
  account_number text,
  bank_code text,
  failure_reason text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  paid_at timestamptz
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target_type text,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.generate_referral_code() returns text
language plpgsql as $$
declare code text;
begin
  loop
    code := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
    exit when not exists (select 1 from public.profiles where referral_code = code);
  end loop;
  return code;
end;
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare ref_code text; referrer_id uuid; new_referral_code text;
begin
  ref_code := nullif(trim(new.raw_user_meta_data ->> 'referral_code'), '');
  select id into referrer_id from public.profiles where referral_code = upper(ref_code) limit 1;
  new_referral_code := public.generate_referral_code();

  insert into public.profiles (id, full_name, referral_code, referred_by)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'VickiEarn User'),
    new_referral_code,
    referrer_id
  );
  insert into public.wallets (user_id) values (new.id);
  if referrer_id is not null then
    insert into public.referrals (referrer_id, referred_id) values (referrer_id, new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- Task completion approval intentionally has no per-task completion cap.
create or replace function public.approve_task_completion(p_completion_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c public.task_completions; t public.tasks; tx uuid;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  select * into c from public.task_completions where id = p_completion_id for update;
  if c.id is null or c.status <> 'pending' then raise exception 'invalid completion'; end if;
  select * into t from public.tasks where id = c.task_id for update;
  if t.status <> 'active' then raise exception 'task is not active'; end if;
  insert into public.transactions(user_id,type,amount_kobo,reference,description,metadata)
  values(c.user_id,'task_reward',t.reward_kobo,'task:'||c.id,'Task reward',jsonb_build_object('task_id',t.id)) returning id into tx;
  update public.wallets set balance_kobo = balance_kobo + t.reward_kobo, lifetime_earned_kobo = lifetime_earned_kobo + t.reward_kobo, updated_at = now() where user_id = c.user_id;
  update public.task_completions set status='approved', reward_transaction_id=tx, reviewed_at=now() where id=c.id;
  update public.tasks set completion_count=completion_count+1, updated_at=now() where id=t.id;
end;
$$;

alter table public.profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.transactions enable row level security;
alter table public.tasks enable row level security;
alter table public.task_completions enable row level security;
alter table public.referrals enable row level security;
alter table public.withdrawals enable row level security;
alter table public.audit_logs enable row level security;

create policy "profiles own read" on public.profiles for select using (auth.uid() = id or public.is_admin());
create policy "profiles own update" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "wallet own read" on public.wallets for select using (auth.uid() = user_id or public.is_admin());
create policy "transactions own read" on public.transactions for select using (auth.uid() = user_id or public.is_admin());
create policy "active tasks read" on public.tasks for select using (status = 'active' or public.is_admin());
create policy "completion own read" on public.task_completions for select using (auth.uid() = user_id or public.is_admin());
create policy "completion own insert" on public.task_completions for insert with check (auth.uid() = user_id);
create policy "referrals own read" on public.referrals for select using (auth.uid() = referrer_id or auth.uid() = referred_id or public.is_admin());
create policy "withdrawals own read" on public.withdrawals for select using (auth.uid() = user_id or public.is_admin());
create policy "withdrawals own insert" on public.withdrawals for insert with check (auth.uid() = user_id);
create policy "audit admin read" on public.audit_logs for select using (public.is_admin());

create index transactions_user_created_idx on public.transactions(user_id, created_at desc);
create index completions_user_created_idx on public.task_completions(user_id, created_at desc);
create index withdrawals_user_created_idx on public.withdrawals(user_id, created_at desc);
create index referrals_referrer_idx on public.referrals(referrer_id);
