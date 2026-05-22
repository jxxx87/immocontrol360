-- ============================================================================
-- SQL MIGRATION PROPOSAL V3: FORDERUNGSMANAGEMENT (CLAIMS)
-- WICHTIG: Dies ist ein Entwurf. Noch nicht live ausführen!
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. HILFSFUNKTIONEN (UPDATED_AT & SICHERHEITS-TRIGGER)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_forderungsmanagement_updated_at()
RETURNS TRIGGER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Sicherheits-Trigger für claim_items -> rent_ledger
CREATE OR REPLACE FUNCTION check_claim_item_rent_ledger_owner()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.rent_ledger_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM rent_ledger WHERE id = NEW.rent_ledger_id AND user_id = NEW.user_id) THEN
      RAISE EXCEPTION 'rent_ledger_id does not belong to the user.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Sicherheits-Trigger für claim_payments -> rent_payments
CREATE OR REPLACE FUNCTION check_claim_payment_rent_payment_owner()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.rent_payment_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM rent_payments WHERE id = NEW.rent_payment_id AND user_id = NEW.user_id) THEN
      RAISE EXCEPTION 'rent_payment_id does not belong to the user.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Sicherheits-Trigger für claim_events -> documents
CREATE OR REPLACE FUNCTION check_claim_event_document_owner()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.document_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM documents WHERE id = NEW.document_id AND user_id = NEW.user_id) THEN
      RAISE EXCEPTION 'document_id does not belong to the user.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Sicherheits-Trigger für claim_payment_allocations
CREATE OR REPLACE FUNCTION check_claim_allocation_integrity()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment_user_id uuid;
  v_payment_claim_id uuid;
  v_claim_user_id uuid;
  v_item_user_id uuid;
  v_item_claim_id uuid;
BEGIN
  -- 1. Check payment exists and belongs to the correct user and claim
  SELECT user_id, claim_id INTO v_payment_user_id, v_payment_claim_id FROM claim_payments WHERE id = NEW.claim_payment_id;
  IF v_payment_user_id != NEW.user_id THEN
    RAISE EXCEPTION 'claim_payment_id does not belong to the user.';
  END IF;
  IF v_payment_claim_id != NEW.claim_id THEN
    RAISE EXCEPTION 'claim_id does not match the claim_payment claim_id.';
  END IF;
  
  -- 2. Check claim exists and belongs to the correct user
  SELECT user_id INTO v_claim_user_id FROM claims WHERE id = NEW.claim_id;
  IF v_claim_user_id != NEW.user_id THEN
    RAISE EXCEPTION 'claim_id does not belong to the user.';
  END IF;

  -- 3. Check item (if provided) exists and belongs to the correct user and claim
  IF NEW.claim_item_id IS NOT NULL THEN
    SELECT user_id, claim_id INTO v_item_user_id, v_item_claim_id FROM claim_items WHERE id = NEW.claim_item_id;
    IF v_item_user_id != NEW.user_id THEN
      RAISE EXCEPTION 'claim_item_id does not belong to the user.';
    END IF;
    IF v_item_claim_id != NEW.claim_id THEN
      RAISE EXCEPTION 'claim_item_id does not belong to this claim.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 2. TABELLE: claims (Die Forderungsakte)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claims (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT NOT NULL,
  lease_id uuid REFERENCES leases(id) ON DELETE RESTRICT NOT NULL,
  tenant_id uuid REFERENCES tenants(id) ON DELETE RESTRICT,
  
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'sent', 'action_required', 'payment_plan_requested', 'payment_plan_active', 'settled', 'cancelled', 'archived')),
  escalation_level integer NOT NULL DEFAULT 0,
  
  interest_start_date date,
  interest_rate numeric(8,4) NOT NULL DEFAULT 5.0000,
  accumulated_unpaid_interest numeric(12,2) NOT NULL DEFAULT 0,
  accumulated_unpaid_fees numeric(12,2) NOT NULL DEFAULT 0,
  
  deadline date,
  next_action_at date,
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES auth.users(id),
  cancellation_reason text,
  archived_at timestamptz
);

