-- =============================================================================
-- Paket TEMPLATES (Komplett-Check 2026-11-27) – einmalige Bereinigung gespeicherter Schreibvorlagen
--
-- Befunde: G06a-01 (mitgespeicherte Beispielwerte in Platzhaltern, v.a. mehrzeilige und
--          Tabellen-Platzhalter), G06a-03 (doppelte Anrede "Sehr geehrte/r" + Variable
--          mieter_anrede), G06a-06 (fest eingetragene fremde Adresse info@immocontrol.de),
--          G06a-09 ("Ort, den" vor dem Briefdatum), G06a-12 (Tippfehler "Die Miete is nach").
--
-- Was passiert (nur public.document_templates.content_html, keine Policies/Rechte):
--   1. Platzhalter <span data-type="mention" …>…</span>, deren Inhalt erkennbar ein
--      mitgespeicherter Beispielwert ist (verschachteltes HTML, Zeilenumbruch oder einer der
--      früheren festen Beispielwerte), bekommen als Inhalt wieder nur ihre Bezeichnung
--      (data-label). Start-Tag und data-id bleiben unverändert.
--   2. "Sehr geehrte/r " direkt vor der Variable mieter_anrede wird entfernt (die Variable
--      enthält die Anrede bereits).
--   3. "Ort, den " direkt vor der Variable rechnungsdatum wird entfernt.
--   4. "E-Mail: info@immocontrol.de" bzw. "info@immocontrol.de" wird durch den Platzhalter
--      vermieter_kontakt ersetzt (nur wenn die Adresse nicht innerhalb eines HTML-Tags steht).
--   5. "Die Miete is nach" → "Die Miete ist nach".
--   Dieselben Regeln wendet die Web-App beim Laden einer Vorlage an
--   (DocumentTemplates.jsx: normalizeStoredTemplateHtml) – diese Datei schreibt sie einmalig
--   in die Datenbank, damit auch Mahnungen, Rechnungen und NK-Abrechnungen (eigene Ersetzer)
--   saubere Vorlagen erhalten.
--
-- Umkehrbar: Jede geänderte Zeile wird VOR der Änderung unverändert (Inhalt + updated_at) in
--   fixwork_backup.document_templates_101200 gesichert; Rollback-Datei:
--   rollback/101200_templates_cleanup.rollback.sql (setzt nur Zeilen zurück, die seit der
--   Bereinigung nicht mehr geändert wurden).
--   Das Schema fixwork_backup ist nicht über die API erreichbar (kein USAGE für anon/authenticated).
--   updated_at bleibt unverändert (technische Bereinigung, keine Bearbeitung durch den Nutzer).
--
-- Stand Live-DB 2026-11-27 (nur Zählungen): 4 Vorlagen, alle mit doppelter Anrede, fremder
--   Kontaktadresse und "Ort, den"; keine mit mehrzeiligen/Tabellen-Beispielwerten.
--
-- Idempotent: mehrfaches Ausführen ändert nichts weiter (die Erstsicherung bleibt erhalten).
-- =============================================================================

create schema if not exists fixwork_backup;

