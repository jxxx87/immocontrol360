/**
 * contact-form
 *
 * Nimmt Anfragen aus dem Kontaktformular der Marketing-Website (immocontrol360.de) entgegen
 * (Komplett-Check 2026-11-27, W1b-01/W1b-04).
 *
 * Ablauf:
 *  1. Plausibilitätsprüfung (Name, E-Mail, Nachricht, Längen).
 *  2. Spam-Schutz: Honeypot-Feld "website" muss leer sein, Mindest-Ausfüllzeit (elapsed_ms),
 *     Begrenzung pro Absender (pseudonymisierte IP), pro E-Mail-Adresse und gesamt pro Stunde.
 *  3. Speichern in public.contact_requests (nur service_role; RLS ohne Policies für anon/authenticated).
 *  4. Benachrichtigung per E-Mail über das Plattform-Postfach, sofern SMTP konfiguriert ist.
 *  Erfolg wird NUR gemeldet, wenn die Anfrage gespeichert ODER per E-Mail zugestellt wurde.
 *
 * Aufruf: POST mit dem öffentlichen anon-Key (verify_jwt = true genügt, eine Anmeldung ist nicht nötig).
 * Fachliche Fehler: HTTP 200 mit { success: false, error } (deutsche Meldung für die Website);
 * code "unavailable" = Dienst nicht nutzbar, die Website zeigt dann die Support-Adresse an.
 *
 * Umgebungsvariablen:
 *  - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (von Supabase gesetzt)
 *  - SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SENDER   (Plattform-Postfach, wie send-letting-email)
 *  - CONTACT_FORM_TO                 Empfänger der Benachrichtigung (kommagetrennt). Ohne Angabe:
 *                                    Adresse aus SMTP_SENDER bzw. SMTP_USER.
 *  - CONTACT_FORM_ALLOWED_ORIGINS    optional, kommagetrennt (Standard: immocontrol360.de, www., lokale Entwicklung)
 *  - CONTACT_FORM_HASH_SECRET        optional, Schlüssel für die Pseudonymisierung der IP
 *                                    (Standard: Service-Role-Key; die IP selbst wird nie gespeichert)
 */

// @ts-ignore
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore
import nodemailer from "npm:nodemailer@6.9.13";

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const HASH_SECRET = Deno.env.get("CONTACT_FORM_HASH_SECRET") || SERVICE_KEY;
const SUPPORT_EMAIL = "support@immocontrol360.de";

// Die Herkunftsprüfung schützt nur vor fremden Websites im Browser (curl & Co. können jeden
// Origin setzen) – daher großzügig: auch http (solange die Website kein HTTPS erzwingt) und lokal.
const DEFAULT_ORIGINS = [
    "https://immocontrol360.de",
    "https://www.immocontrol360.de",
    "http://immocontrol360.de",
    "http://www.immocontrol360.de",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
];
const configuredOrigins = (Deno.env.get("CONTACT_FORM_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
const ALLOWED_ORIGINS = configuredOrigins.length > 0 ? configuredOrigins : DEFAULT_ORIGINS;

const MIN_FILL_MS = 2500;          // Website wartet selbst mindestens 3 s – etwas Toleranz
const MAX_BODY_CHARS = 20_000;
const MAX_NAME = 200;
const MAX_EMAIL = 254;
const MAX_MESSAGE = 5000;
const MAX_PAGE = 200;
const LIMIT_PER_CLIENT_PER_HOUR = 5;
const LIMIT_PER_EMAIL_PER_HOUR = 5;
const LIMIT_TOTAL_PER_HOUR = 60;
const HOUR_MS = 60 * 60 * 1000;

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

const UNAVAILABLE_MSG = `Das Kontaktformular ist gerade nicht verfügbar. Bitte schreibe uns direkt an ${SUPPORT_EMAIL}.`;

// ── Antworten / CORS ────────────────────────────────────────────────────────
function corsHeaders(origin: string | null): Record<string, string> {
    return {
        "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Vary": "Origin",
    };
}

function json(origin: string | null, body: Record<string, unknown>, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
}

function fail(origin: string | null, error: string, code = "invalid"): Response {
    return json(origin, { success: false, code, error });
}

// ── Eingaben ────────────────────────────────────────────────────────────────
const oneLine = (value: unknown, max: number): string =>
    String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

// Mehrzeilig: Zeilenumbrüche behalten, übrige Steuerzeichen entfernen
const multiLine = (value: unknown): string =>
    String(value ?? "")
        .replace(/\r\n?/g, "\n")
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
        .replace(/\n{4,}/g, "\n\n\n")
        .trim();

const escapeHtml = (value: unknown): string =>
    String(value ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c] as string));

