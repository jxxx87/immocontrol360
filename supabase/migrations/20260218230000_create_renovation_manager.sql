-- ============================================================
-- Migration: Sanierungsmanager – Komplettschema
-- Datum: 2026-02-18
-- Zweck: Tabellen für Sanierungsprojekte, Gewerke, Meilensteine,
--         Rechnungen, Aufgaben – konsistent mit bestehender Struktur
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. GEWERKE-TEMPLATES (Einstellungen → wiederverwendbar)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS renovation_trades (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS renovation_subtrades (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    trade_id UUID NOT NULL REFERENCES renovation_trades(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- 2. MEILENSTEIN-TEMPLATES (Einstellungen)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS renovation_milestone_templates (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    is_completion_trigger BOOLEAN DEFAULT FALSE, -- "Abgenommen" setzt Status=fertig
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- 3. PROJEKTE
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS renovation_projects (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    unit_id UUID REFERENCES units(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned', 'active', 'completed', 'archived')),
    target_end_date DATE,
    budget_buffer_percent NUMERIC DEFAULT 10,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- 4. GEWERKE PRO PROJEKT (Ebene 1)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS renovation_project_trades (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES renovation_projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    start_date DATE,
    end_date DATE,
    depends_on UUID REFERENCES renovation_project_trades(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'in_progress', 'completed')),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- 5. UNTERGEWERKE PRO PROJEKT (Ebene 2)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS renovation_project_subtrades (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    project_trade_id UUID NOT NULL REFERENCES renovation_project_trades(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES renovation_projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    budget_soll NUMERIC DEFAULT 0,
    quantity NUMERIC, -- Menge (m², Stück etc.) – aus Sanierungsrechner
    unit_label TEXT,  -- Einheit (m², Stück, pauschal)
    responsible_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- 6. MEILENSTEINE PRO GEWERK (Ebene 1)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS renovation_milestones (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    project_trade_id UUID NOT NULL REFERENCES renovation_project_trades(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    is_completed BOOLEAN DEFAULT FALSE,
    is_completion_trigger BOOLEAN DEFAULT FALSE, -- "Abgenommen" → setzt trade status=completed
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- 7. RECHNUNGEN PRO UNTERGEWERK
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS renovation_invoices (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    project_subtrade_id UUID NOT NULL REFERENCES renovation_project_subtrades(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES renovation_projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    amount NUMERIC NOT NULL DEFAULT 0,
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- 8. AUFGABEN (Zentrale Aufgaben, erweitert für Sanierung)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS renovation_tasks (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES renovation_projects(id) ON DELETE CASCADE,
    project_trade_id UUID REFERENCES renovation_project_trades(id) ON DELETE SET NULL,
    property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    is_completed BOOLEAN DEFAULT FALSE,
    due_date DATE,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- 9. updated_at TRIGGER
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'renovation_projects',
        'renovation_project_trades',
        'renovation_project_subtrades',
        'renovation_invoices',
        'renovation_tasks'
    ] LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS set_updated_at ON %I; CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();',
            t, t
        );
    END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────
-- 10. ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────

-- Enable RLS on all tables
ALTER TABLE renovation_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE renovation_subtrades ENABLE ROW LEVEL SECURITY;
ALTER TABLE renovation_milestone_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE renovation_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE renovation_project_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE renovation_project_subtrades ENABLE ROW LEVEL SECURITY;
ALTER TABLE renovation_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE renovation_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE renovation_tasks ENABLE ROW LEVEL SECURITY;

-- Policies: user can only see/edit own data
CREATE POLICY "Users manage own renovation_trades"
    ON renovation_trades FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own renovation_subtrades"
    ON renovation_subtrades FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own renovation_milestone_templates"
    ON renovation_milestone_templates FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own renovation_projects"
    ON renovation_projects FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own renovation_project_trades"
    ON renovation_project_trades FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own renovation_project_subtrades"
    ON renovation_project_subtrades FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own renovation_milestones"
    ON renovation_milestones FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own renovation_invoices"
    ON renovation_invoices FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own renovation_tasks"
    ON renovation_tasks FOR ALL USING (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────
-- 11. DEFAULT GEWERKE & MEILENSTEINE (Seeds)
-- ────────────────────────────────────────────────────────────
-- Diese werden per Frontend beim ersten Zugriff eingefügt,
-- damit sie dem user_id zugeordnet werden können.
-- Hier nur Kommentar als Referenz:
--
-- Standard-Gewerke:
-- 1. Rückbau & Entsorgung
-- 2. Rohbau & Mauerwerk
-- 3. Elektroinstallation
-- 4. Sanitärinstallation
-- 5. Heizung / Klima
-- 6. Trockenbau
-- 7. Estrich & Bodenbelag
-- 8. Fliesen
-- 9. Malerarbeiten
-- 10. Fenster & Türen
-- 11. Außenanlagen
-- 12. Küche & Einbaumöbel
--
-- Standard-Meilensteine:
-- 1. Beauftragt
-- 2. In Arbeit
-- 3. Fertig
-- 4. Abgenommen (is_completion_trigger = true)

-- ────────────────────────────────────────────────────────────
-- 12. INDEXES
-- ────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_renovation_projects_user ON renovation_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_renovation_projects_property ON renovation_projects(property_id);
CREATE INDEX IF NOT EXISTS idx_rpt_project ON renovation_project_trades(project_id);
CREATE INDEX IF NOT EXISTS idx_rps_trade ON renovation_project_subtrades(project_trade_id);
CREATE INDEX IF NOT EXISTS idx_ri_subtrade ON renovation_invoices(project_subtrade_id);
CREATE INDEX IF NOT EXISTS idx_ri_project ON renovation_invoices(project_id);
CREATE INDEX IF NOT EXISTS idx_rt_project ON renovation_tasks(project_id);

-- ────────────────────────────────────────────────────────────
-- KOMMENTARE
-- ────────────────────────────────────────────────────────────

COMMENT ON TABLE renovation_trades IS 'Benutzer-eigene Gewerke-Templates (Einstellungen)';
COMMENT ON TABLE renovation_subtrades IS 'Benutzer-eigene Untergewerke-Templates';
COMMENT ON TABLE renovation_milestone_templates IS 'Benutzer-eigene Meilenstein-Templates';
COMMENT ON TABLE renovation_projects IS 'Sanierungsprojekte – mehrere pro Immobilie möglich';
COMMENT ON TABLE renovation_project_trades IS 'Gewerke (Ebene 1) innerhalb eines Projekts';
COMMENT ON TABLE renovation_project_subtrades IS 'Untergewerke (Ebene 2) mit eigenem Budget & Rechnungen';
COMMENT ON TABLE renovation_milestones IS 'Meilensteine pro Gewerk – frei abhackbar';
COMMENT ON TABLE renovation_invoices IS 'Rechnungen pro Untergewerk';
COMMENT ON TABLE renovation_tasks IS 'Projektbezogene Aufgaben – optional Gewerk-bezogen';
