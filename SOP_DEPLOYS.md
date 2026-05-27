# Standard Operating Procedure (SOP): Supabase & GitHub Deployment

## 1. Supabase SQL Migration (Direct Execution)
Wenn das offizielle MCP-Tool `execute_sql` wegen unzureichender Berechtigungen (z.B. `PGRST202` oder `Permission Denied`) fehlschlägt, MUSS die SQL-Migration direkt über einen Node.js-Client (`pg`) auf der remote Supabase-Datenbank ausgeführt werden.

**Vorgehen:**
1. SQL-Skript erstellen (z.B. `migration.sql`).
2. Sicherstellen, dass das Paket `pg` installiert ist (`npm install pg` oder `npm install pg dotenv`).
3. Ein Node-Skript (z.B. `apply_sql.cjs`) verwenden, das sich direkt mit der Datenbank verbindet:
   ```javascript
   const { Client } = require('pg');
   const fs = require('fs');
   require('dotenv').config();

   async function run() {
       const password = process.env.SUPABASE_DB_PASSWORD;
       const projectId = "agsmqvvwfufenaiekuox"; // Projekt ID
       const sql = fs.readFileSync('migration.sql', 'utf8');
       
       // WICHTIG: Direkter Endpoint (db.[project_id].supabase.co) ohne Pooler umgeht Region-Raten!
       const connectionString = `postgres://postgres:${password}@db.${projectId}.supabase.co:5432/postgres`;
       
       const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
       await client.connect();
       await client.query(sql);
       await client.end();
   }
   run();
   ```
4. Führe das Skript über das Terminal aus (`node apply_sql.cjs`).

## 2. GitHub & Hostinger Deployment (Kombiniertes Pre-Built-Deployment)
Da Hostinger in Standard-Hosting-Tarifen nur eine einzige Git-Verbindung pro Website (für das Verzeichnis `/public_html`) zulässt, nutzen wir ein kombiniertes Deployment. Beide Webseiten werden lokal gebaut, in eine Verzeichnisstruktur zusammengeführt (Landingpage im Root `/`, Web-App im Unterordner `/app/`) und auf den Branch **`production`** hochgeladen. 

Hostinger zieht sich diesen Branch und stellt ihn eins zu eins bereit. Da die Subdomain `app.immocontrol360.de` in Hostinger auf das Unterverzeichnis `/public_html/app` verweist, funktioniert die Trennung perfekt über diese eine Git-Verbindung!

---

### A. Deployment ausführen
Um die Live-Umgebung (Marketingpage + Web-App) zu aktualisieren:
1. Öffne ein PowerShell-Terminal im Ordner `immo-web`.
2. Führe das kombinierte Deployment-Skript aus:
   ```powershell
   .\deploy_all.ps1
   ```
3. Das Skript baut beide Projekte nacheinander, erstellt die richtige Ordnerstruktur, fügt eine Dummy-`package.json` hinzu und schiebt das fertige Ergebnis per Force-Push auf den Branch **`production`** auf GitHub.

---

### B. Hostinger Git-Konfiguration (Einmalig)
Nimm in deinem Hostinger-Panel unter **Erweitert -> Git** (oder über den Button "Weitere Einstellungen" bei der letzten Bereitstellung) folgende Einstellungen vor:

* **Repository-URL:** `https://github.com/jxxx87/immocontrol360.git`
* **Zweig (Branch):** **`production`**
* **Installationsverzeichnis:** `/public_html` (oder leer lassen)
* **Framework-Voreinstellung:** **`Other`**
* **Build-Befehl:** `npm run build` *(Hostinger führt hierbei die Dummy-package.json aus, was sofort erfolgreich abschließt)*
* **Ausgabeverzeichnis:** **`.`** (ein einzelner Punkt, damit der gesamte Inhalt übernommen wird)
* **Startbefehl:** (leer lassen)

Klicke auf **Speichern und erneut bereitstellen**. Danach läuft das Deployment innerhalb von Sekunden ohne Fehler durch und beide Seiten sind live!




## 3. RLS Policies Pitfall: `auth.users`
**WICHTIG:** In Supabase haben Nutzer (Rolle `authenticated`) **keinen Zugriff** auf die Tabelle `auth.users`!
Ein `SELECT email FROM auth.users WHERE id = auth.uid()` innerhalb einer RLS-Policy führt zu einem `Permission Denied` Fehler. Dieser Fehler blockiert die gesamte Query (z.B. werden Portfolios nicht mehr geladen und der Nutzer landet beim Onboarding).

**Lösung:** Um die E-Mail des aktuellen Nutzers in einer RLS-Policy zu erhalten, nutze IMMER die JWT-Claims:
```sql
-- FALSCH:
shared_with_email = (SELECT email FROM auth.users WHERE id = auth.uid())

-- RICHTIG:
shared_with_email = (auth.jwt() ->> 'email')
```
*(Hinweis: In `SECURITY DEFINER` RPC-Funktionen darf `auth.users` abgefragt werden, da diese mit höheren Rechten laufen.)*
