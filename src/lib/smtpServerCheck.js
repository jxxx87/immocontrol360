// Erlaubte Postfach-Server und -Ports für die E-Mail-Einrichtung.
// Muss mit ALLOWED_SMTP_PORTS / isAllowedSmtpHost in
// supabase/functions/send-letting-email/index.ts übereinstimmen. Die Edge Function prüft
// beim Verbindungstest und beim Versand selbst noch einmal (kein SSRF ins interne Netz).
export const ALLOWED_SMTP_PORTS = [25, 465, 587, 2525];

export const isAllowedSmtpPort = (value) => {
    const port = Number(value);
    return Number.isInteger(port) && ALLOWED_SMTP_PORTS.includes(port);
};

// Nur öffentliche Mailserver: keine localhost-/internen Namen, keine privaten oder
// reservierten IPv4-Adressen, keine IPv6-Literale. Erwartet den getrimmten, klein
// geschriebenen Servernamen.
export const isAllowedSmtpHost = (host) => {
    if (typeof host !== 'string' || !host || host.length > 253) return false;
    if (!/^[a-z0-9.-]+$/.test(host)) return false;
    if (!host.includes('.')) return false;
    if (host === 'localhost' || /\.(localhost|local|internal|lan|home|intranet)$/.test(host)) return false;
    const labels = host.split('.');
    if (labels.some((label) => label === '')) return false;
    const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    // Kurz-, Oktal- und Hex-Schreibweisen (127.1, 10.0x1, 012.0.0.1) löst der Resolver als
    // IP-Adresse auf -> nur die übliche Schreibweise a.b.c.d zulassen (echte TLDs sind nie numerisch)
    if (!ipv4 && /^(0x[0-9a-f]*|\d+)$/.test(labels[labels.length - 1])) return false;
    if (ipv4) {
        const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
        if ([ipv4[1], ipv4[2], ipv4[3], ipv4[4]].some((p) => p.length > 1 && p.startsWith('0'))) return false;
        if ([ipv4[1], ipv4[2], ipv4[3], ipv4[4]].some((p) => Number(p) > 255)) return false;
        if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
        if (a === 169 && b === 254) return false;
        if (a === 172 && b >= 16 && b <= 31) return false;
        if (a === 192 && b === 168) return false;
        if (a === 100 && b >= 64 && b <= 127) return false;
    }
    return true;
};
