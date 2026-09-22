import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Cashfree Webhook Handler — LCO CONNECT
 * 
 * Receives Cashfree webhook events, validates Base64-HMAC-SHA256 signature,
 * and processes PAYMENT_SUCCESS_WEBHOOK events idempotently.
 * 
 * Signature Verification:
 * Base64( HMAC-SHA256( timestamp + rawBody, CASHFREE_SECRET_KEY ) )
 * Header fields: x-webhook-signature, x-webhook-timestamp
 */

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'content-type, x-webhook-signature, x-webhook-timestamp',
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
    const webhookSecret = Deno.env.get('CASHFREE_WEBHOOK_SECRET') || Deno.env.get('CASHFREE_SECRET_KEY');

    if (!url || !serviceRoleKey) {
      console.error('cashfree-webhook: missing platform config.');
      return reply({ error: 'Server configuration error.' }, 500);
    }

    if (!webhookSecret) {
      console.error('cashfree-webhook: missing Cashfree secret.');
      return reply({ error: 'Webhook is not configured.' }, 500);
    }

    // ── 1. Read Raw Body and Signature Headers ──
    const rawBody = await request.text();
    const receivedSignature = request.headers.get('x-webhook-signature') || '';
    const receivedTimestamp = request.headers.get('x-webhook-timestamp') || '';

    if (!receivedSignature || !receivedTimestamp) {
      console.error('cashfree-webhook: missing signature or timestamp header.');
      return reply({ error: 'Missing webhook signature headers.' }, 400);
    }

    // ── 2. Validate Webhook Signature ──
    const signatureData = receivedTimestamp + rawBody;
    const expectedSignature = await generateHmacSha256Base64(signatureData, webhookSecret);

    if (expectedSignature !== receivedSignature) {
      console.error('cashfree-webhook: signature mismatch.');
      return reply({ error: 'Invalid webhook signature.' }, 400);
    }

    // ── 3. Parse Event Body ──
    let event: any;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return reply({ error: 'Invalid JSON body.' }, 400);
    }

    const eventType = event.type || event.event;
    console.log(`cashfree-webhook: received event: ${eventType}`);

    const eventData = event.data || {};
    const paymentObj = eventData.payment || {};
    const orderObj = eventData.order || {};

    const paymentStatus = paymentObj.payment_status || '';

    // Only process successful payment events
    if (eventType !== 'PAYMENT_SUCCESS_WEBHOOK' && paymentStatus !== 'SUCCESS') {
      return reply({ ok: true, message: `Event ${eventType} acknowledged but not processed.` });
    }

    const orderId = orderObj.order_id || '';
    const cfPaymentId = String(paymentObj.cf_payment_id || '');
    const paidAmountRupees = Number(paymentObj.payment_amount || orderObj.order_amount || 0);

    if (!orderId || !cfPaymentId || paidAmountRupees <= 0) {
      console.error('cashfree-webhook: incomplete payment payload data.');
      return reply({ error: 'Incomplete payment payload.' }, 400);
    }

    // ── 4. Supabase Admin Client ──
    const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

    // ── 5. Idempotency Check: check if payment already recorded ──
    const { data: existingPayment } = await admin
      .from('customer_payments')
      .select('id, payment_number')
      .or(`gateway_order_id.eq.${orderId},gateway_payment_id.eq.${cfPaymentId}`)
      .maybeSingle();

    if (existingPayment) {
      console.log(`cashfree-webhook: payment ${cfPaymentId} already processed as ${existingPayment.payment_number}`);
      return reply({ ok: true, message: 'Payment already processed (idempotent).', duplicate: true });
    }

    // ── 6. Identify Associated Bill ──
    let billId = orderObj.order_tags?.bill_id;

    // Fallback: If bill_id is not in order_tags, attempt to query Cashfree API for order details
    if (!billId) {
      const cashfreeAppId = Deno.env.get('CASHFREE_APP_ID');
      const cashfreeSecretKey = Deno.env.get('CASHFREE_SECRET_KEY');
      const cashfreeApiVersion = Deno.env.get('CASHFREE_API_VERSION') || '2023-08-01';

      if (cashfreeAppId && cashfreeSecretKey) {
        try {
          const cfRes = await fetch(`https://sandbox.cashfree.com/pg/orders/${encodeURIComponent(orderId)}`, {
            headers: {
              'x-client-id': cashfreeAppId,
              'x-client-secret': cashfreeSecretKey,
              'x-api-version': cashfreeApiVersion,
            },
          });
          if (cfRes.ok) {
            const cfOrderData = await cfRes.json();
            billId = cfOrderData.order_tags?.bill_id;
          }
        } catch (e) {
          console.error('cashfree-webhook: failed to fetch order details fallback:', e);
        }
      }
    }

    if (!billId) {
      console.error('cashfree-webhook: cannot identify associated bill_id.');
      return reply({ error: 'Cannot identify associated bill.' }, 400);
    }

    // ── 7. Fetch Bill from DB ──
    const { data: bill, error: billError } = await admin
      .from('customer_bills')
      .select('id, bill_number, lco_id, customer_id, amount, paid_amount, status, customers(full_name, customer_id)')
      .eq('id', billId)
      .single();

    if (billError || !bill) {
      console.error('cashfree-webhook: bill not found for id:', billId);
      return reply({ error: 'Associated bill not found.' }, 404);
    }

    if (bill.status === 'PAID') {
      console.log(`cashfree-webhook: bill ${bill.bill_number} is already fully PAID.`);
      return reply({ ok: true, message: 'Bill is already fully paid.' });
    }

    if (bill.status === 'CANCELLED') {
      console.error(`cashfree-webhook: bill ${bill.bill_number} is CANCELLED.`);
      return reply({ error: 'Bill is cancelled.' }, 409);
    }

    // ── 8. Calculate Effective Amount ──
    const outstandingAmount = Number(bill.amount) - Number(bill.paid_amount);
    const effectivePayment = Math.min(paidAmountRupees, outstandingAmount);

    // ── 9. Generate Payment Number ──
    const { data: payNumResult } = await admin.rpc('generate_payment_number');
    const paymentNumber = payNumResult || `PAY-${new Date().getFullYear()}-CFWH`;

    // ── 10. Insert Payment Record into customer_payments ──
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
        transaction_reference: cfPaymentId,
        gateway: 'cashfree',
        gateway_order_id: orderId,
        gateway_payment_id: cfPaymentId,
        gateway_signature: receivedSignature,
      });

    if (insertError) {
      if (insertError.code === '23505') {
        console.log('cashfree-webhook: duplicate insert prevented by unique constraint.');
        return reply({ ok: true, message: 'Payment already recorded.', duplicate: true });
      }

      console.error('cashfree-webhook: insert error:', insertError);
      return reply({ error: 'Failed to record payment.' }, 500);
    }

    // ── 11. Update Bill paid_amount and status ──
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
      console.error('cashfree-webhook: bill update error:', updateError);
    }

    // ── 12. Create Dual Notifications (CUSTOMER + LCO_ADMIN) ──
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
          message: `Payment of ₹${effectivePayment.toFixed(2)} received for bill ${bill.bill_number} via Cashfree. Payment #: ${paymentNumber}. Bill status: ${newStatus}.`,
          type: 'SUCCESS',
        },
        {
          lco_id: bill.lco_id,
          customer_id: null,
          technician_id: null,
          recipient_role: 'LCO_ADMIN',
          title: 'Payment Received',
          message: `Payment of ₹${effectivePayment.toFixed(2)} received from customer ${custName} (${custCode}) for bill ${bill.bill_number} via Cashfree Webhook. Payment #: ${paymentNumber}`,
          type: 'SUCCESS',
        },
      ]);
    } catch (notifErr) {
      console.error('cashfree-webhook: notification failed:', notifErr);
    }

    console.log(`cashfree-webhook: processed payment ${cfPaymentId} → ${paymentNumber} for bill ${bill.bill_number}`);

    return reply({
      ok: true,
      message: 'Cashfree webhook processed successfully.',
      payment_number: paymentNumber,
      bill_status: newStatus,
    });

  } catch (error) {
    console.error('cashfree-webhook error:', error instanceof Error ? error.message : error);
    return reply({ error: 'Webhook processing failed.' }, 500);
  }
});

/**
 * Generate Base64-encoded HMAC-SHA256 digest using Web Crypto API.
 */
async function generateHmacSha256Base64(data: string, key: string): Promise<string> {
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
  const bytes = new Uint8Array(signature);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
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
