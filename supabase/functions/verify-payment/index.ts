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

    // Cashfree Sandbox Credentials
    const cashfreeAppId = Deno.env.get('CASHFREE_APP_ID');
    const cashfreeSecretKey = Deno.env.get('CASHFREE_SECRET_KEY');
    const cashfreeApiVersion = Deno.env.get('CASHFREE_API_VERSION') || '2023-08-01';

    if (!url || !anonKey || !serviceRoleKey) {
      console.error('verify-payment: missing platform config.');
      return reply({ error: 'Server configuration error.' }, 500);
    }

    if (!cashfreeAppId || !cashfreeSecretKey) {
      console.error('verify-payment: missing Cashfree credentials.');
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
    const orderId = String(payload.order_id || '').trim();
    const billId = String(payload.bill_id || '').trim();

    if (!orderId || !billId) {
      return reply({ error: 'Missing payment verification parameters (order_id, bill_id).' }, 400);
    }

    // ── 5. Fetch and Verify Bill from DB ──
    const { data: bill, error: billError } = await admin
      .from('customer_bills')
      .select('id, bill_number, lco_id, customer_id, amount, paid_amount, status')
      .eq('id', billId)
      .single();

    if (billError || !bill) {
      return reply({ error: 'Bill not found.' }, 404);
    }

    // Security & Tenant Isolation Checks
    if (bill.customer_id !== customer.id) {
      console.error(`verify-payment: customer ${customer.id} tried to verify bill ${billId} belonging to ${bill.customer_id}`);
      return reply({ error: 'Access denied. This bill does not belong to you.' }, 403);
    }

    if (bill.lco_id !== customer.lco_id) {
      console.error(`verify-payment: tenant mismatch for customer ${customer.id} on bill ${billId}`);
      return reply({ error: 'Access denied. Tenant mismatch.' }, 403);
    }

    if (bill.status === 'PAID') {
      return reply({ ok: true, message: 'Bill is already paid.', already_paid: true });
    }

    if (bill.status === 'CANCELLED') {
      return reply({ error: 'Bill has been cancelled.' }, 409);
    }

    // ── 6. Query Cashfree Server-to-Server to Verify Order Status ──
    const cfHeaders = {
      'x-client-id': cashfreeAppId,
      'x-client-secret': cashfreeSecretKey,
      'x-api-version': cashfreeApiVersion,
    };

    const orderRes = await fetch(`https://sandbox.cashfree.com/pg/orders/${encodeURIComponent(orderId)}`, {
      headers: cfHeaders,
    });

    if (!orderRes.ok) {
      const errText = await orderRes.text();
      console.error(`verify-payment: failed to fetch order ${orderId} from Cashfree: ${orderRes.status} ${errText}`);
      return reply({ error: 'Could not verify payment with Cashfree gateway.' }, 502);
    }

    const cfOrder = await orderRes.json();

    // NEVER trust browser — verify Cashfree server status is 'PAID'
    if (cfOrder.order_status !== 'PAID') {
      console.log(`verify-payment: order ${orderId} status is ${cfOrder.order_status}`);
      return reply({
        error: `Payment incomplete or pending. Gateway status: ${cfOrder.order_status}`,
        order_status: cfOrder.order_status,
      }, 400);
    }

    const paidAmountRupees = Number(cfOrder.order_amount);
    const outstandingAmount = Number(bill.amount) - Number(bill.paid_amount);

    if (paidAmountRupees > outstandingAmount + 0.01) {
      console.error(`verify-payment: payment amount ₹${paidAmountRupees} exceeds outstanding balance ₹${outstandingAmount}`);
      return reply({ error: 'Payment amount exceeds outstanding balance.' }, 400);
    }

    // ── 7. Fetch Cashfree Payment Details to Get Payment ID & Method ──
    let cfPaymentId = orderId;
    let paymentMethodStr = 'ONLINE';

    try {
      const paymentsRes = await fetch(`https://sandbox.cashfree.com/pg/orders/${encodeURIComponent(orderId)}/payments`, {
        headers: cfHeaders,
      });

      if (paymentsRes.ok) {
        const paymentsList = await paymentsRes.json();
        if (Array.isArray(paymentsList) && paymentsList.length > 0) {
          const successPayment = paymentsList.find((p: any) => p.payment_status === 'SUCCESS') || paymentsList[0];
          if (successPayment.cf_payment_id) {
            cfPaymentId = String(successPayment.cf_payment_id);
          }
          if (successPayment.payment_group) {
            paymentMethodStr = String(successPayment.payment_group).toUpperCase();
          }
        }
      }
    } catch (e) {
      console.error('verify-payment: error fetching payments list:', e);
    }

    // ── 8. Check for Duplicate Payment (Idempotent) ──
    const { data: existingPayment } = await admin
      .from('customer_payments')
      .select('id, payment_number')
      .or(`gateway_order_id.eq.${orderId},gateway_payment_id.eq.${cfPaymentId}`)
      .maybeSingle();

    if (existingPayment) {
      return reply({
        ok: true,
        message: 'Payment already recorded.',
        payment_number: existingPayment.payment_number,
        duplicate: true,
      });
    }

    // ── 9. Generate Payment Number ──
    const { data: payNumResult } = await admin.rpc('generate_payment_number');
    const paymentNumber = payNumResult || `PAY-${new Date().getFullYear()}-CF`;

    // ── 10. Insert Payment Record into customer_payments ──
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
        transaction_reference: cfPaymentId,
        recorded_by: callerUser.id,
        gateway: 'cashfree',
        gateway_order_id: orderId,
        gateway_payment_id: cfPaymentId,
        gateway_signature: null,
      })
      .select('id, payment_number')
      .single();

    if (insertError) {
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
    }

    // ── 12. Create Dual Notifications (CUSTOMER + LCO_ADMIN) ──
    try {
      await admin.from('notifications').insert([
        {
          lco_id: bill.lco_id,
          customer_id: customer.id,
          technician_id: null,
          recipient_role: 'CUSTOMER',
          title: 'Payment Received',
          message: `Your payment of ₹${paidAmountRupees.toFixed(2)} for bill ${bill.bill_number} has been verified and recorded successfully via Cashfree. Payment #: ${paymentNumber}`,
          type: 'SUCCESS',
        },
        {
          lco_id: bill.lco_id,
          customer_id: null,
          technician_id: null,
          recipient_role: 'LCO_ADMIN',
          title: 'Payment Received',
          message: `Payment of ₹${paidAmountRupees.toFixed(2)} received from customer ${customer.full_name || 'Customer'} (${customer.customer_id || 'ID'}) for bill ${bill.bill_number} via Cashfree. Payment #: ${paymentNumber}`,
          type: 'SUCCESS',
        },
      ]);
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
