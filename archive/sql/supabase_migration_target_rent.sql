\set ON_ERROR_STOP on
-- ARCHIV (historisch) – NICHT AUSFÜHREN. Ursprung: immo-web/supabase_migration_target_rent.sql. Siehe immo-web/archive/sql/README.md.
DO $$ BEGIN RAISE EXCEPTION 'Archivdatei - nicht ausfuehren (siehe immo-web/archive/sql/README.md)'; END $$;
-- Add target_rent column to units table
alter table "public"."units" add column if not exists "target_rent" numeric;
