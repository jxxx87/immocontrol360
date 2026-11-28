# Standard Operating Procedure (SOP): Supabase & GitHub Deployment

> Stand: Komplett-Check 2026-11-27, ergänzt 2026-11-28 (Abbruchregeln von `deploy_all.ps1`, `version.json`,
> Neuaufbau über die Baseline, Sicherheits-Header). Ersetzt die frühere Fassung, die Migrationen per Node-Skript mit direkter
> `pg`-Verbindung (Superuser-Passwort, `ssl: { rejectUnauthorized: false }`) vorsah. Dieser Weg ist abgeschafft:
> Das Zertifikat wurde nicht geprüft (Passwort im fremden WLAN abgreifbar) und die Änderungen landeten nicht in
> der Migrationshistorie. Die zugehörigen Skripte (`apply_sql.cjs`, `apply_migration.cjs` usw.) wurden gelöscht.

## 1. Supabase-Datenbank: Migrationen

**Regel:** Jede Schema-, Funktions- oder Policy-Änderung ist eine datierte Datei in
`supabase/migrations/<YYYYMMDDHHMMSS>_<name>.sql` – idempotent geschrieben (`create or replace`,
`drop policy if exists`, `if not exists`). Lose SQL-Dateien im Projekt gibt es nicht mehr
(alte Stände nur zum Nachschlagen in `archive/sql/`, **nicht ausführen**).

**Einspielen – nur über die offiziellen Supabase-Werkzeuge (tragen die Migration in die Historie ein):**

1. **Supabase-MCP** (für KI-Agenten): Werkzeug `apply_migration` mit dem Projekt `agsmqvvwfufenaiekuox`,
   Name = Dateiname ohne Zeitstempel, Inhalt = Datei. Reine Lese-Abfragen gehen über `execute_sql`.
2. **Supabase-CLI** (Terminal im Ordner `immo-web`):
   ```bash
   npx supabase login
   npx supabase link --project-ref agsmqvvwfufenaiekuox
   npx supabase db push
   ```
   Die CLI fragt das DB-Passwort ab bzw. liest es aus der Umgebungsvariable `SUPABASE_DB_PASSWORD`
   (nie in eine Datei im Repo schreiben).

**Achtung – MCP und CLI nicht ungeprüft mischen:** `apply_migration` trägt die Migration mit dem Zeitpunkt der
Ausführung als Version ein, **nicht** mit dem Zeitstempel aus dem Dateinamen (Beispiel: am 27.11.2026 um
15:55:57 eingespielt → Version `20261127155557`, egal wie die Datei heißt). Danach die lokale Datei auf die
tatsächliche Version umbenennen (ablesen mit
`select version, name from supabase_migrations.schema_migrations order by version desc limit 5;`).
Sonst hält `supabase db push` die Datei für nicht eingespielt und bricht wegen der unbekannten Remote-Version ab.
Ebenso fehlen live die Einträge für `20260601151000`, `20260601170000` und `20260601180000` (von Hand eingespielt):
vor dem ersten `db push` mit `npx supabase migration repair --status applied <version>` nachtragen.

**Wenn `apply_migration` mit fehlenden Rechten scheitert** (z. B. `Permission Denied`): abbrechen und den Nutzer
fragen. **Kein** Ausweichen auf eine selbst gebaute `pg`-Verbindung, kein `rejectUnauthorized: false`, kein
Passwort-Literal in Skripten.

**Vor jeder Migration:** Live-Stand lesen (`execute_sql` auf `pg_policies`/`pg_proc`), damit die Migration
nicht einen neueren Stand zurückdreht. Viele Live-Objekte stammen aus früher von Hand eingespielten Dateien.

**Datenbank neu aufbauen (Testumgebung, Notfall, neues Projekt):** nicht über die Migrationskette – die beginnt
ohne Basisschema und enthält einmalige Datenkorrekturen auf den Daten aller Nutzer (mehrere davon sind inzwischen
durch `select 1;` ersetzt, Version und Dateiname blieben; die Kette ist trotzdem nicht wiederholbar). Der Weg steht in **`supabase/baseline/README.md`**: leeres Projekt →
`baseline_public.sql` und `seed_system_defaults.sql` einspielen → Vault-Secrets anlegen → Migrationshistorie bis
zur Baseline-Version per `migration repair` als eingespielt markieren → danach nur neuere Migrationen per
`db push` → Edge Functions samt Secrets deployen. `supabase db reset` spielt dagegen die alte Kette ab und
scheitert. Nie auf der Live-Datenbank ausführen. Die Baseline nach größeren Schemaänderungen mit
`supabase/baseline/generate_baseline.sql` neu erzeugen (Anleitung ebenfalls im README).

## 2. GitHub & Hostinger Deployment (kombiniertes Pre-Built-Deployment)

Hostinger lässt in Standard-Tarifen nur eine Git-Verbindung pro Website (Verzeichnis `/public_html`) zu. Deshalb
werden beide Seiten lokal gebaut, zusammengeführt (Marketing-Seite im Root `/`, Web-App im Unterordner `/app/`)
und auf den Branch **`production`** geschoben. Die Subdomain `app.immocontrol360.de` zeigt in Hostinger auf
`/public_html/app`.

**`git push origin master` geht NICHT live** – das ist nur die Quellcode-Sicherung.

---

### A. Deployment ausführen

1. PowerShell öffnen (Ordner egal – das Skript arbeitet relativ zu seinem eigenen Ort).
2. **Vorher committen und pushen** – in `immo-web` den Branch `master`, in `immowebsite` den Branch
   `landing-master`. Sonst bricht das Skript ab (siehe 4.).