CREATE TRIGGER handle_claims_updated_at BEFORE UPDATE ON claims FOR EACH ROW EXECUTE PROCEDURE set_forderungsmanagement_updated_at();

CREATE INDEX idx_claims_user_id ON claims(user_id);
CREATE INDEX idx_claims_lease_id ON claims(lease_id);
CREATE INDEX idx_claims_tenant_id ON claims(tenant_id);
CREATE INDEX idx_claims_status ON claims(status);
CREATE INDEX idx_claims_deadline ON claims(deadline);
CREATE INDEX idx_claims_user_status ON claims(user_id, status);
CREATE INDEX idx_claims_user_deadline ON claims(user_id, deadline);

-- ----------------------------------------------------------------------------
-- 3. TABELLE: claim_items (Die einzelnen Forderungspositionen - NUR URSPRUNG)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claim_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT NOT NULL,
  claim_id uuid REFERENCES claims(id) ON DELETE RESTRICT NOT NULL,
  rent_ledger_id uuid REFERENCES rent_ledger(id) ON DELETE SET NULL,
  
  item_type text NOT NULL DEFAULT 'rent' CHECK (item_type IN ('rent', 'utility_backpay', 'damage', 'deposit', 'other')),
  
  -- Nur Originalbetrag als Source of Truth! Keine paid/open Spalten mehr.
  original_amount numeric(12,2) NOT NULL CHECK (original_amount >= 0),
  
  description text,
  period_month date,
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TRIGGER handle_claim_items_updated_at BEFORE UPDATE ON claim_items FOR EACH ROW EXECUTE PROCEDURE set_forderungsmanagement_updated_at();
CREATE TRIGGER trigger_check_claim_item_rent_ledger BEFORE INSERT OR UPDATE ON claim_items FOR EACH ROW EXECUTE PROCEDURE check_claim_item_rent_ledger_owner();

CREATE INDEX idx_claim_items_user_id ON claim_items(user_id);
CREATE INDEX idx_claim_items_claim_id ON claim_items(claim_id);
CREATE INDEX idx_claim_items_rent_ledger_id ON claim_items(rent_ledger_id);

CREATE OR REPLACE FUNCTION check_duplicate_active_claim_item()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  active_count INT;
BEGIN
  IF NEW.rent_ledger_id IS NOT NULL THEN
    SELECT COUNT(*) INTO active_count
    FROM claim_items ci
    JOIN claims c ON ci.claim_id = c.id
    WHERE ci.rent_ledger_id = NEW.rent_ledger_id
      AND ci.id != NEW.id
      AND c.status NOT IN ('cancelled', 'archived', 'settled');
      
    IF active_count > 0 THEN
      RAISE EXCEPTION 'This rent_ledger_id is already assigned to an active claim.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_check_duplicate_active_claim_item 
BEFORE INSERT OR UPDATE ON claim_items 
FOR EACH ROW EXECUTE PROCEDURE check_duplicate_active_claim_item();

-- ----------------------------------------------------------------------------
-- 4. TABELLE: claim_payments (Zahlungsereignisse)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claim_payments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT NOT NULL,
  claim_id uuid REFERENCES claims(id) ON DELETE RESTRICT NOT NULL,
  rent_payment_id uuid REFERENCES rent_payments(id) ON DELETE SET NULL,
  
  payment_date date NOT NULL,
  amount numeric(12,2) NOT NULL,
  
  allocation_type text NOT NULL DEFAULT 'automatic' CHECK (allocation_type IN ('automatic', 'manual', 'debtor_designated', 'reversal')),
  
  -- Status 'reversed' entfernt. Reversal = Neuer Datensatz mit negativem amount.
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'cancelled')),
  
  reversal_reference_id uuid REFERENCES claim_payments(id),
  
  note text,
  created_at timestamptz DEFAULT now()
);

CREATE TRIGGER trigger_check_claim_payment_rent_payment BEFORE INSERT OR UPDATE ON claim_payments FOR EACH ROW EXECUTE PROCEDURE check_claim_payment_rent_payment_owner();

