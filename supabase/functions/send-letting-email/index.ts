import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'
import nodemailer from "npm:nodemailer@6.9.13"

// ─────────────────────────────────────────────────────────────────────────────
// send-letting-email
//
// Sicherheitsmodell (Komplett-Check 2026-11-27):
//  • Angemeldete Aktionen (test_connection, send_tenant_invite, get_invite_link,
//    revoke_tenant_invite, send_custom_email) – Vertrag C2: Der Nutzer wird
//    ausschließlich aus dem Authorization-Header ermittelt. Der öffentliche anon-Key
//    zählt NICHT als Anmeldung, `userId` im Body wird ignoriert (darf aus
//    Kompatibilität weiter mitgeschickt werden).
//  • Öffentliche Aktionen (application_received, booking_confirmed,
//    booking_canceled) – Vertrag C1: nur mit `process_token` des laufenden
//    Vermietungsprozesses plus `applicant_id` bzw. `booking_id`. Empfänger kommen
//    ausschließlich aus der Datenbank, nie aus dem Body. Jede Prozess-Mail wird
//    über eine Spalte *_mail_sent_at atomar belegt (höchstens einmal je Ereignis).
//  • Das SMTP-Passwort liegt verschlüsselt im Supabase Vault und wird nur über die
//    Datenbank-Funktion get_smtp_password (nur service_role) gelesen.
//  • Fachliche Fehler werden mit HTTP 200 und { success: false, error } beantwortet,
//    damit die App die deutsche Meldung anzeigen kann (supabase.functions.invoke
//    liefert bei Nicht-2xx nur eine generische Fehlermeldung).
// ─────────────────────────────────────────────────────────────────────────────

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const APP_ORIGIN = 'https://app.immocontrol360.de'
// Weiterleitungsziele für Login-/Einladungslinks (feste Allowlist, nie frei aus dem Body)
const ALLOWED_REDIRECT_ORIGINS = new Set([APP_ORIGIN])
// Zielseiten im Mieterportal nach dem Klick auf einen Einladungslink (Mail und QR/Link gleich)
const DEFAULT_TENANT_REDIRECT_PATH = '/tenant/stammdaten'
const ALLOWED_TENANT_REDIRECT_PATHS = new Set(['/tenant', DEFAULT_TENANT_REDIRECT_PATH])

// Öffentliche Prozess-Mails dürfen nur kurz nach dem auslösenden Ereignis verschickt werden
const PUBLIC_EVENT_WINDOW_MS = 30 * 60 * 1000
const MAX_ATTACHMENTS = 10
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MAX_HTML_LENGTH = 500_000
const ALLOWED_SMTP_PORTS = new Set([25, 465, 587, 2525])

const EXISTING_ACCOUNT_MSG = 'Für diese E-Mail-Adresse besteht bereits ein Benutzerkonto, das nicht eindeutig diesem Mieter zugeordnet ist. Aus Sicherheitsgründen wird kein Anmeldelink erzeugt. Der Mieter kann sich mit seinem Passwort bzw. über „Passwort vergessen“ anmelden.'

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

class HttpError extends Error {
  status: number;
  soft: boolean;
  constructor(status: number, message: string, soft = true) {
    super(message);
    this.status = status;
    this.soft = soft;
  }
}

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });

// ── Helfer: Eingaben ────────────────────────────────────────────────────────
const escapeHtml = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] as string));

// Einzeilig + Längenbegrenzung (Betreffzeilen, Namen)
const oneLine = (value: unknown, max = 120): string =>
  String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

const normEmail = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const isValidEmail = (value: string): boolean =>
  typeof value === 'string' &&
  value.length <= 254 &&
  /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/.test(value);

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

// "Name <adresse@domain>" -> "adresse@domain"
const extractAddress = (from: string): string => {
  const m = String(from || '').match(/<([^>]+)>/);
  return (m ? m[1] : String(from || '')).trim();
};

const isRecent = (timestamp: unknown, windowMs: number): boolean => {
  const t = Date.parse(String(timestamp ?? ''));
  if (Number.isNaN(t)) return false;
  const diff = Date.now() - t;
  return diff <= windowMs && diff > -5 * 60 * 1000;
};

// Datenbank-Objekt (Funktion/Spalte) fehlt – Migration noch nicht eingespielt bzw. zurückgebaut
const isMissingDbObject = (error: any): boolean => {
  const code = String(error?.code || '');
  return ['PGRST202', 'PGRST204', '42883', '42703'].includes(code);
};

// Übergangsschutz, solange die Spalten *_mail_sent_at fehlen: nur innerhalb einer Instanz
const recentEvents = new Map<string, number>();
const claimEvent = (key: string): boolean => {
  const now = Date.now();
  for (const [k, t] of recentEvents) {
    if (now - t > PUBLIC_EVENT_WINDOW_MS) recentEvents.delete(k);
  }
  if (recentEvents.has(key)) return false;
  recentEvents.set(key, now);
  return true;
};
const releaseEvent = (key: string) => { recentEvents.delete(key); };

interface MailClaim {
  table: 'rental_applicants' | 'rental_viewing_bookings';
  column: 'received_mail_sent_at' | 'confirmed_mail_sent_at' | 'canceled_mail_sent_at';
  id: string;
  alreadySentMessage: string;
  mode?: 'db' | 'memory';
}

// Prozess-Mail atomar belegen: Nur wer die Spalte von NULL auf einen Zeitpunkt setzt,
// darf versenden. Parallele oder spätere Aufrufe (auch auf anderen Instanzen) erhalten 409.
async function claimProcessMail(supabaseAdmin: any, claim: MailClaim): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from(claim.table)
    .update({ [claim.column]: new Date().toISOString() })
    .eq('id', claim.id)
    .is(claim.column, null)
    .select('id');
  if (!error) {
    if (!data || data.length === 0) throw new HttpError(409, claim.alreadySentMessage);
    claim.mode = 'db';
    return;
  }
  if (!isMissingDbObject(error)) {
    console.error('Mail claim failed:', error.message);
    throw new Error('Mail claim failed');
  }
  if (!claimEvent(`${claim.table}.${claim.column}:${claim.id}`)) {
    throw new HttpError(409, claim.alreadySentMessage);
  }
  claim.mode = 'memory';
}

// Nach einem Versandfehler wieder freigeben, damit ein erneuter Versuch möglich ist
async function releaseProcessMail(supabaseAdmin: any, claim: MailClaim): Promise<void> {
  if (claim.mode === 'memory') {
    releaseEvent(`${claim.table}.${claim.column}:${claim.id}`);
  } else if (claim.mode === 'db') {
    const { error } = await supabaseAdmin
      .from(claim.table)
      .update({ [claim.column]: null })
      .eq('id', claim.id);
    if (error) console.error('Mail claim release failed:', error.message);
  }
  claim.mode = undefined;
}

const resolveRedirectOrigin = (origin: unknown): string => {
  if (typeof origin === 'string') {
    const cleaned = origin.trim().replace(/\/+$/, '');
    if (ALLOWED_REDIRECT_ORIGINS.has(cleaned)) return cleaned;
  }
  return APP_ORIGIN;
};

const resolveTenantRedirectPath = (path: unknown): string =>
  typeof path === 'string' && ALLOWED_TENANT_REDIRECT_PATHS.has(path.trim())
    ? path.trim()
    : DEFAULT_TENANT_REDIRECT_PATH;

