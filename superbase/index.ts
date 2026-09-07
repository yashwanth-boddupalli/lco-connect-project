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
    // Hosted Supabase projects provide legacy keys and, on newer projects,
    // named key maps. Support both without ever logging a key value.
    const anonKey = getSupabaseKey('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEYS');
    const serviceRoleKey = getSupabaseKey('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEYS');
    const smtp2goKey = Deno.env.get('SMTP2GO_API_KEY');
    const from = Deno.env.get('SMTP2GO_FROM_EMAIL');
    const loginUrl = Deno.env.get('APP_LOGIN_URL');
    const platformMissing = [
      !url && 'SUPABASE_URL',
      !anonKey && 'SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEYS.default',
      !serviceRoleKey && 'SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEYS.default',
    ].filter(Boolean);
    if (!url || !anonKey || !serviceRoleKey) {
      console.error('Notification function is missing platform configuration names:', platformMissing.join(', '));
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

    const notificationMissing = [
      !smtp2goKey && 'SMTP2GO_API_KEY',
      !from && 'SMTP2GO_FROM_EMAIL',
      !loginUrl && 'APP_LOGIN_URL',
    ].filter(Boolean);
    if (!smtp2goKey || !from || !loginUrl) {
      console.error('Notification function is missing configuration names:', notificationMissing.join(', '));
      const { error: statusError } = await admin.from('lco_applications')
        .update({ notification_status: 'FAILED' })
        .eq('id', application.id);
      if (statusError) console.error('Could not record notification status:', statusError.message);
      return reply({ ok: false, error: 'Notification service is not configured.' });
    }

    const subject = decision === 'APPROVED'
      ? 'Your LCO Connect account is approved'
      : 'Update on your LCO Connect application';
    const body = decision === 'APPROVED'
      ? `<p>Hello,</p><p><strong>${escapeHtml(application.business_name)}</strong> has been approved and your LCO Connect account is now active.</p><p>Sign in with the email address you registered and the password you created during registration: <a href="${escapeAttribute(loginUrl)}">Sign in to LCO Connect</a>.</p><p>For security, we never send or retrieve passwords by email.</p>`
      : `<p>Hello,</p><p>Your application for <strong>${escapeHtml(application.business_name)}</strong> has not been approved.</p><p><strong>Reason:</strong> ${escapeHtml(application.rejection_reason || 'Please contact support for more information.')}</p><p>If you need help, please contact the LCO Connect support channel provided to you.</p>`;
    const textBody = decision === 'APPROVED'
      ? `Hello,\n\n${application.business_name} has been approved and your LCO Connect account is now active.\n\nSign in with the email address you registered and the password you created during registration: ${loginUrl}\n\nFor security, we never send or retrieve passwords by email.`
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
      sent = emailResponse.ok;
      if (!sent) console.error(`SMTP2GO rejected notification with HTTP ${emailResponse.status}.`);
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
