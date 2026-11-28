-- =============================================================================
-- Welle 7 – Paket forderungen-2 · Befund A-3
-- Forderungsportal: Positionen mit Fälligkeit (due_date) und Abrechnungsmonat (period_month)
--
-- Befund A-3: Die Tabelle „Offene Positionen im Detail“ in ClaimPortal.jsx zeigt das Anlagedatum
-- der Position (claim_items.created_at), weil get_public_claim_by_token(text, text) im
-- items-Objekt nur id, item_type, description, original_amount, created_at, fee_amount,
-- interest_amount und open_amount liefert. claim_items hat live die Spalten due_date (date) und
-- period_month (date); sie werden bisher nicht ausgegeben.
--
-- Korrektur: Im items-Objekt der Funktion kommen zwei Schlüssel dazu (sonst keine Änderung):
--
--              'created_at', ci.created_at,
--              'due_date', ci.due_date,            <- neu
--              'period_month', ci.period_month,    <- neu
--              'fee_amount', ci.fee_amount,
--
-- Warum als gezielte Ersetzung im Live-Text statt als vollständiges create or replace:
-- Paket forderungen-1 (Befund A-1, Bankverbindung aus dem Portfolio) ändert in Welle 7 dieselbe
-- Funktion (Block bank_details). Diese Datei liest deshalb die aktuelle Live-Definition
-- (pg_get_functiondef), ergänzt nur die zwei Zeilen und legt die Funktion damit neu an. So bleibt
-- eine vorher eingespielte A-1-Fassung erhalten. Reihenfolge: NACH der A-1-Migration einspielen
-- (eine spätere vollständige create-or-replace-Fassung würde die zwei Zeilen wieder entfernen).
--
-- Signatur, RETURNS, SECURITY DEFINER und search_path stammen unverändert aus pg_get_functiondef.
-- Idempotent: ist due_date schon enthalten, passiert nichts. Findet sich die Stelle nicht genau
-- einmal, bricht die Migration ohne Änderung ab.
-- Die App (ClaimPortal.jsx) zeigt item.due_date || item.created_at und funktioniert vor und nach
-- dieser Migration.
-- Rechte am Ende wie heute live: postgres, anon, authenticated, service_role (kein PUBLIC).
-- =============================================================================

do $migration$
declare
  v_fn constant regprocedure := 'public.get_public_claim_by_token(text, text)'::regprocedure;
  v_old_part constant text := '''created_at'', ci.created_at,';
  v_def text;
  v_count integer;
begin
  v_def := pg_get_functiondef(v_fn);

  if position('''due_date'', ci.due_date' in v_def) > 0 then
    raise notice 'get_public_claim_by_token liefert due_date bereits – nichts zu tun';
    return;
  end if;

  v_count := (length(v_def) - length(replace(v_def, v_old_part, ''))) / length(v_old_part);
  if v_count <> 1 then
    raise exception 'get_public_claim_by_token: Stelle % kommt % mal vor (erwartet 1) – Migration abgebrochen',
      v_old_part, v_count;
  end if;

  v_def := replace(v_def, v_old_part,
                   v_old_part || E'\n              ''due_date'', ci.due_date,'
                              || E'\n              ''period_month'', ci.period_month,');
  execute v_def;
end
$migration$;

revoke execute on function public.get_public_claim_by_token(text, text) from public;
grant execute on function public.get_public_claim_by_token(text, text) to anon, authenticated, service_role;
