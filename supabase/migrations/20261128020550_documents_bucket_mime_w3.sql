-- =============================================================================
-- Welle 3 · Paket 09 TENANT-MGMT · Stufe 2 (D4-07) – NICHT automatisch einspielen
--
-- Bucket "documents": nur noch die Dateitypen, die die App hochlädt
-- (FILE_RULES.documents in src/lib/storageFiles.js: PDF, JPG/PNG/GIF/WEBP, DOC/DOCX, XLS/XLSX).
--
-- VORAUSSETZUNG: Die App-Version mit dem neuen Upload in TenantDetail.jsx (Content-Type aus
-- der Dateiendung über prepareUploadBody statt file.type) ist live. Die heute ausgelieferte
-- App sendet in der Mieterakte den Browser-Typ unverändert; Browser melden für Office-Dateien
-- teils '' bzw. application/octet-stream (live liegt bereits ein solches Objekt im Bucket).
-- Mit dieser Liste würde der alte Upload für solche Dateien abgelehnt.
-- Documents.jsx nutzt prepareUploadBody schon heute. Andere Schreiber des Buckets gibt es
-- nicht (src und supabase/functions geprüft). Bestehende Objekte sind nicht betroffen.
-- Idempotent.
-- =============================================================================
update storage.buckets
   set allowed_mime_types = array[
       'application/pdf',
       'image/jpeg',
       'image/png',
       'image/gif',
       'image/webp',
       'application/msword',
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
       'application/vnd.ms-excel',
       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
   ]
 where id = 'documents';
