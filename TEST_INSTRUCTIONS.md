# Test-Anleitung: Trial & Checkout Flow

Diese Anleitung führt dich durch den Test des neuen Registrierungs- und Trial-Prozesses.

## 1. Vorbereitung

- [ ] **App neustarten**: Stoppe `npm run dev` im Terminal von `immo-web` (Strg+C) und starte es neu.
- [ ] **Check**: Die App sollte unter `http://localhost:5173` erreichbar sein.
- [ ] **Marketing-Seite**: `immowebsite` sollte unter `http://localhost:5174` laufen.

## 2. Registrierung (Neuer User)

1. Öffne `http://localhost:5174/abo-starten?plan=professional` im Browser.
2. Gib eine **neue** E-Mail-Adresse und Passwort ein. (z.B. `test1@example.com`).
3. Klicke auf "Jetzt Testphase starten".
4. **Erwartetes Verhalten**:
    - Du wirst in Sekundenbruchteilen weitergeleitet.
    - Die Seite `http://localhost:5173/` (Dashboard) öffnet sich.
    - Du bist automatisch eingeloggt.

## 3. In der App (Trial Prüfung)

1. Schau oben in die Kopfleiste (Topbar).
2. **Erwartetes Verhalten**:
    - Du siehst einen Button mit einem Kronen-Icon und dem Text "10 Tage Testphase".
3. Klicke auf diesen Button.
4. **Erwartetes Verhalten**:
    - Das Paywall-Modal öffnet sich.
    - Du siehst die Pläne (Starter, Professional, Business).
    - Du kannst das Modal schließen (X oben rechts), da der Trial noch läuft.

## 4. Limit Test (Einheiten)

1. Gehe auf "Immobilien" in der Sidebar.
2. Lege eine neue Immobilie an (Dummy Daten).
3. Klicke auf "Neue Einheit".
4. Versuche, **mehr als 250 Einheiten** anzulegen (okay, das ist schwer zu testen manuell...).
    - Alternativ: Wir können das Limit temporär im Code senken (z.B. auf 1 in `SubscriptionContext.jsx`), wenn du das testen willst.

## 5. Feature Lock (Sidebar)

1. In der Sidebar gibt es "Mieterportal" und "Investorportal".
2. **Im Trial**: Diese sollten **offen** sein (kein Schloss).
3. **Test-Szenario "Abgelaufen / Starter"**:
    - Um das zu testen, müssen wir einen User mit Plan "Starter" simulieren.
    - Das geht am einfachsten direkt in der Supabase Datenbank:
      - Tabelle `subscriptions` suchen.
      - Bei deinem User `plan` auf `starter` ändern und `status` auf `active`.
    - Lade die App neu (F5).
    - **Erwartung**: "Mieterportal" hat jetzt ein Schloss-Icon. Wenn du klickst, kommt die Paywall.

## 6. Stripe Checkout (Vorsicht: Price IDs müssen stimmen!)

1. Klicke im Paywall Modal auf "Wählen".
2. **Erwartung**: Du wirst zu Stripe weitergeleitet.
    - **Fehlerfall**: Wenn du einen Fehler siehst, liegt es daran, dass die Price IDs in `create-checkout-session/index.ts` nicht mit deinem Stripe Account übereinstimmen. Das müssen wir noch fixen.

## 7. Webhook & Success

1. Nach erfolgreicher Zahlung in Stripe (Testmodus-Karte: 4242 4242...) wirst du auf `/billing/success` geleitet.
2. Die App gratuliert dir.
3. Nach 3 Sekunden landest du im Dashboard.
4. Der Plan sollte jetzt aktualisiert sein (z.B. kein "Testphase" mehr).

---

**Fragen/Probleme?** Sag Bescheid!
