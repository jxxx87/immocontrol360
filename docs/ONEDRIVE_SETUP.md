# Microsoft OneDrive – Integration & Setup-Anleitung

Diese Anleitung beschreibt Schritt für Schritt, wie Microsoft OneDrive als Cloud-Speicher für Portfolios und Dokumente in ImmoControl360 eingerichtet wird.

---

## 1. App-Registrierung im Microsoft Entra Portal (Azure AD)

Um OneDrive anzubinden, muss eine App-Registrierung im Microsoft Azure Portal erstellt werden:

1. Melden Sie sich im [Azure Portal (App-Registrierungen)](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) an.
2. Klicken Sie auf **Neue Registrierung**.
3. Geben Sie der App einen Namen (z. B. `ImmoControl360-OneDrive`).
4. Wählen Sie unter **Unterstützte Kontotypen** aus:
   * **Konten in allen Organisationsverzeichnissen (beliebiges Microsoft Entra-Verzeichnis - mandantenfähig) und persönliche Microsoft-Konten (z. B. Skype, Xbox)** *(empfohlen, damit sich jeder User mit seinem privaten oder geschäftlichen OneDrive verbinden kann).*
5. Wählen Sie unter **Umleitungs-URI (Redirect-URI)** den Plattformtyp **Web** aus und tragen Sie die Callback-URLs ein:
   * Für die lokale Entwicklung: `http://localhost:5173/settings/cloud/callback`
   * Für das Live-System: `https://app.immocontrol360.de/settings/cloud/callback`

   Die App bildet die Adresse immer als `<aktuelle Origin>/settings/cloud/callback`; die Edge Function `cloud-auth`
   akzeptiert nur diesen Pfad und nur freigegebene Origins (weitere Origins über das Secret `CLOUD_ALLOWED_ORIGINS`).
   Varianten mit `/app` im Pfad werden nicht verwendet.
6. Klicken Sie auf **Registrieren**.

---

## 2. API-Berechtigungen festlegen (Scopes)

Die Anwendung benötigt Berechtigungen, um im Namen des Benutzers auf OneDrive zuzugreifen und Ordnerstrukturen anzulegen:

1. Navigieren Sie in der erstellten App-Registrierung im linken Menü zu **API-Berechtigungen**.
2. Klicken Sie auf **Berechtigung hinzufügen** und wählen Sie **Microsoft Graph** aus.
3. Wählen Sie **Delegierte Berechtigungen** und fügen Sie folgende Berechtigungen hinzu:
   * `offline_access` (ermöglicht den Erhalt von Refresh Tokens, damit die Verbindung nicht stündlich abläuft)
   * `Files.ReadWrite` (Lesen und Schreiben der eigenen OneDrive-Dateien des Benutzers – die App legt nur unter
     `ImmoControlpro360/` an; ein Zugriff auf für den Benutzer freigegebene fremde Dateien, wie ihn
     `Files.ReadWrite.All` erlauben würde, ist nicht nötig)
   * `User.Read` (zum Auslesen des Profils und der E-Mail-Adresse des Benutzers für die Verbindungsanzeige)

   Hinweis: Neue Verbindungen fordern `Files.ReadWrite` an, sobald die aktuelle Version der Edge Function
   `cloud-auth` bereitgestellt ist (vorher noch `Files.ReadWrite.All`). Bestehende Verbindungen behalten ihre
   bisherige Freigabe; niemand muss neu verbinden.
4. Klicken Sie unten auf **Berechtigungen hinzufügen**.

---

## 3. Client-ID und Client-Secret generieren

1. Kopieren Sie auf der **Übersichtsseite** die **Anwendungs-ID (Client-ID)**. Diese benötigen Sie für das Frontend.
2. Navigieren Sie links zu **Zertifikate & Geheimnisse** ➔ **Geheimnisse (Client-Secrets)**.
3. Klicken Sie auf **Neues Clientgeheimnis**, vergeben Sie eine Beschreibung (z. B. `ImmoControl360 Backend Secret`) und wählen Sie die Gültigkeitsdauer aus.
4. Klicken Sie auf **Hinzufügen** und kopieren Sie **sofort den Wert (Value)** des erstellten Secrets (dieser Wert wird nach Verlassen der Seite unkenntlich gemacht).

---

## 4. Konfiguration der Umgebungsvariablen

### A. Frontend (Client-ID)
Tragen Sie die Client-ID in Ihre Umgebungsvariablen-Dateien ein:

In Ihrer `.env` (für lokale Entwicklung) und `.env.production` (für Live-System):
```env
VITE_ONEDRIVE_CLIENT_ID=deine-kopierte-client-id
```

### B. Supabase Edge Functions (Backend)
Die Edge Functions benötigen Zugriff auf die Client-ID sowie auf das Client-Secret, um den Autorisierungscode (Authorization Code) in langlebige Tokens einzutauschen.

Führen Sie im Projektverzeichnis über die Supabase-CLI folgende Befehle aus (oder konfigurieren Sie diese im Supabase-Dashboard unter *Settings ➔ Edge Functions*):

```bash
supabase secrets set ONEDRIVE_CLIENT_ID="deine-kopierte-client-id"
supabase secrets set ONEDRIVE_CLIENT_SECRET="dein-kopiertes-client-secret"
```

---

## 5. Funktionsweise im System

1. Unter **Einstellungen ➔ Cloud-Verbindungen** kann der Anwender auf *Mit Microsoft OneDrive verbinden* klicken.
2. Er wird zur Microsoft-Anmeldeseite weitergeleitet, authentifiziert sich und stimmt den Berechtigungen zu.
3. Microsoft leitet den User zurück zur Callback-Seite, wo die Supabase Edge Function `cloud-auth` aufgerufen wird. Diese tauscht den Autorisierungscode gegen Access- und Refresh-Token und speichert sie in der Tabelle `cloud_connections`.

   **Wichtig zur Speicherung:** Die Tokens liegen dort **unverschlüsselt** (Klartext-Spalten). Geschützt sind sie
   nur über Zugriffsrechte: Die Edge Functions geben keine Tokens an den Browser zurück, und mit der Migration
   des Pakets CLOUD (Komplett-Check 2026-11-27, noch einzuspielen) sind die Token-Spalten für `anon`/`authenticated`
   gesperrt – lesen und schreiben darf sie dann nur noch `service_role` (also die Edge Functions). Bis dahin kann
   jeder angemeldete Nutzer die eigenen Zeilen samt Tokens lesen. Eine echte Verschlüsselung (z. B. Supabase Vault
   bzw. `pgcrypto` mit Schlüssel als Function-Secret) ist noch offen; wer Zugriff auf die Datenbank hat
   (Service-Role-Schlüssel, DB-Passwort, Backups), hat damit dauerhaften Zugriff auf die verbundenen OneDrives.
4. Der User kann nun jedem Portfolio diese Verbindung zuweisen. Bei der Generierung von Rechnungen, Nebenkostenabrechnungen oder Verträgen synchronisiert der Hintergrunddienst `cloud-sync` diese Dokumente vollautomatisch in das entsprechende OneDrive des Users.
