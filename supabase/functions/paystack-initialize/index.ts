import { serve } from 'https://deno.land/std@0.224.0/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PAYSTACK_SECRET = Deno.env.get('PAYSTACK_SECRET_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors })

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  if (req.method !== 'POST' || !PAYSTACK_SECRET) return json({ message: 'Not found' }, 404)
  const auth = req.headers.get('Authorization') || ''
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: auth } } })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return json({ message: 'Unauthorized' }, 401)

  const body = await req.json().catch(() => null)
  const requestedAmount = Number(body?.amount_kobo)
  const tierId = typeof body?.tier_id === 'string' ? body.tier_id : null
  let amount = requestedAmount
  let tier: { id: string; name: string; amount_kobo: number } | null = null

  if (tierId) {
    const { data, error } = await supabase.from('premium_tiers').select('id,name,amount_kobo').eq('id', tierId).maybeSingle()
    if (error || !data) return json({ message: 'Premium tier not found' }, 400)
    tier = data
    amount = Number(data.amount_kobo)
    if (requestedAmount !== amount) return json({ message: 'Premium amount does not match the selected tier' }, 400)
  }

  if (!Number.isSafeInteger(amount) || amount < 100) return json({ message: 'Invalid amount' }, 400)

  const metadata = tier
    ? { user_id: user.id, purchase_type: 'premium_task_access', tier_id: tier.id, tier_name: tier.name }
    : { user_id: user.id, purchase_type: 'wallet_deposit' }

  const response = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, amount, metadata, callback_url: body?.callback_url || undefined })
  })
  const result = await response.json()
  return json(result, response.status)
})
