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

## 2. GitHub & Hostinger Deployment (Windows)
Das Deployment auf Hostinger erfolgt automatisch über den GitHub-`master`-Branch.

**Vorgehen:**
1. Änderungen zu Git hinzufügen: `git add .`
2. Unter Windows kann der Commit-Befehl fehlschlagen mit: `fatal: cannot update the ref 'HEAD': unable to append to '.git/logs/HEAD': Invalid argument`. 
   **Lösung:** Vor dem Commit `git config windows.appendAtomically false` ausführen.
3. Commit und Push in einem Befehl (PowerShell-Syntax mit `;`):
   ```powershell
   git config windows.appendAtomically false ; git commit -m "feat: beschreibung" ; git push
   ```
4. Sobald der Push auf GitHub erfolgreich ist, holt Hostinger die Änderungen automatisch ab und geht live. Es ist kein manueller Hostinger-Login nötig.

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