// ── SMTP ────────────────────────────────────────────────────────────────────
// SMTP-Passwort aus dem Vault (get_smtp_password, nur service_role). Übergang: Ist die
// Migration noch nicht eingespielt, steht das Passwort noch in der alten Spalte smtp_pass.
async function loadSmtpPassword(supabaseAdmin: any, userId: string): Promise<string> {
  const { data, error } = await supabaseAdmin.rpc('get_smtp_password', { p_user_id: userId });
  if (!error) return typeof data === 'string' ? data : '';
  if (!isMissingDbObject(error)) {
    console.error('SMTP password lookup failed:', error.message);
    throw new HttpError(503, 'Die E-Mail-Einstellungen konnten gerade nicht geladen werden. Bitte versuchen Sie es später erneut.');
  }
  const { data: legacy, error: legacyErr } = await supabaseAdmin
    .from('user_smtp_settings')
    .select('smtp_pass')
    .eq('user_id', userId)
    .maybeSingle();
  if (legacyErr) {
    console.error('SMTP password lookup failed:', legacyErr.message);
    throw new HttpError(503, 'Die E-Mail-Einstellungen konnten gerade nicht geladen werden. Bitte versuchen Sie es später erneut.');
  }
  return typeof legacy?.smtp_pass === 'string' ? legacy.smtp_pass : '';
}

// Nur das eigene Postfach des Nutzers (kein Plattform-Fallback)
async function getUserSmtpConfig(supabaseAdmin: any, userId: string): Promise<SmtpConfig | null> {
  if (!userId) return null;
  const { data: userSettings, error } = await supabaseAdmin
    .from('user_smtp_settings')
    .select('smtp_host, smtp_port, smtp_user, smtp_sender')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('SMTP settings lookup failed:', error.message);
    return null;
  }
  if (!userSettings || !userSettings.smtp_host) return null;

  return {
    host: userSettings.smtp_host,
    port: Number(userSettings.smtp_port) || 587,
    user: userSettings.smtp_user,
    pass: await loadSmtpPassword(supabaseAdmin, userId),
    from: userSettings.smtp_sender || userSettings.smtp_user,
  };
}

// Plattform-Postfach (nur für serverseitig erzeugte Benachrichtigungen mit fester Vorlage)
function getPlatformSmtpConfig(): SmtpConfig | null {
  const smtpHost = Deno.env.get('SMTP_HOST');
  if (!smtpHost) return null;
  return {
    host: smtpHost,
    port: parseInt(Deno.env.get('SMTP_PORT') || '587'),
    user: Deno.env.get('SMTP_USER') || '',
    pass: Deno.env.get('SMTP_PASS') || '',
    from: Deno.env.get('SMTP_SENDER') || Deno.env.get('SMTP_USER') || 'no-reply@immocontrol360.de',
  };
}

async function getNotificationSmtpConfig(supabaseAdmin: any, userId: string): Promise<SmtpConfig | null> {
  const own = await getUserSmtpConfig(supabaseAdmin, userId);
  if (own) {
    console.log('Using custom SMTP settings of the landlord.');
    return own;
  }
  const platform = getPlatformSmtpConfig();
  if (platform) console.log('Using platform SMTP settings.');
  return platform;
}

async function sendMail(config: SmtpConfig, to: string, subject: string, html: string, attachments?: any[], replyTo?: string) {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: config.user ? { user: config.user, pass: config.pass } : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });

  // Envelope-Absender nur setzen, wenn eine gültige Adresse bekannt ist (SPF/Bounces).
  // Logins wie "apikey" sind keine Adresse -> Adresse aus dem From-Header nehmen bzw.
  // nodemailer den Envelope selbst ableiten lassen.
  const smtpUser = normEmail(config.user);
  const fromAddress = normEmail(extractAddress(config.from));
  const envelopeFrom = isValidEmail(smtpUser) ? config.user.trim() : (isValidEmail(fromAddress) ? fromAddress : '');

  const mail: Record<string, unknown> = {
    from: config.from,
    to,
    subject: oneLine(subject, 200),
    html,
    attachments,
  };
  if (envelopeFrom) mail.envelope = { from: envelopeFrom, to };
  if (replyTo && isValidEmail(normEmail(replyTo))) mail.replyTo = replyTo;

  const info = await transporter.sendMail(mail);
  console.log(`Email sent successfully: ${info.messageId}`);
  return info;
}

// SMTP-Fehler in verständliche Meldungen übersetzen (keine rohen Servertexte an den Client)
function describeSmtpError(err: any): string {
  const code = String(err?.code || '');
  const responseCode = Number(err?.responseCode || 0);
  if (code === 'EAUTH' || responseCode === 535 || responseCode === 534) {
    return 'Anmeldung am Mailserver fehlgeschlagen. Bitte Benutzername und Passwort prüfen.';
  }
  if (['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH'].includes(code)) {
    return 'Der Mailserver ist nicht erreichbar. Bitte Server und Port prüfen.';
  }
  if (code === 'ETLS') {
    return 'Die verschlüsselte Verbindung zum Mailserver ist fehlgeschlagen. Bitte Port und SSL/TLS prüfen.';
  }
  if (code === 'EENVELOPE' || (responseCode >= 550 && responseCode < 560)) {
    return 'Der Mailserver hat Absender oder Empfänger abgelehnt.';
  }
  return 'Die E-Mail konnte nicht versendet werden.';
}

// Nur öffentliche Mailserver auf üblichen SMTP-Ports (kein Port-Scan/SSRF ins interne Netz)
function isAllowedSmtpHost(host: string): boolean {
  if (!host || host.length > 253) return false;
  if (!/^[a-z0-9.-]+$/.test(host)) return false; // keine IPv6-Literale, keine Sonderzeichen
  if (!host.includes('.')) return false;
  if (host === 'localhost' || /\.(localhost|local|internal|lan|home|intranet)$/.test(host)) return false;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if ([ipv4[1], ipv4[2], ipv4[3], ipv4[4]].some((p) => Number(p) > 255)) return false;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  }
  return true;
}

// Anhänge serverseitig auf {filename, content(base64), encoding, contentType} beschränken
// (nodemailer würde sonst auch path/href/raw akzeptieren -> Dateizugriff/SSRF)
function sanitizeAttachments(list: unknown): any[] | undefined {
  if (list === undefined || list === null) return undefined;
  if (!Array.isArray(list)) throw new HttpError(422, 'Die Anhänge sind ungültig.');
  if (list.length === 0) return undefined;
  if (list.length > MAX_ATTACHMENTS) throw new HttpError(422, `Es sind höchstens ${MAX_ATTACHMENTS} Anhänge möglich.`);

  let totalBytes = 0;
  return list.map((att: any, index: number) => {
    if (!att || typeof att !== 'object') throw new HttpError(422, 'Ein Anhang ist ungültig.');
    if (att.encoding && att.encoding !== 'base64') throw new HttpError(422, 'Anhänge müssen Base64-kodiert sein.');
    const content = typeof att.content === 'string' ? att.content.replace(/\s+/g, '') : '';
    if (!content || !/^[A-Za-z0-9+/]+={0,2}$/.test(content)) {
      throw new HttpError(422, 'Ein Anhang konnte nicht gelesen werden.');
    }
    totalBytes += Math.floor((content.length * 3) / 4);
    if (totalBytes > MAX_ATTACHMENT_BYTES) {
      throw new HttpError(422, 'Die Anhänge sind zu groß (maximal 10 MB insgesamt).');
    }
    const filename = oneLine(att.filename, 150).replace(/[\\/]/g, '_') || `Anhang-${index + 1}`;
    const contentType = typeof att.contentType === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(att.contentType)
      ? att.contentType
      : 'application/octet-stream';
    return { filename, content, encoding: 'base64', contentType };
  });
}

