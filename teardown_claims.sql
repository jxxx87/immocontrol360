-- ============================================================================
-- TEARDOWN SCRIPT FÜR TEST-UMGEBUNG
-- Führt einen sauberen Reset durch, falls eine Migration fehlschlägt.
-- ============================================================================

DROP VIEW IF EXISTS claim_totals_view CASCADE;
DROP VIEW IF EXISTS claim_item_totals_view CASCADE;

DROP TABLE IF EXISTS payment_plan_installments CASCADE;
DROP TABLE IF EXISTS payment_plans CASCADE;
DROP TABLE IF EXISTS claim_events CASCADE;
DROP TABLE IF EXISTS claim_payment_allocations CASCADE;
DROP TABLE IF EXISTS claim_payments CASCADE;
DROP TABLE IF EXISTS claim_items CASCADE;
DROP TABLE IF EXISTS claims CASCADE;

-- Die Funktionen können bestehen bleiben, da sie mit CREATE OR REPLACE angelegt werden, 
-- aber zur Sicherheit können wir die Hauptfunktionen auch droppen:
DROP FUNCTION IF EXISTS update_overdue_claims_status() CASCADE;
