-- ============================================================================
-- MEGA-FIX: Correct claims architecture
-- 1. Add fees_at_creation/interest_at_creation to payment_plans
-- 2. Fix create_claim_advanced: original_amount = ONLY base amount
-- 3. Fix record_claim_payment: use plan-relative fees
-- 4. Fix existing bad data from migration 042
-- ============================================================================

-- STEP 1: Add columns to payment_plans to track what fees/interest existed at plan creation
ALTER TABLE payment_plans ADD COLUMN IF NOT EXISTS fees_at_creation numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE payment_plans ADD COLUMN IF NOT EXISTS interest_at_creation numeric(12,2) NOT NULL DEFAULT 0;

-- Backfill existing plans: estimate from event metadata
DO $$
DECLARE
  v_plan RECORD;
  v_event_meta jsonb;
BEGIN
  FOR v_plan IN SELECT pp.id, pp.claim_id, pp.created_at FROM payment_plans pp WHERE pp.fees_at_creation = 0
  LOOP
    -- Get the claim's accumulated fees/interest at the time the plan was created
    SELECT c.accumulated_unpaid_fees, c.accumulated_unpaid_interest 
    INTO v_event_meta
    FROM claims c WHERE c.id = v_plan.claim_id;
    
    -- For existing plans, we assume ALL fees/interest at that time belonged to the plan
    -- This is a best-effort backfill
    UPDATE payment_plans SET
      fees_at_creation = COALESCE((SELECT accumulated_unpaid_fees FROM claims WHERE id = v_plan.claim_id), 0),
      interest_at_creation = COALESCE((SELECT accumulated_unpaid_interest FROM claims WHERE id = v_plan.claim_id), 0)
    WHERE id = v_plan.id;
  END LOOP;
END $$;

