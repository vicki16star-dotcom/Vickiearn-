# VickiEarn Supabase setup

## 1. Create the database

Open the Supabase SQL Editor and run the complete contents of `supabase/schema.sql`.

This creates the production foundation for profiles, wallets, transactions, tasks, task completions, referrals, withdrawals and audit logs, with Row Level Security enabled.

## 2. Authentication

In Supabase, open Authentication → Providers and enable Email. Configure your production Site URL as:

`https://vicki16star-dotcom.github.io/Vickiearn-/`

Add the same URL to the allowed redirect URLs as appropriate for your authentication settings.

## 3. Create the first administrator

After registering your own account, use the Supabase SQL Editor as the project owner to promote that account:

```sql
update public.profiles
set role = 'admin'
where id = (select id from auth.users where email = 'YOUR_ADMIN_EMAIL');
```

Replace `YOUR_ADMIN_EMAIL` with the administrator's email address.

## 4. Add initial tasks

Example:

```sql
insert into public.tasks (title, description, reward_kobo)
values
('Complete a survey', 'Complete an eligible survey and submit proof.', 15000),
('Test an app', 'Test an eligible app and submit the required feedback.', 30000);
```

Amounts are stored in kobo. `15000` means ₦150.00.

## 5. Production security

Never put a Supabase service-role key, Paystack secret key, database password, or other server secret in this repository or in browser code.

The browser uses only the public Supabase URL and publishable key. Financial mutations that require trusted server-side credentials must be implemented with protected server/Edge Functions before live payouts are enabled.

## 6. Remaining production payment work

The frontend and database foundation are intentionally separated from the live payout layer. Before real withdrawals are enabled, add a server-side Paystack integration that:

- verifies authenticated users;
- validates wallet balance atomically;
- creates an idempotent withdrawal record;
- creates/uses a Paystack transfer recipient securely;
- sends the transfer using the Paystack secret key only server-side;
- verifies Paystack webhooks/signatures;
- records successful or failed payouts in `transactions`;
- prevents duplicate payouts and replayed webhooks.
