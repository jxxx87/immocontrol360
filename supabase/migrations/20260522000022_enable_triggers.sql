-- ============================================================================
-- Migration: Re-enable security triggers
-- ============================================================================

ALTER TABLE claim_payments ENABLE TRIGGER check_payment_allocations_after_payment;
ALTER TABLE claim_payment_allocations ENABLE TRIGGER check_payment_allocations_after_allocation;
