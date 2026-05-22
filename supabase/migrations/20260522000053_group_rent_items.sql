-- Migration: Group rent items into a single claim_item

ALTER TABLE claim_items ADD COLUMN IF NOT EXISTS rent_ledger_ids uuid[];

-- Update create_claim_advanced to group rent_ledger_ids into ONE claim_item
CREATE OR REPLACE FUNCTION create_claim_advanced(
    p_lease_id uuid, p_rent_ledger_ids uuid[], p_manual_items jsonb,
    p_fee_amount numeric, p_interest_rate numeric, p_accumulated_interest numeric,
    p_interest_start_date date, p_deadline_days int, p_note text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_user_id uuid; v_tenant_id uuid; v_ledger RECORD; v_open_amount numeric;
    v_total_open_amount numeric := 0; v_active_claim_id uuid := NULL;
    v_existing_claim_status text; v_new_claim_id uuid; v_new_deadline date;
    v_metadata_items jsonb := '[]'::jsonb; v_manual_item record; v_desc_text text := '';
    v_total_items int := 0; v_fee_per_item numeric := 0; v_interest_per_item numeric := 0;
    
    v_grouped_open_amount numeric := 0;
    v_earliest_month date; v_latest_month date;
    v_desc_rent text;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    SELECT tenant_id INTO v_tenant_id FROM leases WHERE id = p_lease_id AND user_id = v_user_id;
    IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Mietvertrag nicht gefunden.'; END IF;
    IF (array_length(p_rent_ledger_ids, 1) IS NULL OR array_length(p_rent_ledger_ids, 1) = 0) AND jsonb_array_length(p_manual_items) = 0 THEN
        RAISE EXCEPTION 'Keine Forderungspositionen angegeben.'; END IF;

    SELECT id, status INTO v_active_claim_id, v_existing_claim_status FROM claims
    WHERE lease_id = p_lease_id AND user_id = v_user_id AND status NOT IN ('settled','cancelled','archived')
    ORDER BY created_at DESC LIMIT 1;

    -- For proportional distribution, we treat the grouped rent items as ONE item
    v_total_items := CASE WHEN p_rent_ledger_ids IS NOT NULL AND array_length(p_rent_ledger_ids, 1) > 0 THEN 1 ELSE 0 END + jsonb_array_length(p_manual_items);

    IF p_rent_ledger_ids IS NOT NULL AND array_length(p_rent_ledger_ids, 1) > 0 THEN
        FOR v_ledger IN SELECT id, lease_id, expected_rent, COALESCE(paid_amount,0) as paid_amount, period_month
            FROM rent_ledger WHERE id = ANY(p_rent_ledger_ids) AND user_id = v_user_id ORDER BY period_month ASC LOOP
            IF v_ledger.lease_id != p_lease_id THEN RAISE EXCEPTION 'Mieten mÃ¼ssen zum selben Vertrag gehÃ¶ren.'; END IF;
            v_open_amount := v_ledger.expected_rent - v_ledger.paid_amount;
            IF v_open_amount <= 0 THEN RAISE EXCEPTION 'Miete bereits bezahlt.'; END IF;
            DECLARE v_chk uuid; BEGIN
                -- Check both scalar rent_ledger_id and array rent_ledger_ids
                SELECT ci.claim_id INTO v_chk FROM claim_items ci JOIN claims c ON c.id = ci.claim_id
                WHERE (ci.rent_ledger_id = v_ledger.id OR v_ledger.id = ANY(ci.rent_ledger_ids)) AND c.status NOT IN ('settled','cancelled','archived') LIMIT 1;
                IF v_chk IS NOT NULL THEN RAISE EXCEPTION 'Aktive Forderung existiert bereits.'; END IF;
            END;
            v_total_open_amount := v_total_open_amount + v_open_amount;
            v_grouped_open_amount := v_grouped_open_amount + v_open_amount;
            
            IF v_earliest_month IS NULL OR v_ledger.period_month < v_earliest_month THEN v_earliest_month := v_ledger.period_month; END IF;
            IF v_latest_month IS NULL OR v_ledger.period_month > v_latest_month THEN v_latest_month := v_ledger.period_month; END IF;
            
            v_metadata_items := v_metadata_items || jsonb_build_object('rent_ledger_id', v_ledger.id,
                'period_month', v_ledger.period_month, 'amount', v_open_amount,
                'description', 'MietrÃ¼ckstand ' || to_char(v_ledger.period_month, 'MM/YYYY'));
        END LOOP;
        
        IF v_earliest_month = v_latest_month THEN
            v_desc_rent := 'MietrÃ¼ckstand ' || to_char(v_earliest_month, 'MM/YYYY');
        ELSE
            v_desc_rent := 'MietrÃ¼ckstÃ¤nde ' || to_char(v_earliest_month, 'MM/YYYY') || ' bis ' || to_char(v_latest_month, 'MM/YYYY');
        END IF;
        v_desc_text := v_desc_text || v_desc_rent || ', ';
    END IF;

    FOR v_manual_item IN SELECT * FROM jsonb_array_elements(p_manual_items) LOOP
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
            accumulated_unpaid_interest = COALESCE(accumulated_unpaid_interest,0) + COALESCE(p_accumulated_interest,0),
            accumulated_unpaid_fees = COALESCE(accumulated_unpaid_fees,0) + COALESCE(p_fee_amount,0),
            deadline = GREATEST(deadline, v_new_deadline), next_action_at = GREATEST(next_action_at, v_new_deadline),
            updated_at = now()
        WHERE id = v_active_claim_id;
    ELSE
        INSERT INTO claims (user_id, lease_id, tenant_id, status, escalation_level,
            interest_start_date, interest_rate, accumulated_unpaid_interest, accumulated_unpaid_fees, deadline, next_action_at)
        VALUES (v_user_id, p_lease_id, v_tenant_id, 'open', 0,
            p_interest_start_date, p_interest_rate, COALESCE(p_accumulated_interest,0), COALESCE(p_fee_amount,0),
            v_new_deadline, v_new_deadline)
        RETURNING id INTO v_new_claim_id;
    END IF;

    -- Insert rent item(s) AS A SINGLE GROUP
    IF p_rent_ledger_ids IS NOT NULL AND array_length(p_rent_ledger_ids, 1) > 0 THEN
        IF v_total_open_amount > 0 THEN
            v_fee_per_item := ROUND(COALESCE(p_fee_amount,0) * (v_grouped_open_amount / v_total_open_amount), 2);
            v_interest_per_item := ROUND(COALESCE(p_accumulated_interest,0) * (v_grouped_open_amount / v_total_open_amount), 2);
        ELSE v_fee_per_item := 0; v_interest_per_item := 0; END IF;
        
        INSERT INTO claim_items (user_id, claim_id, rent_ledger_id, rent_ledger_ids, item_type,
            original_amount, fee_amount, interest_amount, period_month, description, due_date)
        VALUES (v_user_id, v_new_claim_id, p_rent_ledger_ids[1], p_rent_ledger_ids, 'rent',
            v_grouped_open_amount, v_fee_per_item, v_interest_per_item,
            v_earliest_month, v_desc_rent, v_latest_month + 3);
    END IF;

    -- Insert manual items
    FOR v_manual_item IN SELECT * FROM jsonb_array_elements(p_manual_items) LOOP
        DECLARE v_base numeric; v_due date;
        BEGIN
            v_base := (v_manual_item.value->>'amount')::numeric;
            IF v_total_open_amount > 0 THEN
                v_fee_per_item := ROUND(COALESCE(p_fee_amount,0) * (v_base / v_total_open_amount), 2);
                v_interest_per_item := ROUND(COALESCE(p_accumulated_interest,0) * (v_base / v_total_open_amount), 2);
            ELSE v_fee_per_item := 0; v_interest_per_item := 0; END IF;
            v_due := NULL;
            IF v_manual_item.value->>'dueDate' IS NOT NULL AND v_manual_item.value->>'dueDate' != '' THEN
                v_due := (v_manual_item.value->>'dueDate')::date; END IF;
            INSERT INTO claim_items (user_id, claim_id, item_type,
                original_amount, fee_amount, interest_amount, description, due_date)
            VALUES (v_user_id, v_new_claim_id, COALESCE(v_manual_item.value->>'item_type','other'),
                v_base, v_fee_per_item, v_interest_per_item,
                v_manual_item.value->>'description', v_due);
        END;
    END LOOP;

    -- Timeline
    IF v_active_claim_id IS NOT NULL THEN
        INSERT INTO claim_events (user_id, claim_id, event_type, description, event_metadata)
        VALUES (v_user_id, v_new_claim_id, 'note_added', 'Forderungspositionen hinzugefÃ¼gt: ' || v_desc_text,
            jsonb_build_object('source','append_advanced','items',v_metadata_items,
                'total_principal_amount',v_total_open_amount,'fee_amount',p_fee_amount,
                'accumulated_interest',p_accumulated_interest,'note',p_note));
    ELSE
        INSERT INTO claim_events (user_id, claim_id, event_type, description, event_metadata)
        VALUES (v_user_id, v_new_claim_id, 'created', 'Forderung erstellt: ' || v_desc_text,
            jsonb_build_object('source','create_advanced','items',v_metadata_items,
                'total_principal_amount',v_total_open_amount,'fee_amount',p_fee_amount,
                'accumulated_interest',p_accumulated_interest,'interest_start_date',p_interest_start_date,
                'deadline',v_new_deadline,'note',p_note));
    END IF;
    RETURN v_new_claim_id;
END; $$;
