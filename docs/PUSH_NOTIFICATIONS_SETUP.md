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
2. Android-Paketname: `com.ImmoControl.pro360` (genau so, mit Großbuchstaben – Paketnamen sind
   case-sensitiv; Quelle: `appId` in `capacitor.config.json` bzw. `applicationId` in `android/app/build.gradle`.
   Eine `google-services.json` für einen anders geschriebenen Namen passt nicht zur App.)
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

## Schritt 5: Datenbank-Trigger (Stand und Hinweise)

Die Migrationen `20260215103500_push_notifications.sql` und `20260215110000_update_push_triggers.sql` sind im
Projekt bereits eingespielt; neu aufsetzen nur über `supabase db push` (siehe `SOP_DEPLOYS.md`).

**Tatsächlicher Mechanismus (Live-Stand 27.11.2026):** Die Trigger `push_on_message`, `push_on_ticket`,
`push_on_announcement`, `push_on_document` und `push_on_registration` rufen die Funktionen `trigger_push_on_*`
auf; diese rufen die Hilfsfunktion `notify_push(...)`, die per `pg_net` (`net.http_post`) die Edge Function
`send-push-notification` aufruft. Den dafür nötigen Schlüssel enthält heute die Live-Funktion `notify_push`
selbst.

**Nicht mehr so machen (früherer Weg dieser Anleitung):** den `service_role`-Schlüssel per
`ALTER DATABASE … SET app.settings.service_role_key` als Datenbank-Einstellung hinterlegen – solche Einstellungen
kann jede Datenbank-Rolle mit `current_setting()` lesen. Ebenso wenig gehört der Schlüssel in eine
Migrationsdatei im Repo (in `20260215110000_update_push_triggers.sql` stand er früher im Klartext; dort steht jetzt
ein Platzhalter).

**Ziel:** Schlüssel nach der Rotation (Nutzer, Phase 0 des Komplett-Checks) im Supabase-Tresor (Vault) ablegen
und in `notify_push` aus `vault.decrypted_secrets` lesen – oder statt des `service_role`-Schlüssels ein eigenes
Shared Secret verwenden, das nur `send-push-notification` prüft. Diese Umstellung ist noch offen.

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
