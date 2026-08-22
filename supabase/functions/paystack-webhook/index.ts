import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PAYSTACK_SECRET = Deno.env.get('PAYSTACK_SECRET_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

async function hmacSha512(secret: string, body: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return [...new Uint8Array(signature)].map(b => b.toString(16).padStart(2, '0')).join('')
}

function secureEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

serve(async (req) => {
  if (req.method !== 'POST' || !PAYSTACK_SECRET) return new Response('Not found', { status: 404 })
  const raw = await req.text()
  const expected = await hmacSha512(PAYSTACK_SECRET, raw)
  const received = req.headers.get('x-paystack-signature') || ''
  if (!secureEqual(received, expected)) return new Response('Invalid signature', { status: 401 })

  let event: any
  try { event = JSON.parse(raw) } catch { return new Response('Invalid JSON', { status: 400 }) }
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  if (event.event === 'charge.success') {
    const data = event.data || {}
    const reference = String(data.reference || '')
    const amount = Number(data.amount || 0)
    const userId = data.metadata?.user_id
    if (!reference || !userId || !Number.isSafeInteger(amount) || amount <= 0) return new Response('Invalid event', { status: 400 })

    const { error } = await supabase.rpc('credit_verified_deposit', {
      p_reference: `paystack:${reference}`,
      p_amount_kobo: amount,
      p_user_id: userId,
      p_paystack_reference: reference
    })
    if (error) return new Response('Deposit processing failed', { status: 500 })
  }
  return new Response('OK', { status: 200 })
})
