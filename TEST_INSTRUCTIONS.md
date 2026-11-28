# Test-Anleitung: Trial & Checkout Flow

Diese Anleitung führt durch den manuellen Test von Registrierung, Testphase und Stripe-Checkout.
Automatisierte Tests gibt es dafür noch nicht.

> Stand der Angaben: Komplett-Check 2026-11-27, mit dem Code abgeglichen (Fundstellen jeweils angegeben).
> Ändert sich dort etwas, diese Anleitung mit anpassen.

## 1. Vorbereitung

- [ ] **App starten**: `npm run dev` im Ordner `immo-web` → `http://localhost:5173`.
- [ ] **Marketing-Seite**: `npm run dev` im Ordner `immowebsite` → `http://localhost:5174`.
- [ ] Die Edge Functions laufen in Supabase (nicht lokal). Getestet wird also gegen das echte Projekt – nur
      Test-Konten mit Wegwerf-Adressen verwenden und anschließend wieder löschen.

## 2. Registrierung (Neuer User)

1. `http://localhost:5174/abo-starten?plan=professional` öffnen.
2. **Neue** E-Mail-Adresse und Passwort eingeben (z. B. `test1@example.com`).
3. „Jetzt Testphase starten" klicken.
4. **Erwartet**:
    - Weiterleitung zur App (Dashboard), automatisch eingeloggt.
    - Ist für die Edge Function `register-trial` das Secret `REGISTER_TRIAL_CONFIRM_EMAIL=true` gesetzt, ist das
      Konto erst nach Klick auf den Link in der Bestätigungs-E-Mail nutzbar.

Die Testphase vergibt die Edge Function `register-trial` (Konstante `TRIAL_DAYS = 10` in
`supabase/functions/register-trial/index.ts`). `start-trial` ist abgeschaltet.

## 3. In der App (Trial prüfen)

1. Kopfleiste (Topbar) ansehen.
2. **Erwartet**: Button mit Kronen-Icon und den verbleibenden Tagen („10 Tage · Upgrade" direkt nach der
   Registrierung, `src/components/layout/Topbar.jsx`).
3. Button klicken → Paywall-Modal mit den Plänen (Starter, Professional, Business); lässt sich schließen,
   solange die Testphase läuft.

## 4. Limit-Test (Einheiten)

In der Testphase gelten die Business-Grenzen: **250 Einheiten** (`src/context/SubscriptionContext.jsx`,
Einheiten-Prüfung: `isTrialActive() ? { maxUnits: 250 } : getPlanFeatures()`). Nach der Testphase gilt das
Limit des gebuchten Plans (`getPlanFeatures`: Starter 5, Professional 50, Business 250).

Manuell kaum erreichbar – zum Testen das Limit vorübergehend im Code senken und danach zurücksetzen
(nicht so deployen).

## 5. Feature Lock (Sidebar)

1. In der Sidebar gibt es „Mieterportal" und „Investorportal".
2. **Im Trial**: offen (kein Schloss) – in der Testphase ist alles freigeschaltet (`hasFeature`).
3. **Szenario „Starter"**: In der Tabelle `subscriptions` beim Test-Nutzer `plan = 'starter'` und
   `status = 'active'` setzen (Supabase-Dashboard), App neu laden.
   **Erwartet**: „Mieterportal" mit Schloss-Icon; Klick öffnet die Paywall.

## 6. Stripe-Checkout

1. Im Paywall-Modal auf „Wählen" klicken.
2. **Erwartet**: Weiterleitung zu Stripe.

**Wichtig – Price IDs:** Die Preis-IDs sind fest im Code hinterlegt, und zwar nur an **einer** Stelle:
`supabase/functions/_shared/stripePlans.ts` (`PLAN_PRICES`). Beide Functions lesen sie von dort –
`create-checkout-session` (Tarif + Zeitraum → Preis-ID, `priceIdFor`) und `stripe-webhook` (Preis-ID → Tarif,
`planForPriceId`). Nach einer Änderung **beide** Functions neu ausrollen; beim Ausrollen über Management-API/MCP
die Datei `_shared/stripePlans.ts` mit hochladen (siehe `supabase/config.toml`).
Eine Price ID gehört immer zu **einem** Stripe-Modus: Mit einem Test-Schlüssel (`sk_test_…`) funktionieren nur Test-Preise, mit dem Live-Schlüssel nur Live-Preise.
Erscheint beim Klick ein Fehler, passen Price IDs und Modus des hinterlegten Function-Secrets
`STRIPE_SECRET_KEY` nicht zusammen.

**Offen (nicht im Code lösbar):** Abgleich der Price IDs mit dem Stripe-Konto (Test- und Live-Modus) ist noch
nicht dokumentiert; der Stripe-Secret-Key liegt dem Projekt nicht vor. Sobald er da ist: im Stripe-Dashboard
unter *Produkte* die IDs beider Modi prüfen und mit `supabase/functions/_shared/stripePlans.ts` abgleichen
(die IDs selbst nicht in diese Anleitung kopieren – maßgeblich ist nur die Datei).

## 7. Webhook & Success

1. Nach erfolgreicher Zahlung (Stripe-Testkarte `4242 4242 4242 4242`, beliebiges künftiges Datum, beliebige
   Prüfziffer – nur im Testmodus) Weiterleitung auf `/billing/success`.
2. Die App bestätigt den Abschluss und leitet nach kurzer Zeit ins Dashboard.
3. Der Plan ist aktualisiert (kein „Testphase"-Hinweis mehr) – das setzt die Edge Function `stripe-webhook`.

---

**Fragen/Probleme?** Sag Bescheid!
