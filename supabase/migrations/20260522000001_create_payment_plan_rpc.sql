-- ============================================================================
-- Migration: Create Payment Plan RPC
-- ============================================================================

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
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- 1. Check claim
    SELECT * INTO v_claim 
    FROM claims 
    WHERE id = p_claim_id AND user_id = v_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Forderung nicht gefunden oder keine Berechtigung.';
    END IF;

    IF v_claim.status IN ('settled', 'cancelled', 'archived') THEN
        RAISE EXCEPTION 'Für diese Forderung kann kein Ratenplan mehr erstellt werden (Status: %).', v_claim.status;
    END IF;

    -- 2. Check for existing active plan
    SELECT id INTO v_active_plan
    FROM payment_plans
    WHERE claim_id = p_claim_id AND status = 'active'
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION 'Für diese Forderung besteht bereits eine aktive Ratenzahlungsvereinbarung.';
    END IF;

    -- 3. Calculate amounts
    -- base_claim_total is current_principal_open + fee + interest.
    -- Wait, we don't have the live view available in the RPC directly unless we query it.
    -- Let's query the claim_totals_view
    SELECT total_due INTO v_base_claim_total
    FROM claim_totals_view
    WHERE claim_id = p_claim_id;

    v_plan_total := v_base_claim_total + p_adjustment_amount;
    v_monthly_rate := ROUND((v_plan_total / p_installment_count)::numeric, 2);

    -- 4. Insert payment_plans
    INSERT INTO payment_plans (
        user_id, claim_id, status, plan_type, total_amount, interest_or_fee_adjustment,
        monthly_rate, first_due_date, last_due_date, accepted_at, created_at, updated_at
    ) VALUES (
        v_user_id, p_claim_id, 'active', 'installment_agreement', v_plan_total, p_adjustment_amount,
        v_monthly_rate, p_first_due_date, p_first_due_date + ((p_installment_count - 1) || ' months')::interval, now(), now(), now()
    ) RETURNING id, last_due_date INTO v_new_plan_id, v_last_due_date;

    -- 5. Insert installments
    v_remaining_amount := v_plan_total;
    v_current_due_date := p_first_due_date;

    FOR v_i IN 1..p_installment_count LOOP
        IF v_i = p_installment_count THEN
            v_installment_amount := v_remaining_amount; -- Last installment catches rounding differences
        ELSE
            v_installment_amount := v_monthly_rate;
        END IF;

        INSERT INTO payment_plan_installments (
            user_id, payment_plan_id, due_date, amount, paid_amount, status, created_at, updated_at
        ) VALUES (
            v_user_id, v_new_plan_id, v_current_due_date, v_installment_amount, 0, 'open', now(), now()
        );

        v_remaining_amount := v_remaining_amount - v_installment_amount;
        v_current_due_date := v_current_due_date + interval '1 month';
    END LOOP;

    -- 6. Update claim
    UPDATE claims SET
        status = 'payment_plan_active',
        next_action_at = p_first_due_date,
        updated_at = now()
    WHERE id = p_claim_id;

    -- 7. Insert claim event
    INSERT INTO claim_events (
        user_id, claim_id, event_type, event_date, description, event_metadata, created_at
    ) VALUES (
        v_user_id, p_claim_id, 'payment_plan_accepted', now(), 'Ratenzahlungsvereinbarung erstellt',
        jsonb_build_object(
            'plan_total', v_plan_total,
            'base_claim_total', v_base_claim_total,
            'adjustment', p_adjustment_amount,
            'installment_count', p_installment_count,
            'monthly_rate', v_monthly_rate,
            'first_due_date', p_first_due_date,
            'last_due_date', v_last_due_date,
            'note', p_note
        ),
        now()
    );

    RETURN v_new_plan_id;
END;
$$;
