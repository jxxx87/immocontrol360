-- ============================================================================
-- SQL MIGRATION PROPOSAL: FORDERUNGSMANAGEMENT (CLAIMS)
-- WICHTIG: Dies ist ein Entwurf. Noch nicht live ausführen!
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. HILFSFUNKTIONEN (UPDATED_AT & SICHERHEITS-TRIGGER)
-- ----------------------------------------------------------------------------

-- Standard updated_at Trigger-Funktion (falls nicht schon im System vorhanden)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Sicherheits-Trigger für claim_items -> rent_ledger
CREATE OR REPLACE FUNCTION check_claim_item_rent_ledger_owner()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.rent_ledger_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM rent_ledger WHERE id = NEW.rent_ledger_id AND user_id = NEW.user_id) THEN
      RAISE EXCEPTION 'rent_ledger_id does not belong to the user.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Sicherheits-Trigger für claim_payments -> rent_payments
CREATE OR REPLACE FUNCTION check_claim_payment_rent_payment_owner()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.rent_payment_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM rent_payments WHERE id = NEW.rent_payment_id AND user_id = NEW.user_id) THEN
      RAISE EXCEPTION 'rent_payment_id does not belong to the user.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Sicherheits-Trigger für claim_events -> documents
CREATE OR REPLACE FUNCTION check_claim_event_document_owner()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.document_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM documents WHERE id = NEW.document_id AND user_id = NEW.user_id) THEN
      RAISE EXCEPTION 'document_id does not belong to the user.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- 2. TABELLE: claims (Die Forderungsakte)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claims (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  lease_id uuid REFERENCES leases(id) ON DELETE CASCADE NOT NULL,
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE, -- Optional CASCADE, je nach Stammdaten-Architektur
  
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

CREATE TRIGGER handle_claims_updated_at BEFORE UPDATE ON claims FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. TABELLE: claim_items (Die einzelnen Forderungspositionen)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claim_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  claim_id uuid REFERENCES claims(id) ON DELETE CASCADE NOT NULL,
  rent_ledger_id uuid REFERENCES rent_ledger(id) ON DELETE SET NULL, -- SET NULL, falls rent_ledger gelöscht wird, item bleibt als Historie
  
  item_type text NOT NULL DEFAULT 'rent' CHECK (item_type IN ('rent', 'utility_backpay', 'damage', 'deposit', 'other')),
  
  original_amount numeric(12,2) NOT NULL CHECK (original_amount >= 0),
  paid_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  open_amount numeric(12,2) NOT NULL CHECK (open_amount >= 0),
  
  description text,
  period_month date,
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  -- Sicherstellen, dass open = original - paid
  CONSTRAINT chk_open_amount_calc CHECK (open_amount = original_amount - paid_amount)
);

CREATE TRIGGER handle_claim_items_updated_at BEFORE UPDATE ON claim_items FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
CREATE TRIGGER trigger_check_claim_item_rent_ledger BEFORE INSERT OR UPDATE ON claim_items FOR EACH ROW EXECUTE PROCEDURE check_claim_item_rent_ledger_owner();

-- ----------------------------------------------------------------------------
-- 4. TABELLE: claim_payments (Zahlungsverteilung)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claim_payments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  claim_id uuid REFERENCES claims(id) ON DELETE CASCADE NOT NULL,
  rent_payment_id uuid REFERENCES rent_payments(id) ON DELETE SET NULL,
  
  payment_date date NOT NULL,
  amount numeric(12,2) NOT NULL,
  
  allocated_to_fees numeric(12,2) NOT NULL DEFAULT 0,
  allocated_to_interest numeric(12,2) NOT NULL DEFAULT 0,
  allocated_to_principal numeric(12,2) NOT NULL DEFAULT 0,
  
  allocation_type text NOT NULL DEFAULT 'automatic' CHECK (allocation_type IN ('automatic', 'manual', 'debtor_designated', 'reversal')),
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'reversed', 'cancelled')),
  
  -- Reversal
  reversal_reference_id uuid REFERENCES claim_payments(id),
  reversed_at timestamptz,
  reversed_by uuid REFERENCES auth.users(id),
  reversal_reason text,
  
  note text,
  created_at timestamptz DEFAULT now(),

  -- amount kann auch negativ sein bei reversals, allocation Summen müssen amount ergeben
  CONSTRAINT chk_allocation_sum CHECK (allocated_to_fees + allocated_to_interest + allocated_to_principal = amount)
);

