-- =============================================================================
-- Welle 3 · Paket 15 TEMPLATES (Schreibvorlagen-Editor, Druck, Mieter-Anrede)
-- Befunde:
--   G06b-12  Neue Spalte public.tenants.salutation (text, NULL erlaubt) mit Prüfregel
--            ('female' | 'male' | 'diverse'). NULL = keine Angabe → neutrale Briefanrede
--            „Sehr geehrte/r Vorname Nachname“. Die App setzt die Anrede im Mieter-Assistenten
--            (Tenants.jsx) und gibt sie über buildTemplateTenantData an den Vorlagen-Editor
--            („Sehr geehrte Frau …“ / „Sehr geehrter Herr …“).
--            Mieter selbst (Mieterportal) und der Token-Link können die Spalte NICHT ändern:
--            tenants_protect_columns() übernimmt nur ausdrücklich erlaubte Spalten (Whitelist).
--   G06b-17 / G06c-16  Größengrenze für document_templates.content_html (5 MiB, Bytes): schützt die
--            Datenbank vor beliebig großen Vorlagen mit eingebetteten Base64-Bildern. Die App begrenzt
--            vorher schon auf 3 MB je Vorlage, 2 MB Bilder je Vorlage und ~400 KB je Bild.
--            (Bilder in Supabase Storage auszulagern ist NICHT Teil dieser Datei – siehe Bericht.)
--
-- Idempotent. Keine Funktionen, keine Policies, keine Rechte-Änderungen.
-- Verträglich mit der heute ausgelieferten App: sie kennt salutation nicht (Spalte optional, NULL);
-- Vorlagen der App liegen live bei höchstens wenigen KB (Prüfung 2026-11-28: max. 6.576 Bytes,
-- keine eingebetteten Bilder). Nur ein Speichern von > 5 MiB würde künftig abgewiesen.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. G06b-12: tenants.salutation
-- -----------------------------------------------------------------------------
alter table public.tenants add column if not exists salutation text;

do $$
begin
    if not exists (select 1 from pg_constraint
                   where conrelid = 'public.tenants'::regclass and conname = 'tenants_salutation_check') then
        alter table public.tenants
            add constraint tenants_salutation_check
            check (salutation is null or salutation in ('female', 'male', 'diverse'));
    end if;
end $$;

comment on column public.tenants.salutation is
    'Anrede für Briefe: female = Frau, male = Herr, diverse; NULL = keine Angabe (neutrale Anrede).';

-- -----------------------------------------------------------------------------
-- 2. G06b-17 / G06c-16: Größengrenze für Vorlagen
--    Erst NOT VALID anlegen (blockiert nie das Einspielen), dann prüfen; liegt eine bestehende
--    Vorlage darüber, bleibt die Regel NOT VALID (gilt dann nur für neue/geänderte Zeilen).
-- -----------------------------------------------------------------------------
do $$
begin
    if not exists (select 1 from pg_constraint
                   where conrelid = 'public.document_templates'::regclass
                     and conname = 'document_templates_content_html_size_check') then
        alter table public.document_templates
            add constraint document_templates_content_html_size_check
            check (content_html is null or octet_length(content_html) <= 5242880) not valid;
    end if;
    begin
        alter table public.document_templates validate constraint document_templates_content_html_size_check;
    exception when check_violation then
        raise warning 'TEMPLATES: Bestehende Vorlage(n) über 5 MiB – Größengrenze bleibt NOT VALID (gilt für neue/geänderte Zeilen).';
    end;
end $$;
