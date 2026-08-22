import { serve } from 'https://deno.land/std@0.224.0/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors })

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  if (req.method !== 'POST') return json({ message: 'Not found' }, 404)
  const auth = req.headers.get('Authorization') || ''
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: auth } } })
  const { data: { user } } = await client.auth.getUser()
  if (!user) return json({ message: 'Unauthorized' }, 401)

  const body = await req.json().catch(() => null)
  const amount = Number(body?.amount_kobo)
  const accountNumber = String(body?.account_number || '')
  const bankCode = String(body?.bank_code || '')
  const accountName = String(body?.account_name || '')
  if (!Number.isSafeInteger(amount) || amount < 500000 || !/^\d{10}$/.test(accountNumber) || !bankCode || !accountName) return json({ message: 'Invalid withdrawal details' }, 400)

  const { data: withdrawalId, error: reserveError } = await client.rpc('create_withdrawal_request', {
    p_amount_kobo: amount, p_account_name: accountName, p_account_number: accountNumber, p_bank_code: bankCode
  })
  if (reserveError) return json({ message: reserveError.message }, 400)
  const { data: withdrawal, error } = await client.from('withdrawals').select('id,status,amount_kobo').eq('id', withdrawalId).single()
  if (error) return json({ message: error.message }, 500)
  return json({ ok: true, withdrawal }, 201)
})
