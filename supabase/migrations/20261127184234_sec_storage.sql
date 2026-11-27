-- =============================================================================
-- SEC-STORAGE (Komplett-Check 2026-11-27) – Storage-Policies und Bucket-Einstellungen
--
-- Befunde:
--   G05-01 / G22-02  Bucket documents: jedes angemeldete Konto darf alles lesen und
--                    überall hochladen (auth_read_documents / auth_insert_documents).
--   G05-03           Löschen im Bucket documents wirkungslos (DELETE nur im Ordner
--                    <uid>/, die Dateien liegen aber unter <property_id>/).
--   G23-02 / G22-03  Buckets chat-attachments, tickets, announcements: Lesen und
--                    Hochladen für jedes angemeldete Konto ohne Pfad-/Mandantenbezug.
--   G23-22           announcements/tickets: keine DELETE-Policy (Dateien bleiben liegen).
--   G22-11 / G23-08  Buckets ohne Größen-/Typ-Grenzen.
--   (4.3)            pdf-assets: jedes Konto darf fremde Logos überschreiben (UPDATE ohne
--                    Bedingung) und überall hochladen; anon darf alle Logos auflisten.
--   (4.3)            tenant-documents (unbenutzt): bucketweit lesbar/beschreibbar.
--   M1-24 (teilw.)   Buckets in keiner Migration angelegt -> hier idempotent angelegt.
-- NICHT enthalten: Bucket applicant-documents (Paket SEC-LETTING).
--
-- Voraussetzungen:
--   * Fundament 20261127100000_sec_access_helpers.sql (has_property_access /
--     has_portfolio_access / has_tenant_access mit Kategorie und read/write).
--   * SEC-ROLES: user_roles nicht mehr selbst vergebbar (die Mieter-Regeln unten
--     vertrauen user_roles genauso wie die Tabellen-Policies tenants_read_*).
--
-- Pfad-Konventionen (aus dem Upload-Code, Bestand live am 27.11. geprüft):
--   documents        <property_id>/general/<datei>              Objekt allgemein
--                    <property_id>/tenant/<tenant_id>/<datei>    persönlich (Documents.jsx, TenantDetail.jsx)
--                    <user_id>/<datei>                           Altbestand (eigener Ordner)
--   tickets          <property_id>/<unit_id>/<uploader_uid>/<datei>  neu (TenantTickets.jsx)
--                    <property_id>/<unit_id>/<datei>                 Altbestand
--   announcements    <property_id>/<datei>
--   chat-attachments <sender_uid>/<datei>
--   pdf-assets       logos/<portfolio_id>/<datei>               (öffentlicher Bucket, Logos)
--   tenant-documents (unbenutzt) -> nur eigener Ordner <uid>/...
--
-- Kategorien (RULES 3): documents -> immobilien; tickets/announcements -> mieterportal;
-- pdf-assets -> lesen '*', schreiben nur Portfolio-Eigentümer.
-- Alle neuen Policies: to authenticated. Bucketweite Regeln werden durch pfadgebundene
-- ersetzt (nicht ersatzlos entfernt); bestehende Dateien bleiben für ihre Eigentümer lesbar.
-- Idempotent (drop policy if exists / create or replace).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Hilfsfunktion: Pfadsegment -> uuid, NULL wenn kein uuid-Format. Verhindert, dass
-- eine Policy an einem Cast-Fehler scheitert (z. B. Segment 'logos' oder 'general').
-- -----------------------------------------------------------------------------
create or replace function public.storage_segment_uuid(p_segment text)
returns uuid
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select case
    when p_segment ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then p_segment::uuid
  end
$$;

comment on function public.storage_segment_uuid(text) is
  'SEC-STORAGE: wandelt ein Storage-Pfadsegment in uuid um (NULL bei ungültigem Format).';

