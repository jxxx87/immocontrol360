\set ON_ERROR_STOP on
-- ARCHIV (historisch) – NICHT AUSFÜHREN. Ursprung: immo-web/scripts/create_utility_settlements.sql. Siehe immo-web/archive/sql/README.md.
DO $$ BEGIN RAISE EXCEPTION 'Archivdatei - nicht ausfuehren (siehe immo-web/archive/sql/README.md)'; END $$;
-- Maßgeblich für utility_settlements: supabase/baseline/baseline_public.sql (Live-Stand vom 27.11.2026). Diese Datei ist überholt.
-- Create utility_settlements table for Nebenkostenabrechnungen
CREATE TABLE IF NOT EXISTS public.utility_settlements (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    property_id uuid REFERENCES public.properties(id) ON DELETE CASCADE,
    period_start date NOT NULL,
    period_end date NOT NULL,
    status text DEFAULT 'draft',
    data jsonb DEFAULT '{}'::jsonb,
    year integer,
    created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.utility_settlements ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only access their own settlements
CREATE POLICY "Users can view own settlements" ON public.utility_settlements
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own settlements" ON public.utility_settlements
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own settlements" ON public.utility_settlements
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own settlements" ON public.utility_settlements
    FOR DELETE USING (auth.uid() = user_id);
