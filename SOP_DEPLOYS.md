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

## 2. GitHub & Hostinger Deployment (Native Vite-Build auf Hostinger)
Da die Landingpage (`immowebsite`) und die Haupt-App (`immo-web`) getrennt betrieben werden (Hauptdomain vs. Subdomain `app.`), verwenden wir dasselbe GitHub-Repository (`jxxx87/immocontrol360.git`), aber mit zwei separaten Source-Code-Branches. Hostinger baut das jeweilige Projekt direkt auf dem Server mit Vite.

---

### A. Haupt-Web-App (`immo-web` -> `app.immocontrol360.de`)
Der Source-Code der Web-App liegt im Branch **`master`**.
Das Stammverzeichnis auf Hostinger lautet `/public_html/app`.

**Deployment ausführen:**
1. Git-Änderungen in `immo-web` committen und pushen:
   ```powershell
   git add .
   git commit -m "deine beschreibung"
   git push origin master
   ```
2. Hostinger holt sich den `master`-Branch, führt dort automatisch `npm run build` aus und stellt die App live.

---

### B. Marketing-Website (`immowebsite` -> `immocontrol360.de`)
Der Source-Code der Landingpage liegt im Branch **`landing-master`**.
Das Stammverzeichnis auf Hostinger lautet `/public_html`.

**Deployment ausführen:**
1. Git-Änderungen in `immowebsite` committen und pushen:
   ```powershell
   git add .
   git commit -m "deine beschreibung"
   git push origin landing-master
   ```
2. Hostinger holt sich den `landing-master`-Branch, führt dort automatisch `npm run build` aus und stellt die Landingpage live.

---

### C. Hostinger Git-Konfiguration (Einmalig)
Stelle sicher, dass im Hostinger-Panel folgende Git-Verknüpfungen und Build-Einstellungen aktiv sind:

1. **Für die Hauptdomain (`immocontrol360.de`):**
   * Repository-URL: `https://github.com/jxxx87/immocontrol360.git`
   * Branch: **`landing-master`**
   * Installationsverzeichnis: `/public_html`
   * Framework-Voreinstellung: **`Vite`** (wichtig!)
   * Build-Befehl: `npm run build`
   * Ausgabeverzeichnis: `dist`

2. **Für die Subdomain (`app.immocontrol360.de`):**
   * Repository-URL: `https://github.com/jxxx87/immocontrol360.git`
   * Branch: **`master`**
   * Installationsverzeichnis: `/public_html/app`
   * Framework-Voreinstellung: **`Vite`** (wichtig!)
   * Build-Befehl: `npm run build`
   * Ausgabeverzeichnis: `dist`

Hostinger baut und verteilt bei jedem Push vollautomatisch! Lokale `deploy_*.ps1` Skripte werden nicht mehr benötigt, da Hostinger den Build-Prozess nativ übernimmt.



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
