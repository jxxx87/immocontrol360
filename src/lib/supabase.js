import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// ── Passwort-Wiederherstellung (Reset-Link aus der Mail) ──
// Muss hier beim App-Start laufen: Der Supabase-Client wertet den URL-Hash beim Start aus, leert ihn
// danach und meldet PASSWORD_RECOVERY nur an die Listener, die zu diesem Zeitpunkt angemeldet sind.
// PasswordRecovery.jsx wird erst später nachgeladen und liest nur noch den Merker.
const RECOVERY_KEY = 'passwordRecoveryPending';

export const readRecoveryFlag = () => {
    try { return sessionStorage.getItem(RECOVERY_KEY) === '1'; } catch { return false; }
};
export const writeRecoveryFlag = (on) => {
    try {
        if (on) sessionStorage.setItem(RECOVERY_KEY, '1');
        else sessionStorage.removeItem(RECOVERY_KEY);
    } catch { /* ignore */ }
};

// Hash vor dem Anlegen des Clients lesen (der Client entfernt ihn nach der Auswertung)
const initialHash = typeof window !== 'undefined' ? (window.location.hash || '') : '';
if (/(^#|&)type=recovery(&|$)/.test(initialHash)) {
    writeRecoveryFlag(true);
}
// Abgelaufener/ungültiger Link: Supabase leitet mit #error=…&error_code=… zurück
export const initialLinkError = /(^#|&)error(_code)?=/.test(initialHash);

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// PKCE- und Implicit-Flow melden die Wiederherstellung als PASSWORD_RECOVERY.
supabase.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') {
        writeRecoveryFlag(true);
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('password-recovery'));
    } else if (event === 'SIGNED_OUT') {
        writeRecoveryFlag(false);
    }
});