const isValidEmail = (value: string): boolean => value.length <= MAX_EMAIL && EMAIL_RE.test(value);

// "Name <adresse@domain>" -> "adresse@domain"
const extractAddress = (from: string): string => {
    const m = String(from || "").match(/<([^>]+)>/);
    return (m ? m[1] : String(from || "")).trim();
};

// ── Pseudonymisierter Absender (für die Begrenzung; die IP wird nicht gespeichert) ──
let hmacKey: CryptoKey | null = null;
async function clientHash(req: Request): Promise<string | null> {
    const forwarded = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
    const ip = forwarded || req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "";
    if (!ip || !HASH_SECRET) return null;
    try {
        if (!hmacKey) {
            hmacKey = await crypto.subtle.importKey(
                "raw",
                new TextEncoder().encode(HASH_SECRET),
                { name: "HMAC", hash: "SHA-256" },
                false,
                ["sign"],
            );
        }
        const sig = await crypto.subtle.sign("HMAC", hmacKey, new TextEncoder().encode(`contact-form:${ip}`));
        return Array.from(new Uint8Array(sig)).slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch (e) {
        console.error("Client hash failed:", (e as Error).message);
        return null;
    }
}

// ── Datenbank (REST, service_role) ──────────────────────────────────────────
const serviceHeaders = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
};

// Tabelle fehlt (Migration noch nicht eingespielt)?
async function readError(res: Response): Promise<{ code: string; missing: boolean }> {
    const data = await res.json().catch(() => ({}));
    const code = String(data?.code ?? "");
    const missing = res.status === 404 || code === "PGRST205" || code === "42P01";
    return { code, missing };
}

/** Anzahl der Anfragen der letzten Stunde (optional gefiltert). null = nicht ermittelbar. */
async function countLastHour(filter: string): Promise<number | null> {
    if (!SUPABASE_URL || !SERVICE_KEY) return null;
    try {
        const since = new Date(Date.now() - HOUR_MS).toISOString();
        const res = await fetch(
            `${SUPABASE_URL}/rest/v1/contact_requests?select=id&limit=1&created_at=gte.${encodeURIComponent(since)}${filter}`,
            { headers: { ...serviceHeaders, Prefer: "count=exact" } },
        );
        if (!res.ok) {
            const { code, missing } = await readError(res);
            if (!missing) console.error("Rate count failed:", res.status, code);
            return null;
        }
        const range = res.headers.get("content-range") ?? "";
        await res.body?.cancel();
        const total = parseInt(range.split("/")[1] ?? "", 10);
        return Number.isFinite(total) ? total : null;
    } catch (e) {
        console.error("Rate count error:", (e as Error).message);
        return null;
    }
}

// Rückfall-Begrenzung je Function-Instanz (falls die Tabelle fehlt oder nicht abfragbar ist)
const memoryHits = new Map<string, number[]>();
function memoryCount(key: string): number {
    const now = Date.now();
    const hits = (memoryHits.get(key) ?? []).filter((t) => now - t < HOUR_MS);
    memoryHits.set(key, hits);
    if (memoryHits.size > 5000) {
        for (const [k, v] of memoryHits) {
            if (v.every((t) => now - t >= HOUR_MS)) memoryHits.delete(k);
        }
    }
    return hits.length;
}
function memoryRecord(keys: string[]) {
    const now = Date.now();
    for (const key of keys) {
        const hits = memoryHits.get(key) ?? [];
        hits.push(now);
        memoryHits.set(key, hits);
    }
}

async function isRateLimited(hash: string | null, email: string): Promise<boolean> {
    const checks: Array<[string, string, number]> = [
        ["total", "", LIMIT_TOTAL_PER_HOUR],
        [`email:${email}`, `&email=eq.${encodeURIComponent(email)}`, LIMIT_PER_EMAIL_PER_HOUR],
    ];
    if (hash) checks.push([`client:${hash}`, `&client_hash=eq.${hash}`, LIMIT_PER_CLIENT_PER_HOUR]);

    for (const [memKey, filter, limit] of checks) {
        const dbCount = await countLastHour(filter);
        const count = Math.max(dbCount ?? 0, memoryCount(memKey));
        if (count >= limit) return true;
    }
    return false;
}

