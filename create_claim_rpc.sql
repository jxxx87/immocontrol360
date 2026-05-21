-- ============================================================================
-- RPC: create_claim_from_rent_ledger
-- ============================================================================
-- Erstellt atomar einen neuen Claim aus einer offenen Miete (rent_ledger)
-- ============================================================================

CREATE OR REPLACE FUNCTION create_claim_from_rent_ledger(
    p_rent_ledger_id uuid,
    p_fee_amount numeric,
    p_interest_rate numeric,
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
    v_expected_rent numeric;
    v_paid_amount numeric;
    v_open_amount numeric;
    v_period_month date;
    v_active_claim_id uuid;
    v_new_claim_id uuid;
    v_deadline date;
BEGIN
    -- 1. Auth-Check
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- 2. Lade rent_ledger Daten
    SELECT lease_id, expected_rent, COALESCE(paid_amount, 0), period_month
    INTO v_lease_id, v_expected_rent, v_paid_amount, v_period_month
    FROM rent_ledger
    WHERE id = p_rent_ledger_id AND user_id = v_user_id;

    IF v_lease_id IS NULL THEN
        RAISE EXCEPTION 'rent_ledger Eintrag nicht gefunden oder keine Berechtigung.';
    END IF;

    -- 3. Offene Summe prüfen
    v_open_amount := v_expected_rent - v_paid_amount;
    IF v_open_amount <= 0 THEN
        RAISE EXCEPTION 'Diese Miete ist bereits vollständig bezahlt.';
    END IF;

    -- 4. Tenant aus Lease holen
    SELECT tenant_id INTO v_tenant_id FROM leases WHERE id = v_lease_id;

    -- 5. Prüfen, ob bereits aktiver Claim existiert
    SELECT ci.claim_id INTO v_active_claim_id
    FROM claim_items ci
    JOIN claims c ON c.id = ci.claim_id
    WHERE ci.rent_ledger_id = p_rent_ledger_id
      AND c.status NOT IN ('settled', 'cancelled', 'archived')
    LIMIT 1;

    IF v_active_claim_id IS NOT NULL THEN
        RAISE EXCEPTION 'Für diese Miete existiert bereits eine aktive Forderung (Claim-ID: %).', v_active_claim_id;
    END IF;

    -- 6. Frist berechnen
    v_deadline := CURRENT_DATE + p_deadline_days;

    -- 7. CLAIM erstellen
    INSERT INTO claims (
        user_id, lease_id, tenant_id, status, escalation_level,
        interest_start_date, interest_rate, accumulated_unpaid_interest, accumulated_unpaid_fees,
        deadline, next_action_at
    )
    VALUES (
        v_user_id, v_lease_id, v_tenant_id, 'open', 0,
        p_interest_start_date, p_interest_rate, 0, p_fee_amount,
        v_deadline, v_deadline
    )
    RETURNING id INTO v_new_claim_id;

    -- 8. CLAIM_ITEM erstellen
    INSERT INTO claim_items (
        user_id, claim_id, rent_ledger_id, item_type, original_amount, period_month, description
    )
    VALUES (
        v_user_id, v_new_claim_id, p_rent_ledger_id, 'rent', v_open_amount, v_period_month, 
        'Mietrückstand ' || to_char(v_period_month, 'MM/YYYY')
    );

    -- 9. CLAIM_EVENT erstellen
    INSERT INTO claim_events (
        user_id, claim_id, event_type, description, event_metadata
    )
    VALUES (
        v_user_id, v_new_claim_id, 'created', 'Forderung aus offener Miete erstellt',
        jsonb_build_object(
            'source', 'rent_ledger',
            'rent_ledger_id', p_rent_ledger_id,
            'period_month', v_period_month,
            'principal_amount', v_open_amount,
            'fee_amount', p_fee_amount,
            'interest_start_date', p_interest_start_date,
            'deadline', v_deadline,
            'note', p_note
        )
    );

    RETURN v_new_claim_id;
END;
$$;
