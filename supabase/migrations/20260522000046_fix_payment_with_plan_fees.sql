-- ============================================================================
-- Fix record_claim_payment: use plan-relative fees/interest
-- When a plan exists, only fees/interest AFTER plan creation are "open"
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_claim_payment(
  p_claim_id uuid,
  p_payment_date date,
  p_amount numeric,
  p_note text,
  p_installment_id uuid DEFAULT NULL,
  p_target_type text DEFAULT 'auto',
  p_target_claim_item_id uuid DEFAULT NULL
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
  v_accumulated_unpaid_fees numeric;
  
  v_total_fees_open numeric;
  v_total_interest_open numeric;
  v_current_principal_open numeric;
  v_total_due numeric;
  
  v_new_interest numeric;
  v_remaining_amount numeric;
  v_alloc_fees numeric := 0;
  v_alloc_interest numeric := 0;
  v_alloc_principal numeric := 0;
  v_remaining_principal_to_allocate numeric := 0;
  
  v_payment_id uuid;
  v_item record;
  v_item_alloc numeric;
  
  v_inst record;
  v_open_inst record;
  v_inst_open_amount numeric;
  v_inst_alloc numeric;
  v_inst_new_paid numeric;
  v_inst_new_status text;
  v_all_installments_paid boolean;
  v_remaining_installment_amount numeric;
  v_event_metadata jsonb;
  
  v_active_plan_id uuid := NULL;
  v_active_plan_created_at timestamptz := NULL;
  v_plan_fees_at_creation numeric := 0;
  v_plan_interest_at_creation numeric := 0;
  v_modified_installments jsonb := '[]'::jsonb;
  v_inserted_sum numeric := 0;
  
  v_target_item_description text := NULL;
  v_target_item_open_before numeric := 0;
  v_target_item_open_after numeric := 0;
  
  -- For fee/interest calculation with plan
  v_fees_after_plan numeric := 0;
  v_interest_after_plan numeric := 0;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'Zahlungsbetrag muss größer als 0 sein.'; END IF;

  SELECT status, interest_rate, interest_start_date, accumulated_unpaid_interest, accumulated_unpaid_fees, lease_id
  INTO v_claim_status, v_interest_rate, v_interest_start_date, v_accumulated_unpaid_interest, v_accumulated_unpaid_fees, v_lease_id
  FROM claims WHERE id = p_claim_id AND user_id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Forderung nicht gefunden oder keine Berechtigung.'; END IF;
  IF v_claim_status IN ('settled', 'cancelled', 'archived') THEN RAISE EXCEPTION 'Forderung ist %', v_claim_status; END IF;

  -- Get active plan WITH fees/interest at creation
  SELECT id, created_at, fees_at_creation, interest_at_creation 
  INTO v_active_plan_id, v_active_plan_created_at, v_plan_fees_at_creation, v_plan_interest_at_creation
  FROM payment_plans WHERE claim_id = p_claim_id AND status = 'active' LIMIT 1;

  -- AUTO-DETECT INSTALLMENT
  IF v_active_plan_id IS NOT NULL AND p_installment_id IS NULL AND p_target_type NOT IN ('claim_items', 'specific_item') THEN
    SELECT id INTO p_installment_id
    FROM payment_plan_installments WHERE payment_plan_id = v_active_plan_id AND status != 'paid'
    ORDER BY due_date ASC LIMIT 1;
  END IF;

  -- Get totals from view
  SELECT COALESCE(total_fees_open, 0), COALESCE(total_interest_open, 0), COALESCE(current_principal_open, 0)
  INTO v_total_fees_open, v_total_interest_open, v_current_principal_open
  FROM claim_totals_view WHERE claim_id = p_claim_id;

  IF v_total_fees_open IS NULL THEN v_total_fees_open := 0; END IF;
  IF v_total_interest_open IS NULL THEN v_total_interest_open := 0; END IF;
  IF v_current_principal_open IS NULL THEN v_current_principal_open := 0; END IF;

  -- Calculate live interest
  IF v_interest_start_date IS NOT NULL AND p_payment_date > v_interest_start_date THEN
    v_new_interest := (v_current_principal_open * v_interest_rate / 36500.0) * (p_payment_date - v_interest_start_date);
  ELSE v_new_interest := 0; END IF;

  v_total_interest_open := COALESCE(v_accumulated_unpaid_interest, 0) + v_new_interest;
  v_total_due := v_total_fees_open + v_total_interest_open + v_current_principal_open;

  IF p_amount > (v_total_due + 0.01) THEN
    RAISE EXCEPTION 'Zahlungsbetrag (%.2f) darf die offene Gesamtforderung (%.2f) nicht übersteigen.', p_amount, v_total_due;
  END IF;

  IF p_installment_id IS NOT NULL THEN
    SELECT ppi.*, pp.status as plan_status, pp.claim_id as plan_claim_id
    INTO v_inst FROM payment_plan_installments ppi
    JOIN payment_plans pp ON pp.id = ppi.payment_plan_id
    WHERE ppi.id = p_installment_id AND ppi.user_id = v_user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Rate nicht gefunden.'; END IF;
    IF v_inst.plan_claim_id != p_claim_id THEN RAISE EXCEPTION 'Rate gehört nicht zu dieser Forderung.'; END IF;
    IF v_inst.plan_status != 'active' THEN RAISE EXCEPTION 'Der Ratenplan ist nicht aktiv.'; END IF;
  END IF;

  -- Get target item info for timeline
  IF p_target_type = 'specific_item' AND p_target_claim_item_id IS NOT NULL THEN
    SELECT ci.description, ctv.open_amount
    INTO v_target_item_description, v_target_item_open_before
    FROM claim_items ci JOIN claim_item_totals_view ctv ON ctv.claim_item_id = ci.id
    WHERE ci.id = p_target_claim_item_id;
  END IF;

  v_remaining_amount := p_amount;

  -- FEES/INTEREST ALLOCATION LOGIC
  IF p_installment_id IS NOT NULL THEN
    -- Paying an installment: fees/interest are baked into the plan total, no separate allocation
    v_alloc_fees := 0;
    v_alloc_interest := 0;
  ELSIF v_active_plan_id IS NOT NULL AND p_target_type IN ('specific_item', 'claim_items') THEN
    -- Paying a specific NEW item (after plan): only fees/interest AFTER plan are relevant
    v_fees_after_plan := GREATEST(0, COALESCE(v_accumulated_unpaid_fees, 0) - COALESCE(v_plan_fees_at_creation, 0));
    v_interest_after_plan := GREATEST(0, COALESCE(v_accumulated_unpaid_interest, 0) - COALESCE(v_plan_interest_at_creation, 0));
    
    -- Subtract already-paid fees/interest
    DECLARE v_already_paid_fees numeric; v_already_paid_interest numeric;
    BEGIN
      SELECT COALESCE(SUM(cpa.amount) FILTER (WHERE cpa.allocation_bucket = 'fees'), 0),
             COALESCE(SUM(cpa.amount) FILTER (WHERE cpa.allocation_bucket = 'interest'), 0)
      INTO v_already_paid_fees, v_already_paid_interest
      FROM claim_payment_allocations cpa
      JOIN claim_payments cp ON cp.id = cpa.claim_payment_id
      WHERE cp.claim_id = p_claim_id AND cp.status = 'posted';
      
      v_fees_after_plan := GREATEST(0, v_fees_after_plan - v_already_paid_fees);
      v_interest_after_plan := GREATEST(0, v_interest_after_plan - v_already_paid_interest);
    END;
    
    v_alloc_fees := LEAST(v_remaining_amount, v_fees_after_plan);
    v_remaining_amount := v_remaining_amount - v_alloc_fees;
    v_alloc_interest := LEAST(v_remaining_amount, v_interest_after_plan);
    v_remaining_amount := v_remaining_amount - v_alloc_interest;
  ELSE
    -- Normal payment (no plan, or auto): pay all open fees/interest first
    v_alloc_fees := LEAST(v_remaining_amount, v_total_fees_open);
    v_remaining_amount := v_remaining_amount - v_alloc_fees;
    v_alloc_interest := LEAST(v_remaining_amount, v_total_interest_open);
    v_remaining_amount := v_remaining_amount - v_alloc_interest;
  END IF;

  v_alloc_principal := v_remaining_amount;

  INSERT INTO claim_payments (user_id, claim_id, payment_date, amount, allocation_type, status, note)
  VALUES (v_user_id, p_claim_id, p_payment_date, p_amount, 'automatic', 'posted', p_note)
  RETURNING id INTO v_payment_id;

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
      FROM claim_items ci JOIN claim_item_totals_view ctv ON ctv.claim_item_id = ci.id
      WHERE ci.claim_id = p_claim_id AND ctv.open_amount > 0
        AND (
          (p_target_type = 'specific_item' AND ci.id = p_target_claim_item_id)
          OR
          (p_target_type != 'specific_item' AND (
             (p_installment_id IS NOT NULL AND (v_active_plan_created_at IS NULL OR ci.created_at <= v_active_plan_created_at))
             OR
             (p_installment_id IS NULL AND (v_active_plan_created_at IS NULL OR ci.created_at > v_active_plan_created_at))
          ))
        )
      ORDER BY ci.period_month ASC NULLS FIRST, ci.created_at ASC
    LOOP
      IF v_remaining_principal_to_allocate <= 0 THEN EXIT; END IF;
      v_item_alloc := LEAST(v_remaining_principal_to_allocate, v_item.open_amount);
      IF v_item_alloc > 0 THEN
        INSERT INTO claim_payment_allocations (claim_payment_id, user_id, claim_id, allocation_bucket, claim_item_id, amount)
        VALUES (v_payment_id, v_user_id, p_claim_id, 'principal', v_item.id, v_item_alloc);
        IF v_item.period_month IS NOT NULL AND v_lease_id IS NOT NULL THEN
          INSERT INTO rent_payments (user_id, lease_id, payment_date, period_month, amount, note)
          VALUES (v_user_id, v_lease_id, p_payment_date, v_item.period_month, v_item_alloc,
                  'Verrechnung über Forderungsakte (Ref: ' || v_payment_id || ')');
        END IF;
        v_remaining_principal_to_allocate := v_remaining_principal_to_allocate - v_item_alloc;
      END IF;
    END LOOP;
  END IF;

  -- Catch unallocated remainder
  SELECT COALESCE(SUM(amount), 0) INTO v_inserted_sum FROM claim_payment_allocations WHERE claim_payment_id = v_payment_id;
  IF v_inserted_sum < p_amount THEN
    INSERT INTO claim_payment_allocations (claim_payment_id, user_id, claim_id, allocation_bucket, amount)
    VALUES (v_payment_id, v_user_id, p_claim_id, 'fees', p_amount - v_inserted_sum);
    v_alloc_fees := v_alloc_fees + (p_amount - v_inserted_sum);
    v_alloc_principal := GREATEST(0, v_alloc_principal - (p_amount - v_inserted_sum));
  END IF;

  -- Handle installment tracking
  IF p_installment_id IS NOT NULL THEN
    v_remaining_installment_amount := p_amount;
    FOR v_open_inst IN
        SELECT id, due_date, amount, paid_amount, status
        FROM payment_plan_installments WHERE payment_plan_id = v_inst.payment_plan_id AND status != 'paid' ORDER BY due_date ASC
    LOOP
        IF v_remaining_installment_amount <= 0 THEN EXIT; END IF;
        v_inst_open_amount := v_open_inst.amount - v_open_inst.paid_amount;
        v_inst_alloc := LEAST(v_remaining_installment_amount, v_inst_open_amount);
        v_inst_new_paid := v_open_inst.paid_amount + v_inst_alloc;
        IF v_inst_new_paid >= (v_open_inst.amount - 0.01) THEN v_inst_new_status := 'paid';
        ELSE v_inst_new_status := 'partial'; END IF;
        v_modified_installments := v_modified_installments || jsonb_build_object(
          'id', v_open_inst.id, 'due_date', v_open_inst.due_date,
          'old_paid_amount', v_open_inst.paid_amount, 'old_status', v_open_inst.status,
          'new_status', v_inst_new_status, 'allocated_amount', v_inst_alloc);
        UPDATE payment_plan_installments SET paid_amount = v_inst_new_paid, status = v_inst_new_status, updated_at = now() WHERE id = v_open_inst.id;
        v_remaining_installment_amount := v_remaining_installment_amount - v_inst_alloc;
    END LOOP;
    SELECT bool_and(status = 'paid') INTO v_all_installments_paid FROM payment_plan_installments WHERE payment_plan_id = v_inst.payment_plan_id;
    IF v_all_installments_paid THEN UPDATE payment_plans SET status = 'completed', updated_at = now() WHERE id = v_inst.payment_plan_id; END IF;
  END IF;

  UPDATE claims SET
    accumulated_unpaid_interest = GREATEST(0, v_total_interest_open - v_alloc_interest),
    interest_start_date = p_payment_date,
    status = CASE WHEN p_amount >= (v_total_due - 0.01) THEN 'settled' ELSE status END,
    updated_at = now()
  WHERE id = p_claim_id;

  -- Calculate remaining for specific item
  IF p_target_type = 'specific_item' AND p_target_claim_item_id IS NOT NULL THEN
    SELECT GREATEST(0, ctv.open_amount - v_alloc_principal) INTO v_target_item_open_after
    FROM claim_item_totals_view ctv WHERE ctv.claim_item_id = p_target_claim_item_id;
    IF v_target_item_open_after IS NULL THEN v_target_item_open_after := 0; END IF;
  END IF;

  -- Build event metadata
  v_event_metadata := jsonb_build_object(
    'payment_id', v_payment_id, 'payment_date', p_payment_date, 'amount', p_amount,
    'allocated_to_fees', v_alloc_fees, 'allocated_to_interest', v_alloc_interest,
    'allocated_to_principal', v_alloc_principal, 'remaining_total_due', GREATEST(0, v_total_due - p_amount),
    'old_interest_start_date', v_interest_start_date, 'old_accumulated_unpaid_interest', v_accumulated_unpaid_interest);

  IF p_target_type = 'specific_item' AND p_target_claim_item_id IS NOT NULL THEN
    v_event_metadata := v_event_metadata || jsonb_build_object(
      'target_type', 'specific_item', 'target_item_id', p_target_claim_item_id,
      'target_item_description', v_target_item_description,
      'target_item_open_before', v_target_item_open_before, 'target_item_open_after', v_target_item_open_after);
  END IF;

  IF p_installment_id IS NOT NULL THEN
    v_event_metadata := v_event_metadata || jsonb_build_object(
      'payment_plan_id', v_inst.payment_plan_id, 'old_plan_status', v_inst.plan_status,
      'modified_installments', v_modified_installments);
  END IF;

  INSERT INTO claim_events (user_id, claim_id, event_type, description, event_metadata)
  VALUES (v_user_id, p_claim_id, 'payment_received', 'Zahlung erfasst', v_event_metadata);
  PERFORM sync_all_rent_ledgers();
END;
$$;
