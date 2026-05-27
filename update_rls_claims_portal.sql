-- RLS Policies for claim_access_links
DROP POLICY IF EXISTS "shared_users_select" ON claim_access_links;
CREATE POLICY "shared_users_select" ON claim_access_links FOR SELECT USING (has_claim_access(claim_id));

DROP POLICY IF EXISTS "shared_users_insert" ON claim_access_links;
CREATE POLICY "shared_users_insert" ON claim_access_links FOR INSERT WITH CHECK (has_claim_access(claim_id));

DROP POLICY IF EXISTS "shared_users_update" ON claim_access_links;
CREATE POLICY "shared_users_update" ON claim_access_links FOR UPDATE USING (has_claim_access(claim_id)) WITH CHECK (has_claim_access(claim_id));

DROP POLICY IF EXISTS "shared_users_delete" ON claim_access_links;
CREATE POLICY "shared_users_delete" ON claim_access_links FOR DELETE USING (has_claim_access(claim_id));

-- RLS Policies for payment_plan_requests
DROP POLICY IF EXISTS "shared_users_select" ON payment_plan_requests;
CREATE POLICY "shared_users_select" ON payment_plan_requests FOR SELECT USING (has_claim_access(claim_id));

DROP POLICY IF EXISTS "shared_users_insert" ON payment_plan_requests;
CREATE POLICY "shared_users_insert" ON payment_plan_requests FOR INSERT WITH CHECK (has_claim_access(claim_id));

DROP POLICY IF EXISTS "shared_users_update" ON payment_plan_requests;
CREATE POLICY "shared_users_update" ON payment_plan_requests FOR UPDATE USING (has_claim_access(claim_id)) WITH CHECK (has_claim_access(claim_id));

DROP POLICY IF EXISTS "shared_users_delete" ON payment_plan_requests;
CREATE POLICY "shared_users_delete" ON payment_plan_requests FOR DELETE USING (has_claim_access(claim_id));


-- Drop existing functions before creating to avoid signature/default parameter changes error
DROP FUNCTION IF EXISTS public.generate_claim_access_link(uuid, text, text, integer);
DROP FUNCTION IF EXISTS public.delete_claim_item(uuid);
DROP FUNCTION IF EXISTS public.settle_claim_item(uuid);
DROP FUNCTION IF EXISTS public.create_payment_plan(uuid, date, integer, numeric, text);
DROP FUNCTION IF EXISTS public.record_claim_payment(uuid, date, numeric, text, uuid, text, uuid);
DROP FUNCTION IF EXISTS public.reverse_claim_payment(uuid);
DROP FUNCTION IF EXISTS public.reverse_payment_plan(uuid);
DROP FUNCTION IF EXISTS public.reverse_appended_claim(uuid);


-- 1. generate_claim_access_link
CREATE OR REPLACE FUNCTION public.generate_claim_access_link(
    p_claim_id uuid,
    p_token text,
    p_pin text,
    p_expires_days integer DEFAULT 14
)
RETURNS uuid
SECURITY DEFINER
AS $$
DECLARE
    v_link_id UUID;
    v_claim claims%ROWTYPE;
BEGIN
    SELECT * INTO v_claim FROM claims WHERE id = p_claim_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Claim not found';
    END IF;

    -- SECURITY CHECK
    IF v_claim.user_id <> auth.uid() AND NOT has_claim_access(p_claim_id) THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    -- Update any existing active links for this claim to revoked to ensure only 1 is active
    UPDATE claim_access_links 
    SET revoked_at = now(), is_active = false 
    WHERE claim_id = p_claim_id AND is_active = true;

    INSERT INTO claim_access_links (
        claim_id,
        token,
        pin,
        token_hash, -- legacy dummy
        pin_hash, -- legacy dummy
        expires_at,
        created_by,
        is_active
    ) VALUES (
        p_claim_id,
        p_token,
        p_pin,
        p_token, 
        p_pin,
        now() + (p_expires_days || ' days')::INTERVAL,
        auth.uid(),
        true
    ) RETURNING id INTO v_link_id;

    RETURN v_link_id;
