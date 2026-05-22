-- ============================================================================
-- SQL MIGRATION PROPOSAL V2: FORDERUNGSMANAGEMENT (CLAIMS)
-- WICHTIG: Dies ist ein Entwurf. Noch nicht live ausführen!
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. HILFSFUNKTIONEN (UPDATED_AT & SICHERHEITS-TRIGGER)
-- ----------------------------------------------------------------------------

-- Umbenannte updated_at Trigger-Funktion zur Vermeidung von Konflikten
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
  
  -- Soft Delete & Archivierung
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES auth.users(id),
  cancellation_reason text,
  archived_at timestamptz
);

CREATE TRIGGER handle_claims_updated_at BEFORE UPDATE ON claims FOR EACH ROW EXECUTE PROCEDURE set_forderungsmanagement_updated_at();

-- Indizes für claims
CREATE INDEX idx_claims_user_id ON claims(user_id);
CREATE INDEX idx_claims_lease_id ON claims(lease_id);
CREATE INDEX idx_claims_tenant_id ON claims(tenant_id);
CREATE INDEX idx_claims_status ON claims(status);
CREATE INDEX idx_claims_deadline ON claims(deadline);
CREATE INDEX idx_claims_user_status ON claims(user_id, status);
CREATE INDEX idx_claims_user_deadline ON claims(user_id, deadline);

-- ----------------------------------------------------------------------------
-- 3. TABELLE: claim_items (Die einzelnen Forderungspositionen)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claim_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT NOT NULL,
  claim_id uuid REFERENCES claims(id) ON DELETE RESTRICT NOT NULL,
  rent_ledger_id uuid REFERENCES rent_ledger(id) ON DELETE SET NULL,
  
  item_type text NOT NULL DEFAULT 'rent' CHECK (item_type IN ('rent', 'utility_backpay', 'damage', 'deposit', 'other')),
  
  original_amount numeric(12,2) NOT NULL CHECK (original_amount >= 0),
  paid_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  -- open_amount dynamisch aus original - paid berechnet
  open_amount numeric(12,2) GENERATED ALWAYS AS (original_amount - paid_amount) STORED CHECK (open_amount >= 0),
  
  description text,
  period_month date,
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TRIGGER handle_claim_items_updated_at BEFORE UPDATE ON claim_items FOR EACH ROW EXECUTE PROCEDURE set_forderungsmanagement_updated_at();
CREATE TRIGGER trigger_check_claim_item_rent_ledger BEFORE INSERT OR UPDATE ON claim_items FOR EACH ROW EXECUTE PROCEDURE check_claim_item_rent_ledger_owner();

-- Indizes für claim_items
CREATE INDEX idx_claim_items_user_id ON claim_items(user_id);
CREATE INDEX idx_claim_items_claim_id ON claim_items(claim_id);
CREATE INDEX idx_claim_items_rent_ledger_id ON claim_items(rent_ledger_id);

-- Trigger zur Vermeidung doppelter rent_ledger in offenen Claims
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
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'reversed', 'cancelled')),
  
  reversal_reference_id uuid REFERENCES claim_payments(id),
  reversed_at timestamptz,
  reversed_by uuid REFERENCES auth.users(id),
  reversal_reason text,
  
  note text,
  created_at timestamptz DEFAULT now()
);

CREATE TRIGGER trigger_check_claim_payment_rent_payment BEFORE INSERT OR UPDATE ON claim_payments FOR EACH ROW EXECUTE PROCEDURE check_claim_payment_rent_payment_owner();

CREATE INDEX idx_claim_payments_user_id ON claim_payments(user_id);
CREATE INDEX idx_claim_payments_claim_id ON claim_payments(claim_id);
CREATE INDEX idx_claim_payments_rent_payment_id ON claim_payments(rent_payment_id);
CREATE INDEX idx_claim_payments_reversal_ref ON claim_payments(reversal_reference_id);

