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
      console.error('create-payment-order: missing platform config.');
      return reply({ error: 'Server configuration error.' }, 500);
    }

    if (!cashfreeAppId || !cashfreeSecretKey) {
      console.error('create-payment-order: missing Cashfree credentials.');
      return reply({ error: 'Payment gateway is not configured.' }, 500);
    }

    // ── 2. Verify Caller Identity ──
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
      return reply({ error: 'Only active customers can create payment orders.' }, 403);
    }

    // ── 3. Get Customer Record (derive from auth, don't trust browser) ──
    const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

    const { data: customer, error: custError } = await admin
      .from('customers')
      .select('id, lco_id, full_name, email, phone, customer_id')
      .eq('user_id', callerUser.id)
      .single();

    if (custError || !customer) {
      return reply({ error: 'Customer record not found.' }, 404);
    }

    // ── 4. Parse Request (only bill_id accepted from browser) ──
    const payload = await request.json();
    const billId = String(payload.bill_id || '').trim();

    if (!billId) {
      return reply({ error: 'Bill ID is required.' }, 400);
    }

    // ── 5. Fetch Bill — verify it belongs to this customer ──
    const { data: bill, error: billError } = await admin
      .from('customer_bills')
      .select('id, bill_number, lco_id, customer_id, amount, paid_amount, status, due_date, plan_name')
      .eq('id', billId)
      .single();

    if (billError || !bill) {
      return reply({ error: 'Bill not found.' }, 404);
    }

    // ── 6. Verify bill belongs to this customer ──
    if (bill.customer_id !== customer.id) {
      console.error(`create-payment-order: customer ${customer.id} tried to pay bill ${billId} belonging to ${bill.customer_id}`);
      return reply({ error: 'Access denied. This bill does not belong to you.' }, 403);
    }

    // ── 7. Verify bill is payable ──
    if (bill.status === 'PAID') {
      return reply({ error: 'This bill has already been paid in full.' }, 409);
    }
    if (bill.status === 'CANCELLED') {
      return reply({ error: 'This bill has been cancelled.' }, 409);
    }

    // ── 8. Calculate outstanding amount from DB (do NOT trust browser amount) ──
    const outstandingAmount = Number(bill.amount) - Number(bill.paid_amount);
    if (outstandingAmount <= 0) {
      return reply({ error: 'No outstanding balance on this bill.' }, 409);
    }

    // Cashfree expects amount in INR (float/number), not in paise
    const roundedAmount = Math.round(outstandingAmount * 100) / 100;

    // Generate unique Cashfree order ID (max 45 chars: order_ + 16-char uuid + _ + timestamp)
    const orderId = `order_${bill.id.replace(/-/g, '').substring(0, 16)}_${Date.now()}`;

    // Format phone (must be 10 digits for Indian numbers, remove non-numeric)
    const rawPhone = String(customer.phone || '').replace(/[^0-9]/g, '');
    const cleanPhone = rawPhone.length >= 10 ? rawPhone.slice(-10) : '9999999999';

    // ── 9. Create Cashfree Sandbox Order (server-side) ──
    const orderPayload = {
      order_id: orderId,
      order_amount: roundedAmount,
      order_currency: 'INR',
      customer_details: {
        customer_id: customer.id,
        customer_name: customer.full_name || 'Customer',
        customer_email: customer.email || `${customer.customer_id.toLowerCase()}@lcoconnect.internal`,
        customer_phone: cleanPhone,
      },
      order_meta: {
        return_url: `${request.headers.get('origin') || 'https://lcoconnect.internal'}/pages/customer-dashboard.html?order_id={order_id}`,
      },
      order_tags: {
        bill_id: bill.id,
        customer_id: customer.id,
        lco_id: bill.lco_id,
        bill_number: bill.bill_number,
      },
      order_note: `Bill ${bill.bill_number}`,
    };

    const cashfreeEndpoint = 'https://sandbox.cashfree.com/pg/orders';

    const cfResponse = await fetch(cashfreeEndpoint, {
      method: 'POST',
      headers: {
        'x-client-id': cashfreeAppId,
        'x-client-secret': cashfreeSecretKey,
        'x-api-version': cashfreeApiVersion,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(orderPayload),
    });

    let cfOrder;
    if (cfResponse.ok) {
      cfOrder = await cfResponse.json();
    } else {
      const errBody = await cfResponse.text();
      console.error('Cashfree order creation failed:', cfResponse.status, errBody);
      return reply({ error: 'Failed to create payment order with Cashfree gateway.' }, 502);
    }

    if (!cfOrder.payment_session_id) {
      console.error('Cashfree response missing payment_session_id:', cfOrder);
      return reply({ error: 'Invalid response from payment gateway.' }, 502);
    }

    // ── 10. Return safe checkout info (NO secret keys) ──
    return reply({
      ok: true,
      payment_session_id: cfOrder.payment_session_id,
      order_id: cfOrder.order_id,
      order: {
        id: cfOrder.order_id,
        cf_order_id: cfOrder.cf_order_id,
        amount: cfOrder.order_amount,
        currency: cfOrder.order_currency,
      },
      bill: {
        id: bill.id,
        bill_number: bill.bill_number,
        amount: Number(bill.amount),
        paid_amount: Number(bill.paid_amount),
        outstanding: roundedAmount,
        plan_name: bill.plan_name,
      },
      customer: {
        name: customer.full_name,
        email: customer.email,
        phone: customer.phone,
        customer_id: customer.customer_id,
      },
    });

  } catch (error) {
    console.error('create-payment-order error:', error instanceof Error ? error.message : error);
    return reply({ error: 'Payment order creation failed.' }, 500);
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