END;
$$ LANGUAGE plpgsql;


-- 2. delete_claim_item
CREATE OR REPLACE FUNCTION public.delete_claim_item(p_item_id uuid)
RETURNS void
SECURITY DEFINER
AS $$
DECLARE
    v_user_id uuid;
    v_claim_id uuid;
    v_description text;
    v_original_amount numeric;
    v_claim_owner_id uuid;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

    -- Hole Infos zum Item
    SELECT ci.claim_id, ci.description, ci.original_amount, c.user_id
    INTO v_claim_id, v_description, v_original_amount, v_claim_owner_id
    FROM claim_items ci
    JOIN claims c ON c.id = ci.claim_id
    WHERE ci.id = p_item_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Position nicht gefunden';
    END IF;

    -- SECURITY CHECK
    IF v_claim_owner_id <> v_user_id AND NOT has_claim_access(v_claim_id) THEN
        RAISE EXCEPTION 'Keine Berechtigung.';
    END IF;

    DELETE FROM claim_items WHERE id = p_item_id;

    -- Insert event
    INSERT INTO claim_events (user_id, claim_id, event_type, description, event_metadata)
    VALUES (v_claim_owner_id, v_claim_id, 'note_added', 
            'Forderungsposition gelöscht: ' || COALESCE(v_description, '') || ' (' || v_original_amount || ' EUR)',
            jsonb_build_object('item_id', p_item_id, 'description', v_description, 'amount', v_original_amount)
    );
END;
$$ LANGUAGE plpgsql;


-- 3. settle_claim_item
CREATE OR REPLACE FUNCTION public.settle_claim_item(p_item_id uuid)
RETURNS void
SECURITY DEFINER
AS $$
DECLARE
    v_user_id uuid;
    v_claim_id uuid;
    v_open_amount numeric;
    v_payment_id uuid;
    v_claim_owner_id uuid;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

    -- Finde offene Summe und Claim-Besitzer
    SELECT ci.claim_id, ctv.open_amount, c.user_id
    INTO v_claim_id, v_open_amount, v_claim_owner_id
    FROM claim_items ci
    JOIN claims c ON c.id = ci.claim_id
    LEFT JOIN claim_item_totals_view ctv ON ctv.claim_item_id = ci.id
    WHERE ci.id = p_item_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Position nicht gefunden.';
    END IF;

    -- SECURITY CHECK
    IF v_claim_owner_id <> v_user_id AND NOT has_claim_access(v_claim_id) THEN
        RAISE EXCEPTION 'Keine Berechtigung.';
    END IF;

    IF v_open_amount <= 0 THEN
        RAISE EXCEPTION 'Position ist bereits vollständig erledigt.';
    END IF;

    -- Buche eine Erlass/Waiver Zahlung nur für dieses Item
    INSERT INTO claim_payments (user_id, claim_id, payment_date, amount, allocation_type, status, note)
    VALUES (v_user_id, v_claim_id, current_date, v_open_amount, 'manual', 'posted', 'Als erledigt markiert (Erlass/Ausbuchung)')
    RETURNING id INTO v_payment_id;

    INSERT INTO claim_payment_allocations (claim_payment_id, user_id, claim_id, allocation_bucket, claim_item_id, amount)
    VALUES (v_payment_id, v_user_id, v_claim_id, 'principal', p_item_id, v_open_amount);

    INSERT INTO claim_events (user_id, claim_id, event_type, description, event_metadata)
    VALUES (v_user_id, v_claim_id, 'payment_received', 'Position manuell als erledigt markiert', 
        jsonb_build_object(
            'payment_id', v_payment_id,
            'amount', v_open_amount,
            'allocated_to_principal', v_open_amount,
            'note', 'Als erledigt markiert'
        )
    );
END;
$$ LANGUAGE plpgsql;


