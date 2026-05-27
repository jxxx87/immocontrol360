-- Migration: Restore stripe settings (stripe_connect_enabled, allow_stripe) in get_public_claim_by_token settings object.
-- Ensure we still allow settled claims in portal view.

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
    
    -- Reject if claim is cancelled or archived (settled is allowed so they can see paid state)
    IF v_claim.status IN ('cancelled', 'archived') THEN
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
                'installment_options', COALESCE(claim_portal_installment_options, '[{"months": 3, "surcharge_percent": 7}, {"months": 6, "surcharge_percent": 9}, {"months": 12, "surcharge_percent": 12}]'::jsonb),
                'stripe_connect_enabled', COALESCE(stripe_connect_enabled, false),
                'allow_stripe', COALESCE(claim_portal_allow_stripe, true)
            )
            FROM profiles WHERE id = v_claim.user_id
        )
    ) INTO v_result;

    RETURN v_result;
END;
$$;
