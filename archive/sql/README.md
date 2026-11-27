# Archiv: lose SQL-Dateien (historisch – NICHT ausführen)

Diese Dateien lagen bis zum Komplett-Check vom 27.11.2026 lose im Projekt (Root von `immo-web`, `scripts/`,
`supabase/` und eine Datei ohne Zeitstempel in `supabase/migrations/`). Sie wurden damals von Hand bzw. über
Hilfsskripte direkt auf die Produktiv-Datenbank gespielt – **an der Migrationshistorie vorbei**.

Sie bleiben hier nur als Nachschlagewerk („Woher kommt diese Funktion/Policy?"). Ihr Inhalt ist **überholt**:

- Mehrere Dateien würden den heutigen Live-Stand zurückdrehen (z. B. `update_rls.sql` ersetzt alle Policies
  durch Pauschalregeln, `update_rls_claims_portal.sql` und `supabase_migration_stripe_*.sql` installieren alte
  Fassungen von RPCs, `sync_rent_ledgers_rpc.sql` überschreibt historische Sollmieten, `teardown_claims.sql`
  löscht das Forderungs-Schema).
- Einige sind nicht idempotent (`ADD COLUMN` ohne `IF NOT EXISTS`, `CREATE POLICY` ohne `DROP … IF EXISTS`).

Jede Datei beginnt deshalb mit einer Schutzzeile, die eine Ausführung sofort abbricht:

```sql
DO $$ BEGIN RAISE EXCEPTION 'Archivdatei - nicht ausfuehren (...)'; END $$;
```

(Hinweis: `psql -f` ohne `ON_ERROR_STOP` würde nach dem Fehler weiterlaufen – also auch dort nicht ausführen.)

## Wie Datenbank-Änderungen heute laufen

Nur noch als datierte Migration in `supabase/migrations/<YYYYMMDDHHMMSS>_<name>.sql`, eingespielt über die
Supabase-CLI (`npx supabase db push`) oder das Supabase-MCP-Werkzeug `apply_migration`. Beides trägt die
Migration in die Historie ein. Keine Node-Skripte mit direkter `pg`-Verbindung (Superuser-Passwort,
`rejectUnauthorized: false`) mehr (siehe `SOP_DEPLOYS.md`).

## Herkunft der Dateien

| Datei hier | früherer Ort |
|---|---|
| `create_claim_multi_rpc.sql`, `create_claim_rpc.sql` | `immo-web/` |
| `draft_claims_migration.sql`, `_v2`, `_v3`, `_v4` | `immo-web/` |
| `supabase_migration_*.sql`, `supabase_setup.sql` | `immo-web/` |
| `sync_rent_ledgers_rpc.sql`, `teardown_claims.sql`, `tenant_management_adjustments.sql`, `test_claims_migration.sql` | `immo-web/` |
| `update_rls.sql`, `update_rls_additive.sql`, `update_rls_claims_portal.sql` | `immo-web/` |
| `create_utility_settlements.sql` | `immo-web/scripts/` |
| `sql_step1_table.sql`, `sql_step2_functions.sql`, `sql_step3_triggers.sql` | `immo-web/supabase/` |
| `create_floor_plans.sql` | `immo-web/supabase/migrations/` (ohne Zeitstempel – wurde von der CLI ohnehin übersprungen; live von Hand eingespielt) |
| `fix_rls_policies.sql` | SQL-Teil aus dem gelöschten Skript `fix_rls.cjs` |
| `update_invitations_rpc.sql` | SQL-Teil aus dem gelöschten Skript `update_invitations_rpc.cjs` (`get_pending_invitations`, `decline_portfolio_share`) |

Zeilenangaben aus älteren Prüfberichten verschieben sich durch die zwei Schutzzeilen um +2.