-- 4. create_payment_plan
CREATE OR REPLACE FUNCTION public.create_payment_plan(
    p_claim_id uuid,
    p_first_due_date date,
    p_installment_count integer,
    p_adjustment_amount numeric,
    p_note text
)
RETURNS uuid
SECURITY DEFINER
AS $$
DECLARE
    v_user_id uuid;
    v_claim record;
    v_active_plan uuid;
    v_base_claim_total numeric;
    v_plan_total numeric;
    v_monthly_rate numeric;
    v_last_due_date date;
    v_new_plan_id uuid;
    v_i int;
    v_current_due_date date;
    v_remaining_amount numeric;
    v_installment_amount numeric;
    v_current_fees numeric;
    v_current_interest numeric;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

    SELECT * INTO v_claim FROM claims WHERE id = p_claim_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Forderung nicht gefunden.'; END IF;
    
    -- SECURITY CHECK
    IF v_claim.user_id <> v_user_id AND NOT has_claim_access(p_claim_id) THEN
        RAISE EXCEPTION 'Keine Berechtigung.';
    END IF;

    IF v_claim.status IN ('settled', 'cancelled', 'archived') THEN
        RAISE EXCEPTION 'Für diese Forderung kann kein Ratenplan mehr erstellt werden (Status: %).', v_claim.status;
    END IF;

    SELECT id INTO v_active_plan FROM payment_plans WHERE claim_id = p_claim_id AND status = 'active' LIMIT 1;
    IF FOUND THEN RAISE EXCEPTION 'Für diese Forderung besteht bereits eine aktive Ratenzahlungsvereinbarung.'; END IF;

    SELECT total_due INTO v_base_claim_total FROM claim_totals_view WHERE claim_id = p_claim_id;
    
    -- Save current fees/interest for the plan
    v_current_fees := COALESCE(v_claim.accumulated_unpaid_fees, 0);
    v_current_interest := COALESCE(v_claim.accumulated_unpaid_interest, 0);

    v_plan_total := v_base_claim_total + p_adjustment_amount;
    v_monthly_rate := ROUND((v_plan_total / p_installment_count)::numeric, 2);

    -- Insert payment_plan (owned by claim owner)
    INSERT INTO payment_plans (
        user_id, claim_id, status, plan_type, total_amount, interest_or_fee_adjustment,
        monthly_rate, first_due_date, last_due_date, accepted_at,
        fees_at_creation, interest_at_creation
    ) VALUES (
        v_claim.user_id, p_claim_id, 'active', 'installment_agreement', v_plan_total, p_adjustment_amount,
        v_monthly_rate, p_first_due_date, p_first_due_date + ((p_installment_count - 1) || ' months')::interval, now(),
        v_current_fees, v_current_interest
    ) RETURNING id, last_due_date INTO v_new_plan_id, v_last_due_date;

    v_remaining_amount := v_plan_total;
    v_current_due_date := p_first_due_date;
    FOR v_i IN 1..p_installment_count LOOP
        IF v_i = p_installment_count THEN v_installment_amount := v_remaining_amount;
        ELSE v_installment_amount := v_monthly_rate; END IF;

        INSERT INTO payment_plan_installments (user_id, payment_plan_id, due_date, amount, paid_amount, status)
        VALUES (v_claim.user_id, v_new_plan_id, v_current_due_date, v_installment_amount, 0, 'open');
        v_remaining_amount := v_remaining_amount - v_installment_amount;
        v_current_due_date := v_current_due_date + interval '1 month';
    END LOOP;

    UPDATE claims SET status = 'payment_plan_active', next_action_at = p_first_due_date, updated_at = now()
    WHERE id = p_claim_id;

    -- Event gets recorded by the executing user (owner or shared user)
    INSERT INTO claim_events (user_id, claim_id, event_type, event_date, description, event_metadata)
    VALUES (v_user_id, p_claim_id, 'payment_plan_accepted', now(), 'Ratenzahlungsvereinbarung erstellt',
        jsonb_build_object(
            'plan_total', v_plan_total, 'base_claim_total', v_base_claim_total,
            'adjustment', p_adjustment_amount, 'installment_count', p_installment_count,
            'monthly_rate', v_monthly_rate, 'first_due_date', p_first_due_date,
            'last_due_date', v_last_due_date, 'note', p_note,
            'fees_at_creation', v_current_fees, 'interest_at_creation', v_current_interest
        ));
    RETURN v_new_plan_id;