-- =============================================================================
-- Bucket documents
-- =============================================================================
drop policy if exists "auth_read_documents flreew_0" on storage.objects;
drop policy if exists "auth_insert_documents flreew_0" on storage.objects;
drop policy if exists documents_read_own_folder on storage.objects;
drop policy if exists documents_insert_own_folder on storage.objects;
drop policy if exists documents_update_own_folder on storage.objects;
drop policy if exists documents_delete_own_folder on storage.objects;
drop policy if exists documents_read_access on storage.objects;
drop policy if exists documents_insert_access on storage.objects;
drop policy if exists documents_delete_access on storage.objects;

-- Altbestand: eigener Ordner <uid>/... (bisherige Regeln, jetzt nur für angemeldete)
create policy documents_read_own_folder on storage.objects
  for select to authenticated
  using (bucket_id = 'documents' and (storage.foldername(objects.name))[1] = (auth.uid())::text);

create policy documents_insert_own_folder on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documents' and (storage.foldername(objects.name))[1] = (auth.uid())::text);

create policy documents_update_own_folder on storage.objects
  for update to authenticated
  using (bucket_id = 'documents' and (storage.foldername(objects.name))[1] = (auth.uid())::text)
  with check (bucket_id = 'documents' and (storage.foldername(objects.name))[1] = (auth.uid())::text);

create policy documents_delete_own_folder on storage.objects
  for delete to authenticated
  using (bucket_id = 'documents' and (storage.foldername(objects.name))[1] = (auth.uid())::text);

-- Lesen: Vermieter/Mitnutzer über das Objekt (immobilien/read); Mieter nur
--   '<objekt>/general/...' des eigenen Objekts bzw. '<objekt>/tenant/<eigene tenant_id>/...'
--   UND nur, wenn ein für ihn sichtbarer documents-Datensatz auf genau diese Datei zeigt
--   (Sichtbarkeit folgt damit auch künftigen Einschränkungen der Tabellen-Policies).
create policy documents_read_access on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and (
      public.has_property_access(public.storage_segment_uuid((storage.foldername(objects.name))[1]), 'immobilien', 'read')
      or public.has_property_access(public.storage_segment_uuid((storage.foldername(objects.name))[1]), 'mieterportal', 'read')
      or (
        (storage.foldername(objects.name))[2] = 'general'
        and exists (
          select 1 from public.user_roles ur
          where ur.user_id = auth.uid()
            and ur.role = 'tenant'
            and ur.property_id::text = (storage.foldername(objects.name))[1])
        and exists (
          select 1 from public.documents d
          where (d.file_path = objects.name or d.storage_path = objects.name)
            and d.tenant_id is null
            and d.property_id::text = (storage.foldername(objects.name))[1])
      )
      or (
        (storage.foldername(objects.name))[2] = 'tenant'
        and exists (
          select 1 from public.user_roles ur
          where ur.user_id = auth.uid()
            and ur.role = 'tenant'
            and ur.tenant_id::text = (storage.foldername(objects.name))[3])
        and exists (
          select 1 from public.documents d
          where (d.file_path = objects.name or d.storage_path = objects.name)
            and d.tenant_id::text = (storage.foldername(objects.name))[3])
      )
    )
  );

-- Hochladen: Schreibrecht am Objekt (immobilien/write). Persönliche Dokumente nur für
-- Mieter, die der Hochladende sieht (verhindert Dokumente in fremde Mieterportale).
create policy documents_insert_access on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (public.has_property_access(public.storage_segment_uuid((storage.foldername(objects.name))[1]), 'immobilien', 'write')
         or public.has_property_access(public.storage_segment_uuid((storage.foldername(objects.name))[1]), 'mieterportal', 'write'))
    and (
      (storage.foldername(objects.name))[2] = 'general'
      or (
        (storage.foldername(objects.name))[2] = 'tenant'
        and public.has_tenant_access(public.storage_segment_uuid((storage.foldername(objects.name))[3]), '*', 'read')
      )
    )
  );