// ── Aufrufer (Vertrag C2) ───────────────────────────────────────────────────
async function getCaller(req: Request, supabaseAdmin: any) {
  const header = req.headers.get('Authorization') || '';
  const jwt = header.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return null;
  try {
    // Der anon-Key (role=anon, ohne sub) wird von auth.getUser abgelehnt.
    const { data, error } = await supabaseAdmin.auth.getUser(jwt);
    if (error || !data?.user?.id) return null;
    if (data.user.is_anonymous === true) return null;
    return data.user;
  } catch (_err) {
    return null;
  }
}

async function requireCaller(req: Request, supabaseAdmin: any) {
  const caller = await getCaller(req, supabaseAdmin);
  if (!caller) throw new HttpError(401, 'Bitte melden Sie sich an, um diese Aktion auszuführen.', false);
  return caller;
}

// Eigentümer des Mieters oder Mitnutzer mit Schreibrecht "mietverhaeltnisse" auf ein
// Portfolio desselben Vermieters, in dem der Mieter einen Mietvertrag hat
// (entspricht has_tenant_access(tenant, 'mietverhaeltnisse', 'write') im Fundament).
async function getWritableTenant(supabaseAdmin: any, caller: any, tenantId: string) {
  const { data: tenant, error } = await supabaseAdmin
    .from('tenants')
    .select('id, user_id, first_name, last_name, email')
    .eq('id', tenantId)
    .maybeSingle();
  if (error) {
    console.error('Tenant lookup failed:', error.message);
    return null;
  }
  if (!tenant) return null;
  if (tenant.user_id === caller.id) return tenant;

  const callerEmail = normEmail(caller.email);
  if (!callerEmail) return null;

  const { data: leases, error: leaseErr } = await supabaseAdmin
    .from('leases')
    .select('unit:units(property:properties(portfolio_id, portfolio:portfolios(user_id)))')
    .eq('tenant_id', tenantId);
  if (leaseErr) {
    console.error('Lease lookup failed:', leaseErr.message);
    return null;
  }
  const portfolioIds = [...new Set(
    (leases || [])
      .map((l: any) => l?.unit?.property)
      .filter((p: any) => p && p.portfolio_id && p.portfolio?.user_id === tenant.user_id)
      .map((p: any) => p.portfolio_id),
  )];
  if (portfolioIds.length === 0) return null;

  const { data: shares, error: shareErr } = await supabaseAdmin
    .from('portfolio_shares')
    .select('shared_with_email, permissions')
    .in('portfolio_id', portfolioIds)
    .eq('status', 'accepted');
  if (shareErr) {
    console.error('Share lookup failed:', shareErr.message);
    return null;
  }
  const allowed = (shares || []).some((s: any) =>
    normEmail(s.shared_with_email) === callerEmail &&
    s.permissions && typeof s.permissions === 'object' &&
    s.permissions.mietverhaeltnisse === 'write'
  );
  return allowed ? tenant : null;
}

// Bestehende Mieter-Konten dieses Mieters (über user_roles)
async function findTenantAccounts(supabaseAdmin: any, tenantId: string) {
  const { data: roles, error } = await supabaseAdmin
    .from('user_roles')
    .select('user_id')
    .eq('tenant_id', tenantId)
    .eq('role', 'tenant');
  if (error) {
    console.error('Role lookup failed:', error.message);
    return [];
  }
  const accounts: any[] = [];
  for (const r of roles || []) {
    const { data, error: userErr } = await supabaseAdmin.auth.admin.getUserById(r.user_id);
    if (!userErr && data?.user) accounts.push(data.user);
  }
  return accounts;
}

// Ein Konto gilt nur dann als "ausschließlich Mieter-Konto dieses Mieters", wenn
//  • es über die Mieter-Einladung für genau diesen Mieter entstanden ist (user_metadata.tenant_id),
//  • alle Rollenzeilen Mieterrollen dieses Mieters sind und
//  • es keine eigenen Vermieterdaten (Portfolios, Objekte, Mieter) besitzt.
// Nur dann darf ein Anmeldelink erzeugt werden.
async function isExclusiveTenantAccount(supabaseAdmin: any, user: any, tenantId: string): Promise<boolean> {
  if (!user?.id) return false;
  const metaTenant = String(user.user_metadata?.tenant_id || '').toLowerCase();
  if (metaTenant !== String(tenantId).toLowerCase()) return false;

  const { data: roles, error } = await supabaseAdmin
    .from('user_roles')
    .select('role, tenant_id')
    .eq('user_id', user.id);
  if (error) return false;
  if ((roles || []).some((r: any) => r.role !== 'tenant' || String(r.tenant_id || '').toLowerCase() !== String(tenantId).toLowerCase())) {
    return false;
  }

  for (const table of ['portfolios', 'properties', 'tenants']) {
    const { count, error: countErr } = await supabaseAdmin
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);
    if (countErr || (count ?? 0) > 0) return false;
  }
  return true;
}

// Einheit/Objekt für die Einladungs-Metadaten serverseitig aus den Mietverträgen ableiten
async function resolveTenantPlacement(supabaseAdmin: any, tenantId: string, requestedUnitId: unknown) {
  const { data: leases, error } = await supabaseAdmin
    .from('leases')
    .select('unit_id, status, unit:units(property_id)')
    .eq('tenant_id', tenantId);
  if (error) {
    console.error('Lease placement lookup failed:', error.message);
    return { unitId: null, propertyId: null };
  }
  const list = leases || [];
  const pick = (isUuid(requestedUnitId) ? list.find((l: any) => l.unit_id === requestedUnitId) : null)
    || list.find((l: any) => l.status === 'active')
    || null;
  return { unitId: pick?.unit_id || null, propertyId: pick?.unit?.property_id || null };
}

async function prepareTenantLink(supabaseAdmin: any, caller: any, payload: any) {
  const tenantId = payload.tenantId ?? payload.tenant_id;
  if (!isUuid(tenantId)) throw new HttpError(422, 'Es wurde kein gültiger Mieter angegeben.');

  const tenant = await getWritableTenant(supabaseAdmin, caller, tenantId);
  if (!tenant) throw new HttpError(403, 'Sie haben keine Berechtigung, für diesen Mieter Einladungen zu erstellen.');

  const storedEmail = normEmail(tenant.email);
  const requested = normEmail(payload.to) || storedEmail;
  if (!requested) {
    throw new HttpError(422, 'Beim Mieter ist keine E-Mail-Adresse hinterlegt. Bitte tragen Sie sie zuerst in den Mieterdaten ein.');
  }

  const accounts = await findTenantAccounts(supabaseAdmin, tenantId);
  const existing = accounts.find((a: any) => normEmail(a.email) === requested) || null;

  // Links nur an die beim Mieter hinterlegte Adresse bzw. an das bestehende Mieter-Konto dieses Mieters
  if (!existing && requested !== storedEmail) {
    throw new HttpError(422, 'Die E-Mail-Adresse stimmt nicht mit der beim Mieter hinterlegten Adresse überein. Bitte passen Sie zuerst die Mieterdaten an.');
  }
  if (!isValidEmail(requested)) {
    throw new HttpError(422, 'Die beim Mieter hinterlegte E-Mail-Adresse ist ungültig.');
  }

  const placement = await resolveTenantPlacement(supabaseAdmin, tenantId, payload.unitId ?? payload.unit_id);
  return { tenant, email: requested, existing, placement };
}

