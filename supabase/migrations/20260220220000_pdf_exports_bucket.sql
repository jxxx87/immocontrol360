-- =====================================================
-- PDF Exports Infrastructure
-- Storage bucket for temporary report files (HTML/PDF)
-- Generated reports are stored temporarily and accessed
-- via signed URLs (1h expiry).
-- =====================================================

-- 1. Create private storage bucket for exports
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'exports',
    'exports',
    false,                          -- Private: nur via signed URL zugänglich
    10485760,                       -- 10 MB max
    ARRAY['text/html', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- 2. Service role can upload/manage exports (Edge Function)
CREATE POLICY "Service role full access on exports"
    ON storage.objects FOR ALL
    USING (bucket_id = 'exports' AND auth.role() = 'service_role')
    WITH CHECK (bucket_id = 'exports' AND auth.role() = 'service_role');

-- 3. Authenticated users can read their own exports (path: {user_id}/...)
CREATE POLICY "Users can read own exports"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'exports'
        AND auth.role() = 'authenticated'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- 4. Authenticated users can delete their own exports
CREATE POLICY "Users can delete own exports"
    ON storage.objects FOR DELETE
    USING (
        bucket_id = 'exports'
        AND auth.role() = 'authenticated'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- 5. Add service_role policy to pdf_templates for Edge Function access
CREATE POLICY "Service role full access on pdf_templates"
    ON public.pdf_templates FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