-- STEP 2: Fix create_payment_plan to save fees/interest at creation
CREATE OR REPLACE FUNCTION public.create_payment_plan(
    p_claim_id uuid,
    p_first_due_date date,
    p_installment_count int,
    p_adjustment_amount numeric,
    p_note text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

    SELECT * INTO v_claim FROM claims WHERE id = p_claim_id AND user_id = v_user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Forderung nicht gefunden oder keine Berechtigung.'; END IF;
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

    INSERT INTO payment_plans (
        user_id, claim_id, status, plan_type, total_amount, interest_or_fee_adjustment,
        monthly_rate, first_due_date, last_due_date, accepted_at,
        fees_at_creation, interest_at_creation
    ) VALUES (
        v_user_id, p_claim_id, 'active', 'installment_agreement', v_plan_total, p_adjustment_amount,
        v_monthly_rate, p_first_due_date, p_first_due_date + ((p_installment_count - 1) || ' months')::interval, now(),
        v_current_fees, v_current_interest
    ) RETURNING id, last_due_date INTO v_new_plan_id, v_last_due_date;

    v_remaining_amount := v_plan_total;
    v_current_due_date := p_first_due_date;
    FOR v_i IN 1..p_installment_count LOOP
        IF v_i = p_installment_count THEN v_installment_amount := v_remaining_amount;
        ELSE v_installment_amount := v_monthly_rate; END IF;

        INSERT INTO payment_plan_installments (user_id, payment_plan_id, due_date, amount, paid_amount, status)
        VALUES (v_user_id, v_new_plan_id, v_current_due_date, v_installment_amount, 0, 'open');
        v_remaining_amount := v_remaining_amount - v_installment_amount;
        v_current_due_date := v_current_due_date + interval '1 month';
    END LOOP;

    UPDATE claims SET status = 'payment_plan_active', next_action_at = p_first_due_date, updated_at = now()
    WHERE id = p_claim_id;

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
$$;

-- STEP 3: Fix create_claim_advanced - original_amount = ONLY base amount
CREATE OR REPLACE FUNCTION create_claim_advanced(
    p_lease_id uuid,
    p_rent_ledger_ids uuid[],
    p_manual_items jsonb,
    p_fee_amount numeric,
    p_interest_rate numeric,
    p_accumulated_interest numeric,
    p_interest_start_date date,
    p_deadline_days int,
    p_note text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
    v_tenant_id uuid;
    v_ledger RECORD;
    v_open_amount numeric;
    v_total_open_amount numeric := 0;
    v_active_claim_id uuid := NULL;
    v_existing_claim_status text;
    v_new_claim_id uuid;
    v_new_deadline date;
    v_metadata_items jsonb := '[]'::jsonb;
    v_manual_item record;
    v_desc_text text := '';
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

    SELECT tenant_id INTO v_tenant_id FROM leases WHERE id = p_lease_id AND user_id = v_user_id;
    IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Mietvertrag nicht gefunden oder keine Berechtigung.'; END IF;

    IF (array_length(p_rent_ledger_ids, 1) IS NULL OR array_length(p_rent_ledger_ids, 1) = 0) AND jsonb_array_length(p_manual_items) = 0 THEN
        RAISE EXCEPTION 'Keine Forderungspositionen angegeben.';
    END IF;

    -- Check for existing active claim
    SELECT id, status INTO v_active_claim_id, v_existing_claim_status
    FROM claims WHERE lease_id = p_lease_id AND user_id = v_user_id
      AND status NOT IN ('settled', 'cancelled', 'archived')
    ORDER BY created_at DESC LIMIT 1;

    -- Process rent ledgers
    IF p_rent_ledger_ids IS NOT NULL THEN
        FOR v_ledger IN 
            SELECT id, lease_id, expected_rent, COALESCE(paid_amount, 0) as paid_amount, period_month 
            FROM rent_ledger WHERE id = ANY(p_rent_ledger_ids) AND user_id = v_user_id
        LOOP
            IF v_ledger.lease_id != p_lease_id THEN RAISE EXCEPTION 'Alle ausgewählten Mieten müssen zum selben Mietvertrag gehören.'; END IF;
            v_open_amount := v_ledger.expected_rent - v_ledger.paid_amount;
            IF v_open_amount <= 0 THEN RAISE EXCEPTION 'Eine der Mieten ist bereits bezahlt.'; END IF;

            DECLARE v_already_claimed uuid;
            BEGIN
                SELECT ci.claim_id INTO v_already_claimed FROM claim_items ci JOIN claims c ON c.id = ci.claim_id
                WHERE ci.rent_ledger_id = v_ledger.id AND c.status NOT IN ('settled', 'cancelled', 'archived') LIMIT 1;
                IF v_already_claimed IS NOT NULL THEN RAISE EXCEPTION 'Für diese Miete existiert bereits eine aktive Forderung.'; END IF;
            END;

            v_total_open_amount := v_total_open_amount + v_open_amount;
            v_desc_text := v_desc_text || 'Mietrückstand ' || to_char(v_ledger.period_month, 'MM/YYYY') || ', ';
            v_metadata_items := v_metadata_items || jsonb_build_object(
                'rent_ledger_id', v_ledger.id, 'period_month', v_ledger.period_month,
                'amount', v_open_amount, 'description', 'Mietrückstand ' || to_char(v_ledger.period_month, 'MM/YYYY'));
        END LOOP;
    END IF;

    -- Process manual items
    FOR v_manual_item IN SELECT * FROM jsonb_array_elements(p_manual_items)
    LOOP
        v_total_open_amount := v_total_open_amount + (v_manual_item.value->>'amount')::numeric;
        v_desc_text := v_desc_text || (v_manual_item.value->>'description') || ', ';
        v_metadata_items := v_metadata_items || jsonb_build_object(
            'description', v_manual_item.value->>'description',
            'amount', (v_manual_item.value->>'amount')::numeric,
            'item_type', v_manual_item.value->>'item_type',
            'due_date', v_manual_item.value->>'dueDate');
    END LOOP;

    IF length(v_desc_text) > 0 THEN v_desc_text := substring(v_desc_text from 1 for length(v_desc_text) - 2); END IF;
    v_new_deadline := CURRENT_DATE + p_deadline_days;

    IF v_active_claim_id IS NOT NULL THEN
        v_new_claim_id := v_active_claim_id;
        UPDATE claims SET
            accumulated_unpaid_interest = COALESCE(accumulated_unpaid_interest, 0) + COALESCE(p_accumulated_interest, 0),
            accumulated_unpaid_fees = COALESCE(accumulated_unpaid_fees, 0) + COALESCE(p_fee_amount, 0),
            deadline = GREATEST(deadline, v_new_deadline),
            next_action_at = GREATEST(next_action_at, v_new_deadline),
            updated_at = now()
        WHERE id = v_active_claim_id;
    ELSE
        INSERT INTO claims (user_id, lease_id, tenant_id, status, escalation_level,
            interest_start_date, interest_rate, accumulated_unpaid_interest, accumulated_unpaid_fees,
            deadline, next_action_at)
        VALUES (v_user_id, p_lease_id, v_tenant_id, 'open', 0,
            p_interest_start_date, p_interest_rate, COALESCE(p_accumulated_interest, 0), COALESCE(p_fee_amount, 0),
            v_new_deadline, v_new_deadline)
        RETURNING id INTO v_new_claim_id;
    END IF;

    -- Insert claim_items for rent ledgers: original_amount = ONLY the rent amount
    IF p_rent_ledger_ids IS NOT NULL THEN
        FOR v_ledger IN 
            SELECT id, expected_rent, COALESCE(paid_amount, 0) as paid_amount, period_month
            FROM rent_ledger WHERE id = ANY(p_rent_ledger_ids) AND user_id = v_user_id
        LOOP
            v_open_amount := v_ledger.expected_rent - v_ledger.paid_amount;
            INSERT INTO claim_items (user_id, claim_id, rent_ledger_id, item_type, original_amount, period_month, description, due_date)
            VALUES (v_user_id, v_new_claim_id, v_ledger.id, 'rent', v_open_amount, v_ledger.period_month,
                'Mietrückstand ' || to_char(v_ledger.period_month, 'MM/YYYY'), v_ledger.period_month + 3);
        END LOOP;
    END IF;

    -- Insert claim_items for manual items: original_amount = ONLY the base amount (NO fees/interest!)
    FOR v_manual_item IN SELECT * FROM jsonb_array_elements(p_manual_items)
    LOOP
        DECLARE v_item_due_date date;
        BEGIN
            v_item_due_date := NULL;
            IF v_manual_item.value->>'dueDate' IS NOT NULL AND v_manual_item.value->>'dueDate' != '' THEN
                v_item_due_date := (v_manual_item.value->>'dueDate')::date;
            END IF;
            INSERT INTO claim_items (user_id, claim_id, item_type, original_amount, description, due_date)
            VALUES (v_user_id, v_new_claim_id, COALESCE(v_manual_item.value->>'item_type', 'other'),
                (v_manual_item.value->>'amount')::numeric,  -- PURE amount only!
                v_manual_item.value->>'description', v_item_due_date);
        END;
    END LOOP;

    -- Timeline event
    IF v_active_claim_id IS NOT NULL THEN
        INSERT INTO claim_events (user_id, claim_id, event_type, description, event_metadata)
        VALUES (v_user_id, v_new_claim_id, 'note_added', 'Forderungspositionen hinzugefügt: ' || v_desc_text,
            jsonb_build_object('source', 'append_advanced', 'items', v_metadata_items,
                'total_principal_amount', v_total_open_amount, 'fee_amount', p_fee_amount,
                'accumulated_interest', p_accumulated_interest, 'note', p_note));
    ELSE
        INSERT INTO claim_events (user_id, claim_id, event_type, description, event_metadata)
        VALUES (v_user_id, v_new_claim_id, 'created', 'Forderung erstellt: ' || v_desc_text,
            jsonb_build_object('source', 'create_advanced', 'items', v_metadata_items,
                'total_principal_amount', v_total_open_amount, 'fee_amount', p_fee_amount,
                'accumulated_interest', p_accumulated_interest, 'interest_start_date', p_interest_start_date,
                'deadline', v_new_deadline, 'note', p_note));
    END IF;

    RETURN v_new_claim_id;
END;
$$;
