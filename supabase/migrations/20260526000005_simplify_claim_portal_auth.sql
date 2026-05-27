-- 1. Add token and pin columns to claim_access_links
ALTER TABLE claim_access_links ADD COLUMN IF NOT EXISTS token TEXT;
ALTER TABLE claim_access_links ADD COLUMN IF NOT EXISTS pin TEXT;

-- 2. Make hash columns nullable (legacy)
ALTER TABLE claim_access_links ALTER COLUMN token_hash DROP NOT NULL;
ALTER TABLE claim_access_links ALTER COLUMN pin_hash DROP NOT NULL;

-- 3. Update generate_claim_access_link to store plaintext
DROP FUNCTION IF EXISTS generate_claim_access_link;
CREATE OR REPLACE FUNCTION generate_claim_access_link(
    p_claim_id UUID,
    p_token TEXT,
    p_pin TEXT,
    p_expires_days INT DEFAULT 14
)
RETURNS UUID
LANGUAGE plpgsql
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
        v_claim.user_id,
        true
    ) RETURNING id INTO v_link_id;

    RETURN v_link_id;
END;
$$;

-- 4. Update get_public_claim_by_token to check plaintext
CREATE OR REPLACE FUNCTION get_public_claim_by_token(p_token TEXT, p_pin TEXT)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_link claim_access_links%ROWTYPE;
    v_claim claims%ROWTYPE;
    v_result JSON;
BEGIN
    -- Find the active link
    SELECT * INTO v_link
    FROM claim_access_links
    WHERE (token = p_token OR token_hash = p_token)
      AND (pin = p_pin OR pin_hash = p_pin)
      AND is_active = true
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Zugangscode (PIN) oder Token ist ungültig.';
    END IF;

    IF v_link.expires_at < now() THEN
        RAISE EXCEPTION 'Link ist abgelaufen.';
    END IF;

    -- Update last_used_at securely
    UPDATE claim_access_links SET last_used_at = now() WHERE id = v_link.id;

    -- Fetch the claim
    SELECT * INTO v_claim FROM claims WHERE id = v_link.claim_id;
    
    -- Reject if claim is settled, cancelled or archived
    IF v_claim.status IN ('settled', 'cancelled', 'archived') THEN
        RAISE EXCEPTION 'Diese Forderung ist bereits abgeschlossen oder storniert.';
    END IF;

    -- Build a safe JSON object containing only necessary data
    SELECT json_build_object(
        'claim_id', v_claim.id,
        'link_id', v_link.id,
        'status', v_claim.status,
        'deadline', v_claim.deadline,
        'interest_rate', v_claim.interest_rate,
        'accumulated_unpaid_fees', v_claim.accumulated_unpaid_fees,
        'accumulated_unpaid_interest', v_claim.accumulated_unpaid_interest,
        'tenant', (SELECT json_build_object('first_name', first_name, 'last_name', last_name) FROM tenants WHERE id = v_claim.tenant_id),
        'lease', (
            SELECT json_build_object(
                'unit', (
                    SELECT json_build_object(
                        'unit_name', unit_name, 
                        'property', (SELECT json_build_object('street', street, 'house_number', house_number, 'city', city, 'zip', zip) FROM properties WHERE id = u.property_id)
                    )
                    FROM units u WHERE id = l.unit_id
                )
            ) FROM leases l WHERE id = v_claim.lease_id
        ),
        'items', (
            SELECT json_agg(json_build_object(
                'id', ci.id,
                'item_type', ci.item_type,
                'description', ci.description,
                'original_amount', ci.original_amount,
                'created_at', ci.created_at,
                'fee_amount', ci.fee_amount,
                'interest_amount', ci.interest_amount,
                'open_amount', cv.open_amount
            ))
            FROM claim_items ci
            LEFT JOIN claim_item_totals_view cv ON cv.claim_item_id = ci.id
            WHERE ci.claim_id = v_claim.id
        ),
        'totals', (
            SELECT json_build_object(
                'total_due', total_due,
                'current_principal_open', current_principal_open,
                'total_fees_open', total_fees_open,
                'total_interest_open', total_interest_open
            )
            FROM claim_totals_view WHERE claim_id = v_claim.id
        ),
        'settings', (
            SELECT json_build_object(
                'allow_installments', COALESCE(claim_portal_allow_installments, true),
                'installment_options', COALESCE(claim_portal_installment_options, '[{"months": 3, "surcharge_percent": 7}, {"months": 6, "surcharge_percent": 9}, {"months": 12, "surcharge_percent": 12}]'::jsonb)
            )
            FROM profiles WHERE id = v_claim.user_id
        )
    ) INTO v_result;

    RETURN v_result;
END;
$$;

-- 5. Update submit_public_payment_plan_request
CREATE OR REPLACE FUNCTION submit_public_payment_plan_request(
    p_token TEXT,
    p_pin TEXT,
    p_requested_months INT,
    p_requested_rate NUMERIC,
    p_requested_total NUMERIC,
    p_adjustment_amount NUMERIC,
    p_tenant_message TEXT
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_link claim_access_links%ROWTYPE;
    v_claim_user_id UUID;
BEGIN
    -- Find the access link
    SELECT * INTO v_link
    FROM claim_access_links
    WHERE (token = p_token OR token_hash = p_token)
      AND (pin = p_pin OR pin_hash = p_pin);

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Link ungültig oder nicht gefunden.';
    END IF;

    IF v_link.revoked_at IS NOT NULL OR v_link.expires_at < now() OR v_link.is_active = false THEN
        RAISE EXCEPTION 'Link ist nicht mehr gültig.';
    END IF;

    -- Insert the request
    INSERT INTO payment_plan_requests (
        claim_id, access_link_id, requested_months, requested_rate, requested_total, adjustment_amount, tenant_message
    ) VALUES (
        v_link.claim_id, v_link.id, p_requested_months, p_requested_rate, p_requested_total, p_adjustment_amount, p_tenant_message
    );
    
    -- Get claim user_id
    SELECT user_id INTO v_claim_user_id FROM claims WHERE id = v_link.claim_id;

    -- Insert a timeline event
    INSERT INTO claim_events (
        user_id, claim_id, event_type, description, event_metadata
    ) VALUES (
        v_claim_user_id,
        v_link.claim_id, 
        'payment_plan_requested', 
        'Mieter hat eine Ratenzahlung angefragt', 
        jsonb_build_object(
            'requested_months', p_requested_months,
            'requested_rate', p_requested_rate,
            'requested_total', p_requested_total,
            'tenant_message', p_tenant_message
        )
    );
    
    -- Update claim status
    UPDATE claims SET status = 'payment_plan_requested' WHERE id = v_link.claim_id;

    RETURN json_build_object('success', true);
END;
$$;