CREATE INDEX idx_claim_payments_user_id ON claim_payments(user_id);
CREATE INDEX idx_claim_payments_claim_id ON claim_payments(claim_id);
CREATE INDEX idx_claim_payments_rent_payment_id ON claim_payments(rent_payment_id);
CREATE INDEX idx_claim_payments_reversal_ref ON claim_payments(reversal_reference_id);
CREATE INDEX idx_claim_payments_status ON claim_payments(status);

-- ----------------------------------------------------------------------------
-- 5. TABELLE: claim_payment_allocations (Detail-Aufteilung einer Zahlung)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claim_payment_allocations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT NOT NULL,
  claim_payment_id uuid REFERENCES claim_payments(id) ON DELETE RESTRICT NOT NULL,
  claim_id uuid REFERENCES claims(id) ON DELETE RESTRICT NOT NULL,
  claim_item_id uuid REFERENCES claim_items(id) ON DELETE RESTRICT,
  
  allocation_bucket text NOT NULL CHECK (allocation_bucket IN ('fees', 'interest', 'principal')),
  amount numeric(12,2) NOT NULL,
  
  created_at timestamptz DEFAULT now()
);

CREATE TRIGGER trigger_check_claim_allocation_integrity BEFORE INSERT OR UPDATE ON claim_payment_allocations FOR EACH ROW EXECUTE PROCEDURE check_claim_allocation_integrity();

CREATE INDEX idx_claim_allocations_user_id ON claim_payment_allocations(user_id);
CREATE INDEX idx_claim_allocations_payment_id ON claim_payment_allocations(claim_payment_id);
CREATE INDEX idx_claim_allocations_claim_id ON claim_payment_allocations(claim_id);
CREATE INDEX idx_claim_allocations_item_id ON claim_payment_allocations(claim_item_id);

-- Constraint Funktion für Summenprüfung (DEFERRABLE)
CREATE OR REPLACE FUNCTION verify_payment_allocations_sum()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment_amount numeric;
  v_allocations_sum numeric;
  v_check_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'claim_payments' THEN
    v_check_id := NEW.id;
  ELSE
    v_check_id := NEW.claim_payment_id;
  END IF;

  SELECT amount INTO v_payment_amount FROM claim_payments WHERE id = v_check_id AND status = 'posted';
  
  IF v_payment_amount IS NOT NULL THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_allocations_sum FROM claim_payment_allocations WHERE claim_payment_id = v_check_id;
    IF v_allocations_sum != v_payment_amount THEN
      RAISE EXCEPTION 'Sum of allocations (%) does not match claim_payment amount (%) for posted payment ID %.', v_allocations_sum, v_payment_amount, v_check_id;
    END IF;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Deferred Triggers zur Summenprüfung am Ende der Transaktion
CREATE CONSTRAINT TRIGGER check_payment_allocations_after_payment 
AFTER INSERT OR UPDATE ON claim_payments 
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE PROCEDURE verify_payment_allocations_sum();

CREATE CONSTRAINT TRIGGER check_payment_allocations_after_allocation 
AFTER INSERT OR UPDATE OR DELETE ON claim_payment_allocations 
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE PROCEDURE verify_payment_allocations_sum();

-- ----------------------------------------------------------------------------
-- 6. TABELLE: claim_events (Das Immutable Audit Log)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claim_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT NOT NULL,
  claim_id uuid REFERENCES claims(id) ON DELETE RESTRICT NOT NULL,
  
  event_type text NOT NULL CHECK (event_type IN ('created', 'status_changed', 'dunning_sent', 'deadline_set', 'deadline_expired', 'tenant_contacted', 'payment_received', 'payment_reversed', 'payment_plan_requested', 'payment_plan_accepted', 'payment_plan_failed', 'escalated', 'cancelled', 'archived', 'note_added', 'closed')),
  event_date timestamptz NOT NULL DEFAULT now(),
  description text,
  
  document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  event_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  
  created_at timestamptz DEFAULT now()
);