-- ----------------------------------------------------------------------------
-- 5. TABELLE: claim_payment_allocations (Detail-Aufteilung einer Zahlung)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claim_payment_allocations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT NOT NULL,
  claim_payment_id uuid REFERENCES claim_payments(id) ON DELETE RESTRICT NOT NULL,
  claim_id uuid REFERENCES claims(id) ON DELETE RESTRICT NOT NULL,
  claim_item_id uuid REFERENCES claim_items(id) ON DELETE RESTRICT, -- Nullable, da fees/interest oft keinen direkten Item-Bezug haben
  
  allocation_bucket text NOT NULL CHECK (allocation_bucket IN ('fees', 'interest', 'principal')),
  amount numeric(12,2) NOT NULL,
  
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_claim_allocations_user_id ON claim_payment_allocations(user_id);
CREATE INDEX idx_claim_allocations_payment_id ON claim_payment_allocations(claim_payment_id);
CREATE INDEX idx_claim_allocations_claim_id ON claim_payment_allocations(claim_id);
CREATE INDEX idx_claim_allocations_item_id ON claim_payment_allocations(claim_item_id);

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
  -- Hinweis: documents.sha256_hash hinzufügen, falls gewünscht. Hier wird es im event_metadata unter 'document_sha256' abgelegt.
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
-- 9. CLAIM_ACCESS_LINKS (Vorerst weggelassen / in Phase 2)
-- ----------------------------------------------------------------------------
-- Empfehlung: public access links erst implementieren, wenn das QR-Portal gebaut wird.
-- Falls implementiert, sollte access_token_hash statt Klartext-Token gespeichert werden.

-- ----------------------------------------------------------------------------
-- 10. VIEW: claim_totals_view (RLS-sicher)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW claim_totals_view 
WITH (security_invoker = true) -- Sorgt dafür, dass RLS beim Aufruf der View greift
AS
SELECT 
  c.id as claim_id,
  c.user_id,
  COALESCE(SUM(ci.open_amount), 0) as current_principal_open,
  c.accumulated_unpaid_fees,
  c.accumulated_unpaid_interest,
  
  CASE 
    WHEN c.interest_start_date IS NULL THEN 0
    ELSE GREATEST(0, (COALESCE(SUM(ci.open_amount), 0) * (c.interest_rate / 100.0) / 365.0) * (CURRENT_DATE - c.interest_start_date))
  END as live_interest_since_start,
  
  c.accumulated_unpaid_interest + CASE 
    WHEN c.interest_start_date IS NULL THEN 0
    ELSE GREATEST(0, (COALESCE(SUM(ci.open_amount), 0) * (c.interest_rate / 100.0) / 365.0) * (CURRENT_DATE - c.interest_start_date))
  END as total_interest_open,
  
  COALESCE(SUM(ci.open_amount), 0) + c.accumulated_unpaid_fees + c.accumulated_unpaid_interest + CASE 
    WHEN c.interest_start_date IS NULL THEN 0
    ELSE GREATEST(0, (COALESCE(SUM(ci.open_amount), 0) * (c.interest_rate / 100.0) / 365.0) * (CURRENT_DATE - c.interest_start_date))
  END as total_due

FROM claims c
LEFT JOIN claim_items ci ON ci.claim_id = c.id
GROUP BY c.id;

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

-- Blockiert physisches Löschen (DELETE) für alle Tabellen global per Trigger (Safeguard!)
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
CREATE POLICY "Update claims" ON claims FOR UPDATE USING (auth.uid() = user_id);
-- KEINE Delete Policy

-- RLS: claim_items
CREATE POLICY "Select claim_items" ON claim_items FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Insert claim_items" ON claim_items FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Update claim_items" ON claim_items FOR UPDATE USING (auth.uid() = user_id);

-- RLS: claim_payments
CREATE POLICY "Select claim_payments" ON claim_payments FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Insert claim_payments" ON claim_payments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Update claim_payments" ON claim_payments FOR UPDATE USING (auth.uid() = user_id);

-- RLS: claim_payment_allocations
CREATE POLICY "Select claim_payment_allocations" ON claim_payment_allocations FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Insert claim_payment_allocations" ON claim_payment_allocations FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Update claim_payment_allocations" ON claim_payment_allocations FOR UPDATE USING (auth.uid() = user_id);

-- RLS: payment_plans
CREATE POLICY "Select payment_plans" ON payment_plans FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Insert payment_plans" ON payment_plans FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Update payment_plans" ON payment_plans FOR UPDATE USING (auth.uid() = user_id);

-- RLS: payment_plan_installments
CREATE POLICY "Select installments" ON payment_plan_installments FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Insert installments" ON payment_plan_installments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Update installments" ON payment_plan_installments FOR UPDATE USING (auth.uid() = user_id);

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
-- ENDE DER MIGRATION V2
-- ----------------------------------------------------------------------------
