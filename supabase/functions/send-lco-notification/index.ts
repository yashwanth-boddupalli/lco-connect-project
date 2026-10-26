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
    const loginUrl = Deno.env.get('APP_LOGIN_URL')
      || 'https://www.lcoconnect.in/pages/login.html';

    if (!url || !anonKey || !serviceRoleKey) {
      console.error('Notification function is missing platform configuration.');
      return reply({ error: 'Notification service is not configured.' }, 500);
    }

    const caller = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const { data: isAdmin, error: adminError } = await caller.rpc('is_super_admin');
    if (adminError || !isAdmin) return reply({ error: 'Super Admin access is required.' }, 403);

    const payload = await request.json();
    const decision = String(payload.decision || '').toUpperCase();
    const applicationId = String(payload.application_id || '');
    if (!applicationId || !['APPROVED', 'REJECTED'].includes(decision)) {
      return reply({ error: 'Invalid notification request.' }, 400);
    }

    const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
    const { data: application, error: applicationError } = await admin
      .from('lco_applications')
      .select('id, application_id, business_name, email, status, rejection_reason')
      .eq('id', applicationId)
      .single();
    if (applicationError || !application || application.status !== decision) {
      return reply({ error: 'Application review state does not match this request.' }, 409);
    }

    if (!smtp2goKey || !from) {
      console.error('Notification function is missing email configuration.');
      const { error: statusError } = await admin.from('lco_applications')
        .update({ notification_status: 'FAILED' })
        .eq('id', application.id);
      if (statusError) console.error('Could not record notification status:', statusError.message);
      return reply({ ok: false, error: 'Notification service is not configured.' });
    }

    const subject = decision === 'APPROVED'
      ? 'Your LCO Connect account is approved'
      : 'Update on your LCO Connect application';
    const loginLinkHtml = loginUrl
      ? `<p><a href="${escapeHtml(loginUrl)}" style="color: #0B7A6E; font-weight: 600;">Go to Login</a></p>`
      : '';
    const innerBody = decision === 'APPROVED'
      ? `<p style="font-size: 16px; margin-top: 0;">Hello,</p><p><strong>${escapeHtml(application.business_name)}</strong> has been approved and your LCO Connect account is now active.</p><p>Your application is approved — a separate activation email is on its way; open it to set your password and activate your account.</p>${loginLinkHtml}`
      : `<p style="font-size: 16px; margin-top: 0;">Hello,</p><p>Your application for <strong>${escapeHtml(application.business_name)}</strong> has not been approved.</p><p><strong>Reason:</strong> ${escapeHtml(application.rejection_reason || 'Please contact support for more information.')}</p><p>If you need help, please contact the LCO Connect support channel provided to you.</p>`;
    // Branded LCO CONNECT shell — same label/header as the invitation
    // and password-reset emails, so every mail from the platform
    // carries the brand instead of arriving as bare text.
    const body = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1E293B; background-color: #FAF8F5; border-radius: 12px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h2 style="color: #0B7A6E; margin: 0;">LCO CONNECT</h2>
          <p style="color: #64748B; font-size: 14px; margin-top: 4px;">${decision === 'APPROVED' ? 'Application Approved' : 'Application Update'}</p>
        </div>

        <div style="background-color: #FFFFFF; padding: 28px; border-radius: 12px; border: 1px solid #E2E8F0; box-shadow: 0 4px 12px rgba(0,0,0,0.03);">
          ${innerBody}

          <hr style="border: 0; border-top: 1px solid #E2E8F0; margin: 24px 0;">

          <p style="font-size: 12px; color: #94A3B8; margin-bottom: 0;">
            For security reasons, we never send or retrieve passwords by email.
          </p>
        </div>
      </div>
    `;
    const textBody = decision === 'APPROVED'
      ? `Hello,\n\n${application.business_name} has been approved and your LCO Connect account is now active.\n\nYour application is approved — a separate activation email is on its way; open it to set your password and activate your account.${loginUrl ? `\n\nGo to Login: ${loginUrl}` : ''}\n\nFor security, we never send or retrieve passwords by email.`
      : `Hello,\n\nYour application for ${application.business_name} has not been approved.\n\nReason: ${application.rejection_reason || 'Please contact support for more information.'}\n\nIf you need help, please contact the LCO Connect support channel provided to you.`;

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
          to: [application.email],
          subject,
          text_body: textBody,
          html_body: body,
        }),
      });

      if (emailResponse.ok) {
        const smtpResult = await emailResponse.json();
        sent = !!(smtpResult?.data?.succeeded > 0);
        if (!sent) console.error('SMTP2GO returned succeeded = 0');
      } else {
        console.error(`SMTP2GO rejected notification with HTTP ${emailResponse.status}.`);
      }
    } catch (emailError) {
      console.error('SMTP2GO request failed:', emailError instanceof Error ? emailError.message : 'Unknown error');
    }

    const { error: statusError } = await admin.from('lco_applications')
      .update({ notification_status: sent ? 'SENT' : 'FAILED' })
      .eq('id', application.id);
    if (statusError) console.error('Could not record notification status:', statusError.message);

    return reply({
      ok: sent,
      ...(sent ? {} : { error: 'SMTP2GO did not accept the notification.' }),
    });
  } catch (error) {
    console.error('Notification function error:', error instanceof Error ? error.message : error);
    return reply({ error: 'Notification delivery failed.' }, 500);
  }
});

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]!));
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
