-- ============================================================================
-- RPC: sync_all_rent_ledgers
-- ============================================================================
-- Synchronisiert automatisch alle rent_payments und leases in die 
-- rent_ledger Tabelle, damit die Forderungsübersicht immer aktuell ist.
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_all_rent_ledgers()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
    v_lease RECORD;
    v_iter_date date;
    v_end_date date;
    v_paid numeric;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RETURN;
    END IF;

    -- Gehe über alle aktiven Mietverträge des Users
    FOR v_lease IN 
        SELECT id, start_date, end_date, 
               COALESCE(cold_rent, 0) + COALESCE(service_charge, 0) + COALESCE(heating_cost, 0) + COALESCE(other_costs, 0) as total_rent
        FROM leases 
        WHERE user_id = v_user_id AND start_date IS NOT NULL
    LOOP
        -- Setze iterator auf den 1. des Startmonats
        v_iter_date := date_trunc('month', v_lease.start_date)::date;
        
        -- Enddatum = Ende des Mietvertrags oder aktueller Monat
        IF v_lease.end_date IS NOT NULL AND v_lease.end_date < CURRENT_DATE THEN
            v_end_date := date_trunc('month', v_lease.end_date)::date;
        ELSE
            v_end_date := date_trunc('month', CURRENT_DATE)::date;
        END IF;

        WHILE v_iter_date <= v_end_date LOOP
            -- Berechne bezahlte Summe für diesen Monat
            SELECT COALESCE(SUM(amount), 0) INTO v_paid
            FROM rent_payments
            WHERE lease_id = v_lease.id 
              AND user_id = v_user_id
              AND period_month::text LIKE to_char(v_iter_date, 'YYYY-MM') || '%';

            -- Upsert in rent_ledger
            INSERT INTO rent_ledger (user_id, lease_id, period_month, expected_rent, paid_amount, status)
            VALUES (
                v_user_id, 
                v_lease.id, 
                v_iter_date, 
                v_lease.total_rent, 
                v_paid, 
                CASE WHEN v_paid >= (v_lease.total_rent - 1) THEN 'paid' ELSE 'open' END
            )
            ON CONFLICT (lease_id, period_month) DO UPDATE 
            SET expected_rent = EXCLUDED.expected_rent,
                paid_amount = EXCLUDED.paid_amount,
                status = CASE WHEN EXCLUDED.paid_amount >= (EXCLUDED.expected_rent - 1) THEN 'paid' ELSE 'open' END;

            -- Gehe zum nächsten Monat
            v_iter_date := (v_iter_date + interval '1 month')::date;
        END LOOP;
    END LOOP;
END;
$$;
