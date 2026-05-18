-- ============================================================
-- OBJEKTKALENDER MODULE
-- Tables: objektkalender_settings, objektkalender_events, objektkalender_history
-- ============================================================

-- ── Settings ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS objektkalender_settings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,

    -- Reinigung
    cleaning_active BOOLEAN DEFAULT false,
    cleaning_performer TEXT DEFAULT 'tenant' CHECK (cleaning_performer IN ('tenant', 'janitor')),
    cleaning_frequency TEXT DEFAULT 'monthly' CHECK (cleaning_frequency IN ('monthly', 'bimonthly', 'weekly4', 'weekly')),
    cleaning_weekday INT DEFAULT 1 CHECK (cleaning_weekday BETWEEN 0 AND 6), -- 0=Sun, 1=Mon...6=Sat

    -- Müll
    waste_active BOOLEAN DEFAULT false,
    waste_performer TEXT DEFAULT 'tenant' CHECK (waste_performer IN ('tenant', 'janitor')),

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE(user_id, property_id)
);

-- ── Events ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS objektkalender_events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,

    event_type TEXT NOT NULL CHECK (event_type IN ('cleaning', 'waste', 'custom')),
    title TEXT NOT NULL,
    color TEXT DEFAULT '#3b82f6',

    -- Schedule
    event_date DATE NOT NULL,
    recurring BOOLEAN DEFAULT false,
    recurrence_rule TEXT, -- e.g. 'weekly', 'biweekly', 'monthly', etc.
    recurring_end_date DATE,

    -- Assignment
    assigned_unit_id UUID REFERENCES units(id) ON DELETE SET NULL,
    assigned_unit_name TEXT,

    -- Waste specific
    waste_type TEXT CHECK (waste_type IN ('restmuell', 'bio', 'papier', 'gelbe_tonne', 'sonstiger') OR waste_type IS NULL),

    -- Status
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'overdue')),
    completed_at TIMESTAMPTZ,
    completed_by UUID REFERENCES auth.users(id),

    -- Push
    push_enabled BOOLEAN DEFAULT true,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── History ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS objektkalender_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    event_id UUID REFERENCES objektkalender_events(id) ON DELETE SET NULL,

    event_type TEXT NOT NULL,
    title TEXT NOT NULL,
    event_date DATE NOT NULL,
    assigned_unit_name TEXT,
    status TEXT NOT NULL, -- 'done', 'overdue', 'skipped'
    completed_at TIMESTAMPTZ,
    completed_by UUID,

    created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Indexes ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ok_events_user_property ON objektkalender_events(user_id, property_id);
CREATE INDEX IF NOT EXISTS idx_ok_events_date ON objektkalender_events(event_date);
CREATE INDEX IF NOT EXISTS idx_ok_events_type ON objektkalender_events(event_type);
CREATE INDEX IF NOT EXISTS idx_ok_history_user_property ON objektkalender_history(user_id, property_id);
CREATE INDEX IF NOT EXISTS idx_ok_settings_user ON objektkalender_settings(user_id);

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE objektkalender_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE objektkalender_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE objektkalender_history ENABLE ROW LEVEL SECURITY;

-- Settings RLS
CREATE POLICY "ok_users_own_settings" ON objektkalender_settings
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Events RLS
CREATE POLICY "ok_users_own_events" ON objektkalender_events
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- History RLS
CREATE POLICY "ok_users_own_history" ON objektkalender_history
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