CREATE TRIGGER trigger_check_claim_payment_rent_payment BEFORE INSERT OR UPDATE ON claim_payments FOR EACH ROW EXECUTE PROCEDURE check_claim_payment_rent_payment_owner();

-- ----------------------------------------------------------------------------
-- 5. TABELLE: claim_events (Das Immutable Audit Log)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claim_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  claim_id uuid REFERENCES claims(id) ON DELETE CASCADE NOT NULL,
  
  event_type text NOT NULL CHECK (event_type IN ('created', 'status_changed', 'dunning_sent', 'deadline_set', 'deadline_expired', 'tenant_contacted', 'payment_received', 'payment_reversed', 'payment_plan_requested', 'payment_plan_accepted', 'payment_plan_failed', 'escalated', 'cancelled', 'archived', 'note_added', 'closed')),
  event_date timestamptz NOT NULL DEFAULT now(),
  description text,
  
  document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  event_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  
  created_at timestamptz DEFAULT now()
);

CREATE TRIGGER trigger_check_claim_event_document BEFORE INSERT OR UPDATE ON claim_events FOR EACH ROW EXECUTE PROCEDURE check_claim_event_document_owner();

-- ----------------------------------------------------------------------------
-- 6. TABELLE: payment_plans (Ratenzahlungsvereinbarungen)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_plans (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  claim_id uuid REFERENCES claims(id) ON DELETE CASCADE NOT NULL,
  
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

CREATE TRIGGER handle_payment_plans_updated_at BEFORE UPDATE ON payment_plans FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- ----------------------------------------------------------------------------
-- 7. TABELLE: payment_plan_installments (Die einzelnen Raten)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_plan_installments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  payment_plan_id uuid REFERENCES payment_plans(id) ON DELETE CASCADE NOT NULL,
  
  due_date date NOT NULL,
  amount numeric(12,2) NOT NULL,
  paid_amount numeric(12,2) NOT NULL DEFAULT 0,
  open_amount numeric(12,2) NOT NULL,
  
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'partial', 'overdue', 'cancelled')),
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  CONSTRAINT chk_installment_open_calc CHECK (open_amount = amount - paid_amount)
);

