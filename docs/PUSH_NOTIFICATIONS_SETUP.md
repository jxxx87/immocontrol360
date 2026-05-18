# Push-Benachrichtigungen – Setup Anleitung

## Architektur-Übersicht

```
┌──────────────────────────────────────────────┐
│  App (Capacitor / Browser)                   │
│  ┌────────────────┐  ┌───────────────────┐   │
│  │ FCM Token      │  │ Realtime Listener │   │
│  │ Registration   │  │ (In-App Toasts)   │   │
│  └──────┬─────────┘  └───────────────────┘   │
│         │                                    │
└─────────┼────────────────────────────────────┘
          │ save token
          ▼
┌──────────────────────────────────────────────┐
│  Supabase                                    │
│  ┌──────────────────┐                        │
│  │ push_subscriptions│ (fcm_token, user_id)  │
│  └──────────────────┘                        │
│                                              │
│  DB Trigger: INSERT on messages/tickets/...  │
│       │                                      │
│       ▼                                      │
│  ┌──────────────────────────────────────┐    │
│  │ Edge Function: send-push-notification│    │
│  │  1. Lookup FCM tokens for user_ids   │    │
│  │  2. Get OAuth2 access token          │    │
│  │  3. Send via FCM HTTP v1 API         │    │
│  └──────────────────────────────────────┘    │
│                                              │
└──────────────────────────────────────────────┘
          │
          ▼
┌──────────────────────────────────────────────┐
│  Firebase Cloud Messaging (FCM)              │
│  → Push an Android/iOS Gerät                 │
└──────────────────────────────────────────────┘
```

## Schritt 1: Firebase Projekt erstellen

1. Gehe zu https://console.firebase.google.com/
2. Erstelle ein neues Projekt (z.B. "ImmoControl Pro 360")
3. **Google Analytics** kann deaktiviert werden
4. Klicke auf **⚙️ Projekteinstellungen**

## Schritt 2: Android App in Firebase registrieren

1. Klicke "App hinzufügen" → Android
2. Android-Paketname: `com.immocontrol.pro360`
3. SHA-1 ist optional (kann später hinzugefügt werden)
4. Lade die **`google-services.json`** herunter
5. Kopiere die Datei nach: `android/app/google-services.json`

## Schritt 3: Firebase Service Account Key erstellen

1. In Firebase Console → ⚙️ Projekteinstellungen → **Dienstkonten**
2. Klicke "Neuen privaten Schlüssel generieren"
3. Speichere die JSON-Datei sicher ab (NICHT im Repo!)

## Schritt 4: Supabase Secrets setzen

```bash
# Service Account Key als Secret setzen
supabase secrets set FCM_SERVICE_ACCOUNT_KEY='{ JSON Inhalt }'
```

Alternativ im Supabase Dashboard:
1. Gehe zu **Edge Functions** → **Manage Secrets**
2. Erstelle `FCM_SERVICE_ACCOUNT_KEY` mit dem Inhalt der JSON-Datei

## Schritt 5: SQL Migration ausführen

Führe die Migration `20260215103500_push_notifications.sql` aus:

```bash
supabase db push
```

Oder kopiere den Inhalt der Datei in den Supabase SQL Editor und führe ihn aus.

### App Settings für pg_net konfigurieren

Im Supabase SQL Editor ausführen:

```sql
-- Ersetze mit deinen echten Werten!
ALTER DATABASE postgres SET app.settings.supabase_url = 'https://DEIN-PROJEKT.supabase.co';
ALTER DATABASE postgres SET app.settings.service_role_key = 'DEIN-SERVICE-ROLE-KEY';
```

## Schritt 6: Edge Function deployen

```bash
supabase functions deploy send-push-notification
```

## Schritt 7: Capacitor Push Plugin installieren

```bash
npm install @capacitor/push-notifications
npx cap sync
```

## Schritt 8: Android Build

```bash
npm run build
npx cap sync android
npx cap open android
```

In Android Studio: Run → Run 'app'

## Test

1. App öffnen und einloggen
2. In der Konsole sollte erscheinen: `FCM registered: ...`
3. Eine Nachricht an den User senden
4. Push-Benachrichtigung sollte auf dem Gerät erscheinen

## Benachrichtigungs-Typen

| Event                    | Trigger Tabelle  | Empfänger        |
|--------------------------|------------------|------------------|
| Neue Nachricht           | `messages`       | receiver_id      |
| Neues Ticket             | `tickets`        | Property Owner   |
| Ticket-Kommentar         | `messages` (💬)  | receiver_id      |
| Neuer Aushang            | `announcements`  | Alle Mieter      |
| Neues Dokument           | `documents`      | Betroffene Mieter|
| Mieter registriert       | `user_roles`     | Property Owner   |

## Troubleshooting

### Push kommen nicht an
- Prüfe ob `google-services.json` korrekt platziert ist
- Prüfe ob die Edge Function deployed ist: `supabase functions list`
- Prüfe Edge Function Logs: `supabase functions logs send-push-notification`
- Prüfe ob Tokens in `push_subscriptions` gespeichert sind

### Edge Function Fehler
- `FCM_SERVICE_ACCOUNT_KEY secret not set` → Secret korrekt setzen
- `No FCM tokens found` → App hat keinen Token registriert
- OAuth2 Token Fehler → Service Account Key prüfen
