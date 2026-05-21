-- ============================================================================
-- RPC: create_claim_from_rent_ledgers
-- ============================================================================
-- Erstellt atomar einen neuen Claim aus MEHREREN offenen Mieten (rent_ledger)
-- ============================================================================

CREATE OR REPLACE FUNCTION create_claim_from_rent_ledgers(
    p_rent_ledger_ids uuid[],
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
    v_lease_id uuid;
    v_tenant_id uuid;
    
    v_ledger RECORD;
    v_open_amount numeric;
    v_total_open_amount numeric := 0;
    
    v_active_claim_id uuid;
    v_new_claim_id uuid;
    v_deadline date;
    
    v_metadata_items jsonb := '[]'::jsonb;
BEGIN
    -- 1. Auth-Check
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    IF array_length(p_rent_ledger_ids, 1) IS NULL OR array_length(p_rent_ledger_ids, 1) = 0 THEN
        RAISE EXCEPTION 'Keine Mieten ausgewählt.';
    END IF;

    -- 2. Prüfen, ob alle ausgewählten Mieten zum selben Lease/Tenant gehören und sammeln
    -- Wir nehmen den Lease des ersten Eintrags als Referenz
    SELECT lease_id INTO v_lease_id 
    FROM rent_ledger 
    WHERE id = p_rent_ledger_ids[1] AND user_id = v_user_id;

    IF v_lease_id IS NULL THEN
        RAISE EXCEPTION 'Mietereintrag nicht gefunden oder keine Berechtigung.';
    END IF;

    SELECT tenant_id INTO v_tenant_id FROM leases WHERE id = v_lease_id;

    -- 3. Überprüfe alle Ledger-IDs und berechne Gesamtsumme
    FOR v_ledger IN 
        SELECT id, lease_id, expected_rent, COALESCE(paid_amount, 0) as paid_amount, period_month 
        FROM rent_ledger 
        WHERE id = ANY(p_rent_ledger_ids) AND user_id = v_user_id
    LOOP
        IF v_ledger.lease_id != v_lease_id THEN
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

    -- 4. Frist berechnen
    v_deadline := CURRENT_DATE + p_deadline_days;

    -- 5. CLAIM erstellen
    INSERT INTO claims (
        user_id, lease_id, tenant_id, status, escalation_level,
        interest_start_date, interest_rate, accumulated_unpaid_interest, accumulated_unpaid_fees,
        deadline, next_action_at
    )
    VALUES (
        v_user_id, v_lease_id, v_tenant_id, 'open', 0,
        p_interest_start_date, p_interest_rate, p_accumulated_interest, p_fee_amount,
        v_deadline, v_deadline
    )
    RETURNING id INTO v_new_claim_id;

    -- 6. CLAIM_ITEMS erstellen (für jeden ausgewählten Monat)
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

    -- 7. CLAIM_EVENT erstellen
    INSERT INTO claim_events (
        user_id, claim_id, event_type, description, event_metadata
    )
    VALUES (
        v_user_id, v_new_claim_id, 'created', 'Forderung aus offener Miete (' || array_length(p_rent_ledger_ids, 1) || ' Monate) erstellt',
        jsonb_build_object(
            'source', 'rent_ledger_multi',
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