CREATE TRIGGER handle_payment_plan_installments_updated_at BEFORE UPDATE ON payment_plan_installments FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- ----------------------------------------------------------------------------
-- 8. TABELLE: claim_access_links (Optional, für Portal/QR-Code vorbereitet)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claim_access_links (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  claim_id uuid REFERENCES claims(id) ON DELETE CASCADE NOT NULL,
  
  access_token text NOT NULL UNIQUE,
  pin_hash text NOT NULL,
  
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 9. VIEW: claim_totals_view
-- (Single Source of Truth für aktuelle, berechnete Forderungssummen)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW claim_totals_view AS
SELECT 
  c.id as claim_id,
  c.user_id,
  -- current_principal_open: Summe aller offenen Positionen
  COALESCE(SUM(ci.open_amount), 0) as current_principal_open,
  
  c.accumulated_unpaid_fees,
  c.accumulated_unpaid_interest,
  
  -- live_interest_since_start: Zinsberechnung auf den Principal seit dem start_date
  CASE 
    WHEN c.interest_start_date IS NULL THEN 0
    ELSE GREATEST(0, (COALESCE(SUM(ci.open_amount), 0) * (c.interest_rate / 100.0) / 365.0) * (CURRENT_DATE - c.interest_start_date))
  END as live_interest_since_start,
  
  -- total_interest_open: Aufgelaufene unbezahlte + Live Zinsen
  c.accumulated_unpaid_interest + CASE 
    WHEN c.interest_start_date IS NULL THEN 0
    ELSE GREATEST(0, (COALESCE(SUM(ci.open_amount), 0) * (c.interest_rate / 100.0) / 365.0) * (CURRENT_DATE - c.interest_start_date))
  END as total_interest_open,
  
  -- total_due: Principal + Gebühren + Komplettzinsen
  COALESCE(SUM(ci.open_amount), 0) + c.accumulated_unpaid_fees + c.accumulated_unpaid_interest + CASE 
    WHEN c.interest_start_date IS NULL THEN 0
    ELSE GREATEST(0, (COALESCE(SUM(ci.open_amount), 0) * (c.interest_rate / 100.0) / 365.0) * (CURRENT_DATE - c.interest_start_date))
  END as total_due

FROM claims c
LEFT JOIN claim_items ci ON ci.claim_id = c.id
GROUP BY c.id;

-- ----------------------------------------------------------------------------
-- 10. RPC: update_overdue_claims_status
-- (Automatische Statusaktualisierung beim Öffnen des Moduls, ohne Cron)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_overdue_claims_status()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  claim_record RECORD;
BEGIN
  -- Iteriere nur über offene, fällige Forderungen des aufrufenden Users
  FOR claim_record IN 
    SELECT id FROM claims 
    WHERE user_id = auth.uid() 
      AND status IN ('sent', 'open') 
      AND deadline < CURRENT_DATE
  LOOP
    -- 1. Status auf 'action_required' setzen
    UPDATE claims SET status = 'action_required' WHERE id = claim_record.id;
    
    -- 2. Audit-Log Eintrag erzeugen
    INSERT INTO claim_events (user_id, claim_id, event_type, description, event_metadata)
    VALUES (
      auth.uid(), 
      claim_record.id, 
      'deadline_expired', 
      'Die gesetzte Frist ist abgelaufen. Status wurde automatisch auf Aktion erforderlich gesetzt.', 
      '{"old_status": "sent", "new_status": "action_required"}'::jsonb
    );
  END LOOP;
END;
$$;

-- ----------------------------------------------------------------------------
-- 11. ROW LEVEL SECURITY (RLS)
-- ----------------------------------------------------------------------------
ALTER TABLE claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_plan_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_access_links ENABLE ROW LEVEL SECURITY;

-- Einfache, schnelle RLS für produktive Tabellen
CREATE POLICY "Users can manage own claims" ON claims FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can manage own claim_items" ON claim_items FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can manage own claim_payments" ON claim_payments FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can manage own payment_plans" ON payment_plans FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can manage own installments" ON payment_plan_installments FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can manage own access_links" ON claim_access_links FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Immutable RLS für claim_events (Nur SELECT & INSERT)
CREATE POLICY "Users can view own claim_events" ON claim_events FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own claim_events" ON claim_events FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Block update on claim_events" ON claim_events FOR UPDATE USING (false);
CREATE POLICY "Block delete on claim_events" ON claim_events FOR DELETE USING (false);

-- Zusätzlich: Trigger, um UPDATE/DELETE auf DB-Ebene hart zu blockieren (Backup für Service-Role-Queries)
CREATE OR REPLACE FUNCTION block_claim_events_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'claim_events is an immutable audit log. Updates and deletes are strictly forbidden.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_block_claim_events_update BEFORE UPDATE ON claim_events FOR EACH ROW EXECUTE PROCEDURE block_claim_events_modification();
CREATE TRIGGER trigger_block_claim_events_delete BEFORE DELETE ON claim_events FOR EACH ROW EXECUTE PROCEDURE block_claim_events_modification();

-- ----------------------------------------------------------------------------
-- ENDE DER MIGRATION
-- ----------------------------------------------------------------------------
