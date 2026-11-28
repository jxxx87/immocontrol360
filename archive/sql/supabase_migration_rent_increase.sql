\set ON_ERROR_STOP on
-- ARCHIV (historisch) – NICHT AUSFÜHREN. Ursprung: immo-web/supabase_migration_rent_increase.sql. Siehe immo-web/archive/sql/README.md.
DO $$ BEGIN RAISE EXCEPTION 'Archivdatei - nicht ausfuehren (siehe immo-web/archive/sql/README.md)'; END $$;
-- Add last_rent_increase column to leases
alter table "public"."leases" add column if not exists "last_rent_increase" date;
