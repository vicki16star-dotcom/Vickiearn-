import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SECRET = Deno.env.get('PAYSTACK_SECRET_KEY')
const URL = Deno.env.get('SUPABASE_URL')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

async function paystack(path: string, body: unknown) {
  return fetch(`https://api.paystack.co${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

serve(async (req) => {
  if (req.method !== 'POST' || !SECRET) return new Response('Not found', { status: 404 })
  const supabase = createClient(URL, SERVICE)
  const { data: { user } } = await supabase.auth.getUser(req.headers.get('Authorization') || '')
  if (!user) return new Response('Unauthorized', { status: 401 })
  const { data: admin } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (admin?.role !== 'admin') return new Response('Forbidden', { status: 403 })

  const body = await req.json().catch(() => null)
  const withdrawalId = body?.withdrawal_id
  if (!withdrawalId) return new Response('withdrawal_id required', { status: 400 })

  const { data: withdrawal } = await supabase.from('withdrawals').select('*').eq('id', withdrawalId).single()
  if (!withdrawal || withdrawal.status !== 'approved') return new Response('Withdrawal must be approved', { status: 400 })

  // Create a Paystack recipient for this payout.
  const recipientResponse = await paystack('/transferrecipient', {
    type: 'nuban',
    name: withdrawal.account_name,
    account_number: withdrawal.account_number,
    bank_code: withdrawal.bank_code,
    currency: 'NGN'
  })
  const recipient = await recipientResponse.json()
  if (!recipient.status || !recipient.data?.recipient_code) return new Response(JSON.stringify(recipient), { status: 400 })

  const processing = await supabase.rpc('mark_withdrawal_processing', { p_withdrawal_id: withdrawalId })
  if (processing.error) return new Response(processing.error.message, { status: 409 })

  const transferResponse = await paystack('/transfer', {
    source: 'balance',
    amount: withdrawal.amount_kobo,
    recipient: recipient.data.recipient_code,
    reason: `VickiEarn withdrawal ${withdrawalId}`
  })
  const transfer = await transferResponse.json()
  if (!transfer.status || !transfer.data?.reference) {
    await supabase.rpc('fail_withdrawal', { p_withdrawal_id: withdrawalId, p_reason: transfer.message || 'Paystack transfer failed' })
    return new Response(JSON.stringify(transfer), { status: 400 })
  }

  await supabase.rpc('complete_withdrawal', { p_withdrawal_id: withdrawalId, p_paystack_reference: transfer.data.reference })
  return new Response(JSON.stringify({ ok: true, reference: transfer.data.reference }), { status: 200, headers: { 'Content-Type': 'application/json' } })
})