async function generateTenantLink(supabaseAdmin: any, ctx: any, redirectTo: string): Promise<string> {
  if (ctx.existing) {
    // Bestehendes Konto: Magic-Link nur für ein ausschließliches Mieter-Konto dieses Mieters
    if (!(await isExclusiveTenantAccount(supabaseAdmin, ctx.existing, ctx.tenant.id))) {
      throw new HttpError(409, EXISTING_ACCOUNT_MSG);
    }
    const magicResult = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: ctx.email,
      options: { redirectTo },
    });
    const link = magicResult.data?.properties?.action_link;
    if (magicResult.error || !link) {
      console.error('Magic link generation failed:', magicResult.error?.message);
      throw new HttpError(502, 'Der Anmeldelink konnte nicht erzeugt werden. Bitte versuchen Sie es später erneut.');
    }
    if (magicResult.data?.user?.id && magicResult.data.user.id !== ctx.existing.id) {
      throw new HttpError(409, EXISTING_ACCOUNT_MSG);
    }
    return link;
  }

  // Neues (oder noch nicht bestätigtes, früher eingeladenes) Konto: Einladungslink
  const inviteResult = await supabaseAdmin.auth.admin.generateLink({
    type: 'invite',
    email: ctx.email,
    options: {
      redirectTo,
      data: {
        role: 'tenant',
        tenant_id: ctx.tenant.id,
        unit_id: ctx.placement.unitId,
        property_id: ctx.placement.propertyId,
      },
    },
  });
  if (inviteResult.error || !inviteResult.data?.properties?.action_link) {
    // Typisch: bestätigtes Konto existiert bereits -> niemals auf Magic-Link für fremde Konten ausweichen
    console.warn('Invite link generation refused:', inviteResult.error?.message);
    throw new HttpError(409, EXISTING_ACCOUNT_MSG);
  }
  // Auch ein (unbestätigtes) Fremdkonto darf keinen Link bekommen
  if (!(await isExclusiveTenantAccount(supabaseAdmin, inviteResult.data.user, ctx.tenant.id))) {
    throw new HttpError(409, EXISTING_ACCOUNT_MSG);
  }
  return inviteResult.data.properties.action_link;
}

// Auth-Konto zu einer E-Mail-Adresse (Datenbank-Funktion, nur service_role).
// Übergang ohne Migration: Kontenliste seitenweise durchsuchen.
async function findAuthUserByEmail(supabaseAdmin: any, email: string) {
  const { data: userId, error } = await supabaseAdmin.rpc('get_auth_user_id_by_email', { p_email: email });
  if (!error) {
    if (!isUuid(userId)) return null;
    const { data, error: userErr } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (userErr) {
      console.error('User lookup failed:', userErr.message);
      throw new Error('User lookup failed');
    }
    return data?.user || null;
  }
  if (!isMissingDbObject(error)) {
    console.error('User lookup failed:', error.message);
    throw new Error('User lookup failed');
  }
  const perPage = 1000;
  for (let page = 1; page <= 50; page++) {
    const { data, error: listErr } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (listErr) {
      console.error('User list failed:', listErr.message);
      throw new Error('User list failed');
    }
    const users = data?.users || [];
    const match = users.find((u: any) => normEmail(u.email) === email);
    if (match) return match;
    if (users.length < perPage) break;
  }
  return null;
}

// Zurückgezogene Einladung: Das per Einladungslink angelegte, noch nie bestätigte Konto
// löschen – damit wird der versendete Link ungültig. Bestätigte, fremd genutzte oder
// für weitere Einladungen benötigte Konten bleiben unverändert.
async function revokeInviteAccount(supabaseAdmin: any, email: string, tenantId: string) {
  const user = await findAuthUserByEmail(supabaseAdmin, email);
  if (!user) return { linkRevoked: true, accountDeleted: false, reason: 'no_account' };
  if (user.email_confirmed_at || user.confirmed_at || user.last_sign_in_at) {
    return { linkRevoked: false, accountDeleted: false, reason: 'confirmed' };
  }
  if (!user.invited_at || !(await isExclusiveTenantAccount(supabaseAdmin, user, tenantId))) {
    return { linkRevoked: false, accountDeleted: false, reason: 'foreign' };
  }

  // Weitere offene Einladungen an dieselbe Adresse (anderer Mieter) bräuchten das Konto noch
  const { data: others, error: othersErr } = await supabaseAdmin
    .from('tenant_invitations')
    .select('id, tenant_id')
    .ilike('email', email.replace(/[\\%_]/g, (m) => '\\' + m))
    .eq('status', 'pending')
    .neq('tenant_id', tenantId)
    .limit(1);
  if (othersErr) {
    console.error('Invitation lookup failed:', othersErr.message);
    throw new Error('Invitation lookup failed');
  }
  if (others && others.length > 0) {
    return { linkRevoked: false, accountDeleted: false, reason: 'shared' };
  }

  const { error: deleteErr } = await supabaseAdmin.auth.admin.deleteUser(user.id);
  if (deleteErr) {
    console.error('Invite account deletion failed:', deleteErr.message);
    throw new HttpError(502, 'Der Einladungslink konnte nicht widerrufen werden. Bitte versuchen Sie es später erneut.');
  }
  return { linkRevoked: true, accountDeleted: true, reason: 'deleted' };
}

// ── Öffentliche Prozess-Aktionen (Vertrag C1) ───────────────────────────────
async function loadPublicProcess(supabaseAdmin: any, payload: any) {
  const token = payload.process_token ?? payload.processToken;
  if (typeof token !== 'string' || token.length < 8 || token.length > 200) {
    throw new HttpError(403, 'Der Link zum Vermietungsprozess ist ungültig.');
  }
  const { data: process, error } = await supabaseAdmin
    .from('rental_processes')
    .select('*')
    .eq('token', token)
    .maybeSingle();
  if (error) {
    console.error('Process lookup failed:', error.message);
    throw new Error('Process lookup failed');
  }
  if (!process || process.status !== 'in_vermietung') {
    throw new HttpError(403, 'Dieser Vermietungsprozess ist nicht (mehr) aktiv.');
  }
  return process;
}

async function loadListing(supabaseAdmin: any, process: any) {
  const { data: unit, error } = await supabaseAdmin
    .from('units')
    .select('unit_name, property:properties(street, house_number, zip, city, object_key)')
    .eq('id', process.unit_id)
    .maybeSingle();
  if (error) console.error('Unit lookup failed:', error.message);

  const p = unit?.property || {};
  const streetLine = [p.street, p.house_number].filter(Boolean).join(' ');
  const cityLine = [p.zip, p.city].filter(Boolean).join(' ');
  const addressStr = [streetLine, cityLine].filter(Boolean).join(', ');
  const fallbackTitle = [streetLine || p.object_key, unit?.unit_name].filter(Boolean).join(' - ');
  const listingTitle = oneLine(process.listing_title, 150) || oneLine(fallbackTitle, 150) || 'Wohnung';
  return { listingTitle, addressStr };
}