-- Löschen: Schreibrecht am Objekt (G05-03 – bisher löschte remove() nie etwas)
create policy documents_delete_access on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documents'
    and (public.has_property_access(public.storage_segment_uuid((storage.foldername(objects.name))[1]), 'immobilien', 'write')
         or public.has_property_access(public.storage_segment_uuid((storage.foldername(objects.name))[1]), 'mieterportal', 'write'))
  );

-- =============================================================================
-- Bucket tickets (Schadensfotos)
-- =============================================================================
drop policy if exists "Authenticated users can upload ticket images" on storage.objects;
drop policy if exists "Authenticated users can view ticket images" on storage.objects;
drop policy if exists auth_read_tickets on storage.objects;
drop policy if exists auth_upload_tickets on storage.objects;
drop policy if exists tickets_read_access on storage.objects;
drop policy if exists tickets_insert_access on storage.objects;
drop policy if exists tickets_delete_access on storage.objects;

-- Lesen: Vermieter/Mitnutzer über das Objekt (mieterportal/read); Mieter nur eigene Fotos
create policy tickets_read_access on storage.objects
  for select to authenticated
  using (
    bucket_id = 'tickets'
    and (
      public.has_property_access(public.storage_segment_uuid((storage.foldername(objects.name))[1]), 'mieterportal', 'read')
      or objects.owner_id = (auth.uid())::text
    )
  );

-- Hochladen: Mieter nur in den Ordner seines Objekts/seiner Einheit (neue Pfade mit
-- eigener user-id als 3. Segment; alte Pfadform ohne 3. Segment bleibt für ältere
-- App-Stände erlaubt), Vermieter/Mitnutzer mit Schreibrecht.
create policy tickets_insert_access on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'tickets'
    and (
      public.has_property_access(public.storage_segment_uuid((storage.foldername(objects.name))[1]), 'mieterportal', 'write')
      or (
        exists (
          select 1 from public.user_roles ur
          where ur.user_id = auth.uid()
            and ur.role = 'tenant'
            and ur.property_id::text = (storage.foldername(objects.name))[1]
            and ur.unit_id::text = (storage.foldername(objects.name))[2])
        and (
          coalesce(array_length(storage.foldername(objects.name), 1), 0) = 2
          or (
            coalesce(array_length(storage.foldername(objects.name), 1), 0) = 3
            and (storage.foldername(objects.name))[3] = (auth.uid())::text
          )
        )
      )
    )
  );

-- Löschen: Vermieter/Mitnutzer mit Schreibrecht (Ticket löschen entfernt die Fotos);
-- der Hochladende nur, solange das Foto noch zu keinem Ticket gehört (Rücknahme eines
-- fehlgeschlagenen Ticket-Anlegens) – Beweisfotos bestehender Tickets bleiben.
create policy tickets_delete_access on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'tickets'
    and (
      public.has_property_access(public.storage_segment_uuid((storage.foldername(objects.name))[1]), 'mieterportal', 'write')
      or (
        objects.owner_id = (auth.uid())::text
        and not exists (select 1 from public.tickets t where objects.name = any (t.images))
      )
    )
  );

-- =============================================================================
-- Bucket announcements (Aushang-Anhänge)
-- =============================================================================
drop policy if exists auth_read_announcements on storage.objects;
drop policy if exists auth_upload_announcements on storage.objects;
drop policy if exists announcements_read_access on storage.objects;
drop policy if exists announcements_insert_access on storage.objects;
drop policy if exists announcements_delete_access on storage.objects;

-- Lesen: Vermieter/Mitnutzer (mieterportal/read) und die Mieter des Objekts
create policy announcements_read_access on storage.objects
  for select to authenticated
  using (
    bucket_id = 'announcements'
    and (
      public.has_property_access(public.storage_segment_uuid((storage.foldername(objects.name))[1]), 'mieterportal', 'read')
      or exists (
        select 1 from public.user_roles ur
        where ur.user_id = auth.uid()
          and ur.role = 'tenant'
          and ur.property_id::text = (storage.foldername(objects.name))[1])
    )
  );

create policy announcements_insert_access on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'announcements'
    and public.has_property_access(public.storage_segment_uuid((storage.foldername(objects.name))[1]), 'mieterportal', 'write')
  );

