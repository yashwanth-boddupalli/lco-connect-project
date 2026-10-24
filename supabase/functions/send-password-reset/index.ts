import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Password reset for ALL roles (Super Admin, LCO Admin, Technician,
// Customer). Invoked from the public login page by logged-out users,
// so there is deliberately no caller-role check. To avoid leaking which
// emails have accounts, the response is the same whether or not the
// account exists — the email is only sent when it does.
//
// Mirrors the send-*-invitation functions: the recovery link is
// generated with the service-role admin client and delivered through
// SMTP2GO with LCO CONNECT branding, instead of Supabase's built-in
// mailer/template.
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

  const genericOk = () => reply({
    ok: true,
    message: 'If an account exists for this email, a password reset link has been sent.',
  });

  try {
    const url = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = getSupabaseKey('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEYS');
    const smtp2goKey = Deno.env.get('SMTP2GO_API_KEY');
    const from = Deno.env.get('SMTP2GO_FROM_EMAIL');

    if (!url || !serviceRoleKey) {
      console.error('Send password reset missing platform config.');
      return reply({ error: 'Server configuration error.' }, 500);
    }

    const payload = await request.json().catch(() => ({}));
    const email = String(payload.email || '').trim().toLowerCase();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reply({ error: 'Please enter a valid email address.' }, 400);
    }

    if (!smtp2goKey || !from) {
      console.error('SMTP2GO service is not configured.');
      return reply({ ok: false, error: 'Email service is not configured.' }, 500);
    }

    const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

    const resetPageUrl = Deno.env.get('APP_PASSWORD_RESET_URL')
      || 'https://lco-connect-project.vercel.app/pages/reset-password.html';

    // Generate the recovery link. If no account exists for this email,
    // generateLink errors — swallow it and return the generic response
    // so the endpoint cannot be used to enumerate accounts.
    let actionLink = '';

    try {
      const linkRes = await admin.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: { redirectTo: resetPageUrl },
      });

      if (linkRes.data?.properties?.action_link) {
        actionLink = linkRes.data.properties.action_link;
      } else if (linkRes.error) {
        console.log('Password reset requested for unknown email (no account).');
      }
    } catch (authErr) {
      console.error('Auth generateLink failed:', authErr instanceof Error ? authErr.message : authErr);
    }

    if (!actionLink) return genericOk();

    const subject = 'Reset your LCO CONNECT password';

    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1E293B; background-color: #FAF8F5; border-radius: 12px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h2 style="color: #0B7A6E; margin: 0;">LCO CONNECT</h2>
          <p style="color: #64748B; font-size: 14px; margin-top: 4px;">Password Reset</p>
        </div>

        <div style="background-color: #FFFFFF; padding: 28px; border-radius: 12px; border: 1px solid #E2E8F0; box-shadow: 0 4px 12px rgba(0,0,0,0.03);">
          <p style="font-size: 16px; margin-top: 0;">Hello,</p>

          <p>We received a request to reset the password for your <strong>LCO CONNECT</strong> account.</p>

          <p>To set a new password, click the button below:</p>

          <div style="text-align: center; margin: 28px 0;">
            <a href="${escapeAttribute(actionLink)}" style="background-color: #0B7A6E; color: #FFFFFF; text-decoration: none; padding: 14px 28px; border-radius: 10px; font-weight: bold; font-size: 15px; display: inline-block; box-shadow: 0 4px 14px rgba(11, 122, 110, 0.3);">
              Set New Password →
            </a>
          </div>

          <p style="font-size: 13px; color: #64748B; margin-top: 24px;">
            If the button above does not work, copy and paste this link into your browser:<br>
            <a href="${escapeAttribute(actionLink)}" style="color: #0B7A6E; word-break: break-all;">${escapeHtml(actionLink)}</a>
          </p>

          <hr style="border: 0; border-top: 1px solid #E2E8F0; margin: 24px 0;">

          <p style="font-size: 12px; color: #94A3B8; margin-bottom: 0;">
            This link can be used only once and is valid for a limited time. If you did not request a password reset, please ignore this email — your password will not change.
          </p>
        </div>
      </div>
    `;

    const textBody = `Hello,\n\nWe received a request to reset the password for your LCO CONNECT account.\n\nTo set a new password, visit:\n${actionLink}\n\nThis link can be used only once and is valid for a limited time. If you did not request a password reset, please ignore this email — your password will not change.`;

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
          to: [email],
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

    if (sent) return genericOk();

    return reply({
      ok: false,
      error: 'Failed to deliver password reset email.',
    }, 502);

  } catch (error) {
    console.error('Send password reset function error:', error instanceof Error ? error.message : error);
    return reply({ error: 'Password reset failed.' }, 500);
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