create table if not exists fixwork_backup.document_templates_101200 (
  id                    uuid primary key,
  original_content_html text not null,
  original_updated_at   timestamptz not null,
  cleaned_content_html  text,
  backed_up_at          timestamptz not null default now()
);
revoke all on table fixwork_backup.document_templates_101200 from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reine Text-Funktion: bereinigt ein Vorlagen-HTML (siehe Punkte 1–5 oben)
-- ---------------------------------------------------------------------------
create or replace function fixwork_backup.normalize_template_html_101200(p_html text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_out        text := '';
  v_rest       text;
  v_start      int;
  v_tag        text;
  v_label      text;
  v_inner      text;
  v_pos        int;
  v_depth      int;
  v_scan       text;
  v_open       int;
  v_close      int;
  v_broken     boolean := false;
  v_chip       constant text := '<span class="variable-chip" data-type="mention" data-id="vermieter_kontakt" data-label="Vermieter Kontakt">Vermieter Kontakt</span>';
  -- Beispielwerte, die frühere Editor-Versionen in Platzhalter geschrieben haben
  v_legacy     constant text[] := array[
    'Max Mustermann', 'Mustermann', 'Sehr geehrter Herr Mustermann', 'Dr. Sabine Sommer',
    'Wohnpark Sonnenseite', 'Wohnung EG links', 'Musterstraße 42, 12345 Musterstadt',
    'ImmoControlpro Vermieter GmbH', 'info@vermieter.de', '0123 4567890', '123/456/78901', 'DE123456789',
    '908,70 €', '17.06.2026', '14', '2', '3,70 €', '2025', '01.01.2025 - 31.12.2025', '550,00 €', '400,00 €',
    '150,00 €', 'Nachzahlung', '1.950,00 €', '15.05.2026 - 22.05.2026', 'RE-2026-0412', '03.06.2026',
    '560,75 €', '39,25 €', '600,00 €', 'RE-2026-0399', 'ST-2026-0001', '650,00 €', '715,00 €', '65,00 €',
    '01.08.2026', '31.07.2026', '01.06.2026'
  ];
begin
  if p_html is null then
    return null;
  end if;

  -- 1. Platzhalter: Beispielwerte entfernen (verschachtelte <span> werden mitgezählt)
  v_rest := p_html;
  loop
    v_start := regexp_instr(v_rest, '<span\s[^>]*data-type="mention"[^>]*>');
    exit when v_start = 0;

    v_out  := v_out || substr(v_rest, 1, v_start - 1);
    v_rest := substr(v_rest, v_start);
    v_tag  := substring(v_rest from '^<span\s[^>]*>');
    v_pos  := length(v_tag) + 1;          -- erstes Zeichen nach dem Start-Tag
    v_depth := 1;

    loop
      v_scan  := substr(v_rest, v_pos);
      v_close := strpos(v_scan, '</span>');
      if v_close = 0 then
        v_broken := true;                 -- unvollständiges HTML: Rest unverändert lassen
        exit;
      end if;
      v_open := regexp_instr(v_scan, '<span[\s>]');
      if v_open > 0 and v_open < v_close then
        v_depth := v_depth + 1;
        v_pos   := v_pos + v_open - 1 + 5;       -- hinter '<span'
      else
        v_depth := v_depth - 1;
        v_pos   := v_pos + v_close - 1 + 7;      -- hinter '</span>'
        exit when v_depth = 0;
      end if;
    end loop;

    if v_broken then
      v_out  := v_out || v_rest;
      v_rest := '';
      exit;
    end if;

    -- v_pos zeigt auf das erste Zeichen nach dem passenden '</span>'
    v_inner := substr(v_rest, length(v_tag) + 1, v_pos - 8 - length(v_tag));
    v_label := substring(v_tag from 'data-label="([^"]*)"');
    if v_label is null or v_label = '' then
      v_label := substring(v_tag from 'data-id="([^"]*)"');
    end if;
    v_label := replace(replace(coalesce(v_label, ''), '<', '&lt;'), '>', '&gt;');

    if v_label <> ''
       and v_inner is distinct from v_label
       and (strpos(v_inner, '<') > 0
            or strpos(v_inner, chr(10)) > 0
            or btrim(v_inner) = any (v_legacy)) then
      v_out := v_out || v_tag || v_label || '</span>';
    else
      v_out := v_out || substr(v_rest, 1, v_pos - 1);
    end if;
    v_rest := substr(v_rest, v_pos);
  end loop;
  v_out := v_out || v_rest;

  -- 2. doppelte Anrede vor der Variable mieter_anrede
  v_out := regexp_replace(v_out, 'Sehr geehrte(/r|\(r\))?(\s|&nbsp;)*(<span[^>]*data-id="mieter_anrede")', '\3', 'g');
  v_out := regexp_replace(v_out, 'Sehr geehrte(/r|\(r\))?(\s|&nbsp;)*(\{mieter_anrede\})', '\3', 'g');

  -- 3. "Ort, den" vor dem Briefdatum
  v_out := regexp_replace(v_out, 'Ort,(\s|&nbsp;)*den(\s|&nbsp;)*(<span[^>]*data-id="rechnungsdatum")', '\3', 'g');

  -- 4. fremde Kontaktadresse (nur im Text, nie innerhalb eines Tags)
  if v_out !~ '<[^>]*info@immocontrol\.de' then
    v_out := replace(v_out, 'E-Mail: info@immocontrol.de', v_chip);
    v_out := replace(v_out, 'info@immocontrol.de', v_chip);
  end if;

  -- 5. Tippfehler
  v_out := replace(v_out, 'Die Miete is nach', 'Die Miete ist nach');

  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- Bereinigung aller Vorlagen (mit Sicherung); Rückgabe: Anzahl geänderter Zeilen
-- ---------------------------------------------------------------------------
create or replace function fixwork_backup.cleanup_document_templates_101200()
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_count       int := 0;
  v_new         text;
  v_has_trigger boolean;
  r             record;
begin
  -- updated_at nicht anfassen: den updated_at-Trigger für diese Bereinigung aussetzen
  select exists (
    select 1 from pg_trigger
    where tgrelid = 'public.document_templates'::regclass
      and tgname = 'trigger_update_document_templates_updated_at'
      and not tgisinternal
  ) into v_has_trigger;
  if v_has_trigger then
    execute 'alter table public.document_templates disable trigger trigger_update_document_templates_updated_at';
  end if;

  for r in
    select id, content_html, updated_at
    from public.document_templates
    where content_html like '%data-type="mention"%'
       or content_html like '%info@immocontrol.de%'
       or content_html like '%Die Miete is nach%'
    for update
  loop
    v_new := fixwork_backup.normalize_template_html_101200(r.content_html);
    if v_new is distinct from r.content_html then
      insert into fixwork_backup.document_templates_101200 (id, original_content_html, original_updated_at, cleaned_content_html)
      values (r.id, r.content_html, r.updated_at, v_new)
      on conflict (id) do update
        set cleaned_content_html = excluded.cleaned_content_html;   -- Erstsicherung bleibt erhalten
      update public.document_templates
        set content_html = v_new
        where id = r.id;
      v_count := v_count + 1;
    end if;
  end loop;

  if v_has_trigger then
    execute 'alter table public.document_templates enable trigger trigger_update_document_templates_updated_at';
  end if;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ausführen
-- ---------------------------------------------------------------------------
do $$
declare
  v_changed int;
begin
  v_changed := fixwork_backup.cleanup_document_templates_101200();
  raise notice '101200_templates_cleanup: % Vorlage(n) bereinigt (Sicherung in fixwork_backup.document_templates_101200).', v_changed;
end;
$$;