create policy announcements_delete_access on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'announcements'
    and public.has_property_access(public.storage_segment_uuid((storage.foldername(objects.name))[1]), 'mieterportal', 'write')
  );

-- =============================================================================
-- Bucket chat-attachments
-- =============================================================================
drop policy if exists "Authenticated users can upload chat attachments" on storage.objects;
drop policy if exists "Authenticated users can view chat attachments" on storage.objects;
drop policy if exists auth_read_chat on storage.objects;
drop policy if exists auth_upload_chat on storage.objects;
drop policy if exists chat_attachments_read_access on storage.objects;
drop policy if exists chat_attachments_insert_access on storage.objects;
drop policy if exists chat_attachments_delete_access on storage.objects;

-- Lesen: Absender (eigener Ordner) und Empfänger einer Nachricht, die genau diese
-- Datei des Absenders als Anhang trägt.
create policy chat_attachments_read_access on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-attachments'
    and (
      (storage.foldername(objects.name))[1] = (auth.uid())::text
      or exists (
        select 1 from public.messages m
        where m.receiver_id = auth.uid()
          and m.sender_id::text = (storage.foldername(objects.name))[1]
          and m.attachment_url = objects.name)
    )
  );

create policy chat_attachments_insert_access on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-attachments'
    and (storage.foldername(objects.name))[1] = (auth.uid())::text
  );

-- Löschen: nur eigene Dateien, die noch an keiner gesendeten Nachricht hängen
-- (Rücknahme bei fehlgeschlagenem Senden; der Verlauf bleibt nachweisbar).
create policy chat_attachments_delete_access on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chat-attachments'
    and (storage.foldername(objects.name))[1] = (auth.uid())::text
    and not exists (
      select 1 from public.messages m
      where m.sender_id = auth.uid()
        and m.attachment_url = objects.name)
  );

-- =============================================================================
-- Bucket pdf-assets (öffentlich; Logos für PDFs – Anzeige über die öffentliche URL,
-- die keine Policy braucht)
-- =============================================================================
drop policy if exists "Anyone can read pdf-assets" on storage.objects;
drop policy if exists "Authenticated users can upload pdf-assets" on storage.objects;
drop policy if exists "Users can update their pdf-assets" on storage.objects;
drop policy if exists pdf_assets_read_access on storage.objects;
drop policy if exists pdf_assets_insert_access on storage.objects;
drop policy if exists pdf_assets_update_access on storage.objects;
drop policy if exists pdf_assets_delete_access on storage.objects;

-- Auflisten/Signieren über die API: Hochladender oder wer das Portfolio sehen darf
create policy pdf_assets_read_access on storage.objects
  for select to authenticated
  using (
    bucket_id = 'pdf-assets'
    and (
      objects.owner_id = (auth.uid())::text
      or (
        (storage.foldername(objects.name))[1] = 'logos'
        and public.has_portfolio_access(public.storage_segment_uuid((storage.foldername(objects.name))[2]), '*', 'read')
      )
    )
  );

-- Schreiben nur in den Ordner eines eigenen Portfolios (wie pdf_templates: nur Eigentümer)
create policy pdf_assets_insert_access on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'pdf-assets'
    and (storage.foldername(objects.name))[1] = 'logos'
    and exists (
      select 1 from public.portfolios p
      where p.id = public.storage_segment_uuid((storage.foldername(objects.name))[2])
        and p.user_id = auth.uid())
  );

create policy pdf_assets_update_access on storage.objects
  for update to authenticated
  using (
    bucket_id = 'pdf-assets'
    and (
      objects.owner_id = (auth.uid())::text
      or (
        (storage.foldername(objects.name))[1] = 'logos'
        and exists (
          select 1 from public.portfolios p
          where p.id = public.storage_segment_uuid((storage.foldername(objects.name))[2])
            and p.user_id = auth.uid())
      )
    )
  )
  with check (
    bucket_id = 'pdf-assets'
    and (storage.foldername(objects.name))[1] = 'logos'
    and exists (
      select 1 from public.portfolios p
      where p.id = public.storage_segment_uuid((storage.foldername(objects.name))[2])
        and p.user_id = auth.uid())
  );

