-- ============================================================================
-- Migration: Temporarily disable allocation constraints for debugging
-- ============================================================================

ALTER TABLE claim_payments DISABLE TRIGGER check_payment_allocations_after_payment;
ALTER TABLE claim_payment_allocations DISABLE TRIGGER check_payment_allocations_after_allocation;
