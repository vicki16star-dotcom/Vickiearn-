-- VickiEarn authentication/profile/wallet foundation.
-- Safe to run after the existing schema: objects are created only when missing.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  referral_code text unique,
  role text not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance_kobo bigint not null default 0 check (balance_kobo >= 0),
  lifetime_earned_kobo bigint not null default 0 check (lifetime_earned_kobo >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references auth.users(id) on delete cascade,
  referred_user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  amount_kobo bigint not null check (amount_kobo >= 0),
  reference text unique,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount_kobo bigint not null check (amount_kobo > 0),
  status text not null default 'pending',
  account_name text not null,
  account_number text not null,
  bank_code text not null,
  paystack_reference text unique,
  failure_reason text,
  reviewed_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists profiles_referral_code_idx on public.profiles(referral_code);
create index if not exists transactions_user_created_idx on public.transactions(user_id, created_at desc);
create index if not exists withdrawals_user_created_idx on public.withdrawals(user_id, created_at desc);
create index if not exists withdrawals_status_created_idx on public.withdrawals(status, created_at asc);

create or replace function public.make_referral_code(p_name text, p_id uuid)
returns text language plpgsql immutable as $$
declare base text; code text; suffix text;
begin
  base := upper(regexp_replace(coalesce(p_name,'USER'), '[^A-Za-z0-9]', '', 'g'));
  base := left(case when length(base) < 4 then base || 'USER' else base end, 8);
  suffix := upper(substr(replace(p_id::text,'-',''),1,6));
  code := base || suffix;
  return code;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := coalesce(new.raw_user_meta_data->>'full_name', split_part(coalesce(new.email,''),'@',1), 'User');
  v_ref text;
  v_referrer uuid;
  v_ref_code text := upper(nullif(trim(new.raw_user_meta_data->>'referral_code'),''));
begin
  v_ref := public.make_referral_code(v_name, new.id);
  insert into public.profiles(id, full_name, referral_code)
  values(new.id, v_name, v_ref)
  on conflict (id) do update set full_name=excluded.full_name;

  insert into public.wallets(user_id) values(new.id) on conflict (user_id) do nothing;

  if v_ref_code is not null then
    select id into v_referrer from public.profiles where referral_code = v_ref_code limit 1;
    if v_referrer is not null and v_referrer <> new.id then
      insert into public.referrals(referrer_id, referred_user_id)
      values(v_referrer, new.id)
      on conflict (referred_user_id) do nothing;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles where id=auth.uid() and role='admin');
$$;

alter table public.profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.referrals enable row level security;
alter table public.transactions enable row level security;
alter table public.withdrawals enable row level security;

drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles for select to authenticated using (id=auth.uid() or public.is_admin());

drop policy if exists wallets_self_select on public.wallets;
create policy wallets_self_select on public.wallets for select to authenticated using (user_id=auth.uid() or public.is_admin());

drop policy if exists referrals_self_select on public.referrals;
create policy referrals_self_select on public.referrals for select to authenticated using (referrer_id=auth.uid() or referred_user_id=auth.uid() or public.is_admin());

drop policy if exists transactions_self_select on public.transactions;
create policy transactions_self_select on public.transactions for select to authenticated using (user_id=auth.uid() or public.is_admin());

drop policy if exists withdrawals_self_select on public.withdrawals;
create policy withdrawals_self_select on public.withdrawals for select to authenticated using (user_id=auth.uid() or public.is_admin());

grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.wallets, public.referrals, public.transactions, public.withdrawals to authenticated;