async function getLandlordEmail(supabaseAdmin: any, userId: string): Promise<string | null> {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('email')
    .eq('id', userId)
    .maybeSingle();
  const profileEmail = normEmail(profile?.email);
  if (isValidEmail(profileEmail)) return profileEmail;

  const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
  const authEmail = normEmail(data?.user?.email);
  return isValidEmail(authEmail) ? authEmail : null;
}

async function loadBookingContext(supabaseAdmin: any, process: any, payload: any) {
  const bookingId = payload.booking_id ?? payload.bookingId;
  if (!isUuid(bookingId)) throw new HttpError(422, 'Es wurde keine gültige Buchung angegeben.');

  const { data: booking, error: bookErr } = await supabaseAdmin
    .from('rental_viewing_bookings')
    .select('*')
    .eq('id', bookingId)
    .maybeSingle();
  if (bookErr) throw new Error(`Booking lookup failed: ${bookErr.message}`);
  if (!booking) throw new HttpError(404, 'Die Buchung wurde nicht gefunden.');

  const { data: viewing, error: viewErr } = await supabaseAdmin
    .from('rental_viewings')
    .select('*')
    .eq('id', booking.viewing_id)
    .eq('process_id', process.id)
    .maybeSingle();
  if (viewErr) throw new Error(`Viewing lookup failed: ${viewErr.message}`);
  if (!viewing) throw new HttpError(404, 'Die Buchung gehört nicht zu diesem Vermietungsprozess.');

  const requestedApplicant = payload.applicant_id ?? payload.applicantId;
  if (requestedApplicant && requestedApplicant !== booking.applicant_id) {
    throw new HttpError(404, 'Die Buchung gehört nicht zu diesem Bewerber.');
  }

  const { data: applicant, error: appErr } = await supabaseAdmin
    .from('rental_applicants')
    .select('*')
    .eq('id', booking.applicant_id)
    .eq('process_id', process.id)
    .maybeSingle();
  if (appErr) throw new Error(`Applicant lookup failed: ${appErr.message}`);
  if (!applicant) throw new HttpError(404, 'Der Bewerber gehört nicht zu diesem Vermietungsprozess.');

  return { booking, viewing, applicant };
}

const bookingPortalLink = (process: any, applicant: any) =>
  `${APP_ORIGIN}/besichtigung/${encodeURIComponent(process.token)}?applicantId=${encodeURIComponent(applicant.id)}`;

