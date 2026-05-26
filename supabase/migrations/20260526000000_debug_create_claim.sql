-- Debug create claim
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
    v_lease_owner uuid;
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
    v_desc_rent text := '';
    v_lease_exists boolean;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

    -- DEBUG CHECKS:
    SELECT true, tenant_id, user_id INTO v_lease_exists, v_tenant_id, v_lease_owner 
    FROM leases WHERE id = p_lease_id;

    IF v_lease_exists IS NULL THEN 
        RAISE EXCEPTION 'Fehler: Mietvertrag % existiert überhaupt nicht in der Datenbank.', p_lease_id; 
    END IF;

    IF v_lease_owner != v_user_id THEN 
        RAISE EXCEPTION 'Fehler: Mietvertrag gehört Owner %, aber du bist %. RLS verhindert Zugriff.', v_lease_owner, v_user_id; 
    END IF;

    IF v_tenant_id IS NULL THEN 
        RAISE EXCEPTION 'Fehler: Diesem Mietvertrag ist kein Mieter zugewiesen! Bitte weisen Sie dem Mietvertrag einen Mieter zu, bevor Sie eine Forderung erstellen.'; 
    END IF;

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
            ORDER BY period_month ASC
        LOOP
            IF v_ledger.lease_id != p_lease_id THEN RAISE EXCEPTION 'Alle ausgewählten Mieten müssen zum selben Mietvertrag gehören.'; END IF;
            v_open_amount := v_ledger.expected_rent - v_ledger.paid_amount;
            IF v_open_amount <= 0 THEN RAISE EXCEPTION 'Eine der Mieten ist bereits bezahlt.'; END IF;

            DECLARE v_already_claimed uuid;
            BEGIN
                SELECT ci.claim_id INTO v_already_claimed FROM claim_items ci JOIN claims c ON c.id = ci.claim_id
                WHERE ci.rent_ledger_id = v_ledger.id AND c.status NOT IN ('settled', 'cancelled', 'archived') LIMIT 1;
                IF v_already_claimed IS NOT NULL THEN RAISE EXCEPTION 'Für die Miete % existiert bereits eine aktive Forderung.', to_char(v_ledger.period_month, 'MM/YYYY'); END IF;
            END;

            v_total_open_amount := v_total_open_amount + v_open_amount;
            v_desc_rent := v_desc_rent || to_char(v_ledger.period_month, 'MM/YYYY') || ', ';
            
            v_metadata_items := v_metadata_items || jsonb_build_object(
                'rent_ledger_id', v_ledger.id, 'period_month', v_ledger.period_month,
                'amount', v_open_amount, 'description', 'Mietrückstand ' || to_char(v_ledger.period_month, 'MM/YYYY'));
        END LOOP;
        
        IF length(v_desc_rent) > 0 THEN
            IF array_length(p_rent_ledger_ids, 1) = 1 THEN
                v_desc_text := v_desc_text || 'Mietrückstand ' || substring(v_desc_rent from 1 for length(v_desc_rent) - 2) || ', ';
            ELSE
                v_desc_text := v_desc_text || 'Mietrückstände ' || substring(v_desc_rent from 1 for length(v_desc_rent) - 2) || ', ';
            END IF;
        END IF;
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

    -- Insert claim_items for rent ledgers (grouping them in ONE single claim_item)
    DECLARE v_is_first_item boolean := true;
    BEGIN
        IF p_rent_ledger_ids IS NOT NULL AND array_length(p_rent_ledger_ids, 1) > 0 THEN
            DECLARE
                v_first_period date;
                v_desc text;
                v_this_fee numeric := 0;
                v_this_interest numeric := 0;
            BEGIN
                SELECT MIN(period_month) INTO v_first_period FROM rent_ledger WHERE id = ANY(p_rent_ledger_ids) AND user_id = v_user_id;
                
                IF array_length(p_rent_ledger_ids, 1) = 1 THEN
                    v_desc := 'Mietrückstand ' || substring(v_desc_rent from 1 for length(v_desc_rent) - 2);
                ELSE
                    v_desc := 'Mietrückstände ' || substring(v_desc_rent from 1 for length(v_desc_rent) - 2);
                END IF;

                IF v_is_first_item THEN
                    v_this_fee := p_fee_amount;
                    v_this_interest := p_accumulated_interest;
                    v_is_first_item := false;
                END IF;

                INSERT INTO claim_items (
                    user_id, claim_id, item_type, original_amount, period_month, 
                    description, due_date, rent_ledger_ids, fee_amount, interest_amount
                )
                VALUES (
                    v_user_id, v_new_claim_id, 'rent', 
                    (SELECT SUM(expected_rent - COALESCE(paid_amount,0)) FROM rent_ledger WHERE id = ANY(p_rent_ledger_ids) AND user_id = v_user_id), 
                    v_first_period, v_desc, v_first_period + 3, p_rent_ledger_ids, v_this_fee, v_this_interest
                );
            END;
        END IF;

        -- Insert claim_items for manual items
        FOR v_manual_item IN SELECT * FROM jsonb_array_elements(p_manual_items)
        LOOP
            DECLARE 
                v_item_due_date date;
                v_this_fee numeric := 0;
                v_this_interest numeric := 0;
            BEGIN
                v_item_due_date := NULL;
                IF v_manual_item.value->>'dueDate' IS NOT NULL AND v_manual_item.value->>'dueDate' != '' THEN
                    v_item_due_date := (v_manual_item.value->>'dueDate')::date;
                END IF;

                IF v_is_first_item THEN
                    v_this_fee := p_fee_amount;
                    v_this_interest := p_accumulated_interest;
                    v_is_first_item := false;
                END IF;

                INSERT INTO claim_items (user_id, claim_id, item_type, original_amount, description, due_date, fee_amount, interest_amount)
                VALUES (v_user_id, v_new_claim_id, COALESCE(v_manual_item.value->>'item_type', 'other'),
                    (v_manual_item.value->>'amount')::numeric, 
                    v_manual_item.value->>'description', v_item_due_date, v_this_fee, v_this_interest);
            END;
        END LOOP;
    END;

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
