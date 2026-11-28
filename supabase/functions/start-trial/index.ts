/**
 * start-trial  –  ABGESCHALTET (Komplett-Check 2026-11-27, E3-02/E3-24)
 *
 * Die Funktion hatte keinerlei Aufruferprüfung: user_id und plan kamen aus dem Body und
 * wurden per Service-Role in `subscriptions` geschrieben; die komplette Zeile inkl.
 * Stripe-Kennungen wurde zurückgegeben. Weder die Web-App (immo-web/src) noch die
 * Marketing-Seite (immowebsite/src) rufen sie auf – die Testphase wird ausschließlich
 * über `register-trial` beim Anlegen des Kontos vergeben.
 *
 * Die Funktion antwortet daher immer mit 410 Gone und schreibt nichts.
 * Empfehlung: im Supabase-Dashboard ganz löschen (`supabase functions delete start-trial`).
 *
 * Wave 4 (E3-21): eingebautes Deno.serve statt deno.land/std@0.131.0 (keine externen Importe mehr).
 */

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve((req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    return new Response(JSON.stringify({
        success: false,
        error: 'gone',
        message: 'Diese Funktion wurde abgeschaltet. Die Testphase wird bei der Registrierung vergeben.',
    }), {
        status: 410,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
});
