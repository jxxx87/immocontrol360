-- PDF Template Table (one per portfolio)
CREATE TABLE IF NOT EXISTS public.pdf_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    portfolio_id UUID NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    margin_mm INTEGER NOT NULL DEFAULT 15,
    header_height_mm INTEGER NOT NULL DEFAULT 50,
    footer_height_mm INTEGER NOT NULL DEFAULT 20,
    accent_color TEXT DEFAULT '#0ea5e9',
    elements JSONB DEFAULT '[]'::jsonb,
    orientation_by_report_type JSONB DEFAULT '{}'::jsonb,
    elements_by_report_orientation JSONB DEFAULT '{}'::jsonb,
    subtitles_by_report_type JSONB DEFAULT '{}'::jsonb,
    logo_url TEXT,
    updated_at TIMESTAMPTZ DEFAULT now(),
    updated_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(portfolio_id)
);

-- RLS Policies
ALTER TABLE public.pdf_templates ENABLE ROW LEVEL SECURITY;

-- Any authenticated user in the same team can read/write
-- (simplified: same user or same portfolio access)
CREATE POLICY "Users can manage pdf_templates for their portfolios"
    ON public.pdf_templates
    FOR ALL
    USING (
        portfolio_id IN (
            SELECT id FROM public.portfolios WHERE user_id = auth.uid()
        )
        OR user_id = auth.uid()
    )
    WITH CHECK (
        portfolio_id IN (
            SELECT id FROM public.portfolios WHERE user_id = auth.uid()
        )
        OR user_id = auth.uid()
    );

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_pdf_templates_portfolio ON public.pdf_templates(portfolio_id);

-- Storage bucket for PDF assets (logos)
INSERT INTO storage.buckets (id, name, public)
VALUES ('pdf-assets', 'pdf-assets', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "Anyone can read pdf-assets"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'pdf-assets');

CREATE POLICY "Authenticated users can upload pdf-assets"
    ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'pdf-assets' AND auth.role() = 'authenticated');

CREATE POLICY "Users can update their pdf-assets"
    ON storage.objects FOR UPDATE
    USING (bucket_id = 'pdf-assets' AND auth.role() = 'authenticated');
