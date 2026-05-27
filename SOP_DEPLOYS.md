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

## 2. GitHub & Hostinger Deployment (Dual-Branch Setup)
Da die Landingpage (`immowebsite`) und die Haupt-App (`immo-web`) getrennt betrieben werden (Hauptdomain vs Subdomain `app.`), verwenden wir dasselbe GitHub-Repository (`jxxx87/immocontrol360.git`), schieben die fertigen Builds aber auf unterschiedliche Deployment-Branches.

### A. Haupt-Web-App (`immo-web` -> `app.immocontrol360.de`)
Die Web-App wird auf der Subdomain `app.` bereitgestellt. Das Stammverzeichnis auf Hostinger lautet `/public_html/app`.
Die deployten Build-Dateien liegen im Branch **`production`**.

**Deployment ausführen:**
1. Öffne ein PowerShell-Terminal im Ordner `immo-web`.
2. Führe das Deployment-Skript aus:
   ```powershell
   .\deploy_hostinger.ps1
   ```
3. Das Skript baut die App (`npm run build`) und schiebt den `dist`-Ordner in den Branch `production` auf GitHub.
4. Hostinger zieht sich diesen Branch automatisch in das Verzeichnis `/public_html/app` und schaltet die Änderungen live.

---

### B. Marketing-Website (`immowebsite` -> `immocontrol360.de`)
Die Marketingpage wird auf der Hauptdomain betrieben. Das Stammverzeichnis auf Hostinger lautet `/public_html`.
Die deployten Build-Dateien liegen im Branch **`production-landing`**.

**Deployment ausführen:**
1. Öffne ein PowerShell-Terminal im Ordner `immowebsite`.
2. Führe das Deployment-Skript aus:
   ```powershell
   .\deploy_marketing.ps1
   ```
3. Das Skript installiert Abhängigkeiten, baut die Seite und schiebt den `dist`-Ordner in den Branch `production-landing` auf GitHub.
4. Hostinger zieht sich diesen Branch automatisch in das Verzeichnis `/public_html` und schaltet die Änderungen live.

---

### C. Hostinger Git-Konfiguration (Einmalig)
Stelle sicher, dass im Hostinger-Panel folgende Git-Verknüpfungen aktiv sind:

1. **Für die Hauptdomain (`immocontrol360.de`):**
   * Repository-URL: `https://github.com/jxxx87/immocontrol360.git`
   * Branch: `production-landing`
   * Installationsverzeichnis: `/public_html`

2. **Für die Subdomain (`app.immocontrol360.de`):**
   * Repository-URL: `https://github.com/jxxx87/immocontrol360.git`
   * Branch: `production`
   * Installationsverzeichnis: `/public_html/app`


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
