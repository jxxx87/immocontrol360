-- Add fee_amount and interest_amount to claim_items
-- Each item knows its own fees and interest
ALTER TABLE claim_items ADD COLUMN IF NOT EXISTS fee_amount numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE claim_items ADD COLUMN IF NOT EXISTS interest_amount numeric(12,2) NOT NULL DEFAULT 0;

-- Fix existing data in claim_items – NEUTRALISIERT (Welle 4, Paket M_REPO_MISC, 28.11.2026, H3-05/H3-08):
-- Einmalige Datenkorrektur vom Mai 2026, live bereits ausgeführt (Version steht in
-- supabase_migrations.schema_migrations). Das frühere Massen-UPDATE lief ohne Einschränkung über die
-- Forderungspositionen ALLER Nutzer (bei abgeschaltetem Schutztrigger
-- trigger_protect_claim_item_original_amount, den die Kette erst in 20261128012659_claims_db anlegt –
-- ein Neuaufbau brach hier ab) und schrieb Gebühr und Zins des ganzen Events ungeteilt auf jede
-- passende Position.
-- Die Spalten oben bleiben (idempotent). Ursprünglicher Inhalt: Git-Historie dieser Datei.
-- Neuaufbau einer Datenbank: supabase/baseline/README.md
select 1;
