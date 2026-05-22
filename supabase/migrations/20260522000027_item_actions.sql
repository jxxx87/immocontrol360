-- ============================================================================
-- Migration: Add RPCs for single item deletion and settlement
-- ============================================================================

CREATE OR REPLACE FUNCTION delete_claim_item(p_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
    v_claim_id uuid;
    v_description text;
    v_original_amount numeric;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

    -- Hole Infos zum Item
    SELECT claim_id, description, original_amount INTO v_claim_id, v_description, v_original_amount
    FROM claim_items
    WHERE id = p_item_id AND user_id = v_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Position nicht gefunden oder keine Berechtigung.';
    END IF;

    -- Lösche das Item (claim_payment_allocations mit FK on delete cascade?)
    -- Wait! Wenn es bereits Zahlungen gibt, wirft das einen Fehler, falls kein CASCADE.
    -- Wir prüfen ob Zahlungen existieren
    IF EXISTS (SELECT 1 FROM claim_payment_allocations WHERE claim_item_id = p_item_id) THEN
        RAISE EXCEPTION 'Diese Position hat bereits zugeordnete Zahlungen. Bitte zuerst die Zahlungen rückabwickeln.';
    END IF;

    DELETE FROM claim_items WHERE id = p_item_id;

    -- Timeline Eintrag hinzufügen
    INSERT INTO claim_events (user_id, claim_id, event_type, description, event_metadata)
    VALUES (v_user_id, v_claim_id, 'note_added', 'Forderungsposition gelöscht: ' || COALESCE(v_description, 'Unbekannt'), jsonb_build_object('deleted_amount', v_original_amount));

END;
$$;

CREATE OR REPLACE FUNCTION settle_claim_item(p_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
    v_claim_id uuid;
    v_open_amount numeric;
    v_payment_id uuid;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

    -- Finde offene Summe
    SELECT claim_id, open_amount INTO v_claim_id, v_open_amount
    FROM claim_item_totals_view
    WHERE claim_item_id = p_item_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Position nicht gefunden.';
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
$$;
