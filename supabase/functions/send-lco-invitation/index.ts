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

    if (!url || !anonKey || !serviceRoleKey) {
      console.error('Send LCO invitation missing platform config.');
      return reply({ error: 'Server configuration error.' }, 500);
    }

    const callerClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });

    const { data: isSuperAdmin, error: adminCheckError } = await callerClient.rpc('is_super_admin');
    if (adminCheckError || !isSuperAdmin) {
      return reply({ error: 'Only Super Admins can send LCO invitations.' }, 403);
    }

    const payload = await request.json();
    const applicationUuid = String(payload.application_id || '').trim();

    if (!applicationUuid) {
      return reply({ error: 'Application ID is required.' }, 400);
    }

    const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

    const { data: application, error: appError } = await admin
      .from('lco_applications')
      .select('id, application_id, business_name, email, status, invitation_status')
      .eq('id', applicationUuid)
      .single();

    if (appError || !application) {
      console.error('LCO application lookup error or not found:', appError?.message, 'for input:', applicationUuid);
      return reply({ error: 'Application record not found.' }, 404);
    }

    if (application.status !== 'APPROVED') {
      return reply({ error: 'Only approved applications can receive activation invitations.' }, 409);
    }

    if (!application.email) {
      return reply({ error: 'Application does not have an email address registered.' }, 400);
    }

    if (application.invitation_status === 'ACTIVATED') {
      return reply({ error: 'This LCO account is already activated.' }, 409);
    }

    const lcoEmail = application.email.trim().toLowerCase();
    const businessName = application.business_name || 'Your LCO Business';
    const activationBaseUrl = Deno.env.get('APP_LCO_ACTIVATION_URL')
      || 'https://lco-connect-project.vercel.app/pages/activate-lco.html';
    const activationUrl = `${activationBaseUrl}?application_id=${encodeURIComponent(application.application_id)}`;

    if (!smtp2goKey || !from) {
      console.error('SMTP2GO service is not configured.');
      await admin.from('lco_applications')
        .update({ invitation_status: 'FAILED', last_invitation_attempt: new Date().toISOString() })
        .eq('id', application.id);
      return reply({ ok: false, error: 'Email service is not configured.' }, 500);
    }

    // Generate auth invitation link — fail closed if unavailable
    let actionLink = '';

    try {
      const linkRes = await admin.auth.admin.generateLink({
        type: 'invite',
        email: lcoEmail,
        options: {
          redirectTo: activationUrl,
          data: {
            application_id: application.application_id,
          },
        },
      });

      if (linkRes.data?.properties?.action_link) {
        actionLink = linkRes.data.properties.action_link;
      } else {
        const recoveryRes = await admin.auth.admin.generateLink({
          type: 'recovery',
          email: lcoEmail,
          options: {
            redirectTo: activationUrl,
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
      await admin.from('lco_applications')
        .update({ invitation_status: 'FAILED', last_invitation_attempt: new Date().toISOString() })
        .eq('id', application.id);
      return reply({ ok: false, error: 'Unable to generate a secure activation link.' }, 502);
    }

    const subject = `Activate your LCO Connect account — ${businessName}`;

    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1E293B; background-color: #FAF8F5; border-radius: 12px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h2 style="color: #0B7A6E; margin: 0;">LCO CONNECT</h2>
          <p style="color: #64748B; font-size: 14px; margin-top: 4px;">LCO Account Activation</p>
        </div>

        <div style="background-color: #FFFFFF; padding: 28px; border-radius: 12px; border: 1px solid #E2E8F0; box-shadow: 0 4px 12px rgba(0,0,0,0.03);">
          <p style="font-size: 16px; margin-top: 0;">Hello,</p>

          <p>Congratulations — <strong>${escapeHtml(businessName)}</strong> has been approved as an LCO CONNECT operator.</p>

          <div style="background-color: rgba(11, 122, 110, 0.08); padding: 14px 18px; border-radius: 8px; margin: 20px 0;">
            <span style="font-size: 13px; color: #64748B; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">Application ID</span><br>
            <strong style="font-family: monospace; font-size: 18px; color: #0B7A6E;">${escapeHtml(application.application_id)}</strong>
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

    const textBody = `Hello,\n\nCongratulations — ${businessName} has been approved as an LCO CONNECT operator.\n\nApplication ID: ${application.application_id}\n\nTo activate your account and set your password, visit:\n${actionLink}\n\nFor security, we never send or store passwords by email.`;

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
          to: [lcoEmail],
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
    await admin.from('lco_applications')
      .update({
        invitation_status: sent ? 'INVITED' : 'FAILED',
        invitation_sent_at: sent ? nowIso : application.invitation_sent_at,
        last_invitation_attempt: nowIso,
      })
      .eq('id', application.id);

    if (sent) {
      return reply({
        ok: true,
        message: `Activation email sent successfully to ${lcoEmail}.`,
        application_id: application.application_id,
      });
    }

    return reply({
      ok: false,
      error: 'Failed to deliver activation email.',
      application_id: application.application_id,
    }, 502);

  } catch (error) {
    console.error('Send LCO invitation function error:', error instanceof Error ? error.message : error);
    return reply({ error: 'LCO activation invitation failed.' }, 500);
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