type StoreResult = { ok: true; id: string | null } | { ok: false; missing: boolean };

async function storeRequest(row: Record<string, unknown>): Promise<StoreResult> {
    if (!SUPABASE_URL || !SERVICE_KEY) return { ok: false, missing: false };
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/contact_requests?select=id`, {
            method: "POST",
            headers: { ...serviceHeaders, Prefer: "return=representation" },
            body: JSON.stringify(row),
        });
        if (res.ok) {
            const data = await res.json().catch(() => null);
            const id = Array.isArray(data) ? data[0]?.id ?? null : data?.id ?? null;
            return { ok: true, id };
        }
        // Nur den Fehlercode protokollieren – Fehlertexte können die Formulardaten enthalten
        const { code, missing } = await readError(res);
        if (!missing) console.error("Storing contact request failed:", res.status, code);
        return { ok: false, missing };
    } catch (e) {
        console.error("Storing contact request error:", (e as Error).message);
        return { ok: false, missing: false };
    }
}

async function markNotified(id: string | null): Promise<void> {
    if (!id) return;
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/contact_requests?id=eq.${encodeURIComponent(id)}`, {
            method: "PATCH",
            headers: { ...serviceHeaders, Prefer: "return=minimal" },
            body: JSON.stringify({ notified_at: new Date().toISOString() }),
        });
        await res.body?.cancel();
    } catch (e) {
        console.error("Marking contact request as notified failed:", (e as Error).message);
    }
}

// ── E-Mail-Benachrichtigung (Plattform-Postfach) ────────────────────────────
interface SmtpConfig {
    host: string;
    port: number;
    user: string;
    pass: string;
    from: string;
}

function getPlatformSmtpConfig(): SmtpConfig | null {
    const host = Deno.env.get("SMTP_HOST");
    if (!host) return null;
    const user = Deno.env.get("SMTP_USER") || "";
    return {
        host,
        port: parseInt(Deno.env.get("SMTP_PORT") || "587", 10) || 587,
        user,
        pass: Deno.env.get("SMTP_PASS") || "",
        from: Deno.env.get("SMTP_SENDER") || user,
    };
}

function getNotificationRecipients(config: SmtpConfig): string[] {
    const configured = (Deno.env.get("CONTACT_FORM_TO") ?? "")
        .split(",")
        .map((a) => a.trim().toLowerCase())
        .filter((a) => isValidEmail(a));
    if (configured.length > 0) return configured;
    const fallback = [extractAddress(config.from), config.user.trim()]
        .map((a) => a.toLowerCase())
        .find((a) => isValidEmail(a));
    return fallback ? [fallback] : [];
}

async function sendNotification(
    config: SmtpConfig,
    to: string[],
    data: { name: string; email: string; message: string; page: string },
): Promise<boolean> {
    const fromAddress = extractAddress(config.from).toLowerCase();
    if (!isValidEmail(fromAddress)) {
        console.error("Contact notification skipped: SMTP_SENDER/SMTP_USER is not a valid address.");
        return false;
    }
    try {
        const transporter = nodemailer.createTransport({
            host: config.host,
            port: config.port,
            secure: config.port === 465,
            auth: config.user ? { user: config.user, pass: config.pass } : undefined,
            connectionTimeout: 15000,
            greetingTimeout: 15000,
            socketTimeout: 30000,
        });

        const received = new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin" });
        const html = `
            <p><strong>Neue Kontaktanfrage über die Website</strong> (${escapeHtml(received)})</p>
            <p><strong>Name:</strong> ${escapeHtml(data.name)}<br>
               <strong>E-Mail:</strong> ${escapeHtml(data.email)}<br>
               <strong>Seite:</strong> ${escapeHtml(data.page || "–")}</p>
            <p><strong>Nachricht:</strong></p>
            <p style="white-space:pre-wrap">${escapeHtml(data.message).replace(/\n/g, "<br>")}</p>
            <p style="color:#64748b;font-size:12px">Antworten auf diese E-Mail gehen direkt an die angegebene Adresse.</p>`;
        const text = `Neue Kontaktanfrage über die Website (${received})\n\n`
            + `Name: ${data.name}\nE-Mail: ${data.email}\nSeite: ${data.page || "–"}\n\nNachricht:\n${data.message}\n`;

        const info = await transporter.sendMail({
            from: config.from,
            to: to.join(", "),
            replyTo: { name: data.name, address: data.email },
            subject: "Neue Kontaktanfrage über immocontrol360.de",
            text,
            html,
            envelope: { from: isValidEmail(config.user.trim().toLowerCase()) ? config.user.trim() : fromAddress, to },
        });
        console.log(`Contact notification sent: ${info?.messageId ?? ""}`);
        return true;
    } catch (err: any) {
        console.error("Contact notification failed:", err?.code || "", err?.responseCode || "");
        return false;
    }
}

