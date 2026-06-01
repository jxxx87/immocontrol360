const { Client } = require('pg');
require('dotenv').config();

async function run() {
    const password = process.env.SUPABASE_DB_PASSWORD || "mYxTGLyU7yLIY7n8";
    const connectionString = `postgresql://postgres.agsmqvvwfufenaiekuox:${password}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres`;
    const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
    
    try {
        await client.connect();
        
        console.log("Creating storage bucket and policies...");
        await client.query(`
            -- Create applicant-documents bucket
            INSERT INTO storage.buckets (id, name, public)
            VALUES ('applicant-documents', 'applicant-documents', true)
            ON CONFLICT (id) DO NOTHING;

            -- RLS policies for storage bucket
            -- Drop existing if they exist to avoid conflict
            DROP POLICY IF EXISTS "Allow public uploads to applicant-documents" ON storage.objects;
            DROP POLICY IF EXISTS "Allow public read to applicant-documents" ON storage.objects;
            DROP POLICY IF EXISTS "Allow system/landlord delete from applicant-documents" ON storage.objects;

            CREATE POLICY "Allow public uploads to applicant-documents"
            ON storage.objects FOR INSERT
            TO anon, authenticated
            WITH CHECK (bucket_id = 'applicant-documents');

            CREATE POLICY "Allow public read to applicant-documents"
            ON storage.objects FOR SELECT
            TO anon, authenticated
            USING (bucket_id = 'applicant-documents');

            CREATE POLICY "Allow system/landlord delete from applicant-documents"
            ON storage.objects FOR DELETE
            TO anon, authenticated
            USING (bucket_id = 'applicant-documents');
        `);
        console.log("Storage bucket and policies created successfully!");
        
    } catch (e) {
        console.error("Failed to execute SQL:", e.message);
    } finally {
        await client.end();
    }
}
run();
