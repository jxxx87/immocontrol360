-- ============================================================================
-- Migration: Bulletproof record claim payment allocation with Auto-Detect Installment
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_claim_payment(
  p_claim_id uuid,
  p_payment_date date,
  p_amount numeric,
  p_note text,
  p_installment_id uuid DEFAULT NULL
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
  
  v_inst record;
  v_open_inst record;
  v_plan record;
  v_inst_open_amount numeric;
  v_inst_alloc numeric;
  v_inst_new_paid numeric;
  v_inst_new_status text;
  v_all_installments_paid boolean;
  v_remaining_installment_amount numeric;
  v_event_metadata jsonb;
  
  v_active_plan_id uuid := NULL;
  v_active_plan_created_at timestamptz := NULL;
  v_modified_installments jsonb := '[]'::jsonb;

  -- Safety Check
  v_inserted_sum numeric := 0;
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
  FOR UPDATE; 

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Forderung nicht gefunden oder keine Berechtigung.';
  END IF;

  IF v_claim_status IN ('settled', 'cancelled', 'archived') THEN
    RAISE EXCEPTION 'Forderung ist % und kann keine Zahlung empfangen.', v_claim_status;
  END IF;

  -- 3.5 Check for active payment plan
  SELECT id, created_at INTO v_active_plan_id, v_active_plan_created_at
  FROM payment_plans
  WHERE claim_id = p_claim_id AND status = 'active'
  LIMIT 1;

  -- AUTO-DETECT INSTALLMENT: If user didn't explicitly select an installment, but an active plan exists,
  -- auto-link it to the first open installment to ensure cascading works automatically.
  IF v_active_plan_id IS NOT NULL AND p_installment_id IS NULL THEN
    SELECT id INTO p_installment_id
    FROM payment_plan_installments
    WHERE payment_plan_id = v_active_plan_id AND status != 'paid'
    ORDER BY due_date ASC
    LIMIT 1;
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

  IF v_total_fees_open IS NULL THEN v_total_fees_open := 0; END IF;
  IF v_current_principal_open IS NULL THEN v_current_principal_open := 0; END IF;

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

  -- 6. Validate Installment if provided
  IF p_installment_id IS NOT NULL THEN
    SELECT ppi.*, pp.status as plan_status, pp.claim_id as plan_claim_id 
    INTO v_inst
    FROM payment_plan_installments ppi
    JOIN payment_plans pp ON pp.id = ppi.payment_plan_id
    WHERE ppi.id = p_installment_id AND ppi.user_id = v_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Rate nicht gefunden oder keine Berechtigung.';
    END IF;
    IF v_inst.plan_claim_id != p_claim_id THEN
      RAISE EXCEPTION 'Rate gehört nicht zu dieser Forderung.';
    END IF;
    IF v_inst.plan_status != 'active' THEN
      RAISE EXCEPTION 'Der Ratenplan ist nicht aktiv.';
    END IF;
  END IF;

  -- 7. Allocate
  v_remaining_amount := p_amount;
  
  IF v_active_plan_created_at IS NOT NULL AND p_installment_id IS NULL THEN
    v_alloc_fees := 0;
    v_alloc_interest := 0;
  ELSE
    v_alloc_fees := LEAST(v_remaining_amount, v_total_fees_open);
    v_remaining_amount := v_remaining_amount - v_alloc_fees;
    v_alloc_interest := LEAST(v_remaining_amount, v_total_interest_open);
    v_remaining_amount := v_remaining_amount - v_alloc_interest;
  END IF;

  v_alloc_principal := v_remaining_amount;
  
  -- 8. Insert claim_payments
  INSERT INTO claim_payments (user_id, claim_id, payment_date, amount, allocation_type, status, note)
  VALUES (v_user_id, p_claim_id, p_payment_date, p_amount, 'automatic', 'posted', p_note)
  RETURNING id INTO v_payment_id;

  -- 9. Insert Allocations
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
      SELECT ci.id, ci.period_month, ctv.open_amount, ci.created_at 
      FROM claim_items ci
      JOIN claim_item_totals_view ctv ON ctv.claim_item_id = ci.id
      WHERE ci.claim_id = p_claim_id AND ctv.open_amount > 0
        AND (
          (p_installment_id IS NOT NULL AND (v_active_plan_created_at IS NULL OR ci.created_at <= v_active_plan_created_at))
          OR
          (p_installment_id IS NULL AND (v_active_plan_created_at IS NULL OR ci.created_at > v_active_plan_created_at))
        )
      ORDER BY ci.period_month ASC NULLS FIRST, ci.created_at ASC
    LOOP
      IF v_remaining_principal_to_allocate <= 0 THEN EXIT; END IF;
      
      v_item_alloc := LEAST(v_remaining_principal_to_allocate, v_item.open_amount);
      
      IF v_item_alloc > 0 THEN
        INSERT INTO claim_payment_allocations (claim_payment_id, user_id, claim_id, allocation_bucket, claim_item_id, amount)
        VALUES (v_payment_id, v_user_id, p_claim_id, 'principal', v_item.id, v_item_alloc);
        
        -- Insert into rent_payments with reference to v_payment_id
        IF v_item.period_month IS NOT NULL AND v_lease_id IS NOT NULL THEN
          INSERT INTO rent_payments (user_id, lease_id, payment_date, period_month, amount, note)
          VALUES (v_user_id, v_lease_id, p_payment_date, v_item.period_month, v_item_alloc, 
                  'Verrechnung über Forderungsakte' || CASE WHEN p_note IS NOT NULL AND p_note != '' THEN ': ' || p_note ELSE '' END || ' (Ref: ' || v_payment_id || ')');
        END IF;

        v_remaining_principal_to_allocate := v_remaining_principal_to_allocate - v_item_alloc;
      END IF;
    END LOOP;
  END IF;

  -- BULLETPROOF FALLBACK: Ensure the total allocations match p_amount.
  SELECT COALESCE(SUM(amount), 0) INTO v_inserted_sum FROM claim_payment_allocations WHERE claim_payment_id = v_payment_id;
  
  IF v_inserted_sum < p_amount THEN
    INSERT INTO claim_payment_allocations (claim_payment_id, user_id, claim_id, allocation_bucket, amount)
    VALUES (v_payment_id, v_user_id, p_claim_id, 'fees', p_amount - v_inserted_sum);
    v_alloc_fees := v_alloc_fees + (p_amount - v_inserted_sum);
    v_alloc_principal := GREATEST(0, v_alloc_principal - (p_amount - v_inserted_sum));
  END IF;

  -- 10. Process Installment if provided
  IF p_installment_id IS NOT NULL THEN
    v_remaining_installment_amount := p_amount;
    
    FOR v_open_inst IN 
        SELECT id, amount, paid_amount, status 
        FROM payment_plan_installments 
        WHERE payment_plan_id = v_inst.payment_plan_id AND status != 'paid'
        ORDER BY due_date ASC
    LOOP
        IF v_remaining_installment_amount <= 0 THEN EXIT; END IF;
        
        v_inst_open_amount := v_open_inst.amount - v_open_inst.paid_amount;
        v_inst_alloc := LEAST(v_remaining_installment_amount, v_inst_open_amount);
        v_inst_new_paid := v_open_inst.paid_amount + v_inst_alloc;
        
        IF v_inst_new_paid >= (v_open_inst.amount - 0.01) THEN
            v_inst_new_status := 'paid';
        ELSE
            v_inst_new_status := 'partial';
        END IF;

        v_modified_installments := v_modified_installments || jsonb_build_object(
          'id', v_open_inst.id,
          'old_paid_amount', v_open_inst.paid_amount,
          'old_status', v_open_inst.status
        );

        UPDATE payment_plan_installments 
        SET paid_amount = v_inst_new_paid, status = v_inst_new_status, updated_at = now()
        WHERE id = v_open_inst.id;
        
        v_remaining_installment_amount := v_remaining_installment_amount - v_inst_alloc;
    END LOOP;

    -- Check if all installments are paid
    SELECT bool_and(status = 'paid') INTO v_all_installments_paid
    FROM payment_plan_installments
    WHERE payment_plan_id = v_inst.payment_plan_id;

    IF v_all_installments_paid THEN
      UPDATE payment_plans SET status = 'completed', updated_at = now() WHERE id = v_inst.payment_plan_id;
    END IF;
  END IF;

  -- 11. Update Claim
  UPDATE claims SET
    accumulated_unpaid_interest = GREATEST(0, v_total_interest_open - v_alloc_interest),
    interest_start_date = p_payment_date,
    status = CASE WHEN p_amount >= (v_total_due - 0.01) THEN 'settled' ELSE status END,
    updated_at = now()
  WHERE id = p_claim_id;

  -- 12. Insert claim_events (Save state for reversal)
  v_event_metadata := jsonb_build_object(
    'payment_id', v_payment_id,
    'payment_date', p_payment_date,
    'amount', p_amount,
    'allocated_to_fees', v_alloc_fees,
    'allocated_to_interest', v_alloc_interest,
    'allocated_to_principal', v_alloc_principal,
    'remaining_total_due', GREATEST(0, v_total_due - p_amount),
    'old_interest_start_date', v_interest_start_date,
    'old_accumulated_unpaid_interest', v_accumulated_unpaid_interest
  );

  IF p_installment_id IS NOT NULL THEN
    v_event_metadata := v_event_metadata || jsonb_build_object(
      'payment_plan_id', v_inst.payment_plan_id,
      'old_plan_status', v_inst.plan_status,
      'modified_installments', v_modified_installments
    );
  END IF;

  INSERT INTO claim_events (user_id, claim_id, event_type, description, event_metadata)
  VALUES (
    v_user_id, p_claim_id, 'payment_received', 'Zahlung erfasst', 
    v_event_metadata
  );
  
  PERFORM sync_all_rent_ledgers();
END;
$$;