END;
$$ LANGUAGE plpgsql;


-- 5. record_claim_payment
CREATE OR REPLACE FUNCTION public.record_claim_payment(
    p_claim_id uuid,
    p_payment_date date,
    p_amount numeric,
    p_note text,
    p_installment_id uuid,
    p_target_type text,
    p_target_claim_item_id uuid
)
RETURNS void
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
  v_lease_id uuid;
  v_claim_status text;
  v_interest_rate numeric;
  v_interest_start_date date;
  v_accumulated_unpaid_interest numeric;
  v_claim_owner_id uuid;
  
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
  SELECT status, interest_rate, interest_start_date, accumulated_unpaid_interest, lease_id, user_id
  INTO v_claim_status, v_interest_rate, v_interest_start_date, v_accumulated_unpaid_interest, v_lease_id, v_claim_owner_id
  FROM claims
  WHERE id = p_claim_id
  FOR UPDATE; 

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Forderung nicht gefunden.';
  END IF;

  -- SECURITY CHECK
  IF v_claim_owner_id <> v_user_id AND NOT has_claim_access(p_claim_id) THEN
    RAISE EXCEPTION 'Keine Berechtigung.';
  END IF;

  IF v_claim_status IN ('settled', 'cancelled', 'archived') THEN
    RAISE EXCEPTION 'Forderung ist % und kann keine Zahlung empfangen.', v_claim_status;
  END IF;

  -- 3.5 Check for active payment plan
  SELECT id, created_at INTO v_active_plan_id, v_active_plan_created_at
  FROM payment_plans
  WHERE claim_id = p_claim_id AND status = 'active'
  LIMIT 1;

  -- AUTO-DETECT INSTALLMENT
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
    SELECT ppi.*, pp.status as plan_status, pp.claim_id as plan_claim_id, pp.user_id as plan_owner_id
    INTO v_inst
    FROM payment_plan_installments ppi
    JOIN payment_plans pp ON pp.id = ppi.payment_plan_id
    WHERE ppi.id = p_installment_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Rate nicht gefunden.';
    END IF;
    IF v_inst.plan_claim_id != p_claim_id THEN
      RAISE EXCEPTION 'Rate gehört nicht zu dieser Forderung.';
    END IF;
    IF v_inst.plan_status != 'active' THEN
      RAISE EXCEPTION 'Der Ratenplan ist nicht aktiv.';
    END IF;
    -- SECURITY CHECK
    IF v_inst.plan_owner_id <> v_user_id AND NOT has_claim_access(p_claim_id) THEN
      RAISE EXCEPTION 'Keine Berechtigung für diese Ratenzahlung.';
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
        
        IF v_item.period_month IS NOT NULL AND v_lease_id IS NOT NULL THEN
          -- Insert rent_payments owned by the claim owner
          INSERT INTO rent_payments (user_id, lease_id, payment_date, period_month, amount, note)
          VALUES (v_claim_owner_id, v_lease_id, p_payment_date, v_item.period_month, v_item_alloc, 
                  'Verrechnung über Forderungsakte' || CASE WHEN p_note IS NOT NULL AND p_note != '' THEN ': ' || p_note ELSE '' END || ' (Ref: ' || v_payment_id || ')');
        END IF;

        v_remaining_principal_to_allocate := v_remaining_principal_to_allocate - v_item_alloc;
      END IF;
    END LOOP;
  END IF;

  -- BULLETPROOF FALLBACK
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
        SELECT id, due_date, amount, paid_amount, status 
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
          'due_date', v_open_inst.due_date,
          'old_paid_amount', v_open_inst.paid_amount,
          'old_status', v_open_inst.status,
          'new_status', v_inst_new_status,
          'allocated_amount', v_inst_alloc
        );

        UPDATE payment_plan_installments 
        SET paid_amount = v_inst_new_paid, status = v_inst_new_status, updated_at = now()
        WHERE id = v_open_inst.id;
        
        v_remaining_installment_amount := v_remaining_installment_amount - v_inst_alloc;
    END LOOP;

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

  -- 12. Insert claim_events
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
$$ LANGUAGE plpgsql;


