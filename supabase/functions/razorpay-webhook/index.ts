import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Razorpay Webhook Handler — LCO CONNECT
 * 
 * Receives Razorpay webhook events, validates signature,
 * and processes payment.captured events idempotently.
 * 
 * This endpoint does NOT require JWT auth — it uses
 * Razorpay webhook signature verification instead.
 */

Deno.serve(async (request) => {
  // Webhooks are POST only
  if (request.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'content-type, x-razorpay-signature',
      },
    });
  }

  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

  try {
    const url = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = getSupabaseKey('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEYS');
    const webhookSecret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET') || Deno.env.get('RAZORPAY_KEY_SECRET');

    if (!url || !serviceRoleKey) {
      console.error('razorpay-webhook: missing platform config.');
      return reply({ error: 'Server configuration error.' }, 500);
    }

    if (!webhookSecret) {
      console.error('razorpay-webhook: missing webhook secret.');
      return reply({ error: 'Webhook is not configured.' }, 500);
    }

    // ── 1. Read Raw Body and Signature ──
    const rawBody = await request.text();
    const receivedSignature = request.headers.get('x-razorpay-signature') || '';

    if (!receivedSignature) {
      console.error('razorpay-webhook: no signature header.');
      return reply({ error: 'Missing webhook signature.' }, 400);
    }

    // ── 2. Validate Webhook Signature ──
    const expectedSignature = await generateHmacSha256(rawBody, webhookSecret);

    if (expectedSignature !== receivedSignature) {
      console.error('razorpay-webhook: signature mismatch.');
      return reply({ error: 'Invalid webhook signature.' }, 400);
    }

    // ── 3. Parse Event ──
    let event: any;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return reply({ error: 'Invalid JSON body.' }, 400);
    }

    const eventType = event.event;
    console.log(`razorpay-webhook: received event: ${eventType}`);

    // ── 4. Only process payment.captured ──
    if (eventType !== 'payment.captured') {
      // Acknowledge other events without processing
      return reply({ ok: true, message: `Event ${eventType} acknowledged but not processed.` });
    }

    const paymentEntity = event.payload?.payment?.entity;
    if (!paymentEntity) {
      console.error('razorpay-webhook: no payment entity in payload.');
      return reply({ error: 'Invalid payment payload.' }, 400);
    }

    const razorpayPaymentId = paymentEntity.id;
    const razorpayOrderId = paymentEntity.order_id;
    const amountInPaise = paymentEntity.amount;
    const paymentStatus = paymentEntity.status;

    if (!razorpayPaymentId || !razorpayOrderId || !amountInPaise) {
      console.error('razorpay-webhook: incomplete payment data.');
      return reply({ error: 'Incomplete payment data.' }, 400);
    }

    if (paymentStatus !== 'captured') {
      console.log(`razorpay-webhook: skipping non-captured payment: ${paymentStatus}`);
      return reply({ ok: true, message: 'Payment not captured, skipping.' });
    }

    const paidAmountRupees = amountInPaise / 100;

    // ── 5. Supabase Admin Client ──
    const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

    // ── 6. Check for Duplicate Processing (Idempotent) ──
    const { data: existingPayment } = await admin
      .from('customer_payments')
      .select('id, payment_number')
      .eq('gateway_payment_id', razorpayPaymentId)
      .maybeSingle();

    if (existingPayment) {
      console.log(`razorpay-webhook: payment ${razorpayPaymentId} already processed as ${existingPayment.payment_number}`);
      return reply({ ok: true, message: 'Payment already processed.', duplicate: true });
    }

    // ── 7. Find Bill by Razorpay Order Receipt (bill_number) ──
    // The order was created with receipt = bill_number
    // We need to look up the order to find the receipt/bill
    const notes = paymentEntity.notes || {};
    const billId = notes.bill_id;

    if (!billId) {
      console.error('razorpay-webhook: no bill_id in payment notes.');
      // Try to find by matching the order_id somewhere — fallback
      return reply({ error: 'Cannot identify associated bill.' }, 400);
    }

    // ── 8. Fetch Bill ──
    const { data: bill, error: billError } = await admin
      .from('customer_bills')
      .select('id, bill_number, lco_id, customer_id, amount, paid_amount, status, customers(full_name, customer_id)')
      .eq('id', billId)
      .single();

    if (billError || !bill) {
      console.error('razorpay-webhook: bill not found for id:', billId);
      return reply({ error: 'Associated bill not found.' }, 404);
    }

    // ── 9. Verify Bill is Still Payable ──
    if (bill.status === 'PAID') {
      console.log(`razorpay-webhook: bill ${bill.bill_number} already PAID.`);
      return reply({ ok: true, message: 'Bill already fully paid.' });
    }

    if (bill.status === 'CANCELLED') {
      console.error(`razorpay-webhook: bill ${bill.bill_number} is CANCELLED, cannot process payment.`);
      return reply({ error: 'Bill is cancelled.' }, 409);
    }

    // ── 10. Verify Amount ──
    const outstandingAmount = Number(bill.amount) - Number(bill.paid_amount);

    if (paidAmountRupees > outstandingAmount + 0.01) {
      console.error(`razorpay-webhook: payment ₹${paidAmountRupees} exceeds outstanding ₹${outstandingAmount} for bill ${bill.bill_number}`);
      // Still process but cap at outstanding
    }

    const effectivePayment = Math.min(paidAmountRupees, outstandingAmount);

    // ── 11. Generate Payment Number ──
    const { data: payNumResult } = await admin.rpc('generate_payment_number');
    const paymentNumber = payNumResult || `PAY-${new Date().getFullYear()}-WH`;

    // ── 12. Insert Payment Record ──
    const { error: insertError } = await admin
      .from('customer_payments')
      .insert({
        payment_number: paymentNumber,
        lco_id: bill.lco_id,
        customer_id: bill.customer_id,
        bill_id: bill.id,
        amount: effectivePayment,
        payment_method: 'ONLINE',
        payment_date: new Date().toISOString(),
        transaction_reference: razorpayPaymentId,
        gateway: 'razorpay',
        gateway_order_id: razorpayOrderId,
        gateway_payment_id: razorpayPaymentId,
        gateway_signature: receivedSignature,
      });

    if (insertError) {
      if (insertError.code === '23505') {
        // Unique constraint violation — duplicate
        console.log('razorpay-webhook: duplicate insert prevented by constraint.');
        return reply({ ok: true, message: 'Payment already recorded.', duplicate: true });
      }

      console.error('razorpay-webhook: insert error:', insertError);
      return reply({ error: 'Failed to record payment.' }, 500);
    }

    // ── 13. Update Bill ──
    const newPaidAmount = Number(bill.paid_amount) + effectivePayment;
    const newStatus = newPaidAmount >= Number(bill.amount) ? 'PAID' : 'PENDING';

    const { error: updateError } = await admin
      .from('customer_bills')
      .update({
        paid_amount: Math.min(newPaidAmount, Number(bill.amount)),
        status: newStatus,
      })
      .eq('id', bill.id);

    if (updateError) {
      console.error('razorpay-webhook: bill update error:', updateError);
    }

    // ── 14. Create Dual Notifications (CUSTOMER + LCO_ADMIN) ──
    try {
      const custObj = (bill as any).customers || {};
      const custName = custObj.full_name || 'Customer';
      const custCode = custObj.customer_id || 'ID';

      await admin.from('notifications').insert([
        {
          lco_id: bill.lco_id,
          customer_id: bill.customer_id,
          technician_id: null,
          recipient_role: 'CUSTOMER',
          title: 'Payment Received',
          message: `Payment of ₹${effectivePayment.toFixed(2)} received for bill ${bill.bill_number}. Payment #: ${paymentNumber}. Bill status: ${newStatus}.`,
          type: 'SUCCESS',
        },
        {
          lco_id: bill.lco_id,
          customer_id: null,
          technician_id: null,
          recipient_role: 'LCO_ADMIN',
          title: 'Payment Received',
          message: `Payment of ₹${effectivePayment.toFixed(2)} received from customer ${custName} (${custCode}) for bill ${bill.bill_number} via Razorpay Webhook. Payment #: ${paymentNumber}`,
          type: 'SUCCESS',
        },
      ]);
    } catch (notifErr) {
      console.error('razorpay-webhook: notification failed:', notifErr);
    }

    console.log(`razorpay-webhook: processed payment ${razorpayPaymentId} → ${paymentNumber} for bill ${bill.bill_number}`);

    return reply({
      ok: true,
      message: 'Payment processed successfully.',
      payment_number: paymentNumber,
      bill_status: newStatus,
    });

  } catch (error) {
    console.error('razorpay-webhook error:', error instanceof Error ? error.message : error);
    return reply({ error: 'Webhook processing failed.' }, 500);
  }
});


/**
 * Generate HMAC-SHA256 hex digest using Web Crypto API.
 */
async function generateHmacSha256(data: string, key: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(key);
  const msgData = encoder.encode(data);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}


function getSupabaseKey(legacyName: string, keyMapName: string) {
  const legacyValue = Deno.env.get(legacyName);
  if (legacyValue) return legacyValue;

  try {
    const keyMap = JSON.parse(Deno.env.get(keyMapName) || '{}');
    return typeof keyMap.default === 'string' ? keyMap.default : undefined;
  } catch {
    console.error(`Unable to read ${keyMapName}.`);
    return undefined;
  }
}