// ── Handler ─────────────────────────────────────────────────────────────────
serve(async (req: Request) => {
    const origin = req.headers.get("origin");

    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders(origin) });
    }
    if (req.method !== "POST") {
        return json(origin, { success: false, code: "method", error: "Methode nicht erlaubt." }, 405);
    }
    // Browser-Aufrufe nur von der eigenen Website
    if (origin && !ALLOWED_ORIGINS.includes(origin.replace(/\/+$/, ""))) {
        return json(origin, { success: false, code: "origin", error: "Anfragen sind nur über die Website möglich." }, 403);
    }

    try {
        const raw = await req.text();
        if (raw.length > MAX_BODY_CHARS) {
            return fail(origin, "Die Nachricht ist zu lang (höchstens 5.000 Zeichen).");
        }
        let body: any = null;
        try { body = JSON.parse(raw); } catch { body = null; }
        if (!body || typeof body !== "object") {
            return fail(origin, "Die Anfrage konnte nicht gelesen werden. Bitte versuche es erneut.");
        }

        // ── Spam-Schutz ──
        if (typeof body.website === "string" && body.website.trim() !== "") {
            console.log("Contact form: honeypot filled, request discarded.");
            return fail(origin, "Die Nachricht konnte nicht gesendet werden.", "rejected");
        }
        const elapsed = Number(body.elapsed_ms);
        if (!Number.isFinite(elapsed) || elapsed < MIN_FILL_MS) {
            return fail(origin, "Bitte warte einen kurzen Moment und sende die Nachricht dann erneut.", "too_fast");
        }

        // ── Plausibilität ──
        const name = oneLine(body.name, MAX_NAME);
        const email = oneLine(body.email, MAX_EMAIL + 1).toLowerCase();
        const message = multiLine(body.message);
        const page = oneLine(body.page, MAX_PAGE);

        if (!name) return fail(origin, "Bitte gib deinen Namen an.");
        if (!email || !isValidEmail(email)) return fail(origin, "Bitte gib eine gültige E-Mail-Adresse an.");
        if (!message) return fail(origin, "Bitte schreibe uns eine Nachricht.");
        if (message.length > MAX_MESSAGE) return fail(origin, "Die Nachricht ist zu lang (höchstens 5.000 Zeichen).");

        // ── Begrenzung ──
        const hash = await clientHash(req);
        if (await isRateLimited(hash, email)) {
            return fail(origin, "Es wurden in kurzer Zeit sehr viele Nachrichten gesendet. Bitte versuche es später erneut.", "rate_limited");
        }
        memoryRecord(["total", `email:${email}`, ...(hash ? [`client:${hash}`] : [])]);

        // ── Speichern ──
        const stored = await storeRequest({
            name,
            email,
            message,
            source_page: page || null,
            client_hash: hash,
        });

        // ── Benachrichtigen ──
        let notified = false;
        const smtp = getPlatformSmtpConfig();
        if (smtp) {
            const recipients = getNotificationRecipients(smtp);
            if (recipients.length > 0) {
                notified = await sendNotification(smtp, recipients, { name, email, message, page });
            } else {
                console.error("Contact notification skipped: no recipient (CONTACT_FORM_TO).");
            }
        }
        if (notified && stored.ok) await markNotified(stored.id);

        if (!stored.ok && !notified) {
            console.error("Contact request could neither be stored nor sent.", stored.missing ? "(table missing)" : "");
            return fail(origin, UNAVAILABLE_MSG, "unavailable");
        }
        if (!notified) console.log("Contact request stored without e-mail notification (SMTP/CONTACT_FORM_TO not configured or failed).");

        return json(origin, { success: true });
    } catch (error: unknown) {
        console.error("Contact form error:", error instanceof Error ? error.message : String(error));
        return fail(origin, UNAVAILABLE_MSG, "unavailable");
    }
});