CREATE TRIGGER trigger_check_claim_event_document BEFORE INSERT OR UPDATE ON claim_events FOR EACH ROW EXECUTE PROCEDURE check_claim_event_document_owner();

CREATE INDEX idx_claim_events_user_id ON claim_events(user_id);
CREATE INDEX idx_claim_events_claim_id ON claim_events(claim_id);
CREATE INDEX idx_claim_events_type ON claim_events(event_type);
CREATE INDEX idx_claim_events_date ON claim_events(event_date);

-- ----------------------------------------------------------------------------
-- 7. TABELLE: payment_plans (Ratenzahlungsvereinbarungen)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_plans (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT NOT NULL,
  claim_id uuid REFERENCES claims(id) ON DELETE RESTRICT NOT NULL,
  
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('requested', 'active', 'completed', 'failed', 'cancelled')),
  plan_type text NOT NULL DEFAULT 'installment_agreement',
  
  total_amount numeric(12,2) NOT NULL,
  interest_or_fee_adjustment numeric(12,2) NOT NULL DEFAULT 0,
  monthly_rate numeric(12,2),
  first_due_date date,
  last_due_date date,
  
  requested_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES auth.users(id),
  cancellation_reason text
);

CREATE TRIGGER handle_payment_plans_updated_at BEFORE UPDATE ON payment_plans FOR EACH ROW EXECUTE PROCEDURE set_forderungsmanagement_updated_at();

CREATE INDEX idx_payment_plans_user_id ON payment_plans(user_id);
CREATE INDEX idx_payment_plans_claim_id ON payment_plans(claim_id);
CREATE INDEX idx_payment_plans_status ON payment_plans(status);

-- ----------------------------------------------------------------------------
-- 8. TABELLE: payment_plan_installments (Die einzelnen Raten)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_plan_installments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT NOT NULL,
  payment_plan_id uuid REFERENCES payment_plans(id) ON DELETE RESTRICT NOT NULL,
  
  due_date date NOT NULL,
  amount numeric(12,2) NOT NULL,
  paid_amount numeric(12,2) NOT NULL DEFAULT 0,
  open_amount numeric(12,2) GENERATED ALWAYS AS (amount - paid_amount) STORED CHECK (open_amount >= 0),
  
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'partial', 'overdue', 'cancelled')),
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TRIGGER handle_payment_plan_installments_updated_at BEFORE UPDATE ON payment_plan_installments FOR EACH ROW EXECUTE PROCEDURE set_forderungsmanagement_updated_at();

CREATE INDEX idx_payment_installments_user_id ON payment_plan_installments(user_id);
CREATE INDEX idx_payment_installments_plan_id ON payment_plan_installments(payment_plan_id);
CREATE INDEX idx_payment_installments_due_date ON payment_plan_installments(due_date);
CREATE INDEX idx_payment_installments_status ON payment_plan_installments(status);


-- ----------------------------------------------------------------------------
-- 9. VIEW: claim_item_totals_view (RLS-sicher)
-- Detail-View zur Ansicht von bezahlten/offenen Beträgen auf Item-Ebene
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW claim_item_totals_view 
WITH (security_invoker = true)
AS
SELECT 
  ci.id as claim_item_id,
  ci.claim_id,
  ci.user_id,
  ci.original_amount,
  COALESCE(SUM(cpa.amount), 0) as paid_principal,
  GREATEST(0, ci.original_amount - COALESCE(SUM(cpa.amount), 0)) as open_amount
FROM claim_items ci
LEFT JOIN claim_payment_allocations cpa 
  ON cpa.claim_item_id = ci.id 
  AND cpa.allocation_bucket = 'principal'
LEFT JOIN claim_payments cp 
  ON cp.id = cpa.claim_payment_id 
  AND cp.status = 'posted'
GROUP BY ci.id;