-- 6. reverse_claim_payment
CREATE OR REPLACE FUNCTION public.reverse_claim_payment(p_payment_id uuid)
RETURNS void
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
  v_claim_id uuid;
  v_status text;
  v_event record;
  v_modified_inst record;
  v_payment_owner_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Load payment
  SELECT claim_id, status, user_id INTO v_claim_id, v_status, v_payment_owner_id
  FROM claim_payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Zahlung nicht gefunden.';
  END IF;

  -- SECURITY CHECK
  IF v_payment_owner_id <> v_user_id AND NOT has_claim_access(v_claim_id) THEN
    RAISE EXCEPTION 'Keine Berechtigung.';
  END IF;

  -- Reverse in claims table (best effort via event_metadata)
  SELECT event_metadata INTO v_event
  FROM claim_events
  WHERE claim_id = v_claim_id AND event_type = 'payment_received' AND event_metadata->>'payment_id' = p_payment_id::text
  LIMIT 1;

  IF FOUND THEN
    -- Resilient claims update: always reset 'settled' status back to 'open', using metadata fallbacks
    UPDATE claims SET
      interest_start_date = COALESCE((v_event.event_metadata->>'old_interest_start_date')::date, interest_start_date),
      accumulated_unpaid_interest = COALESCE((v_event.event_metadata->>'old_accumulated_unpaid_interest')::numeric, accumulated_unpaid_interest),
      status = CASE WHEN status = 'settled' THEN 'open' ELSE status END,
      updated_at = now()
    WHERE id = v_claim_id;

    -- Reverse installments if applicable
    IF v_event.event_metadata->>'modified_installments' IS NOT NULL THEN
      FOR v_modified_inst IN SELECT * FROM jsonb_array_elements(v_event.event_metadata->'modified_installments')
      LOOP
        UPDATE payment_plan_installments SET
          paid_amount = COALESCE((v_modified_inst.value->>'old_paid_amount')::numeric, 0),
          status = COALESCE((v_modified_inst.value->>'old_status')::text, 'unpaid'),
          updated_at = now()
        WHERE id = (v_modified_inst.value->>'id')::uuid;
      END LOOP;

      -- Reverse plan status if it was completed
      IF v_event.event_metadata->>'old_plan_status' IS NOT NULL THEN
        UPDATE payment_plans SET
          status = (v_event.event_metadata->>'old_plan_status')::text,
          updated_at = now()
        WHERE id = (v_event.event_metadata->>'payment_plan_id')::uuid;
      END IF;
    ELSIF v_event.event_metadata->>'installment_id' IS NOT NULL THEN
      -- Fallback for older events before cascade
      UPDATE payment_plan_installments SET
        paid_amount = COALESCE((v_event.event_metadata->>'old_installment_paid_amount')::numeric, 0),
        status = COALESCE((v_event.event_metadata->>'old_installment_status')::text, 'unpaid'),
        updated_at = now()
      WHERE id = (v_event.event_metadata->>'installment_id')::uuid;

      IF v_event.event_metadata->>'old_plan_status' IS NOT NULL THEN
        UPDATE payment_plans SET
          status = (v_event.event_metadata->>'old_plan_status')::text,
          updated_at = now()
        WHERE id = (v_event.event_metadata->>'payment_plan_id')::uuid;
      END IF;
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
  WHERE note LIKE '%(Ref: ' || p_payment_id || ')%';

  -- Delete allocations
  DELETE FROM claim_payment_allocations WHERE claim_payment_id = p_payment_id;

  -- Delete payment
  DELETE FROM claim_payments WHERE id = p_payment_id;
  
  PERFORM sync_all_rent_ledgers();
