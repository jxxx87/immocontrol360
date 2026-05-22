-- ============================================================================
-- Migration: create_claim_advanced
-- ============================================================================

CREATE OR REPLACE FUNCTION create_claim_advanced(
    p_lease_id uuid,
    p_rent_ledger_ids uuid[],
    p_manual_items jsonb, -- array of {description: string, amount: numeric, item_type: string}
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
    
    v_active_claim_id uuid;
    v_new_claim_id uuid;
    v_deadline date;
    
    v_metadata_items jsonb := '[]'::jsonb;
    v_manual_item record;
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

    -- 3. Überprüfe alle Ledger-IDs und berechne Gesamtsumme
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

            -- Prüfen, ob bereits aktiver Claim existiert
            SELECT ci.claim_id INTO v_active_claim_id
            FROM claim_items ci
            JOIN claims c ON c.id = ci.claim_id
            WHERE ci.rent_ledger_id = v_ledger.id
              AND c.status NOT IN ('settled', 'cancelled', 'archived')
            LIMIT 1;

            IF v_active_claim_id IS NOT NULL THEN
                RAISE EXCEPTION 'Für die Miete % existiert bereits eine aktive Forderung.', v_ledger.period_month;
            END IF;

            v_total_open_amount := v_total_open_amount + v_open_amount;
            
            -- Metadaten sammeln
            v_metadata_items := v_metadata_items || jsonb_build_object(
                'rent_ledger_id', v_ledger.id,
                'period_month', v_ledger.period_month,
                'amount', v_open_amount
            );
        END LOOP;
    END IF;

    -- 4. Berechne Summe der manuellen Positionen
    FOR v_manual_item IN SELECT * FROM jsonb_array_elements(p_manual_items)
    LOOP
        v_total_open_amount := v_total_open_amount + (v_manual_item.value->>'amount')::numeric;
        v_metadata_items := v_metadata_items || jsonb_build_object(
            'description', v_manual_item.value->>'description',
            'amount', (v_manual_item.value->>'amount')::numeric,
            'item_type', v_manual_item.value->>'item_type'
        );
    END LOOP;

    -- 5. Frist berechnen
    v_deadline := CURRENT_DATE + p_deadline_days;

    -- 6. CLAIM erstellen
    INSERT INTO claims (
        user_id, lease_id, tenant_id, status, escalation_level,
        interest_start_date, interest_rate, accumulated_unpaid_interest, accumulated_unpaid_fees,
        deadline, next_action_at
    )
    VALUES (
        v_user_id, p_lease_id, v_tenant_id, 'open', 0,
        p_interest_start_date, p_interest_rate, p_accumulated_interest, p_fee_amount,
        v_deadline, v_deadline
    )
    RETURNING id INTO v_new_claim_id;

    -- 7. CLAIM_ITEMS für rent_ledgers erstellen
    IF p_rent_ledger_ids IS NOT NULL THEN
        FOR v_ledger IN 
            SELECT id, expected_rent, COALESCE(paid_amount, 0) as paid_amount, period_month 
            FROM rent_ledger 
            WHERE id = ANY(p_rent_ledger_ids) AND user_id = v_user_id
        LOOP
            v_open_amount := v_ledger.expected_rent - v_ledger.paid_amount;
            INSERT INTO claim_items (
                user_id, claim_id, rent_ledger_id, item_type, original_amount, period_month, description
            )
            VALUES (
                v_user_id, v_new_claim_id, v_ledger.id, 'rent', v_open_amount, v_ledger.period_month, 
                'Mietrückstand ' || to_char(v_ledger.period_month, 'MM/YYYY')
            );
        END LOOP;
    END IF;

    -- 8. CLAIM_ITEMS für manuelle Positionen erstellen
    FOR v_manual_item IN SELECT * FROM jsonb_array_elements(p_manual_items)
    LOOP
        INSERT INTO claim_items (
            user_id, claim_id, item_type, original_amount, description
        )
        VALUES (
            v_user_id, v_new_claim_id, 
            COALESCE(v_manual_item.value->>'item_type', 'other'), 
            (v_manual_item.value->>'amount')::numeric, 
            v_manual_item.value->>'description'
        );
    END LOOP;

    -- 9. CLAIM_EVENT erstellen
    INSERT INTO claim_events (
        user_id, claim_id, event_type, description, event_metadata
    )
    VALUES (
        v_user_id, v_new_claim_id, 'created', 'Forderung (' || jsonb_array_length(v_metadata_items) || ' Positionen) erstellt',
        jsonb_build_object(
            'source', 'create_advanced',
            'items', v_metadata_items,
            'total_principal_amount', v_total_open_amount,
            'fee_amount', p_fee_amount,
            'accumulated_interest', p_accumulated_interest,
            'interest_start_date', p_interest_start_date,
            'deadline', v_deadline,
            'note', p_note
        )
    );

    RETURN v_new_claim_id;
END;
$$;
