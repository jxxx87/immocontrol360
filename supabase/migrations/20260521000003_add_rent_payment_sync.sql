-- ============================================================================
-- RPC: record_claim_payment (Updated to insert into rent_payments)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_claim_payment(
  p_claim_id uuid,
  p_payment_date date,
  p_amount numeric,
  p_note text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_lease_id uuid;
  v_claim_status text;
  v_interest_rate numeric;
  v_interest_start_date date;
  v_accumulated_unpaid_interest numeric;
  
  -- Totals from DB
  v_total_fees_open numeric;
  v_total_interest_open numeric;
  v_current_principal_open numeric;
  v_total_due numeric;
  
  -- Interest calculation variables
  v_new_interest numeric;
  
  -- Allocation variables
  v_remaining_amount numeric;
  v_alloc_fees numeric := 0;
  v_alloc_interest numeric := 0;
  v_alloc_principal numeric := 0;
  v_remaining_principal_to_allocate numeric := 0;
  
  -- Payment / Loop
  v_payment_id uuid;
  v_item record;
  v_item_alloc numeric;
BEGIN
  -- 1. Check user authorization
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 2. Validate amount
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Zahlungsbetrag muss größer als 0 sein.';
  END IF;

  -- 3. Load Claim
  SELECT status, interest_rate, interest_start_date, accumulated_unpaid_interest, lease_id
  INTO v_claim_status, v_interest_rate, v_interest_start_date, v_accumulated_unpaid_interest, v_lease_id
  FROM claims
  WHERE id = p_claim_id AND user_id = v_user_id
  FOR UPDATE; -- Lock row

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Forderung nicht gefunden oder keine Berechtigung.';
  END IF;

  IF v_claim_status IN ('settled', 'cancelled', 'archived') THEN
    RAISE EXCEPTION 'Forderung ist % und kann keine Zahlung empfangen.', v_claim_status;
  END IF;

  -- 4. Calculate current open amounts
  SELECT 
    COALESCE(total_fees_open, 0), 
    COALESCE(current_principal_open, 0)
  INTO 
    v_total_fees_open, 
    v_current_principal_open
  FROM claim_totals_view
  WHERE claim_id = p_claim_id;

  -- Calculate interest up to p_payment_date
  IF v_interest_start_date IS NOT NULL AND p_payment_date > v_interest_start_date THEN
    v_new_interest := (v_current_principal_open * v_interest_rate / 36500.0) * (p_payment_date - v_interest_start_date);
  ELSE
    v_new_interest := 0;
  END IF;
  
  v_total_interest_open := COALESCE(v_accumulated_unpaid_interest, 0) + v_new_interest;
  v_total_due := v_total_fees_open + v_total_interest_open + v_current_principal_open;

  -- 5. Validate payment against total due
  IF p_amount > (v_total_due + 0.01) THEN
    RAISE EXCEPTION 'Zahlungsbetrag (%.2f) darf die offene Gesamtforderung (%.2f) nicht übersteigen.', p_amount, v_total_due;
  END IF;

  -- 6. Allocate
  v_remaining_amount := p_amount;
  
  v_alloc_fees := LEAST(v_remaining_amount, v_total_fees_open);
  v_remaining_amount := v_remaining_amount - v_alloc_fees;
  
  v_alloc_interest := LEAST(v_remaining_amount, v_total_interest_open);
  v_remaining_amount := v_remaining_amount - v_alloc_interest;
  
  v_alloc_principal := v_remaining_amount;
  
  -- 7. Insert claim_payments
  INSERT INTO claim_payments (user_id, claim_id, payment_date, amount, allocation_type, status, note)
  VALUES (v_user_id, p_claim_id, p_payment_date, p_amount, 'automatic', 'posted', p_note)
  RETURNING id INTO v_payment_id;

  -- 8. Insert Allocations
  IF v_alloc_fees > 0 THEN
    INSERT INTO claim_payment_allocations (claim_payment_id, user_id, claim_id, allocation_bucket, amount)
    VALUES (v_payment_id, v_user_id, p_claim_id, 'fees', v_alloc_fees);
  END IF;

  IF v_alloc_interest > 0 THEN
    INSERT INTO claim_payment_allocations (claim_payment_id, user_id, claim_id, allocation_bucket, amount)
    VALUES (v_payment_id, v_user_id, p_claim_id, 'interest', v_alloc_interest);
  END IF;

  IF v_alloc_principal > 0 THEN
    v_remaining_principal_to_allocate := v_alloc_principal;
    
    FOR v_item IN 
      SELECT ci.id, ci.period_month, ctv.open_amount 
      FROM claim_items ci
      JOIN claim_item_totals_view ctv ON ctv.claim_item_id = ci.id
      WHERE ci.claim_id = p_claim_id AND ctv.open_amount > 0
      ORDER BY ci.period_month ASC NULLS FIRST, ci.created_at ASC
    LOOP
      IF v_remaining_principal_to_allocate <= 0 THEN
        EXIT;
      END IF;
      
      v_item_alloc := LEAST(v_remaining_principal_to_allocate, v_item.open_amount);
      
      IF v_item_alloc > 0 THEN
        -- Allocate to claim item
        INSERT INTO claim_payment_allocations (claim_payment_id, user_id, claim_id, allocation_bucket, claim_item_id, amount)
        VALUES (v_payment_id, v_user_id, p_claim_id, 'principal', v_item.id, v_item_alloc);
        
        -- Also insert into rent_payments so it reflects in Buchhaltung!
        IF v_item.period_month IS NOT NULL AND v_lease_id IS NOT NULL THEN
          INSERT INTO rent_payments (user_id, lease_id, payment_date, period_month, amount, note)
          VALUES (v_user_id, v_lease_id, p_payment_date, v_item.period_month, v_item_alloc, 
                  'Verrechnung über Forderungsakte' || CASE WHEN p_note IS NOT NULL AND p_note != '' THEN ': ' || p_note ELSE '' END);
        END IF;

        v_remaining_principal_to_allocate := v_remaining_principal_to_allocate - v_item_alloc;
      END IF;
    END LOOP;
  END IF;

  -- 9. Update Claim
  UPDATE claims SET
    accumulated_unpaid_interest = GREATEST(0, v_total_interest_open - v_alloc_interest),
    interest_start_date = p_payment_date,
    status = CASE WHEN p_amount >= (v_total_due - 0.01) THEN 'settled' ELSE status END,
    updated_at = now()
  WHERE id = p_claim_id;

  -- 10. Insert claim_events
  INSERT INTO claim_events (user_id, claim_id, event_type, description, event_metadata)
  VALUES (
    v_user_id, 
    p_claim_id, 
    'payment_received', 
    'Zahlung erfasst', 
    jsonb_build_object(
      'payment_date', p_payment_date,
      'amount', p_amount,
      'allocated_to_fees', v_alloc_fees,
      'allocated_to_interest', v_alloc_interest,
      'allocated_to_principal', v_alloc_principal,
      'remaining_total_due', GREATEST(0, v_total_due - p_amount)
    )
  );
  
  -- Optionally, trigger sync_all_rent_ledgers immediately to update rent_ledger view
  -- PERF: this might be slow if the user has many leases, but keeps Buchhaltung 100% in sync instantly.
  -- We rely on the UI or next page load for now, or just call it:
  PERFORM sync_all_rent_ledgers();

END;
$$;
