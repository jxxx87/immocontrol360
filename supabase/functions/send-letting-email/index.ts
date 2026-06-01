import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'
import nodemailer from "npm:nodemailer@6.9.13"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

async function getSmtpConfig(supabaseAdmin: any, userId: string): Promise<SmtpConfig | null> {
  // 1. Try to fetch user-specific SMTP settings
  const { data: userSettings, error } = await supabaseAdmin
    .from('user_smtp_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (userSettings && !error) {
    console.log(`Using custom SMTP settings for user ${userId} (${userSettings.smtp_user})...`);
    return {
      host: userSettings.smtp_host,
      port: userSettings.smtp_port,
      user: userSettings.smtp_user,
      pass: userSettings.smtp_pass,
      from: userSettings.smtp_sender
    };
  }

  // 2. Fallback to platform-wide SMTP settings
  const smtpHost = Deno.env.get('SMTP_HOST');
  if (smtpHost) {
    console.log(`Using platform global SMTP settings...`);
    return {
      host: smtpHost,
      port: parseInt(Deno.env.get('SMTP_PORT') || '587'),
      user: Deno.env.get('SMTP_USER') || '',
      pass: Deno.env.get('SMTP_PASS') || '',
      from: Deno.env.get('SMTP_SENDER') || Deno.env.get('SMTP_USER') || 'no-reply@immocontrol360.de'
    };
  }

  return null;
}

