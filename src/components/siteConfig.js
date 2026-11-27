// Zentrale Angaben der Website – an EINER Stelle pflegen (Komplett-Check 2026-11-27, W1b-02/W1b-19).
// Die Website läuft unter immocontrol360.de, die App unter app.immocontrol360.de.
// Die frühere Schreibweise "immocontrolpro360.de" ist keine registrierte Domain (kein Web-/Mail-Eintrag).

export const BRAND_NAME = 'ImmoControlPro360';

export const SITE_URL = 'https://immocontrol360.de';

// Web-App (lokal: Vite-Dev-Server der App auf Port 5173)
export const APP_URL = import.meta.env.DEV ? 'http://localhost:5173' : 'https://app.immocontrol360.de';

export const SUPPORT_EMAIL = 'support@immocontrol360.de';

// Kontaktformular → Supabase Edge Function "contact-form" (aufgerufen mit dem öffentlichen anon-Key)
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || 'https://agsmqvvwfufenaiekuox.supabase.co').replace(/\/+$/, '');
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
export const CONTACT_FORM_ENDPOINT = `${SUPABASE_URL}/functions/v1/contact-form`;
