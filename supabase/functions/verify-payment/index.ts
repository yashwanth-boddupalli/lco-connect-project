import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

  try {
    // ── 1. Require Authentication ──
    const authorization = request.headers.get('Authorization');
    if (!authorization) return reply({ error: 'Authentication is required.' }, 401);

    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = getSupabaseKey('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEYS');
    const serviceRoleKey = getSupabaseKey('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEYS');
    const razorpayKeySecret = Deno.env.get('RAZORPAY_KEY_SECRET');

    if (!url || !anonKey || !serviceRoleKey) {
      console.error('verify-payment: missing platform config.');
      return reply({ error: 'Server configuration error.' }, 500);
    }

    if (!razorpayKeySecret) {
      console.error('verify-payment: missing Razorpay secret.');
      return reply({ error: 'Payment verification is not configured.' }, 500);
    }

    // ── 2. Verify Caller Identity (Customer) ──
    const callerClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });

    const { data: { user: callerUser }, error: userError } = await callerClient.auth.getUser();
    if (userError || !callerUser) return reply({ error: 'Invalid or expired session.' }, 401);

    const { data: callerProfile } = await callerClient
      .from('profiles')
      .select('role, status')
      .eq('id', callerUser.id)
      .single();

    if (!callerProfile || callerProfile.role !== 'CUSTOMER' || callerProfile.status !== 'ACTIVE') {
      return reply({ error: 'Only active customers can verify payments.' }, 403);
    }

    // ── 3. Get Customer Record ──
    const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

    const { data: customer, error: custError } = await admin
      .from('customers')
      .select('id, lco_id, full_name, customer_id')
      .eq('user_id', callerUser.id)
      .single();

    if (custError || !customer) {
      return reply({ error: 'Customer record not found.' }, 404);
    }

    // ── 4. Parse Request ──
    const payload = await request.json();
    const razorpayOrderId = String(payload.razorpay_order_id || '').trim();
    const razorpayPaymentId = String(payload.razorpay_payment_id || '').trim();
    const razorpaySignature = String(payload.razorpay_signature || '').trim();
    const billId = String(payload.bill_id || '').trim();

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature || !billId) {
      return reply({ error: 'Missing payment verification fields.' }, 400);
    }

    // ── 5. Verify Razorpay Signature ──
    const razorpayKeyId = Deno.env.get('RAZORPAY_KEY_ID') || '';

    const expectedSignature = await generateHmacSha256(
      `${razorpayOrderId}|${razorpayPaymentId}`,
      razorpayKeySecret
    );

    if (expectedSignature !== razorpaySignature) {
      console.error('verify-payment: signature mismatch for order', razorpayOrderId);
      return reply({ error: 'Payment signature verification failed.' }, 400);
    }

    // ── 6. Fetch and Verify Bill ──
    const { data: bill, error: billError } = await admin
      .from('customer_bills')
      .select('id, bill_number, lco_id, customer_id, amount, paid_amount, status')
      .eq('id', billId)
      .single();

    if (billError || !bill) {
      return reply({ error: 'Bill not found.' }, 404);
    }

    if (bill.customer_id !== customer.id) {
      console.error(`verify-payment: customer ${customer.id} tried to verify payment for bill ${billId} belonging to ${bill.customer_id}`);
      return reply({ error: 'Access denied.' }, 403);
    }

    if (bill.status === 'PAID') {
      return reply({ ok: true, message: 'Bill is already paid.', already_paid: true });
    }

    if (bill.status === 'CANCELLED') {
      return reply({ error: 'Bill has been cancelled.' }, 409);
    }

    // ── 7. Check for Duplicate Payment (idempotent) ──
    const { data: existingPayment } = await admin
      .from('customer_payments')
      .select('id, payment_number')
      .eq('gateway_payment_id', razorpayPaymentId)
      .maybeSingle();

    if (existingPayment) {
      // Already processed — return success (idempotent)
      return reply({
        ok: true,
        message: 'Payment already recorded.',
        payment_number: existingPayment.payment_number,
        duplicate: true,
      });
    }

    // ── 8. Verify Payment Amount with Razorpay API ──
    const razorpayAuth = btoa(`${razorpayKeyId}:${razorpayKeySecret}`);

    const paymentCheckResponse = await fetch(`https://api.razorpay.com/v1/payments/${razorpayPaymentId}`, {
      headers: { 'Authorization': `Basic ${razorpayAuth}` },
    });

    if (!paymentCheckResponse.ok) {
      console.error('verify-payment: failed to fetch payment from Razorpay');
      return reply({ error: 'Could not verify payment with gateway.' }, 502);
    }

    const razorpayPayment = await paymentCheckResponse.json();

    if (razorpayPayment.status !== 'captured') {
      console.error('verify-payment: payment not captured, status:', razorpayPayment.status);
      return reply({ error: 'Payment has not been captured. Status: ' + razorpayPayment.status }, 400);
    }

    const paidAmountRupees = razorpayPayment.amount / 100;
    const outstandingAmount = Number(bill.amount) - Number(bill.paid_amount);

    // Verify amount does not exceed outstanding
    if (paidAmountRupees > outstandingAmount + 0.01) {
      console.error('verify-payment: payment amount exceeds outstanding balance');
      return reply({ error: 'Payment amount exceeds outstanding balance.' }, 400);
    }

    // ── 9. Generate Payment Number ──
    const { data: payNumResult } = await admin.rpc('generate_payment_number');
    const paymentNumber = payNumResult || `PAY-${new Date().getFullYear()}-FALLBACK`;

    // ── 10. Insert Payment Record ──
    const { data: newPayment, error: insertError } = await admin
      .from('customer_payments')
      .insert({
        payment_number: paymentNumber,
        lco_id: bill.lco_id,
        customer_id: customer.id,
        bill_id: bill.id,
        amount: paidAmountRupees,
        payment_method: 'ONLINE',
        payment_date: new Date().toISOString(),
        transaction_reference: razorpayPaymentId,
        recorded_by: callerUser.id,
        gateway: 'razorpay',
        gateway_order_id: razorpayOrderId,
        gateway_payment_id: razorpayPaymentId,
        gateway_signature: razorpaySignature,
      })
      .select('id, payment_number')
      .single();

    if (insertError) {
      // Could be a unique constraint violation (duplicate) — handle gracefully
      if (insertError.code === '23505') {
        return reply({ ok: true, message: 'Payment already recorded.', duplicate: true });
      }
      console.error('verify-payment: insert error:', insertError);
      return reply({ error: 'Failed to record payment.' }, 500);
    }

    // ── 11. Update Bill paid_amount and status ──
    const newPaidAmount = Number(bill.paid_amount) + paidAmountRupees;
    const newStatus = newPaidAmount >= Number(bill.amount) ? 'PAID' : 'PENDING';

    const { error: updateError } = await admin
      .from('customer_bills')
      .update({
        paid_amount: Math.min(newPaidAmount, Number(bill.amount)),
        status: newStatus,
      })
      .eq('id', bill.id);

    if (updateError) {
      console.error('verify-payment: bill update error:', updateError);
      // Payment was already recorded, so we don't fail — the webhook will catch up
    }

    // ── 12. Create Notification for Customer ──
    try {
      await admin.from('notifications').insert({
        lco_id: bill.lco_id,
        customer_id: customer.id,
        title: 'Payment Received',
        message: `Your payment of ₹${paidAmountRupees.toFixed(2)} for bill ${bill.bill_number} has been verified and recorded successfully. Payment #: ${paymentNumber}`,
        type: 'SUCCESS',
      });
    } catch (notifErr) {
      console.error('verify-payment: notification insert failed:', notifErr);
    }

    return reply({
      ok: true,
      message: 'Payment verified and recorded successfully.',
      payment_number: newPayment?.payment_number || paymentNumber,
      bill_status: newStatus,
      paid_amount: Math.min(newPaidAmount, Number(bill.amount)),
    });

  } catch (error) {
    console.error('verify-payment error:', error instanceof Error ? error.message : error);
    return reply({ error: 'Payment verification failed.' }, 500);
  }
});


/**
 * Generate HMAC-SHA256 hex digest using Web Crypto API (Deno-compatible).
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
