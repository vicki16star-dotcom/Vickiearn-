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

serve(async (req) => {
  if (req.method !== 'POST' || !PAYSTACK_SECRET) return new Response('Not found', { status: 404 })
  const raw = await req.text()
  const expected = await hmacSha512(PAYSTACK_SECRET, raw)
  const received = req.headers.get('x-paystack-signature') || ''
  if (received.length !== expected.length || !crypto.timingSafeEqual(new TextEncoder().encode(received), new TextEncoder().encode(expected))) {
    return new Response('Invalid signature', { status: 401 })
  }

  const event = JSON.parse(raw)
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // Only verified successful charge events may credit a wallet.
  if (event.event === 'charge.success') {
    const data = event.data
    const reference = String(data.reference || '')
    const amount = Number(data.amount || 0)
    const userId = data.metadata?.user_id
    if (!reference || !userId || !Number.isSafeInteger(amount) || amount <= 0) return new Response('Invalid event', { status: 400 })

    // The unique transaction reference makes webhook retries idempotent.
    const { data: existing } = await supabase.from('transactions').select('id').eq('reference', `paystack:${reference}`).maybeSingle()
    if (!existing) {
      const { error: txError } = await supabase.from('transactions').insert({
        user_id: userId,
        type: 'deposit',
        amount_kobo: amount,
        reference: `paystack:${reference}`,
        description: 'Verified Paystack payment',
        metadata: { paystack_reference: reference, customer_email: data.customer?.email || null }
      })
      if (txError) return new Response('Transaction failed', { status: 500 })
      const { data: wallet } = await supabase.from('wallets').select('balance_kobo').eq('user_id', userId).single()
      if (!wallet) return new Response('Wallet not found', { status: 404 })
      const { error: walletError } = await supabase.from('wallets').update({ balance_kobo: Number(wallet.balance_kobo) + amount, updated_at: new Date().toISOString() }).eq('user_id', userId)
      if (walletError) return new Response('Wallet update failed', { status: 500 })
    }
  }

  return new Response('OK', { status: 200 })
})