async function sendMail(config: SmtpConfig, to: string, subject: string, html: string) {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });

  const info = await transporter.sendMail({
    from: config.from,
    to,
    subject,
    html,
  });

  console.log(`Email sent successfully: ${info.messageId}`);
  return info;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload = await req.json();
    const { action, applicantId, bookingId, settings, test_email, userId, to, subject, html, tenantId, unitId, propertyId, origin } = payload;

    // Create Supabase Admin client
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // ACTION: TEST CONNECTION
    if (action === 'test_connection') {
      if (!settings || !test_email) {
        throw new Error('Missing settings or test_email parameter');
      }

      console.log(`Testing SMTP connection for host: ${settings.smtp_host}...`);
      const config: SmtpConfig = {
        host: settings.smtp_host,
        port: parseInt(settings.smtp_port || '587'),
        user: settings.smtp_user,
        pass: settings.smtp_pass,
        from: settings.smtp_sender || settings.smtp_user
      };

      const testHtml = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <div style="background-color: #0ea5e9; color: white; padding: 20px; border-radius: 6px; text-align: center;">
            <h2 style="margin: 0; font-size: 20px;">E-Mail Verbindung erfolgreich</h2>
          </div>
          <div style="padding: 20px; color: #1e293b; line-height: 1.6;">
            <p>Hallo,</p>
            <p>Dies ist eine Test-E-Mail von <strong>ImmoControlpro360</strong>.</p>
            <p>Ihre SMTP-Verbindung wurde erfolgreich eingerichtet und verifiziert! Ab sofort werden Bewerber-E-Mails und Einladungen über diese Einstellungen versendet.</p>
            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;"/>
            <p style="font-size: 14px; color: #64748b; margin: 0;">Freundliche Grüße,<br/>Ihr ImmoControlpro360 Team</p>
          </div>
        </div>
      `;

      await sendMail(config, test_email, 'ImmoControlpro360 - E-Mail Verbindungstest', testHtml);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // ACTION: SEND TENANT INVITATION (Custom SMTP + Magic Link)
    if (action === 'send_tenant_invite') {
      if (!to || !tenantId || !userId) {
        throw new Error('Missing required fields for tenant invitation: to (email), tenantId, userId');
      }

      // Generate magic link via Supabase Auth admin API
      const redirectTo = `${origin || 'https://app.immocontrol360.de'}/tenant/dashboard`;
      console.log(`Generating magic link for ${to} redirecting to ${redirectTo}...`);
      
      const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
        type: 'magiclink',
        email: to,
        options: {
          redirectTo: redirectTo,
          data: {
            role: 'tenant',
            tenant_id: tenantId,
            unit_id: unitId || null,
            property_id: propertyId || null
          }
        }
      });

      if (linkErr || !linkData?.properties?.action_link) {
        throw new Error(`Failed to generate magic link: ${linkErr?.message || 'No action link returned'}`);
      }

      const magicLink = linkData.properties.action_link;
      console.log(`Successfully generated magic link.`);

      // Fetch SMTP config for landlord
      const config = await getSmtpConfig(supabaseAdmin, userId);
      if (!config) {
        throw new Error('No SMTP configuration found');
      }

      // Render HTML template
      const inviteHtml = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <div style="background-color: #0ea5e9; color: white; padding: 20px; border-radius: 6px; text-align: center;">
            <h2 style="margin: 0; font-size: 20px;">Einladung zum Mieterportal</h2>
          </div>
          <div style="padding: 20px; color: #1e293b; line-height: 1.6;">
            <p>Hallo,</p>
            <p>Ihr Vermieter hat Sie eingeladen, das <strong>ImmoControlpro360 Mieterportal</strong> zu nutzen.</p>
            <p>Über das Mieterportal können Sie:</p>
            <ul style="padding-left: 20px; color: #475569;">
              <li>Ihre Mietverträge und Dokumente einsehen</li>
              <li>Nebenkostenabrechnungen prüfen</li>
              <li>Meldungen und Anfragen direkt an Ihren Vermieter senden</li>
              <li>Ihre Kontaktdaten auf dem aktuellen Stand halten</li>
            </ul>
            <p>Klicken Sie auf den folgenden Button, um sich direkt und ohne Passwort im Portal anzumelden:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${magicLink}" style="background-color: #0ea5e9; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Jetzt im Mieterportal anmelden</a>
            </div>
            <p style="font-size: 13px; color: #64748b;">Falls der Button oben nicht funktioniert, kopieren Sie bitte folgenden Link in Ihren Browser:<br/>${magicLink}</p>
            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;"/>
            <p style="font-size: 14px; color: #64748b; margin: 0;">Freundliche Grüße,<br/>Ihr Vermieter-Team</p>
          </div>
        </div>
      `;

      // Send email
      await sendMail(config, to, 'Einladung zum ImmoControlpro360 Mieterportal', inviteHtml);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // ACTION: SEND CUSTOM EMAIL (Generic dispatch)
    if (action === 'send_custom_email') {
      if (!to || !subject || !html || !userId) {
        throw new Error('Missing required fields for custom email: to, subject, html, userId');
      }
      const config = await getSmtpConfig(supabaseAdmin, userId);
      if (!config) {
        throw new Error('No email configuration found (neither user-specific nor platform fallback)');
      }
      await sendMail(config, to, subject, html);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // ACTION: APPLICATION RECEIVED
    if (action === 'application_received') {
      // 1. Fetch applicant info
      const { data: applicant, error: appErr } = await supabaseAdmin
        .from('rental_applicants')
        .select('*')
        .eq('id', applicantId)
        .single();
      if (appErr || !applicant) throw new Error('Applicant not found');

      // 2. Fetch process details
      const { data: process, error: procErr } = await supabaseAdmin
        .from('rental_processes')
        .select('*')
        .eq('id', applicant.process_id)
        .single();
      if (procErr || !process) throw new Error('Rental process not found');

      // 3. Fetch property / unit info
      const { data: unit, error: unitErr } = await supabaseAdmin
        .from('units')
        .select('*, properties(name, street, house_number, zip, city)')
        .eq('id', process.unit_id)
        .single();
      if (unitErr || !unit) throw new Error('Unit not found');

      const property = unit.properties;
      const listingTitle = process.listing_title || `${property.name} - ${unit.unit_name}`;
      const addressStr = `${property.street} ${property.house_number}, ${property.zip} ${property.city}`;

      // Resolve SMTP configuration for landlord (process.user_id)
      const config = await getSmtpConfig(supabaseAdmin, process.user_id);
      if (!config) {
        console.warn('No email config found. Skipping email sending.');
        return new Response(JSON.stringify({ success: false, warning: 'No email config configured' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
      }

      // Email template to applicant (Tenant)
      const tenantSubject = `Bewerbung eingegangen: ${listingTitle}`;
      const bookingLink = `https://app.immocontrol360.de/besichtigung/${process.token}?applicantId=${applicant.id}`;
      const tenantHtml = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <div style="background-color: #0ea5e9; color: white; padding: 20px; border-radius: 6px; text-align: center;">
            <h2 style="margin: 0; font-size: 20px;">Bewerbung eingegangen</h2>
          </div>
          <div style="padding: 20px; color: #1e293b; line-height: 1.6;">
            <p>Hallo ${applicant.first_name} ${applicant.last_name},</p>
            <p>vielen Dank für Ihr Interesse an der Wohnung <strong>${listingTitle}</strong> (${addressStr}).</p>
            <p>Ihre Selbstauskunft und Unterlagen wurden erfolgreich an uns übermittelt.</p>
            <p>Sie können sich jetzt direkt online Ihren Wunschtermin für die Besichtigung aussuchen:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${bookingLink}" style="background-color: #0ea5e9; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Besichtigungstermin wählen</a>
            </div>
            <p style="font-size: 13px; color: #64748b;">Falls der Button oben nicht funktioniert, kopieren Sie bitte folgenden Link in Ihren Browser:<br/>${bookingLink}</p>
            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;"/>
            <p style="font-size: 14px; color: #64748b; margin: 0;">Freundliche Grüße,<br/>Ihr Vermieter-Team</p>
          </div>
        </div>
      `;

      // Email template to Landlord
      const landlordSubject = `Neue Bewerbung: ${applicant.first_name} ${applicant.last_name} - ${listingTitle}`;
      const landlordHtml = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <div style="background-color: #1e293b; color: white; padding: 20px; border-radius: 6px;">
            <h2 style="margin: 0; font-size: 20px;">Neue Bewerbung eingegangen</h2>
          </div>
          <div style="padding: 20px; color: #1e293b; line-height: 1.6;">
            <p>Hallo,</p>
            <p>für die Wohnung <strong>${listingTitle}</strong> ist eine neue Bewerbung eingegangen.</p>
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
              <tr>
                <td style="padding: 8px 0; font-weight: bold; border-bottom: 1px solid #f1f5f9; width: 150px;">Bewerber:</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f1f5f9;">${applicant.first_name} ${applicant.last_name}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; border-bottom: 1px solid #f1f5f9;">E-Mail:</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f1f5f9;">${applicant.email}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; border-bottom: 1px solid #f1f5f9;">Telefon:</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f1f5f9;">${applicant.phone || 'Keine Angabe'}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; border-bottom: 1px solid #f1f5f9;">Monatseinkommen:</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f1f5f9;">${applicant.monthly_income ? applicant.monthly_income.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }) : 'Keine Angabe'}</td>
              </tr>
            </table>
            <p>Die vollständige Selbstauskunft sowie alle hochgeladenen Dokumente finden Sie direkt in Ihrem Vermietungscockpit oder im Objektordner in der Cloud.</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="https://app.immocontrol360.de/app/letting" style="background-color: #1e293b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Zum Vermietungscockpit</a>
            </div>
          </div>
        </div>
      `;

      // Trigger emails
      await sendMail(config, applicant.email, tenantSubject, tenantHtml);
      
      // Try to get landlord email from profile
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('email')
        .eq('id', process.user_id)
        .maybeSingle();

      if (profile?.email) {
        await sendMail(config, profile.email, landlordSubject, landlordHtml);
      }

    } else if (action === 'booking_confirmed') {
      // 1. Fetch booking details
      const { data: booking, error: bookErr } = await supabaseAdmin
        .from('rental_viewing_bookings')
        .select('*')
        .eq('id', bookingId)
        .single();
      if (bookErr || !booking) throw new Error('Booking not found');

      // 2. Fetch viewing day
      const { data: viewing, error: viewErr } = await supabaseAdmin
        .from('rental_viewings')
        .select('*')
        .eq('id', booking.viewing_id)
        .single();
      if (viewErr || !viewing) throw new Error('Viewing day not found');

      // 3. Fetch applicant
      const { data: applicant, error: appErr } = await supabaseAdmin
        .from('rental_applicants')
        .select('*')
        .eq('id', booking.applicant_id)
        .single();
      if (appErr || !applicant) throw new Error('Applicant not found');

      // 4. Fetch process
      const { data: process, error: procErr } = await supabaseAdmin
        .from('rental_processes')
        .select('*')
        .eq('id', applicant.process_id)
        .single();
      if (procErr || !process) throw new Error('Rental process not found');

      // 5. Fetch property
      const { data: unit, error: unitErr } = await supabaseAdmin
        .from('units')
        .select('*, properties(name, street, house_number, zip, city)')
        .eq('id', process.unit_id)
        .single();
      if (unitErr || !unit) throw new Error('Unit not found');

      const property = unit.properties;
      const listingTitle = process.listing_title || `${property.name} - ${unit.unit_name}`;
      const addressStr = `${property.street} ${property.house_number}, ${property.zip} ${property.city}`;
      const dateStr = new Date(viewing.date).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      const timeStr = `${booking.start_time.substring(0, 5)} - ${booking.end_time.substring(0, 5)} Uhr`;

      // Resolve SMTP configuration for landlord (process.user_id)
      const config = await getSmtpConfig(supabaseAdmin, process.user_id);
      if (!config) {
        console.warn('No email config found. Skipping email sending.');
        return new Response(JSON.stringify({ success: false, warning: 'No email config configured' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
      }

      // Tenant Email Template
      const tenantSubject = `Besichtigungstermin bestätigt: ${listingTitle}`;
      const manageLink = `https://app.immocontrol360.de/besichtigung/${process.token}?applicantId=${applicant.id}`;
      const tenantHtml = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <div style="background-color: #10b981; color: white; padding: 20px; border-radius: 6px; text-align: center;">
            <h2 style="margin: 0; font-size: 20px;">Besichtigungstermin bestätigt</h2>
          </div>
          <div style="padding: 20px; color: #1e293b; line-height: 1.6;">
            <p>Hallo ${applicant.first_name} ${applicant.last_name},</p>
            <p>Ihr Besichtigungstermin für die Wohnung <strong>${listingTitle}</strong> wurde erfolgreich gebucht.</p>
            <div style="background-color: #f8fafc; padding: 20px; border-radius: 6px; margin: 20px 0; border: 1px solid #e2e8f0;">
              <strong style="display: block; font-size: 15px; color: #64748b; text-transform: uppercase; margin-bottom: 5px;">Datum & Uhrzeit:</strong>
              <span style="font-size: 18px; font-weight: bold; color: #1e293b;">${dateStr}</span><br/>
              <span style="font-size: 16px; font-weight: bold; color: #10b981;">${timeStr}</span>
              <strong style="display: block; font-size: 15px; color: #64748b; text-transform: uppercase; margin-top: 15px; margin-bottom: 5px;">Adresse:</strong>
              <span style="font-size: 15px; font-weight: bold; color: #1e293b;">${addressStr}</span>
            </div>
            <p>Sollten Sie den Termin absagen oder verschieben müssen, nutzen Sie bitte das Portal:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${manageLink}" style="background-color: #1e293b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Termin verwalten / verschieben</a>
            </div>
            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;"/>
            <p style="font-size: 14px; color: #64748b; margin: 0;">Freundliche Grüße,<br/>Ihr Vermieter-Team</p>
          </div>
        </div>
      `;

      // Landlord Email Template
      const landlordSubject = `Termin gebucht: ${applicant.first_name} ${applicant.last_name} - ${listingTitle}`;
      const landlordHtml = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <div style="background-color: #10b981; color: white; padding: 20px; border-radius: 6px;">
            <h2 style="margin: 0; font-size: 20px;">Besichtigung gebucht</h2>
          </div>
          <div style="padding: 20px; color: #1e293b; line-height: 1.6;">
            <p>Hallo,</p>
            <p>für Ihre Wohnung <strong>${listingTitle}</strong> wurde ein Besichtigungstermin gebucht.</p>
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
              <tr>
                <td style="padding: 8px 0; font-weight: bold; border-bottom: 1px solid #f1f5f9; width: 150px;">Bewerber:</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f1f5f9;">${applicant.first_name} ${applicant.last_name}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; border-bottom: 1px solid #f1f5f9;">Datum:</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f1f5f9;">${dateStr}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; border-bottom: 1px solid #f1f5f9;">Uhrzeit:</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f1f5f9;">${timeStr}</td>
              </tr>
            </table>
            <p>Die Buchung ist live im Cockpit eingetragen.</p>
          </div>
        </div>
      `;

      await sendMail(config, applicant.email, tenantSubject, tenantHtml);

      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('email')
        .eq('id', process.user_id)
        .maybeSingle();

      if (profile?.email) {
        await sendMail(config, profile.email, landlordSubject, landlordHtml);
      }

    } else if (action === 'booking_canceled') {
      // 1. Fetch booking details
      const { data: booking, error: bookErr } = await supabaseAdmin
        .from('rental_viewing_bookings')
        .select('*')
        .eq('id', bookingId)
        .single();
      if (bookErr || !booking) throw new Error('Booking not found');

      // 2. Fetch viewing day
      const { data: viewing, error: viewErr } = await supabaseAdmin
        .from('rental_viewings')
        .select('*')
        .eq('id', booking.viewing_id)
        .single();
      if (viewErr || !viewing) throw new Error('Viewing day not found');

      // 3. Fetch applicant
      const { data: applicant, error: appErr } = await supabaseAdmin
        .from('rental_applicants')
        .select('*')
        .eq('id', booking.applicant_id)
        .single();
      if (appErr || !applicant) throw new Error('Applicant not found');

      // 4. Fetch process
      const { data: process, error: procErr } = await supabaseAdmin
        .from('rental_processes')
        .select('*')
        .eq('id', applicant.process_id)
        .single();
      if (procErr || !process) throw new Error('Rental process not found');

      const listingTitle = process.listing_title || "Besichtigungstermin";
      const dateStr = new Date(viewing.date).toLocaleDateString('de-DE');
      const timeStr = `${booking.start_time.substring(0, 5)} - ${booking.end_time.substring(0, 5)} Uhr`;

      // Resolve SMTP configuration for landlord (process.user_id)
      const config = await getSmtpConfig(supabaseAdmin, process.user_id);
      if (!config) {
        console.warn('No email config found. Skipping email sending.');
        return new Response(JSON.stringify({ success: false, warning: 'No email config configured' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
      }

      // Tenant Cancellation Email
      const tenantSubject = `Besichtigungstermin abgesagt: ${listingTitle}`;
      const bookNewLink = `https://app.immocontrol360.de/besichtigung/${process.token}?applicantId=${applicant.id}`;
      const tenantHtml = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <div style="background-color: #ef4444; color: white; padding: 20px; border-radius: 6px; text-align: center;">
            <h2 style="margin: 0; font-size: 20px;">Besichtigungstermin abgesagt</h2>
          </div>
          <div style="padding: 20px; color: #1e293b; line-height: 1.6;">
            <p>Hallo ${applicant.first_name} ${applicant.last_name},</p>
            <p>Ihr Termin am <strong>${dateStr} um ${timeStr}</strong> für die Wohnung <strong>${listingTitle}</strong> wurde abgesagt.</p>
            <p>Sie können sich jederzeit einen neuen freien Termin aussuchen:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${bookNewLink}" style="background-color: #ef4444; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Neuen Termin buchen</a>
            </div>
            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;"/>
            <p style="font-size: 14px; color: #64748b; margin: 0;">Freundliche Grüße,<br/>Ihr Vermieter-Team</p>
          </div>
        </div>
      `;

      // Landlord Notification Email
      const landlordSubject = `Termin abgesagt: ${applicant.first_name} ${applicant.last_name} - ${listingTitle}`;
      const landlordHtml = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <div style="background-color: #ef4444; color: white; padding: 20px; border-radius: 6px;">
            <h2 style="margin: 0; font-size: 20px;">Besichtigung abgesagt</h2>
          </div>
          <div style="padding: 20px; color: #1e293b; line-height: 1.6;">
            <p>Hallo,</p>
            <p>der Besichtigungstermin mit <strong>${applicant.first_name} ${applicant.last_name}</strong> wurde abgesagt.</p>
            <p><strong>Ursprünglicher Termin:</strong> ${dateStr} um ${timeStr}</p>
            <p>Der Slot is im Planer wieder als frei markiert.</p>
          </div>
        </div>
      `;

      await sendMail(config, applicant.email, tenantSubject, tenantHtml);

      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('email')
        .eq('id', process.user_id)
        .maybeSingle();

      if (profile?.email) {
        await sendMail(config, profile.email, landlordSubject, landlordHtml);
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error: any) {
    console.error('Error in send-letting-email function:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
})
