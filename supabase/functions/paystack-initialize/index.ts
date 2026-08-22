import { serve } from 'https://deno.land/std@0.224.0/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PAYSTACK_SECRET = Deno.env.get('PAYSTACK_SECRET_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

serve(async (req) => {
  if (req.method !== 'POST' || !PAYSTACK_SECRET) return new Response('Not found', { status: 404 })
  const auth = req.headers.get('Authorization') || ''
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: auth } } })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const body = await req.json().catch(() => null)
  const amount = Number(body?.amount_kobo)
  if (!Number.isSafeInteger(amount) || amount < 100) return new Response('Invalid amount', { status: 400 })

  const response = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: user.email,
      amount,
      metadata: { user_id: user.id },
      callback_url: body?.callback_url || undefined
    })
  })
  const result = await response.json()
  return new Response(JSON.stringify(result), { status: response.status, headers: { 'Content-Type': 'application/json' } })
})

// Automatic deployment trigger.
