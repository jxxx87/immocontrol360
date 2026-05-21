-- ============================================================================
-- Migration: Fix interest_start_date for cleaned up claims
-- ============================================================================

DO $$ 
BEGIN
  -- Set interest_start_date back to the 5th day of the oldest unpaid rent month 
  -- (approximate start of default / Verzug)
  UPDATE claims c
  SET interest_start_date = (
    SELECT min(ci.period_month) + interval '4 days'
    FROM claim_items ci
    WHERE ci.claim_id = c.id
  )
  WHERE c.status = 'open' 
    AND c.interest_start_date > (
      SELECT min(ci.period_month) + interval '4 days'
      FROM claim_items ci
      WHERE ci.claim_id = c.id
    );

END $$;
