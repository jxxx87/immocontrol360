-- ARCHIV (historisch) – NICHT AUSFÜHREN. Ursprung: immo-web/supabase_migration_deposit.sql. Siehe immo-web/archive/sql/README.md.
DO $$ BEGIN RAISE EXCEPTION 'Archivdatei - nicht ausfuehren (siehe immo-web/archive/sql/README.md)'; END $$;
-- Add deposit column to leases
alter table "public"."leases" add column "deposit" numeric;

-- Ensure payment_due_day exists (requested previously)
alter table "public"."leases" add column if not exists "payment_due_day" integer default 3;