create policy pdf_assets_delete_access on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'pdf-assets'
    and (
      objects.owner_id = (auth.uid())::text
      or (
        (storage.foldername(objects.name))[1] = 'logos'
        and exists (
          select 1 from public.portfolios p
          where p.id = public.storage_segment_uuid((storage.foldername(objects.name))[2])
            and p.user_id = auth.uid())
      )
    )
  );

-- =============================================================================
-- Bucket tenant-documents (wird von der App nicht verwendet, 0 Dateien)
-- =============================================================================
drop policy if exists "Investors can upload tenant documents" on storage.objects;
drop policy if exists "Authenticated users can view tenant documents" on storage.objects;
drop policy if exists auth_read_docs on storage.objects;
drop policy if exists auth_upload_docs on storage.objects;
drop policy if exists tenant_documents_read_own_folder on storage.objects;
drop policy if exists tenant_documents_insert_own_folder on storage.objects;
drop policy if exists tenant_documents_delete_own_folder on storage.objects;

create policy tenant_documents_read_own_folder on storage.objects
  for select to authenticated
  using (bucket_id = 'tenant-documents' and (storage.foldername(objects.name))[1] = (auth.uid())::text);

create policy tenant_documents_insert_own_folder on storage.objects
  for insert to authenticated
  with check (bucket_id = 'tenant-documents' and (storage.foldername(objects.name))[1] = (auth.uid())::text);

create policy tenant_documents_delete_own_folder on storage.objects
  for delete to authenticated
  using (bucket_id = 'tenant-documents' and (storage.foldername(objects.name))[1] = (auth.uid())::text);

-- =============================================================================
-- Buckets anlegen, falls sie fehlen (Neuaufbau aus dem Repo, Befund M1-24 – live sind
-- alle vorhanden, dort passiert nichts). public wie live.
-- =============================================================================
insert into storage.buckets (id, name, public) values
  ('documents', 'documents', false),
  ('tickets', 'tickets', false),
  ('announcements', 'announcements', false),
  ('chat-attachments', 'chat-attachments', false),
  ('pdf-assets', 'pdf-assets', true),
  ('tenant-documents', 'tenant-documents', false)
on conflict (id) do nothing;

-- =============================================================================
-- Bucket-Einstellungen (Größe/Typ; gleiche Grenzen prüft die App vorab –
-- src/lib/storageFiles.js). documents behält allowed_mime_types = NULL, weil
-- TenantDetail.jsx den Browser-Typ unverändert sendet (Office-Dateien oft leer).
-- =============================================================================
update storage.buckets
   set file_size_limit = 10485760,
       allowed_mime_types = array['image/*']::text[]
 where id = 'tickets';

update storage.buckets
   set file_size_limit = 10485760,
       allowed_mime_types = array['image/*', 'application/pdf']::text[]
 where id = 'announcements';

update storage.buckets
   set file_size_limit = 10485760,
       allowed_mime_types = array[
         'image/*',
         'application/pdf',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.ms-excel',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'text/plain',
         'text/csv'
       ]::text[]
 where id = 'chat-attachments';

update storage.buckets
   set file_size_limit = 10485760
 where id = 'documents';

-- pdf-assets: Logos (PNG/JPEG/WEBP/GIF, max. 5 MB; größtes Bestandslogo 1,9 MB).
-- SVG für NEUE Uploads bewusst nicht: im öffentlichen Bucket ist eine SVG-Datei ein
-- möglicher Skript-Träger (Befund G07-09). Das eine vorhandene SVG-Logo bleibt nutzbar.
update storage.buckets
   set file_size_limit = 5242880,
       allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif']::text[]
 where id = 'pdf-assets';

update storage.buckets
   set file_size_limit = 10485760
 where id = 'tenant-documents';
