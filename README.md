# ImmoControl360 – Web-App (`immo-web`)

React 19 + Vite, Supabase (Auth, Datenbank, Storage, Edge Functions), Capacitor (Android).
Live unter **https://app.immocontrol360.de**. Die Marketing-Seite liegt im Nachbarordner `../immowebsite`.

## Lokale Entwicklung

1. Abhängigkeiten sind in `node_modules` vorhanden (sonst einmalig `npm install`).
2. Dev-Server starten:
   ```bash
   npm run dev
   ```
3. Im Browser `http://localhost:5173` öffnen. Änderungen in `src/` werden sofort neu geladen.

Die Umgebungswerte (Supabase-URL, Anon-Key, OAuth-Client-IDs) stehen in `.env` bzw. `.env.production`.

PDFs (Rechnungen, Mahnungen, Nebenkosten, Vorlagen) werden **im Browser** erzeugt – ein separater
PDF-Server ist nicht nötig. (Der frühere Ordner `server/` mit einem Puppeteer-Server wurde entfernt; er wurde
von der App nie aufgerufen.)

## Datenbank-Änderungen

Nur als datierte Migration in `supabase/migrations/<YYYYMMDDHHMMSS>_<name>.sql` (idempotent schreiben:
`create or replace`, `drop … if exists`, `if not exists`). Einspielen über die offiziellen Supabase-Werkzeuge,
die die Migration in die Historie eintragen:

```bash
npx supabase login
npx supabase link --project-ref agsmqvvwfufenaiekuox
npx supabase db push
```

oder über das Supabase-MCP-Werkzeug `apply_migration`. Keine Node-Skripte mit direkter `pg`-Verbindung
(ohne Zertifikatsprüfung, an der Historie vorbei) mehr – Details in `SOP_DEPLOYS.md`. Alte lose SQL-Dateien
liegen nur noch zum Nachschlagen in `archive/sql/` und dürfen **nicht** ausgeführt werden.

## Live stellen (Deployment)

**Nicht** `git push origin master` – das aktualisiert nur den Quellcode auf GitHub, aber nicht die Webseite.

Live geht nur, was im Branch **`production`** liegt. Den befüllt ausschließlich das Skript:

```powershell
.\deploy_all.ps1
```

Es baut `immowebsite` und `immo-web`, legt beide zusammen (Marketing-Seite in `/`, Web-App in `/app/`),
schreibt die Quell-Commits beider Repos in die Commit-Nachricht und pusht das Ergebnis auf `production`.
Hostinger stellt diesen Branch bereit. Bei einem Build- oder Git-Fehler bricht das Skript ab, ohne etwas zu
veröffentlichen. Vorher am besten committen und `master` pushen, damit der Live-Stand einem Commit entspricht.

Ausführliche Anleitung (inkl. Hostinger-Einstellungen): `SOP_DEPLOYS.md`.

## Android-App

`npm run build`, dann `npx cap sync android` und `npx cap open android` (Android Studio). Paketname:
`com.ImmoControl.pro360`. Push-Benachrichtigungen: `docs/PUSH_NOTIFICATIONS_SETUP.md`.
