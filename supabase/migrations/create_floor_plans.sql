-- ─── floor_plans table ───────────────────────────────────────────
-- Run this in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS floor_plans (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name text NOT NULL DEFAULT 'Grundriss',
    property_id uuid REFERENCES properties(id) ON DELETE SET NULL,
    unit_id uuid REFERENCES units(id) ON DELETE SET NULL,
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'completed')),
    plan_data jsonb NOT NULL DEFAULT '[]'::jsonb,
    version_history jsonb DEFAULT '[]'::jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE floor_plans ENABLE ROW LEVEL SECURITY;

-- Users can only access their own floor plans
CREATE POLICY "Users can view their own floor plans"
    ON floor_plans FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own floor plans"
    ON floor_plans FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own floor plans"
    ON floor_plans FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own floor plans"
    ON floor_plans FOR DELETE
    USING (auth.uid() = user_id);

-- Index for faster user queries
CREATE INDEX idx_floor_plans_user_id ON floor_plans(user_id);
CREATE INDEX idx_floor_plans_property_id ON floor_plans(property_id);