-- ----------------------------------------------------------------------------
-- 10. VIEW: claim_totals_view (RLS-sicher)
-- Komplette Berechnung aller Forderungssummen basierend auf Allocations
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW claim_totals_view 
WITH (security_invoker = true)
AS
WITH allocation_sums AS (
  SELECT
    cp.claim_id,
    SUM(cpa.amount) FILTER (WHERE cpa.allocation_bucket = 'principal') as principal_paid,
    SUM(cpa.amount) FILTER (WHERE cpa.allocation_bucket = 'fees') as fees_paid,
    SUM(cpa.amount) FILTER (WHERE cpa.allocation_bucket = 'interest') as interest_paid
  FROM claim_payments cp
  LEFT JOIN claim_payment_allocations cpa ON cp.id = cpa.claim_payment_id
  WHERE cp.status = 'posted'
  GROUP BY cp.claim_id
),
item_sums AS (
  SELECT claim_id, SUM(original_amount) as original_principal
  FROM claim_items
  GROUP BY claim_id
)
SELECT 
  c.id as claim_id,
  c.user_id,
  
  -- Principal
  COALESCE(i.original_principal, 0) as current_principal_original,
  COALESCE(a.principal_paid, 0) as principal_paid,
  GREATEST(0, COALESCE(i.original_principal, 0) - COALESCE(a.principal_paid, 0)) as current_principal_open,
  
  -- Fees
  c.accumulated_unpaid_fees,
  COALESCE(a.fees_paid, 0) as fees_paid,
  GREATEST(0, c.accumulated_unpaid_fees - COALESCE(a.fees_paid, 0)) as total_fees_open,
  
  -- Interest
  c.accumulated_unpaid_interest,
  COALESCE(a.interest_paid, 0) as interest_paid,
  
  ROUND(
    CASE 
      WHEN c.interest_start_date IS NULL THEN 0
      ELSE GREATEST(0, (GREATEST(0, COALESCE(i.original_principal, 0) - COALESCE(a.principal_paid, 0)) * (c.interest_rate / 100.0) / 365.0) * (CURRENT_DATE - c.interest_start_date))
    END, 2
  ) as live_interest_since_start,
  
  GREATEST(0, c.accumulated_unpaid_interest + 
    ROUND(
      CASE 
        WHEN c.interest_start_date IS NULL THEN 0
        ELSE GREATEST(0, (GREATEST(0, COALESCE(i.original_principal, 0) - COALESCE(a.principal_paid, 0)) * (c.interest_rate / 100.0) / 365.0) * (CURRENT_DATE - c.interest_start_date))
      END, 2
    ) - COALESCE(a.interest_paid, 0)
  ) as total_interest_open,
  
  -- Total Due (Principal + Fees + Interest)
  GREATEST(0, COALESCE(i.original_principal, 0) - COALESCE(a.principal_paid, 0)) +
  GREATEST(0, c.accumulated_unpaid_fees - COALESCE(a.fees_paid, 0)) +
  GREATEST(0, c.accumulated_unpaid_interest + 
    ROUND(
      CASE 
        WHEN c.interest_start_date IS NULL THEN 0
        ELSE GREATEST(0, (GREATEST(0, COALESCE(i.original_principal, 0) - COALESCE(a.principal_paid, 0)) * (c.interest_rate / 100.0) / 365.0) * (CURRENT_DATE - c.interest_start_date))
      END, 2
    ) - COALESCE(a.interest_paid, 0)
  ) as total_due

FROM claims c
LEFT JOIN item_sums i ON c.id = i.claim_id
LEFT JOIN allocation_sums a ON c.id = a.claim_id;

-- ----------------------------------------------------------------------------
-- 11. RPC: update_overdue_claims_status
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_overdue_claims_status()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claim_record RECORD;
  current_user_id uuid;