const formatViewingDate = (date: string, long: boolean) => {
  const d = new Date(`${String(date).substring(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(date ?? '');
  return long
    ? d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    : d.toLocaleDateString('de-DE', { timeZone: 'UTC' });
};

const formatSlot = (booking: any) =>
  `${String(booking.start_time ?? '').substring(0, 5)} - ${String(booking.end_time ?? '').substring(0, 5)} Uhr`;

const noProcessMailConfig = () => {
  console.warn('No email config found. Skipping email sending.');
  return json({ success: false, warning: 'No email config configured' });
};

// Versendet Bewerber- und Vermieter-Mail; Empfänger ausschließlich aus der DB
async function dispatchProcessMails(
  supabaseAdmin: any,
  config: SmtpConfig,
  process: any,
  applicant: any,
  tenantMail: { subject: string; html: string },
  landlordMail: { subject: string; html: string },
) {
  const applicantEmail = normEmail(applicant.email);
  const landlordEmail = await getLandlordEmail(supabaseAdmin, process.user_id);

  try {
    if (isValidEmail(applicantEmail)) {
      await sendMail(config, applicantEmail, tenantMail.subject, tenantMail.html);
    } else {
      console.warn('Applicant has no valid email address, skipping applicant mail.');
    }
    if (landlordEmail) {
      await sendMail(config, landlordEmail, landlordMail.subject, landlordMail.html);
    }
  } catch (err: any) {
    console.error('Process mail failed:', err?.code || '', err?.message || err);
    throw new HttpError(502, 'Die Bestätigungs-E-Mail konnte nicht versendet werden.');
  }
  return json({ success: true });
}

// ── Mail-Vorlagen ───────────────────────────────────────────────────────────
const SIGNATURE = `<hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;"/>
            <p style="font-size: 14px; color: #64748b; margin: 0;">Freundliche Grüße,<br/>Ihr Vermieter-Team</p>`;

function inviteMailHtml(salutation: string, link: string) {
  const safeLink = escapeHtml(link);
  return `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <div style="background-color: #0ea5e9; color: white; padding: 20px; border-radius: 6px; text-align: center;">
            <h2 style="margin: 0; font-size: 20px;">Einladung zum Mieterportal</h2>
          </div>
          <div style="padding: 20px; color: #1e293b; line-height: 1.6;">
            <p>${salutation}</p>
            <p>Wir möchten Sie herzlich dazu einladen, das <strong>ImmoControlpro360 Mieterportal</strong> zu nutzen.</p>
            <p>Über das Mieterportal können Sie ganz bequem:</p>
            <ul style="padding-left: 20px; color: #475569;">
              <li>Ihre Mietverträge und Dokumente online einsehen</li>
              <li>Nebenkostenabrechnungen prüfen</li>
              <li>Schadensmeldungen und Anfragen direkt an uns senden</li>
              <li>Ihre Kontaktdaten auf dem aktuellen Stand halten</li>
            </ul>
            <p>Klicken Sie auf den folgenden Button, um sich direkt und ohne Passwort im Portal anzumelden:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${safeLink}" style="background-color: #0ea5e9; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Jetzt im Mieterportal anmelden</a>
            </div>
            <p style="font-size: 13px; color: #64748b;">Falls der Button oben nicht funktioniert, kopieren Sie bitte folgenden Link in Ihren Browser:<br/>${safeLink}</p>
            ${SIGNATURE}
          </div>
        </div>
      `;
}

// ── Handler ─────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ success: false, error: 'Methode nicht erlaubt.' }, 405);
  }

  try {
    let payload: any;
    try {
      payload = await req.json();
    } catch (_err) {
      throw new HttpError(400, 'Ungültige Anfrage.', false);
    }
    if (!payload || typeof payload !== 'object') throw new HttpError(400, 'Ungültige Anfrage.', false);
    const { action } = payload;

    // Create Supabase Admin client
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    // ACTION: TEST CONNECTION (nur angemeldet; nur öffentliche Mailserver; Testmail nur an eigene Adresse)
    if (action === 'test_connection') {
      const caller = await requireCaller(req, supabaseAdmin);
      const settings = payload.settings || {};
      const host = String(settings.smtp_host || '').trim().toLowerCase();
      if (!isAllowedSmtpHost(host)) {
        throw new HttpError(422, 'Bitte geben Sie einen gültigen, öffentlich erreichbaren SMTP-Server an.');
      }
      const port = parseInt(String(settings.smtp_port || '587'), 10);
      if (!ALLOWED_SMTP_PORTS.has(port)) {
        throw new HttpError(422, 'Erlaubte SMTP-Ports sind 25, 465, 587 und 2525.');
      }
      const smtpUser = String(settings.smtp_user || '').trim();
      let smtpPass = typeof settings.smtp_pass === 'string' ? settings.smtp_pass : '';
      if (!smtpUser || smtpUser.length > 320 || smtpPass.length > 1024) {
        throw new HttpError(422, 'Bitte geben Sie gültige SMTP-Zugangsdaten an.');
      }
      // Ist das Passwort im Formular leer, das gespeicherte Passwort desselben Kontos verwenden
      if (!smtpPass) {
        const stored = await getUserSmtpConfig(supabaseAdmin, caller.id);
        if (stored && String(stored.host).trim().toLowerCase() === host && stored.user === smtpUser) {
          smtpPass = stored.pass;
        }
      }
      const from = oneLine(settings.smtp_sender || smtpUser, 320);

      const testEmail = normEmail(payload.test_email);
      const allowedTargets = new Set(
        [normEmail(caller.email), normEmail(extractAddress(from)), isValidEmail(normEmail(smtpUser)) ? normEmail(smtpUser) : '']
          .filter(Boolean),
      );
      if (!isValidEmail(testEmail) || !allowedTargets.has(testEmail)) {
        throw new HttpError(422, 'Die Test-E-Mail kann nur an Ihre eigene Konto-Adresse oder an die Absenderadresse gesendet werden.');
      }

      const config: SmtpConfig = { host, port, user: smtpUser, pass: smtpPass, from };

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

      try {
        await sendMail(config, testEmail, 'ImmoControlpro360 - E-Mail Verbindungstest', testHtml);
      } catch (err: any) {
        console.error('SMTP test failed:', err?.code || '', err?.message || err);
        return json({ success: false, error: describeSmtpError(err) });
      }
      return json({ success: true });
    }

    // ACTION: SEND TENANT INVITATION (Custom SMTP + Magic Link)
    if (action === 'send_tenant_invite') {
      const caller = await requireCaller(req, supabaseAdmin);
      const ctx = await prepareTenantLink(supabaseAdmin, caller, payload);

      // Postfach vor der Link-Erzeugung prüfen (eigenes Postfach, sonst Plattform-Postfach – feste Vorlage)
      const config = await getNotificationSmtpConfig(supabaseAdmin, caller.id);
      if (!config) {
        throw new HttpError(422, 'Es ist kein E-Mail-Versand eingerichtet. Bitte hinterlegen Sie unter Einstellungen > E-Mail Ihr Postfach.');
      }

      const redirectTo = `${resolveRedirectOrigin(payload.origin)}${DEFAULT_TENANT_REDIRECT_PATH}`;
      const magicLink = await generateTenantLink(supabaseAdmin, ctx, redirectTo);

      const firstName = oneLine(ctx.tenant.first_name, 80);
      const lastName = oneLine(ctx.tenant.last_name, 80);
      const salutation = firstName && lastName
        ? `Hallo ${escapeHtml(firstName)} ${escapeHtml(lastName)},`
        : 'Hallo,';

      try {
        await sendMail(config, ctx.email, 'Einladung zum ImmoControlpro360 Mieterportal', inviteMailHtml(salutation, magicLink));
      } catch (err: any) {
        console.error('Invite mail failed:', err?.code || '', err?.message || err);
        throw new HttpError(502, describeSmtpError(err));
      }
      return json({ success: true });
    }

    // ACTION: GET TENANT PORTAL INVITE LINK (Without sending email, returns the action link for QR code)
    if (action === 'get_invite_link') {
      const caller = await requireCaller(req, supabaseAdmin);
      const ctx = await prepareTenantLink(supabaseAdmin, caller, payload);
      // Gleiches Ziel wie der Link in der Einladungs-Mail (nur Pfade aus der Allowlist)
      const redirectTo = `${resolveRedirectOrigin(payload.origin)}${resolveTenantRedirectPath(payload.redirectPath ?? payload.redirect_path)}`;
      const actionLink = await generateTenantLink(supabaseAdmin, ctx, redirectTo);
      return json({ success: true, actionLink });
    }

    // ACTION: REVOKE TENANT INVITE (zurückgezogene Einladung: versendeten Link ungültig machen)
    if (action === 'revoke_tenant_invite') {
      const caller = await requireCaller(req, supabaseAdmin);
      const tenantId = payload.tenantId ?? payload.tenant_id;
      const invitationId = payload.invitationId ?? payload.invitation_id;
      if (!isUuid(tenantId) || !isUuid(invitationId)) {
        throw new HttpError(422, 'Es wurde keine gültige Einladung angegeben.');
      }
      const tenant = await getWritableTenant(supabaseAdmin, caller, tenantId);
      if (!tenant) throw new HttpError(403, 'Sie haben keine Berechtigung, Einladungen dieses Mieters zu verwalten.');

      const { data: invitation, error: invErr } = await supabaseAdmin
        .from('tenant_invitations')
        .select('id, email, tenant_id, status')
        .eq('id', invitationId)
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (invErr) {
        console.error('Invitation lookup failed:', invErr.message);
        throw new Error('Invitation lookup failed');
      }
      if (!invitation) throw new HttpError(404, 'Die Einladung wurde nicht gefunden.');
      // Nur angenommene Einladungen ausnehmen (offene und abgelaufene werden widerrufen,
      // die App zeigt beide als „eingeladen“ an)
      if (invitation.status === 'accepted') {
        throw new HttpError(409, 'Die Einladung wurde bereits angenommen. Bitte entziehen Sie stattdessen den Portalzugang.');
      }

      const email = normEmail(invitation.email);
      if (!isValidEmail(email)) return json({ success: true, linkRevoked: true, accountDeleted: false, reason: 'no_account' });
      const result = await revokeInviteAccount(supabaseAdmin, email, tenantId);
      return json({ success: true, ...result });
    }

    // ACTION: SEND CUSTOM EMAIL (nur angemeldet, nur über das eigene Postfach des Aufrufers)
    if (action === 'send_custom_email') {
      const caller = await requireCaller(req, supabaseAdmin);

      const to = normEmail(payload.to);
      if (!isValidEmail(to)) {
        throw new HttpError(422, 'Bitte geben Sie genau eine gültige Empfängeradresse an.');
      }
      const subject = oneLine(payload.subject, 200);
      if (!subject) throw new HttpError(422, 'Bitte geben Sie einen Betreff an.');
      const html = typeof payload.html === 'string' ? payload.html : '';
      if (!html.trim()) throw new HttpError(422, 'Bitte geben Sie eine Nachricht ein.');
      if (html.length > MAX_HTML_LENGTH) throw new HttpError(422, 'Die Nachricht ist zu lang.');
      const attachments = sanitizeAttachments(payload.attachments);

      let config = await getUserSmtpConfig(supabaseAdmin, caller.id);
      let replyTo: string | undefined;
      if (!config) {
        // Ohne eigenes Postfach: Plattform-Postfach nur an eigene Mieter/Kontakte des Aufrufers
        // (kein Versand an beliebige Adressen), Antworten gehen an den Vermieter.
        const likeTo = to.replace(/[\\%_]/g, (m) => '\\' + m);
        const [{ data: ownTenant }, { data: ownContact }] = await Promise.all([
          supabaseAdmin.from('tenants').select('id').eq('user_id', caller.id).ilike('email', likeTo).limit(1),
          supabaseAdmin.from('contacts').select('id').eq('user_id', caller.id).ilike('email', likeTo).limit(1),
        ]);
        const isOwnRecipient = (ownTenant && ownTenant.length > 0) || (ownContact && ownContact.length > 0);
        const platform = isOwnRecipient ? getPlatformSmtpConfig() : null;
        if (!platform) {
          throw new HttpError(422, 'Für den Versand eigener E-Mails richten Sie bitte zuerst Ihr E-Mail-Postfach unter Einstellungen > E-Mail ein.');
        }
        config = platform;
        replyTo = caller.email || undefined;
      }

      try {
        await sendMail(config, to, subject, html, attachments, replyTo);
      } catch (err: any) {
        console.error('Custom mail failed:', err?.code || '', err?.message || err);
        throw new HttpError(502, describeSmtpError(err));
      }
      return json({ success: true });
    }

    // ACTION: APPLICATION RECEIVED (öffentlich, Vertrag C1)
    if (action === 'application_received') {
      const process = await loadPublicProcess(supabaseAdmin, payload);
      const applicantId = payload.applicant_id ?? payload.applicantId;
      if (!isUuid(applicantId)) throw new HttpError(422, 'Es wurde keine gültige Bewerbung angegeben.');

      const { data: applicant, error: appErr } = await supabaseAdmin
        .from('rental_applicants')
        .select('*')
        .eq('id', applicantId)
        .eq('process_id', process.id)
        .maybeSingle();
      if (appErr) throw new Error(`Applicant lookup failed: ${appErr.message}`);
      if (!applicant) throw new HttpError(404, 'Die Bewerbung wurde nicht gefunden.');
      if (!isRecent(applicant.created_at, PUBLIC_EVENT_WINDOW_MS)) {
        throw new HttpError(409, 'Die Eingangsbestätigung kann nur direkt nach dem Absenden der Bewerbung verschickt werden.');
      }
      if (applicant.received_mail_sent_at) {
        throw new HttpError(409, 'Die Eingangsbestätigung wurde bereits verschickt.');
      }
      const config = await getNotificationSmtpConfig(supabaseAdmin, process.user_id);
      if (!config) return noProcessMailConfig();
      const claim: MailClaim = {
        table: 'rental_applicants',
        column: 'received_mail_sent_at',
        id: applicant.id,
        alreadySentMessage: 'Die Eingangsbestätigung wurde bereits verschickt.',
      };
      await claimProcessMail(supabaseAdmin, claim);

      try {
        const { listingTitle, addressStr } = await loadListing(supabaseAdmin, process);
        const firstName = escapeHtml(oneLine(applicant.first_name, 80));
        const lastName = escapeHtml(oneLine(applicant.last_name, 80));
        const plainName = oneLine(`${applicant.first_name || ''} ${applicant.last_name || ''}`, 120);
        const safeTitle = escapeHtml(listingTitle);
        const safeAddress = escapeHtml(addressStr);
        const bookingLink = escapeHtml(bookingPortalLink(process, applicant));
        const income = Number(applicant.monthly_income);
        const incomeStr = applicant.monthly_income !== null && applicant.monthly_income !== undefined && Number.isFinite(income)
          ? income.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
          : 'Keine Angabe';

        // Email template to applicant (Tenant)
        const tenantHtml = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <div style="background-color: #0ea5e9; color: white; padding: 20px; border-radius: 6px; text-align: center;">
            <h2 style="margin: 0; font-size: 20px;">Bewerbung eingegangen</h2>
          </div>
          <div style="padding: 20px; color: #1e293b; line-height: 1.6;">
            <p>Hallo ${firstName} ${lastName},</p>
            <p>vielen Dank für Ihr Interesse an der Wohnung <strong>${safeTitle}</strong>${safeAddress ? ` (${safeAddress})` : ''}.</p>
            <p>Ihre Selbstauskunft und Unterlagen wurden erfolgreich an uns übermittelt.</p>
            <p>Sie können sich jetzt direkt online Ihren Wunschtermin für die Besichtigung aussuchen:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${bookingLink}" style="background-color: #0ea5e9; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Besichtigungstermin wählen</a>
            </div>
            <p style="font-size: 13px; color: #64748b;">Falls der Button oben nicht funktioniert, kopieren Sie bitte folgenden Link in Ihren Browser:<br/>${bookingLink}</p>
            ${SIGNATURE}
          </div>
        </div>
      `;

        // Email template to Landlord
        const landlordHtml = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <div style="background-color: #1e293b; color: white; padding: 20px; border-radius: 6px;">
            <h2 style="margin: 0; font-size: 20px;">Neue Bewerbung eingegangen</h2>
          </div>
          <div style="padding: 20px; color: #1e293b; line-height: 1.6;">
            <p>Hallo,</p>
            <p>für die Wohnung <strong>${safeTitle}</strong> ist eine neue Bewerbung eingegangen.</p>
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
              <tr>
                <td style="padding: 8px 0; font-weight: bold; border-bottom: 1px solid #f1f5f9; width: 150px;">Bewerber:</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f1f5f9;">${firstName} ${lastName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; border-bottom: 1px solid #f1f5f9;">E-Mail:</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f1f5f9;">${escapeHtml(oneLine(applicant.email, 254))}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; border-bottom: 1px solid #f1f5f9;">Telefon:</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f1f5f9;">${escapeHtml(oneLine(applicant.phone, 60)) || 'Keine Angabe'}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; border-bottom: 1px solid #f1f5f9;">Monatseinkommen:</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f1f5f9;">${escapeHtml(incomeStr)}</td>
              </tr>
            </table>
            <p>Die vollständige Selbstauskunft sowie alle hochgeladenen Dokumente finden Sie direkt in Ihrem Vermietungscockpit oder im Objektordner in der Cloud.</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${APP_ORIGIN}/letting" style="background-color: #1e293b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Zum Vermietungscockpit</a>
            </div>
          </div>
        </div>
      `;

        return await dispatchProcessMails(
          supabaseAdmin, config, process, applicant,
          { subject: `Bewerbung eingegangen: ${listingTitle}`, html: tenantHtml },
          { subject: `Neue Bewerbung: ${plainName} - ${listingTitle}`, html: landlordHtml },
        );
      } catch (err) {
        await releaseProcessMail(supabaseAdmin, claim);
        throw err;
      }
    }

    // ACTION: BOOKING CONFIRMED (öffentlich, Vertrag C1)
    if (action === 'booking_confirmed') {
      const process = await loadPublicProcess(supabaseAdmin, payload);
      const { booking, viewing, applicant } = await loadBookingContext(supabaseAdmin, process, payload);
      if (booking.status !== 'booked') throw new HttpError(409, 'Diese Buchung ist nicht (mehr) aktiv.');
      if (!isRecent(booking.created_at, PUBLIC_EVENT_WINDOW_MS)) {
        throw new HttpError(409, 'Die Terminbestätigung kann nur direkt nach der Buchung verschickt werden.');
      }
      if (booking.confirmed_mail_sent_at) throw new HttpError(409, 'Die Terminbestätigung wurde bereits verschickt.');
      const config = await getNotificationSmtpConfig(supabaseAdmin, process.user_id);
      if (!config) return noProcessMailConfig();
      const claim: MailClaim = {
        table: 'rental_viewing_bookings',
        column: 'confirmed_mail_sent_at',
        id: booking.id,
        alreadySentMessage: 'Die Terminbestätigung wurde bereits verschickt.',
      };
      await claimProcessMail(supabaseAdmin, claim);

      try {
        const { listingTitle, addressStr } = await loadListing(supabaseAdmin, process);
        const firstName = escapeHtml(oneLine(applicant.first_name, 80));
        const lastName = escapeHtml(oneLine(applicant.last_name, 80));
        const plainName = oneLine(`${applicant.first_name || ''} ${applicant.last_name || ''}`, 120);
        const safeTitle = escapeHtml(listingTitle);
        const dateStr = escapeHtml(formatViewingDate(viewing.date, true));
        const timeStr = escapeHtml(formatSlot(booking));
        const manageLink = escapeHtml(bookingPortalLink(process, applicant));

        // Tenant Email Template
        const tenantHtml = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <div style="background-color: #10b981; color: white; padding: 20px; border-radius: 6px; text-align: center;">
            <h2 style="margin: 0; font-size: 20px;">Besichtigungstermin bestätigt</h2>
          </div>
          <div style="padding: 20px; color: #1e293b; line-height: 1.6;">
            <p>Hallo ${firstName} ${lastName},</p>
            <p>Ihr Besichtigungstermin für die Wohnung <strong>${safeTitle}</strong> wurde erfolgreich gebucht.</p>
            <div style="background-color: #f8fafc; padding: 20px; border-radius: 6px; margin: 20px 0; border: 1px solid #e2e8f0;">
              <strong style="display: block; font-size: 15px; color: #64748b; text-transform: uppercase; margin-bottom: 5px;">Datum & Uhrzeit:</strong>
              <span style="font-size: 18px; font-weight: bold; color: #1e293b;">${dateStr}</span><br/>
              <span style="font-size: 16px; font-weight: bold; color: #10b981;">${timeStr}</span>
              <strong style="display: block; font-size: 15px; color: #64748b; text-transform: uppercase; margin-top: 15px; margin-bottom: 5px;">Adresse:</strong>
              <span style="font-size: 15px; font-weight: bold; color: #1e293b;">${escapeHtml(addressStr) || 'Wird Ihnen vom Vermieter mitgeteilt'}</span>
            </div>
            <p>Sollten Sie den Termin absagen oder verschieben müssen, nutzen Sie bitte das Portal:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${manageLink}" style="background-color: #1e293b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Termin verwalten / verschieben</a>
            </div>
            ${SIGNATURE}
          </div>
        </div>
      `;

        // Landlord Email Template
        const landlordHtml = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <div style="background-color: #10b981; color: white; padding: 20px; border-radius: 6px;">
            <h2 style="margin: 0; font-size: 20px;">Besichtigung gebucht</h2>
          </div>
          <div style="padding: 20px; color: #1e293b; line-height: 1.6;">
            <p>Hallo,</p>
            <p>für Ihre Wohnung <strong>${safeTitle}</strong> wurde ein Besichtigungstermin gebucht.</p>
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
              <tr>
                <td style="padding: 8px 0; font-weight: bold; border-bottom: 1px solid #f1f5f9; width: 150px;">Bewerber:</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f1f5f9;">${firstName} ${lastName}</td>
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

        return await dispatchProcessMails(
          supabaseAdmin, config, process, applicant,
          { subject: `Besichtigungstermin bestätigt: ${listingTitle}`, html: tenantHtml },
          { subject: `Termin gebucht: ${plainName} - ${listingTitle}`, html: landlordHtml },
        );
      } catch (err) {
        await releaseProcessMail(supabaseAdmin, claim);
        throw err;
      }
    }

    // ACTION: BOOKING CANCELED (öffentlich, Vertrag C1)
    if (action === 'booking_canceled') {
      const process = await loadPublicProcess(supabaseAdmin, payload);
      const { booking, viewing, applicant } = await loadBookingContext(supabaseAdmin, process, payload);
      // Absage-Mail nur, wenn die Buchung tatsächlich gerade storniert wurde
      if (booking.status !== 'canceled') throw new HttpError(409, 'Diese Buchung wurde nicht storniert.');
      if (!isRecent(booking.canceled_at, PUBLIC_EVENT_WINDOW_MS)) {
        throw new HttpError(409, 'Die Absagebestätigung kann nur direkt nach der Stornierung verschickt werden.');
      }
      if (booking.canceled_mail_sent_at) throw new HttpError(409, 'Die Absagebestätigung wurde bereits verschickt.');
      const config = await getNotificationSmtpConfig(supabaseAdmin, process.user_id);
      if (!config) return noProcessMailConfig();
      const claim: MailClaim = {
        table: 'rental_viewing_bookings',
        column: 'canceled_mail_sent_at',
        id: booking.id,
        alreadySentMessage: 'Die Absagebestätigung wurde bereits verschickt.',
      };
      await claimProcessMail(supabaseAdmin, claim);

      try {
        const listingTitle = oneLine(process.listing_title, 150) || 'Besichtigungstermin';
        const firstName = escapeHtml(oneLine(applicant.first_name, 80));
        const lastName = escapeHtml(oneLine(applicant.last_name, 80));
        const plainName = oneLine(`${applicant.first_name || ''} ${applicant.last_name || ''}`, 120);
        const safeTitle = escapeHtml(listingTitle);
        const dateStr = escapeHtml(formatViewingDate(viewing.date, false));
        const timeStr = escapeHtml(formatSlot(booking));
        const bookNewLink = escapeHtml(bookingPortalLink(process, applicant));

        // Tenant Cancellation Email
        const tenantHtml = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <div style="background-color: #ef4444; color: white; padding: 20px; border-radius: 6px; text-align: center;">
            <h2 style="margin: 0; font-size: 20px;">Besichtigungstermin abgesagt</h2>
          </div>
          <div style="padding: 20px; color: #1e293b; line-height: 1.6;">
            <p>Hallo ${firstName} ${lastName},</p>
            <p>Ihr Termin am <strong>${dateStr} um ${timeStr}</strong> für die Wohnung <strong>${safeTitle}</strong> wurde abgesagt.</p>
            <p>Sie können sich jederzeit einen neuen freien Termin aussuchen:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${bookNewLink}" style="background-color: #ef4444; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Neuen Termin buchen</a>
            </div>
            ${SIGNATURE}
          </div>
        </div>
      `;

        // Landlord Notification Email
        const landlordHtml = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <div style="background-color: #ef4444; color: white; padding: 20px; border-radius: 6px;">
            <h2 style="margin: 0; font-size: 20px;">Besichtigung abgesagt</h2>
          </div>
          <div style="padding: 20px; color: #1e293b; line-height: 1.6;">
            <p>Hallo,</p>
            <p>der Besichtigungstermin mit <strong>${firstName} ${lastName}</strong> wurde abgesagt.</p>
            <p><strong>Ursprünglicher Termin:</strong> ${dateStr} um ${timeStr}</p>
            <p>Der Slot ist im Planer wieder als frei markiert.</p>
          </div>
        </div>
      `;

        return await dispatchProcessMails(
          supabaseAdmin, config, process, applicant,
          { subject: `Besichtigungstermin abgesagt: ${listingTitle}`, html: tenantHtml },
          { subject: `Termin abgesagt: ${plainName} - ${listingTitle}`, html: landlordHtml },
        );
      } catch (err) {
        await releaseProcessMail(supabaseAdmin, claim);
        throw err;
      }
    }

    // Unbekannte oder fehlende Aktion: kein stiller Erfolg
    throw new HttpError(400, 'Unbekannte Aktion.', false);
  } catch (error: any) {
    if (error instanceof HttpError) {
      if (error.status >= 500 || !error.soft) {
        console.warn(`send-letting-email: ${error.status} ${error.message}`);
      }
      return json({ success: false, error: error.message }, error.soft ? 200 : error.status);
    }
    console.error('Error in send-letting-email function:', error);
    return json({ success: false, error: 'Bei der Verarbeitung ist ein interner Fehler aufgetreten.' }, 500);
  }
})
