-- Create documents table for metadata
CREATE TABLE IF NOT EXISTS documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  category TEXT,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime_type TEXT,
  related_type TEXT,
  related_id UUID
);

-- RLS for documents table
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own documents" ON documents
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own documents" ON documents
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own documents" ON documents
  FOR DELETE USING (auth.uid() = user_id);

-- Storage Policies for 'documents' bucket
-- Ensure RLS is enabled on objects (usually is by default, but good to check)
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Allow uploads to 'documents' bucket if path starts with user_id
CREATE POLICY "Users can upload specific folder" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'documents' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow viewing own files
CREATE POLICY "Users can view specific folder" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'documents' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow updates (e.g. overwriting)
CREATE POLICY "Users can update specific folder" ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'documents' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow deletes
CREATE POLICY "Users can delete specific folder" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'documents' AND
  (storage.foldername(name))[1] = auth.uid()::text
);