END;
$$ LANGUAGE plpgsql;


-- 7. reverse_payment_plan
CREATE OR REPLACE FUNCTION public.reverse_payment_plan(p_claim_id uuid)
RETURNS void
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
  v_plan_id uuid;
  v_plan_owner_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 1. Check if there is an active payment plan for this claim
  SELECT id, user_id INTO v_plan_id, v_plan_owner_id
  FROM payment_plans
  WHERE claim_id = p_claim_id AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Kein aktiver Ratenplan für diese Forderung gefunden.';
  END IF;

  -- SECURITY CHECK
  IF v_plan_owner_id <> v_user_id AND NOT has_claim_access(p_claim_id) THEN
    RAISE EXCEPTION 'Keine Berechtigung.';
  END IF;

  -- 2. Delete the installments
  DELETE FROM payment_plan_installments WHERE payment_plan_id = v_plan_id;

  -- 3. Delete the plan itself
  DELETE FROM payment_plans WHERE id = v_plan_id;

  -- 4. Set the claim status back to open (if it was payment_plan_active)
  UPDATE claims SET
    status = CASE WHEN status = 'payment_plan_active' THEN 'open' ELSE status END,
    next_action_at = NULL,
    updated_at = now()
  WHERE id = p_claim_id;
END;
$$ LANGUAGE plpgsql;


-- 8. reverse_appended_claim
CREATE OR REPLACE FUNCTION public.reverse_appended_claim(p_event_id uuid)
RETURNS void
SECURITY DEFINER
AS $$
DECLARE
    v_user_id uuid;
    v_claim_id uuid;
    v_event_metadata jsonb;
    v_fee_amount numeric;
    v_accumulated_interest numeric;
    v_item record;
    v_event_owner_id uuid;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

    -- Load the event
    SELECT claim_id, event_metadata, user_id INTO v_claim_id, v_event_metadata, v_event_owner_id
    FROM claim_events
    WHERE id = p_event_id AND event_type = 'note_added' AND event_metadata->>'source' = 'append_advanced'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Das Ereignis wurde nicht gefunden oder ist keine Erweiterung der Akte.';
    END IF;

    -- SECURITY CHECK
    IF v_event_owner_id <> v_user_id AND NOT has_claim_access(v_claim_id) THEN
        RAISE EXCEPTION 'Keine Berechtigung.';
    END IF;

    v_fee_amount := (v_event_metadata->>'fee_amount')::numeric;
    v_accumulated_interest := (v_event_metadata->>'accumulated_interest')::numeric;

    -- Reduce fees and interest
    UPDATE claims SET
        accumulated_unpaid_fees = GREATEST(0, COALESCE(accumulated_unpaid_fees, 0) - COALESCE(v_fee_amount, 0)),
        accumulated_unpaid_interest = GREATEST(0, COALESCE(accumulated_unpaid_interest, 0) - COALESCE(v_accumulated_interest, 0))
    WHERE id = v_claim_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(v_event_metadata->'items')
    LOOP
        IF v_item.value->>'rent_ledger_id' IS NOT NULL THEN
            DELETE FROM claim_items 
            WHERE claim_id = v_claim_id AND rent_ledger_id = (v_item.value->>'rent_ledger_id')::uuid;
        ELSE
            DELETE FROM claim_items
            WHERE id IN (
                SELECT id FROM claim_items 
                WHERE claim_id = v_claim_id 
                  AND description = v_item.value->>'description' 
                  AND original_amount = (v_item.value->>'amount')::numeric
                  AND rent_ledger_id IS NULL
                LIMIT 1
            );
        END IF;
    END LOOP;

    -- Delete the event
    DELETE FROM claim_events WHERE id = p_event_id;
END;
$$ LANGUAGE plpgsql;
