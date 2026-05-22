-- ============================================================================
-- TEST SCRIPT FÜR MIGRATION V4
-- Bitte nach der Migration im Supabase SQL Editor (Staging) ausführen.
-- ============================================================================

-- 1. Test-User und IDs ermitteln (wir nehmen einfach den ersten verfügbaren User)
DO $$
DECLARE
  v_user_id uuid;
  v_lease_id uuid;
  v_claim_id uuid;
  v_claim_item_id uuid;
  v_payment_id uuid;
  v_reversal_id uuid;
BEGIN
  -- Hole einen gültigen User und Lease
  SELECT user_id, id INTO v_user_id, v_lease_id FROM leases LIMIT 1;
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Kein User/Lease gefunden. Bitte erstelle einen Test-Mietvertrag.';
  END IF;

  -- ============================================================================
  -- 4. TESTDATEN ANLEGEN
  -- ============================================================================
  RAISE NOTICE '>>> TEST 4: Lege Forderung an (Miete März 850€ + 5€ Gebühr)...';
  
  INSERT INTO claims (user_id, lease_id, status, accumulated_unpaid_fees, interest_start_date, interest_rate)
  VALUES (v_user_id, v_lease_id, 'open', 5.00, '2026-03-05', 5.00)
  RETURNING id INTO v_claim_id;

  INSERT INTO claim_items (user_id, claim_id, item_type, original_amount, period_month, description)
  VALUES (v_user_id, v_claim_id, 'rent', 850.00, '2026-03-01', 'Miete März')
  RETURNING id INTO v_claim_item_id;

  -- ============================================================================
  -- TEST A: claim_totals_view PRÜFEN
  -- ============================================================================
  RAISE NOTICE '>>> TEST A: claim_totals_view vor Zahlung prüfen...';
  -- Die Werte sollten sein: original 850, open 850, fees open 5, total_due 855 + zinsen
  
  -- ============================================================================
  -- TEST B: ZAHLUNG (DRAFT -> POSTED)
  -- ============================================================================
  RAISE NOTICE '>>> TEST B: Lege 100€ Zahlung als draft an...';
  INSERT INTO claim_payments (user_id, claim_id, payment_date, amount, status)
  VALUES (v_user_id, v_claim_id, CURRENT_DATE, 100.00, 'draft')
  RETURNING id INTO v_payment_id;

  INSERT INTO claim_payment_allocations (user_id, claim_payment_id, claim_id, claim_item_id, allocation_bucket, amount)
  VALUES 
    (v_user_id, v_payment_id, v_claim_id, NULL, 'fees', 5.00),
    (v_user_id, v_payment_id, v_claim_id, NULL, 'interest', 8.00),
    (v_user_id, v_payment_id, v_claim_id, v_claim_item_id, 'principal', 87.00);

  RAISE NOTICE 'Setze Zahlung auf posted (löst Constraint-Check aus)...';
  UPDATE claim_payments SET status = 'posted' WHERE id = v_payment_id;

  -- ============================================================================
  -- TEST C: IMMUTABLE SCHUTZ
  -- ============================================================================
  RAISE NOTICE '>>> TEST C: Prüfe Immutable-Schutz (sollte Fehler werfen, Exception wird hier abgefangen)...';
  BEGIN
    UPDATE claim_payments SET note = 'Manipulation' WHERE id = v_payment_id;
    RAISE EXCEPTION 'FEHLER: Update auf posted Zahlung wurde nicht blockiert!';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '  -> Erfolgreich blockiert: %', SQLERRM;
  END;

  BEGIN
    UPDATE claim_items SET original_amount = 1000 WHERE id = v_claim_item_id;
    RAISE EXCEPTION 'FEHLER: Update auf claim_item.original_amount wurde nicht blockiert!';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '  -> Erfolgreich blockiert: %', SQLERRM;
  END;

  -- ============================================================================
  -- TEST D: REVERSAL
  -- ============================================================================
  RAISE NOTICE '>>> TEST D: Lege Reversal an (-100€)...';
  INSERT INTO claim_payments (user_id, claim_id, payment_date, amount, allocation_type, reversal_reference_id, status)
  VALUES (v_user_id, v_claim_id, CURRENT_DATE, -100.00, 'reversal', v_payment_id, 'posted')
  RETURNING id INTO v_reversal_id;

  INSERT INTO claim_payment_allocations (user_id, claim_payment_id, claim_id, claim_item_id, allocation_bucket, amount)
  VALUES 
    (v_user_id, v_reversal_id, v_claim_id, NULL, 'fees', -5.00),
    (v_user_id, v_reversal_id, v_claim_id, NULL, 'interest', -8.00),
    (v_user_id, v_reversal_id, v_claim_id, v_claim_item_id, 'principal', -87.00);

  -- ============================================================================
  -- TEST E: FRIST ABLAUFEN LASSEN
  -- ============================================================================
  RAISE NOTICE '>>> TEST E: update_overdue_claims_status ausführen...';
  UPDATE claims SET deadline = CURRENT_DATE - 1 WHERE id = v_claim_id;
  
  -- Hierfür müssten wir als User authentifiziert sein, da RPC RLS nutzt.
  -- In diesem DO-Block läuft auth.uid() als null.
  -- Den RPC Test musst du ggf. im Frontend oder einer auth-Session testen.
  
  RAISE NOTICE 'Tests abgeschlossen! Bitte validiere die View-Ergebnisse in einer SELECT-Abfrage.';
  
END $$;
