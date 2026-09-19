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
    const authorization = request.headers.get('Authorization');
    if (!authorization) return reply({ error: 'Authentication is required.' }, 401);

    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = getSupabaseKey('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEYS');
    const serviceRoleKey = getSupabaseKey('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEYS');
    const smtp2goKey = Deno.env.get('SMTP2GO_API_KEY');
    const from = Deno.env.get('SMTP2GO_FROM_EMAIL');
    const activationBaseUrl = Deno.env.get('APP_ACTIVATION_URL')
      || 'https://lco-connect-project.vercel.app/pages/activate-account.html';

    if (!url || !anonKey || !serviceRoleKey) {
      console.error('Send customer invitation missing platform config.');
      return reply({ error: 'Server configuration error.' }, 500);
    }

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

    if (!callerProfile || callerProfile.role !== 'LCO_ADMIN' || callerProfile.status !== 'ACTIVE') {
      return reply({ error: 'Only active LCO Admins can send customer invitations.' }, 403);
    }

    const { data: lcoApp, error: lcoError } = await callerClient
      .from('lco_applications')
      .select('id, business_name')
      .eq('user_id', callerUser.id)
      .eq('status', 'APPROVED')
      .single();

    if (lcoError || !lcoApp) {
      return reply({ error: 'Approved LCO account not found for current user.' }, 403);
    }

    const callerLcoId = lcoApp.id;

    const payload = await request.json();
    const customerIdInput = String(payload.customer_id || '').trim();

    if (!customerIdInput) {
      return reply({ error: 'Customer ID is required.' }, 400);
    }

    const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(customerIdInput);

    let query = admin.from('customers').select('*, lco_applications(business_name)').eq('lco_id', callerLcoId);
    if (isUuid) {
      query = query.or(`id.eq.${customerIdInput},customer_id.eq.${customerIdInput}`);
    } else {
      query = query.eq('customer_id', customerIdInput);
    }

    const { data: customer, error: custError } = await query.single();

    if (custError || !customer) {
      console.error('Customer lookup error or not found:', custError?.message, 'for input:', customerIdInput);
      return reply({ error: 'Customer record not found.' }, 404);
    }

    if (customer.lco_id !== callerLcoId) {
      return reply({ error: 'Access denied. You can only invite customers belonging to your LCO.' }, 403);
    }

    if (!customer.email) {
      return reply({ error: 'Customer does not have an email address registered.' }, 400);
    }

    if (customer.invitation_status === 'ACTIVATED' || customer.user_id) {
      return reply({ error: 'This customer account is already activated.' }, 409);
    }

    const customerEmail = customer.email.trim().toLowerCase();
    const lcoBusinessName = lcoApp.business_name || 'Your Cable / Broadband Operator';

    if (!smtp2goKey || !from) {
      console.error('SMTP2GO service is not configured.');
      await admin.from('customers')
        .update({ invitation_status: 'FAILED', last_invitation_attempt: new Date().toISOString() })
        .eq('id', customer.id);
      return reply({ ok: false, error: 'Email service is not configured.' }, 500);
    }

    // Generate auth invitation link — fail closed if unavailable
    let actionLink = '';

    try {
      const linkRes = await admin.auth.admin.generateLink({
        type: 'invite',
        email: customerEmail,
        options: {
          redirectTo: `${activationBaseUrl}?customer_id=${encodeURIComponent(customer.customer_id)}`,
          data: {
            customer_id: customer.customer_id,
          },
        },
      });

      if (linkRes.data?.properties?.action_link) {
        actionLink = linkRes.data.properties.action_link;
      } else {
        const recoveryRes = await admin.auth.admin.generateLink({
          type: 'recovery',
          email: customerEmail,
          options: {
            redirectTo: `${activationBaseUrl}?customer_id=${encodeURIComponent(customer.customer_id)}`,
          },
        });

        if (recoveryRes.data?.properties?.action_link) {
          actionLink = recoveryRes.data.properties.action_link;
        }
      }
    } catch (authErr) {
      console.error('Auth generateLink failed:', authErr instanceof Error ? authErr.message : authErr);
    }

    if (!actionLink) {
      await admin.from('customers')
        .update({ invitation_status: 'FAILED', last_invitation_attempt: new Date().toISOString() })
        .eq('id', customer.id);
      return reply({ ok: false, error: 'Unable to generate a secure activation link.' }, 502);
    }

    const subject = `Activate your LCO CONNECT account — ${lcoBusinessName}`;

    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1E293B; background-color: #FAF8F5; border-radius: 12px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h2 style="color: #0B7A6E; margin: 0;">LCO CONNECT</h2>
          <p style="color: #64748B; font-size: 14px; margin-top: 4px;">Customer Account Activation</p>
        </div>
        
        <div style="background-color: #FFFFFF; padding: 28px; border-radius: 12px; border: 1px solid #E2E8F0; box-shadow: 0 4px 12px rgba(0,0,0,0.03);">
          <p style="font-size: 16px; margin-top: 0;">Hello <strong>${escapeHtml(customer.full_name)}</strong>,</p>

          <p>Your customer account has been created by <strong>${escapeHtml(lcoBusinessName)}</strong>.</p>
          
          <div style="background-color: rgba(11, 122, 110, 0.08); padding: 14px 18px; border-radius: 8px; margin: 20px 0;">
            <span style="font-size: 13px; color: #64748B; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">Customer ID</span><br>
            <strong style="font-family: monospace; font-size: 18px; color: #0B7A6E;">${escapeHtml(customer.customer_id)}</strong>
          </div>
          
          <p>To activate your account and set your password, click the button below:</p>
          
          <div style="text-align: center; margin: 28px 0;">
            <a href="${escapeAttribute(actionLink)}" style="background-color: #0B7A6E; color: #FFFFFF; text-decoration: none; padding: 14px 28px; border-radius: 10px; font-weight: bold; font-size: 15px; display: inline-block; box-shadow: 0 4px 14px rgba(11, 122, 110, 0.3);">
              Activate My Account →
            </a>
          </div>
          
          <p style="font-size: 13px; color: #64748B; margin-top: 24px;">
            If the button above does not work, copy and paste this link into your browser:<br>
            <a href="${escapeAttribute(actionLink)}" style="color: #0B7A6E; word-break: break-all;">${escapeHtml(actionLink)}</a>
          </p>
          
          <hr style="border: 0; border-top: 1px solid #E2E8F0; margin: 24px 0;">
          
          <p style="font-size: 12px; color: #94A3B8; margin-bottom: 0;">
            For security reasons, we never send or store passwords by email. If you did not expect this email, please ignore it.
          </p>
        </div>
      </div>
    `;

    const textBody = `Hello ${customer.full_name},\n\nYour customer account has been created by ${lcoBusinessName}.\n\nCustomer ID: ${customer.customer_id}\n\nTo activate your account and set your password, visit:\n${actionLink}\n\nFor security, we never send or store passwords by email.`;

    let sent = false;

    try {
      const emailResponse = await fetch('https://api.smtp2go.com/v3/email/send', {
        method: 'POST',
        headers: {
          'X-Smtp2go-Api-Key': smtp2goKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          sender: from,
          to: [customerEmail],
          subject,
          text_body: textBody,
          html_body: htmlBody,
        }),
      });

      if (emailResponse.ok) {
        const smtpResult = await emailResponse.json();
        if (smtpResult?.data?.succeeded > 0) {
          sent = true;
        } else {
          console.error('SMTP2GO returned succeeded = 0');
        }
      } else {
        console.error(`SMTP2GO HTTP failure ${emailResponse.status}`);
      }
    } catch (emailErr) {
      console.error('SMTP2GO fetch error:', emailErr instanceof Error ? emailErr.message : emailErr);
    }

    const nowIso = new Date().toISOString();
    await admin.from('customers')
      .update({
        invitation_status: sent ? 'INVITED' : 'FAILED',
        invitation_sent_at: sent ? nowIso : customer.invitation_sent_at,
        last_invitation_attempt: nowIso,
      })
      .eq('id', customer.id);

    if (sent) {
      return reply({
        ok: true,
        message: `Activation email sent successfully to ${customerEmail}.`,
        customer_id: customer.customer_id,
      });
    }

    return reply({
      ok: false,
      error: 'Failed to deliver activation email.',
      customer_id: customer.customer_id,
    }, 502);

  } catch (error) {
    console.error('Send customer invitation function error:', error instanceof Error ? error.message : error);
    return reply({ error: 'Customer activation invitation failed.' }, 500);
  }
});

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]!));
}

function escapeAttribute(value: string) {
  return escapeHtml(value);
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
