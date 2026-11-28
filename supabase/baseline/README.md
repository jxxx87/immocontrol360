# Ausgangsschema (Baseline) der Datenbank

Die Migrationskette in `supabase/migrations/` lässt sich **nicht** auf einer leeren Datenbank abspielen:
Kerntabellen (properties, units, tenants, leases, portfolios, contacts, invoices, claims …) wurden nie per
Migration angelegt, einige Alt-Migrationen schalten Trigger ab, die keine Migration erzeugt, und manche sind
nicht idempotent. Maßgeblich war deshalb immer nur der Live-Stand.

Dieser Ordner enthält den **Live-Stand als eine Datei** – damit lässt sich die Datenbank aus dem Repository
neu aufbauen (Testumgebung, Notfall, neues Projekt).

| Datei | Inhalt |
|---|---|
| `baseline_public.sql` | Komplettes Schema `public` (74 Tabellen, 3 Sichten, 159 Funktionen, 291 Policies, Trigger, Indizes, Rechte, Kommentare, Realtime-Publikation) plus die 32 Storage-Policies und die Einstellungen der 9 Storage-Buckets. Keine Kundendaten. |
| `seed_system_defaults.sql` | Globale Systemvorgaben ohne Personenbezug: 6 Verteilerschlüssel und 23 Kostenarten mit `user_id IS NULL`. |
| `generate_baseline.sql` | Erzeugt beide Dateien aus dem Live-Katalog **und prüft sie**: das erzeugte DDL wird in derselben Transaktion in Ersatz-Schemata eingespielt und Objekt für Objekt mit dem Live-Stand verglichen; danach wird alles zurückgerollt. |
| `extract_baseline.cjs` | Schreibt die Dateien aus dem gespeicherten Ergebnis; prüft Prüfsumme, Schlüssel-Freiheit und Prüfbericht. |

## Stand

- Erzeugt am 2026-11-28, PostgreSQL 17.6, letzte eingetragene Migration `20261128092217`
  (reno_self_assign_w6) – enthält alle Korrekturwellen 1–6.
- Prüfbericht des Laufs: Spalten 915/915, Constraints 345/345, Indizes 307/307, Funktionen 159/159,
  Funktionsrechte 159/159, Policies 323/323 (inkl. Storage), Trigger 92/92, RLS 74/74, Tabellenrechte 77/77,
  Kommentare 100/100, Sichten 3/3, Buckets 9/9, Standardrechte 3/3 – alles identisch bis auf bekannte Stellen:
  - `notify_push`: absichtlich eine **Vault-Fassung** (siehe unten), nicht der Live-Rumpf (im Prüfbericht
    beidseitig mit festem Fingerabdruck verglichen, erscheint daher nicht als Abweichung).
  - `contact_requests_email_len` und `lease_cloud_folders_path_check`: gleiche Bedingung, nur andere Klammerung
    (die Originale wurden mit `BETWEEN` angelegt; nach dem erneuten Einlesen fasst Postgres die UND-Glieder flacher).
- Funktionen, die berechnete Spalten, Spalten-Vorgaben oder CHECK-Constraints benutzen (derzeit
  `floor_plan_room_count`, `floor_plan_storey_labels`, `floor_plan_total_area_mm2` für `floor_plans`), stehen in
  Abschnitt 1 **vor** den Tabellen – sonst scheitert `create table` beim Neuaufbau.

## notify_push und der Schlüssel

Der Live-Rumpf von `notify_push` enthält bis zur Schlüssel-Erneuerung (Phase 0) den service_role-Schlüssel als
Literal. Der Generator gibt ihn **nie** aus. In der Baseline steht stattdessen eine Fassung, die URL und Schlüssel
aus dem Supabase-Vault liest:

```sql
select vault.create_secret('https://<projekt-ref>.supabase.co/functions/v1/send-push-notification', 'push_function_url');
select vault.create_secret('<service_role_key des neuen Projekts>', 'service_role_key');
```

Fehlt eines der Secrets, verschickt die Funktion nichts und schreibt nur eine Warnung. Diese Fassung ist auch
die Vorlage für Phase 0 auf Live (Schlüssel erneuern, Secret anlegen, Funktion ersetzen).

## Neuaufbau (nur auf einer LEEREN Datenbank)

1. Leeres Ziel bereitstellen: neues Supabase-Projekt, Supabase-Branch (kostenpflichtig – Freigabe des Nutzers)
   oder lokal `npx supabase start` (Docker). **Nie auf der Live-Datenbank ausführen.**
2. Schema einspielen (eine Transaktion, Abbruch beim ersten Fehler):
   ```bash
   psql "<db-url>" -v ON_ERROR_STOP=1 --single-transaction -f supabase/baseline/baseline_public.sql
   psql "<db-url>" -v ON_ERROR_STOP=1 --single-transaction -f supabase/baseline/seed_system_defaults.sql
   ```
3. Vault-Secrets für Push anlegen (siehe oben).
4. Migrationshistorie angleichen: alle Dateien in `supabase/migrations/` bis einschließlich der Version im Kopf von
   `baseline_public.sql` als eingespielt markieren – sie stecken schon in der Baseline und dürfen **nicht**
   noch einmal laufen:
   ```bash
   npx supabase migration repair --status applied $(ls supabase/migrations | sed 's/_.*//' | awk '$1 <= 20261128092217')
   ```
5. Neuere Migrationen normal einspielen (`npx supabase db push`).
6. Edge Functions deployen (`supabase/functions`, `verify_jwt` laut `supabase/config.toml`) und deren Secrets setzen.

`npx supabase db reset` (lokal) spielt dagegen die alte Kette ab und scheitert – für einen Neuaufbau immer die
Baseline verwenden.

## Baseline neu erzeugen

1. Den ganzen Inhalt von `generate_baseline.sql` über das Supabase-MCP-Werkzeug `execute_sql` (oder den SQL-Editor)
   ausführen. Er liest nur und rollt am Ende alles zurück; Kundendaten werden nicht gelesen (Ausnahme: die
   globalen Vorgaben für `seed_system_defaults.sql`).
2. Das Ergebnis speichern (MCP legt große Ergebnisse als Datei ab) und schreiben:
   ```bash
   node supabase/baseline/extract_baseline.cjs <ergebnis-datei>
   ```
   Das Skript bricht ab und schreibt nichts, wenn die Prüfsumme nicht stimmt, ein JWT-artiges Literal auftaucht
   oder der Prüfbericht andere als die zwei bekannten Abweichungen meldet.
3. Kopfzeile (Version) prüfen und Schritt 4 oben anpassen.

## Was nicht enthalten ist

- Daten (außer den globalen Vorgaben im Seed) und Dateien in den Storage-Buckets.
- Supabase-eigene Schemata und Einstellungen (auth, storage-Tabellen, realtime, Auth-Einstellungen wie
  „Leaked Password Protection"), Edge Functions und deren Secrets.
- Es gibt live keine Trigger auf `auth.users`, keine Cron-Jobs und keine eigenen Typen; sollte sich das ändern,
  den Generator erweitern.

## Hinweis zur Veröffentlichung

Die Baseline zeigt alle Policies und Funktionen im Klartext. Solange das GitHub-Repository öffentlich ist, neue
Sicherheits-Migrationen immer erst einspielen und die Baseline erst danach neu erzeugen und committen – sonst
dokumentiert sie offene Lücken.
