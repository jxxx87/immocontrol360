-- ============================================================================
-- Migration: Cleanup stuck payments from before the Reverse feature
-- ============================================================================

DO $$ 
DECLARE 
  v_user_id uuid;
BEGIN
  -- We just delete all claim_payments and associated data to clean up the test state.
  
  ALTER TABLE rent_payments DISABLE TRIGGER block_claim_rent_payments_modification;

  -- Delete all rent_payments created via Forderungsakte (both old format without Ref and new format)
  DELETE FROM rent_payments WHERE note LIKE 'Verrechnung über Forderungsakte%';

  ALTER TABLE rent_payments ENABLE TRIGGER block_claim_rent_payments_modification;

  -- Delete all claim payment allocations
  DELETE FROM claim_payment_allocations;

  -- Delete all claim payments
  DELETE FROM claim_payments;

  -- Reset claims status if it was settled by those payments
  UPDATE claims 
  SET 
    accumulated_unpaid_interest = 0,
    status = 'open'
  WHERE status = 'settled' OR accumulated_unpaid_interest > 0;
  
  -- Perform sync
  PERFORM sync_all_rent_ledgers();

END $$;
