-- ============================================================================
-- Migration: Update create_claim_advanced to store due_date and include
-- fees/interest into the claim_item original_amount for manual positions
-- ============================================================================

CREATE OR REPLACE FUNCTION create_claim_advanced(
    p_lease_id uuid,
    p_rent_ledger_ids uuid[],
    p_manual_items jsonb, -- array of {description: string, amount: numeric, item_type: string, dueDate: string}
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
    v_deadline date;
    v_new_deadline date;
    
    v_metadata_items jsonb := '[]'::jsonb;
    v_manual_item record;
    
    v_desc_text text := '';
    v_manual_count int := 0;
    v_total_manual_amount numeric := 0;
    v_fee_per_item numeric := 0;
    v_interest_per_item numeric := 0;
BEGIN
    -- 1. Auth-Check
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- 2. Validate Lease
    SELECT tenant_id INTO v_tenant_id 
    FROM leases 
    WHERE id = p_lease_id AND user_id = v_user_id;

    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Mietvertrag nicht gefunden oder keine Berechtigung.';
    END IF;

    IF (array_length(p_rent_ledger_ids, 1) IS NULL OR array_length(p_rent_ledger_ids, 1) = 0) AND jsonb_array_length(p_manual_items) = 0 THEN
        RAISE EXCEPTION 'Keine Forderungspositionen angegeben.';
    END IF;

    -- 2.5 Check for existing active claim for this lease
    SELECT id, status INTO v_active_claim_id, v_existing_claim_status
    FROM claims
    WHERE lease_id = p_lease_id 
      AND user_id = v_user_id
      AND status NOT IN ('settled', 'cancelled', 'archived')
    ORDER BY created_at DESC
    LIMIT 1;

    -- 3. Check all Ledger-IDs and calculate totals
    IF p_rent_ledger_ids IS NOT NULL THEN
        FOR v_ledger IN 
            SELECT id, lease_id, expected_rent, COALESCE(paid_amount, 0) as paid_amount, period_month 
            FROM rent_ledger 
            WHERE id = ANY(p_rent_ledger_ids) AND user_id = v_user_id
        LOOP
            IF v_ledger.lease_id != p_lease_id THEN
                RAISE EXCEPTION 'Alle ausgewählten Mieten müssen zum selben Mietvertrag gehören.';
            END IF;
            
            v_open_amount := v_ledger.expected_rent - v_ledger.paid_amount;
            IF v_open_amount <= 0 THEN
                RAISE EXCEPTION 'Eine der Mieten (Monat %) ist bereits bezahlt.', v_ledger.period_month;
            END IF;

            -- Check if already claimed
            DECLARE
                v_ledger_already_claimed uuid;
            BEGIN
                SELECT ci.claim_id INTO v_ledger_already_claimed
                FROM claim_items ci
                JOIN claims c ON c.id = ci.claim_id
                WHERE ci.rent_ledger_id = v_ledger.id
                  AND c.status NOT IN ('settled', 'cancelled', 'archived')
                LIMIT 1;

                IF v_ledger_already_claimed IS NOT NULL THEN
                    RAISE EXCEPTION 'Für die Miete % existiert bereits eine aktive Forderung.', v_ledger.period_month;
                END IF;
            END;

            v_total_open_amount := v_total_open_amount + v_open_amount;
            
            v_desc_text := v_desc_text || 'Mietrückstand ' || to_char(v_ledger.period_month, 'MM/YYYY') || ', ';
            
            v_metadata_items := v_metadata_items || jsonb_build_object(
                'rent_ledger_id', v_ledger.id,
                'period_month', v_ledger.period_month,
                'amount', v_open_amount,
                'description', 'Mietrückstand ' || to_char(v_ledger.period_month, 'MM/YYYY')
            );
        END LOOP;
    END IF;

    -- 4. Count total items (rent + manual) for distributing fees/interest
    v_manual_count := jsonb_array_length(p_manual_items);
    
    -- Calculate total manual amount  
    FOR v_manual_item IN SELECT * FROM jsonb_array_elements(p_manual_items)
    LOOP
        v_total_manual_amount := v_total_manual_amount + (v_manual_item.value->>'amount')::numeric;
        v_total_open_amount := v_total_open_amount + (v_manual_item.value->>'amount')::numeric;
        v_desc_text := v_desc_text || (v_manual_item.value->>'description') || ', ';
        
        v_metadata_items := v_metadata_items || jsonb_build_object(
            'description', v_manual_item.value->>'description',
            'amount', (v_manual_item.value->>'amount')::numeric,
            'item_type', v_manual_item.value->>'item_type',
            'due_date', v_manual_item.value->>'dueDate'
        );
    END LOOP;

    -- Remove trailing comma
    IF length(v_desc_text) > 0 THEN
        v_desc_text := substring(v_desc_text from 1 for length(v_desc_text) - 2);
    END IF;

    -- 5. Calculate deadline
    v_new_deadline := CURRENT_DATE + p_deadline_days;

    IF v_active_claim_id IS NOT NULL THEN
        -- MERGE INTO EXISTING CLAIM
        v_new_claim_id := v_active_claim_id;
        
        UPDATE claims SET
            accumulated_unpaid_interest = COALESCE(accumulated_unpaid_interest, 0) + COALESCE(p_accumulated_interest, 0),
            accumulated_unpaid_fees = COALESCE(accumulated_unpaid_fees, 0) + COALESCE(p_fee_amount, 0),
            deadline = GREATEST(deadline, v_new_deadline),
            next_action_at = GREATEST(next_action_at, v_new_deadline),
            updated_at = now()
        WHERE id = v_active_claim_id;

    ELSE
        -- 6. CREATE NEW CLAIM
        INSERT INTO claims (
            user_id, lease_id, tenant_id, status, escalation_level,
            interest_start_date, interest_rate, accumulated_unpaid_interest, accumulated_unpaid_fees,
            deadline, next_action_at
        )
        VALUES (
            v_user_id, p_lease_id, v_tenant_id, 'open', 0,
            p_interest_start_date, p_interest_rate, p_accumulated_interest, p_fee_amount,
            v_new_deadline, v_new_deadline
        )
        RETURNING id INTO v_new_claim_id;
    END IF;

    -- 7. CLAIM_ITEMS for rent_ledgers
    IF p_rent_ledger_ids IS NOT NULL THEN
        FOR v_ledger IN 
            SELECT id, expected_rent, COALESCE(paid_amount, 0) as paid_amount, period_month 
            FROM rent_ledger 
            WHERE id = ANY(p_rent_ledger_ids) AND user_id = v_user_id
        LOOP
            v_open_amount := v_ledger.expected_rent - v_ledger.paid_amount;
            INSERT INTO claim_items (
                user_id, claim_id, rent_ledger_id, item_type, original_amount, period_month, description, due_date
            )
            VALUES (
                v_user_id, v_new_claim_id, v_ledger.id, 'rent', v_open_amount, v_ledger.period_month, 
                'Mietrückstand ' || to_char(v_ledger.period_month, 'MM/YYYY'),
                v_ledger.period_month + 3  -- due_date = period_month + 3 days tolerance
            );
        END LOOP;
    END IF;

    -- 8. CLAIM_ITEMS for manual positions (include proportional fees + interest)
    FOR v_manual_item IN SELECT * FROM jsonb_array_elements(p_manual_items)
    LOOP
        DECLARE
            v_item_amount numeric;
            v_item_total numeric;
            v_item_due_date date;
        BEGIN
            v_item_amount := (v_manual_item.value->>'amount')::numeric;
            
            -- Distribute fees/interest proportionally across items based on amount
            IF v_total_open_amount > 0 THEN
                v_fee_per_item := ROUND(p_fee_amount * (v_item_amount / v_total_open_amount), 2);
                v_interest_per_item := ROUND(p_accumulated_interest * (v_item_amount / v_total_open_amount), 2);
            ELSE
                v_fee_per_item := 0;
                v_interest_per_item := 0;
            END IF;
            
            -- Sum: base amount + proportional fee + proportional interest
            v_item_total := v_item_amount + v_fee_per_item + v_interest_per_item;
            
            -- Parse due_date from dueDate field
            v_item_due_date := NULL;
            IF v_manual_item.value->>'dueDate' IS NOT NULL AND v_manual_item.value->>'dueDate' != '' THEN
                v_item_due_date := (v_manual_item.value->>'dueDate')::date;
            END IF;
            
            INSERT INTO claim_items (
                user_id, claim_id, item_type, original_amount, description, due_date
            )
            VALUES (
                v_user_id, v_new_claim_id, 
                COALESCE(v_manual_item.value->>'item_type', 'other'), 
                v_item_total,
                v_manual_item.value->>'description',
                v_item_due_date
            );
        END;
    END LOOP;

    -- Also distribute fees/interest to rent items proportionally
    IF p_rent_ledger_ids IS NOT NULL AND v_total_open_amount > 0 THEN
        FOR v_ledger IN 
            SELECT id, expected_rent, COALESCE(paid_amount, 0) as paid_amount
            FROM rent_ledger 
            WHERE id = ANY(p_rent_ledger_ids) AND user_id = v_user_id
        LOOP
            v_open_amount := v_ledger.expected_rent - v_ledger.paid_amount;
            v_fee_per_item := ROUND(p_fee_amount * (v_open_amount / v_total_open_amount), 2);
            v_interest_per_item := ROUND(p_accumulated_interest * (v_open_amount / v_total_open_amount), 2);
            
            IF v_fee_per_item + v_interest_per_item > 0 THEN
                UPDATE claim_items 
                SET original_amount = original_amount + v_fee_per_item + v_interest_per_item
                WHERE claim_id = v_new_claim_id AND rent_ledger_id = v_ledger.id;
            END IF;
        END LOOP;
    END IF;

    -- 9. CLAIM_EVENT
    IF v_active_claim_id IS NOT NULL THEN
        INSERT INTO claim_events (
            user_id, claim_id, event_type, description, event_metadata
        )
        VALUES (
            v_user_id, v_new_claim_id, 'note_added', 'Forderungspositionen hinzugefügt: ' || v_desc_text,
            jsonb_build_object(
                'source', 'append_advanced',
                'items', v_metadata_items,
                'total_principal_amount', v_total_open_amount,
                'fee_amount', p_fee_amount,
                'accumulated_interest', p_accumulated_interest,
                'note', p_note
            )
        );
    ELSE
        INSERT INTO claim_events (
            user_id, claim_id, event_type, description, event_metadata
        )
        VALUES (
            v_user_id, v_new_claim_id, 'created', 'Forderung erstellt: ' || v_desc_text,
            jsonb_build_object(
                'source', 'create_advanced',
                'items', v_metadata_items,
                'total_principal_amount', v_total_open_amount,
                'fee_amount', p_fee_amount,
                'accumulated_interest', p_accumulated_interest,
                'interest_start_date', p_interest_start_date,
                'deadline', v_new_deadline,
                'note', p_note
            )
        );
    END IF;

    RETURN v_new_claim_id;
END;
$$;
