import { supabase } from './supabase';

/**
 * Prüft, ob das Konto eigene SMTP-Einstellungen (E-Mail-Versand) hinterlegt hat.
 * Wirft bei einem Ladefehler, damit der Aufrufer den bisherigen Stand behalten kann.
 */
export const hasSmtpSettings = async (userId) => {
    if (!userId) return false;
    const { data, error } = await supabase
        .from('user_smtp_settings')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle();
    if (error) throw error;
    return !!data;
};
