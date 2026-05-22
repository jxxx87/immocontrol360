-- ============================================================================
-- Migration: Add bypass setting to reverse_claim_payment
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reverse_claim_payment(p_payment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_claim_id uuid;
  v_status text;
  v_event record;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Load payment
  SELECT claim_id, status INTO v_claim_id, v_status
  FROM claim_payments
  WHERE id = p_payment_id AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Zahlung nicht gefunden oder keine Berechtigung.';
  END IF;

  -- Reverse in claims table (best effort via event_metadata)
  SELECT event_metadata INTO v_event
  FROM claim_events
  WHERE claim_id = v_claim_id AND event_type = 'payment_received' AND event_metadata->>'payment_id' = p_payment_id::text
  LIMIT 1;

  IF FOUND THEN
    IF v_event.event_metadata->>'old_interest_start_date' IS NOT NULL THEN
      UPDATE claims SET
        interest_start_date = (v_event.event_metadata->>'old_interest_start_date')::date,
        accumulated_unpaid_interest = (v_event.event_metadata->>'old_accumulated_unpaid_interest')::numeric,
        status = CASE WHEN status = 'settled' THEN 'open' ELSE status END,
        updated_at = now()
      WHERE id = v_claim_id;
    END IF;

    -- Reverse installment if applicable
    IF v_event.event_metadata->>'installment_id' IS NOT NULL THEN
      UPDATE payment_plan_installments SET
        paid_amount = (v_event.event_metadata->>'old_installment_paid_amount')::numeric,
        status = (v_event.event_metadata->>'old_installment_status')::text,
        updated_at = now()
      WHERE id = (v_event.event_metadata->>'installment_id')::uuid;

      -- Reverse plan status if it was completed
      UPDATE payment_plans SET
        status = (v_event.event_metadata->>'old_plan_status')::text,
        updated_at = now()
      WHERE id = (v_event.event_metadata->>'payment_plan_id')::uuid;
    END IF;
  ELSE
    -- If no event found, just change status back to open if it was settled
    UPDATE claims SET
      status = CASE WHEN status = 'settled' THEN 'open' ELSE status END,
      updated_at = now()
    WHERE id = v_claim_id;
  END IF;

  -- Bypass safety trigger on rent_payments for this transaction
  PERFORM set_config('app.bypass_rent_payment_protect', '1', true);

  -- Delete rent_payments synced from this payment
  DELETE FROM rent_payments 
  WHERE user_id = v_user_id AND note LIKE '%(Ref: ' || p_payment_id || ')%';

  -- Delete allocations
  DELETE FROM claim_payment_allocations WHERE claim_payment_id = p_payment_id;

  -- Delete payment
  DELETE FROM claim_payments WHERE id = p_payment_id;
  
  PERFORM sync_all_rent_ledgers();
END;
$$;