BEGIN
  current_user_id := auth.uid();
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  FOR claim_record IN 
    SELECT id FROM claims 
    WHERE user_id = current_user_id 
      AND status IN ('sent', 'open') 
      AND deadline < CURRENT_DATE
  LOOP
    UPDATE claims SET status = 'action_required' WHERE id = claim_record.id AND user_id = current_user_id;
    
    INSERT INTO claim_events (user_id, claim_id, event_type, description, event_metadata)
    VALUES (
      current_user_id, 
      claim_record.id, 
      'deadline_expired', 
      'Die gesetzte Frist ist abgelaufen. Status wurde automatisch auf Aktion erforderlich gesetzt.', 
      '{"old_status": "sent", "new_status": "action_required"}'::jsonb
    );
  END LOOP;
END;
$$;

-- ----------------------------------------------------------------------------
-- 12. ROW LEVEL SECURITY (RLS) - SICHERES SETUP OHNE DELETE
-- ----------------------------------------------------------------------------
ALTER TABLE claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_plan_installments ENABLE ROW LEVEL SECURITY;

-- Blockiert physisches Löschen (DELETE) für alle Tabellen global per Trigger
CREATE OR REPLACE FUNCTION block_physical_delete()
RETURNS TRIGGER 
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Physical deletes are blocked for this table. Use soft cancel/archive status instead.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER block_claims_delete BEFORE DELETE ON claims FOR EACH ROW EXECUTE PROCEDURE block_physical_delete();
CREATE TRIGGER block_claim_items_delete BEFORE DELETE ON claim_items FOR EACH ROW EXECUTE PROCEDURE block_physical_delete();
CREATE TRIGGER block_claim_payments_delete BEFORE DELETE ON claim_payments FOR EACH ROW EXECUTE PROCEDURE block_physical_delete();
CREATE TRIGGER block_claim_allocations_delete BEFORE DELETE ON claim_payment_allocations FOR EACH ROW EXECUTE PROCEDURE block_physical_delete();
CREATE TRIGGER block_payment_plans_delete BEFORE DELETE ON payment_plans FOR EACH ROW EXECUTE PROCEDURE block_physical_delete();
CREATE TRIGGER block_installments_delete BEFORE DELETE ON payment_plan_installments FOR EACH ROW EXECUTE PROCEDURE block_physical_delete();
CREATE TRIGGER block_events_delete BEFORE DELETE ON claim_events FOR EACH ROW EXECUTE PROCEDURE block_physical_delete();

-- RLS: claims
CREATE POLICY "Select claims" ON claims FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Insert claims" ON claims FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Update claims" ON claims FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- RLS: claim_items
CREATE POLICY "Select claim_items" ON claim_items FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Insert claim_items" ON claim_items FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Update claim_items" ON claim_items FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- RLS: claim_payments
CREATE POLICY "Select claim_payments" ON claim_payments FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Insert claim_payments" ON claim_payments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Update claim_payments" ON claim_payments FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- RLS: claim_payment_allocations
CREATE POLICY "Select claim_payment_allocations" ON claim_payment_allocations FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Insert claim_payment_allocations" ON claim_payment_allocations FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Update claim_payment_allocations" ON claim_payment_allocations FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- RLS: payment_plans
CREATE POLICY "Select payment_plans" ON payment_plans FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Insert payment_plans" ON payment_plans FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Update payment_plans" ON payment_plans FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- RLS: payment_plan_installments
CREATE POLICY "Select installments" ON payment_plan_installments FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Insert installments" ON payment_plan_installments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Update installments" ON payment_plan_installments FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- RLS: claim_events (IMMUTABLE: Nur SELECT und INSERT)
CREATE POLICY "Select claim_events" ON claim_events FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Insert claim_events" ON claim_events FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Block update events" ON claim_events FOR UPDATE USING (false);

-- Trigger zur Sicherheit gegen UPDATE in claim_events
CREATE OR REPLACE FUNCTION block_claim_events_update()
RETURNS TRIGGER 
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'claim_events is an immutable audit log. Updates are strictly forbidden.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_block_claim_events_update BEFORE UPDATE ON claim_events FOR EACH ROW EXECUTE PROCEDURE block_claim_events_update();

-- ----------------------------------------------------------------------------
-- ENDE DER MIGRATION V3
-- ----------------------------------------------------------------------------
