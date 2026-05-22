-- ============================================================================
-- Migration: Drop physical delete blockers for claim_items and claim_events
-- ============================================================================

DROP TRIGGER IF EXISTS block_claim_items_delete ON claim_items;
DROP TRIGGER IF EXISTS block_events_delete ON claim_events;

-- Optional: if you also want to allow deleting allocations when reversing payments
DROP TRIGGER IF EXISTS block_claim_allocations_delete ON claim_payment_allocations;
DROP TRIGGER IF EXISTS block_claim_payments_delete ON claim_payments;
