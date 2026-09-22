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
    const activationBaseUrl = Deno.env.get('APP_TECHNICIAN_ACTIVATION_URL')
      || 'https://lco-connect-project.vercel.app/pages/activate-technician.html';

    if (!url || !anonKey || !serviceRoleKey) {
      console.error('Send technician invitation missing platform config.');
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
      return reply({ error: 'Only active LCO Admins can send technician invitations.' }, 403);
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
    const technicianIdInput = String(payload.technician_id || payload.id || '').trim();

    if (!technicianIdInput) {
      return reply({ error: 'Technician ID is required.' }, 400);
    }

    const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(technicianIdInput);

    let query = admin.from('technicians').select('*, lco_applications(business_name)').eq('lco_id', callerLcoId);
    if (isUuid) {
      query = query.or(`id.eq.${technicianIdInput},technician_id.eq.${technicianIdInput}`);
    } else {
      query = query.eq('technician_id', technicianIdInput);
    }

    const { data: technician, error: techError } = await query.single();

    if (techError || !technician) {
      console.error('Technician lookup error or not found:', techError?.message, 'for input:', technicianIdInput);
      return reply({ error: 'Technician record not found.' }, 404);
    }

    if (technician.lco_id !== callerLcoId) {
      return reply({ error: 'Access denied. You can only invite technicians belonging to your LCO.' }, 403);
    }

    if (!technician.email) {
      return reply({ error: 'Technician does not have an email address registered.' }, 400);
    }

    if (technician.invitation_status === 'ACTIVATED' || technician.user_id) {
      return reply({ error: 'This technician account is already activated.' }, 409);
    }

    const technicianEmail = technician.email.trim().toLowerCase();
    const lcoBusinessName = lcoApp.business_name || 'Your Cable / Broadband Operator';

    if (!smtp2goKey || !from) {
      console.error('SMTP2GO service is not configured.');
      await admin.from('technicians')
        .update({ invitation_status: 'FAILED', last_invitation_attempt: new Date().toISOString() })
        .eq('id', technician.id);
      return reply({ ok: false, error: 'Email service is not configured.' }, 500);
    }

    // Generate auth invitation link
    let actionLink = '';

    try {
      const linkRes = await admin.auth.admin.generateLink({
        type: 'invite',
        email: technicianEmail,
        options: {
          redirectTo: `${activationBaseUrl}?technician_id=${encodeURIComponent(technician.technician_id)}`,
          data: {
            technician_id: technician.technician_id,
          },
        },
      });

      if (linkRes.data?.properties?.action_link) {
        actionLink = linkRes.data.properties.action_link;
      } else {
        const recoveryRes = await admin.auth.admin.generateLink({
          type: 'recovery',
          email: technicianEmail,
          options: {
            redirectTo: `${activationBaseUrl}?technician_id=${encodeURIComponent(technician.technician_id)}`,
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
      await admin.from('technicians')
        .update({ invitation_status: 'FAILED', last_invitation_attempt: new Date().toISOString() })
        .eq('id', technician.id);
      return reply({ ok: false, error: 'Unable to generate a secure activation link.' }, 502);
    }

    const subject = `Activate your Technician Account — ${lcoBusinessName}`;

    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1E293B; background-color: #FAF8F5; border-radius: 12px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h2 style="color: #0B7A6E; margin: 0;">LCO CONNECT</h2>
          <p style="color: #64748B; font-size: 14px; margin-top: 4px;">Field Technician Portal Activation</p>
        </div>
        
        <div style="background-color: #FFFFFF; padding: 28px; border-radius: 12px; border: 1px solid #E2E8F0; box-shadow: 0 4px 12px rgba(0,0,0,0.03);">
          <p style="font-size: 16px; margin-top: 0;">Hello <strong>${escapeHtml(technician.full_name)}</strong>,</p>

          <p>You have been registered as a Field Technician for <strong>${escapeHtml(lcoBusinessName)}</strong>.</p>
          
          <div style="background-color: rgba(11, 122, 110, 0.08); padding: 14px 18px; border-radius: 8px; margin: 20px 0;">
            <span style="font-size: 13px; color: #64748B; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">Technician ID</span><br>
            <strong style="font-family: monospace; font-size: 18px; color: #0B7A6E;">${escapeHtml(technician.technician_id)}</strong>
          </div>
          
          <p>To set your password and access the Technician Portal, click the button below:</p>
          
          <div style="text-align: center; margin: 28px 0;">
            <a href="${escapeAttribute(actionLink)}" style="background-color: #0B7A6E; color: #FFFFFF; text-decoration: none; padding: 14px 28px; border-radius: 10px; font-weight: bold; font-size: 15px; display: inline-block; box-shadow: 0 4px 14px rgba(11, 122, 110, 0.3);">
              Activate Technician Account →
            </a>
          </div>
          
          <p style="font-size: 13px; color: #64748B; margin-top: 24px;">
            If the button above does not work, copy and paste this link into your browser:<br>
            <a href="${escapeAttribute(actionLink)}" style="color: #0B7A6E; word-break: break-all;">${escapeHtml(actionLink)}</a>
          </p>
          
          <hr style="border: 0; border-top: 1px solid #E2E8F0; margin: 24px 0;">
          
          <p style="font-size: 12px; color: #94A3B8; margin-bottom: 0;">
            For security reasons, passwords are never sent by email. If you did not expect this email, please contact your operator administrator.
          </p>
        </div>
      </div>
    `;

    const textBody = `Hello ${technician.full_name},\n\nYou have been registered as a Field Technician for ${lcoBusinessName}.\n\nTechnician ID: ${technician.technician_id}\n\nTo activate your account and set your password, visit:\n${actionLink}\n\nFor security, passwords are never sent by email.`;

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
          to: [technicianEmail],
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
    await admin.from('technicians')
      .update({
        invitation_status: sent ? 'INVITED' : 'FAILED',
        invitation_sent_at: sent ? nowIso : technician.invitation_sent_at,
        last_invitation_attempt: nowIso,
      })
      .eq('id', technician.id);

    if (sent) {
      return reply({
        ok: true,
        message: `Activation email sent successfully to ${technicianEmail}.`,
        technician_id: technician.technician_id,
      });
    }

    return reply({
      ok: false,
      error: 'Failed to deliver activation email.',
      technician_id: technician.technician_id,
    }, 502);

  } catch (error) {
    console.error('Send technician invitation function error:', error instanceof Error ? error.message : error);
    return reply({ error: 'Technician activation invitation failed.' }, 500);
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
