-- ============================================================================
-- Migration: Drop old record_claim_payment signature
-- ============================================================================

-- Drop the old 4-parameter version which did not have the bulletproof fallback.
-- PostgREST was routing calls without p_installment_id to this old buggy version
-- instead of the new 5-parameter version (which has a DEFAULT NULL).
DROP FUNCTION IF EXISTS public.record_claim_payment(uuid, date, numeric, text);
