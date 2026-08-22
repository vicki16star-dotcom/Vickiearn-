import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PAYSTACK_SECRET = Deno.env.get('PAYSTACK_SECRET_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

serve(async (req) => {
  if (req.method !== 'POST' || !PAYSTACK_SECRET) return new Response('Not found', { status: 404 })
  const auth = req.headers.get('Authorization') || ''
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: auth } } })
  const { data: { user } } = await client.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const body = await req.json().catch(() => null)
  const amount = Number(body?.amount_kobo)
  const accountNumber = String(body?.account_number || '')
  const bankCode = String(body?.bank_code || '')
  const accountName = String(body?.account_name || '')
  if (!Number.isSafeInteger(amount) || amount < 500000 || !/^\d{10}$/.test(accountNumber) || !bankCode || !accountName) return new Response('Invalid withdrawal details', { status: 400 })

  const { data: wallet } = await client.from('wallets').select('balance_kobo').eq('user_id', user.id).single()
  if (!wallet || Number(wallet.balance_kobo) < amount) return new Response('Insufficient balance', { status: 400 })

  // Create a pending request first; the actual payout should be performed by an admin-approved worker.
  const { data: withdrawal, error } = await client.from('withdrawals').insert({
    user_id: user.id, amount_kobo: amount, account_name: accountName, account_number: accountNumber, bank_code: bankCode
  }).select('id,status,amount_kobo').single()
  if (error) return new Response(error.message, { status: 400 })

  return new Response(JSON.stringify({ ok: true, withdrawal }), { status: 201, headers: { 'Content-Type': 'application/json' } })
})
