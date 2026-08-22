# VickiEarn production setup

## 1. Database

The live Supabase project already contains the authentication/profile/wallet foundation, RLS policies, task tables, task-completion workflow, referral tables, transaction ledger, and withdrawal state functions.

The repository keeps the reproducible SQL under `supabase/schema.sql` and `supabase/migrations/`.

## 2. Authentication

Enable Email authentication in Supabase and configure the production Site URL and allowed redirect URL to the live site. The intended GitHub Pages URL is:

`https://vicki16star-dotcom.github.io/Vickiearn-/`

The frontend sends `full_name` and an optional referral code through Supabase Auth metadata. A database trigger creates the profile and wallet automatically after signup.

## 3. Administrator

After registering the first administrator account, promote it from the Supabase SQL Editor:

```sql
update public.profiles
set role = 'admin'
where id = (select id from auth.users where email = 'YOUR_ADMIN_EMAIL');
```

## 4. Tasks

The task tables and secure completion/approval functions are deployed. No active tasks are seeded automatically because task rewards should only be created after the platform has confirmed the task source, proof requirements, reward amount, and funding.

Example task creation:

```sql
insert into public.tasks (title, description, reward_kobo)
values ('Complete an approved survey', 'Complete the eligible survey and submit proof.', 15000);
```

`15000` means ₦150.00.

## 5. Payments and withdrawals

The repository contains Supabase Edge Functions for Paystack initialization, webhook verification, withdrawal reservation, and admin payout transfer. The database contains atomic wallet reservation/refund/state-transition functions and an idempotent verified-deposit credit function.

Before enabling real money, confirm that the Supabase Edge Function secrets are configured with the intended **live** Paystack credentials:

- `PAYSTACK_SECRET_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Never put either secret in browser code or GitHub.

## 6. Deployment

`main` contains a GitHub Pages workflow at `.github/workflows/pages.yml`, which deploys the static site on every push to `main`. The Supabase Edge Function workflow deploys the Paystack functions when their source changes.

The site should be tested from the actual live deployment URL before public launch. Do not rely on an old Vercel URL if its deployment has been removed.