3. Ausführen (im PowerShell-Tool ohne Umleitung wie `*>&1`/`2>&1` – sonst wertet PowerShell 5.1 npm-Warnungen
   auf stderr als Fehler):
   ```powershell
   .\deploy_all.ps1          # im Ordner immo-web
   ```
4. Das Skript
   - **bricht ab, bevor etwas gebaut wird**, wenn eines der beiden Repos nicht committete Änderungen hat
     (auch neue, noch nicht hinzugefügte Dateien – es prüft `git status --porcelain`), kein Branch ausgecheckt ist
     (detached HEAD) oder der aktuelle Commit noch nicht auf GitHub liegt (`git fetch` +
     `git merge-base --is-ancestor HEAD origin/<branch>`). So entspricht der Live-Stand immer genau einem gepushten
     Commit. Notfall-Schalter **`-AllowDirty`**: baut trotzdem und vermerkt in Commit-Nachricht und `version.json`
     „NICHT REPRODUZIERBAR (…)“,
   - führt in `immo-web` vor dem Build **`npm run lint`** (`eslint .`) und **`npm test`** (`vitest run`) aus und
     bricht beim ersten Fehler ab (die Website hat keine Tests). Notfall-Schalter **`-SkipChecks`**,
   - baut beide Projekte und bricht bei einem Build-Fehler ab (prüft Exit-Codes und dass beide
     `dist\index.html` neu erzeugt wurden),
   - holt den Branch `production` in einen Arbeitsordner unter `%TEMP%` (nicht im OneDrive-Ordner),
   - ersetzt den Inhalt durch das neue Build und eine Dummy-`package.json` für Hostinger,
   - schreibt `app/version.json` mit Build-Zeitpunkt und den Quell-Commits beider Repos (Felder `gebaut`,
     `web`, `website`, je „<repo>: <commit> (<branch>)“),
   - committet mit den **Quell-Commits beider Repos** in der Commit-Nachricht (mit `-AllowDirty` zusätzlich
     „NICHT REPRODUZIERBAR (…)“),
   - pusht **ohne `--force`** (die Historie von `production` bleibt erhalten, ein Rollback ist möglich),
   - räumt den Arbeitsordner immer auf und meldet Erfolg erst nach erfolgreichem Push.
5. Wird der Push mit „rejected" abgelehnt, hat jemand `production` inzwischen geändert – Skript einfach erneut
   starten. Schlägt das Klonen fehl (Netz, Anmeldung), bricht das Skript ab; es legt nie ein leeres Repository an.

**Welcher Quellstand ist live?** `https://app.immocontrol360.de/version.json` (Build-Zeitpunkt und Quell-Commits
beider Repos; geprüft 28.11.2026) – oder `git log origin/production -1`, dessen Commit-Nachricht dieselben
Quell-Commits nennt.

**Rollback:** In einem Klon von `production` den gewünschten früheren Deploy-Commit per `git revert` (oder
Inhalt des alten Commits als neuer Commit) wiederherstellen und normal pushen.

---

### B. Hostinger Git-Konfiguration (einmalig)

Im Hostinger-Panel unter **Erweitert -> Git** (oder „Weitere Einstellungen" bei der letzten Bereitstellung):

* **Repository-URL:** `https://github.com/jxxx87/immocontrol360.git`
* **Zweig (Branch):** **`production`**
* **Installationsverzeichnis:** `/public_html` (oder leer lassen)
* **Framework-Voreinstellung:** **`Other`**
* **Build-Befehl:** `npm run build` *(Hostinger führt die Dummy-package.json aus, die sofort erfolgreich endet)*
* **Ausgabeverzeichnis:** **`.`** (ein einzelner Punkt, damit der gesamte Inhalt übernommen wird)
* **Startbefehl:** (leer lassen)

Mit **Speichern und erneut bereitstellen** abschließen. Hostinger stellt bei jedem Push auf `production`
automatisch neu bereit (beobachtet am 27.11.2026: neuer Stand nach etwa 2 Minuten live). Kontrolle: `version.json`
(siehe oben) bzw. die Asset-Namen in `https://app.immocontrol360.de/` und `https://immocontrol360.de/` mit
`dist/index.html` vergleichen.

**Hinweis Webserver-Regeln:** `public/.htaccess` der App (landet in `/app`) setzt Sicherheits-Header, Cache-Regeln
(`index.html` immer neu prüfen, gehashte Dateien unter `/assets/` ein Jahr cachen), liefert fehlende Assets als
echtes 404 und leitet `immocontrol360.de/app/...` auf `app.immocontrol360.de` um. Header aus der `.htaccess` der
Marketing-Seite (Root) gelten bei Apache auch für den Unterordner `/app` – dort keine Regeln setzen, die die App
brechen. Beide `.htaccess` setzen seit 28.11.2026 eine schmale Content-Security-Policy ohne `script-src`/
`connect-src` (`upgrade-insecure-requests; frame-ancestors 'self'; base-uri 'self'`, die Marketing-Seite zusätzlich
`object-src 'none'`); die App setzt ihre eigene und ersetzt damit die der Marketing-Seite (ohne `object-src`, weil
Mahnungs-PDFs als `blob:`-Adresse im Browser-PDF-Viewer geöffnet werden). Nach einem Deploy prüfen:
`curl -sI https://app.immocontrol360.de/` und `curl -sI https://immocontrol360.de/`.

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
*(Hinweis: In `SECURITY DEFINER` RPC-Funktionen darf `auth.users` abgefragt werden, da diese mit höheren Rechten laufen. Solche Funktionen immer mit `set search_path = public, pg_temp` anlegen.)*
