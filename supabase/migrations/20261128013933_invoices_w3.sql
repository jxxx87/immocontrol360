-- =============================================================================
-- Welle 3 · Paket 13 INVOICES (Rechnungen / Gutschriften, PDF-Vorlagen-Default)
-- Befunde:
--   G10-04  Festschreibung auf DB-Ebene (GoBD): Trigger protect_issued_invoice() auf public.invoices.
--           Entwürfe bleiben frei änderbar/löschbar. Ausgestellte Rechnungen, stornierte Rechnungen
--           und Gutschriften sind unveränderlich und nicht löschbar; erlaubt bleiben nur
--             a) Status issued -> credited (Storno-Kennzeichen; die Gutschrift ist ein eigener Beleg),
--             b) Umhängen in ein anderes Portfolio DESSELBEN Eigentümers (Portfolio löschen mit Übertrag,
--                delete_portfolio aus Paket 12),
--             c) Verweis auf Kontakt/Objekt/Einheit -> NULL, wenn dieser Datensatz gelöscht wurde
--                (Fremdschlüssel ON DELETE SET NULL; die Anschriften stehen im Beleg selbst),
--             d) Löschen mit dem Benutzerkonto (auth.users ON DELETE CASCADE, wie bisher).
--           Neue RPC create_credit_note(uuid): Gutschrift anlegen + Original auf 'credited' in EINER
--           Transaktion (ersetzt das clientseitige Anlegen mit „Rückgängig-Delete“).
--           TRUNCATE auf invoices für anon/authenticated entzogen (umgeht RLS und Trigger).
--   D4-10   get_next_invoice_number(): ein Zähler je Portfolio und Jahr (passend zur Eindeutigkeit
--           invoices (portfolio_id, invoice_number)); p_object_unit_id bleibt als Parameter, wird aber
--           ignoriert. Die Nummer berücksichtigt zusätzlich die bereits vergebenen Nummern „JJJJ-NNN“
--           (die App vergibt Rechnungsnummern ohne Zähler) – keine Kollision mehr mit Bestandsnummern.
--           Kein Fremdschlüssel auf invoice_counters.object_unit_id: die Spalte ist ab jetzt bedeutungslos,
--           und ON DELETE SET NULL würde am Unique-Index (NULLS NOT DISTINCT) das Löschen von Einheiten
--           blockieren.
--   G10-24  Ungenutztes Altschema entfernt: Sicht invoice_totals, Tabelle invoice_items (live 0 Zeilen),
--           Spalten invoices.checkin_date/checkout_date (live 0 Werte). Nur wenn weiterhin leer – sonst
--           Warnung und unverändert. invoice_counters bleibt (get_next_invoice_number, delete_portfolio).
--   G07-23  pdf_templates.accent_color: Spalten-Default = App-Standard '#0ea5e9' (bestehende Zeilen
--           unverändert).
--
-- Idempotent. Signatur von get_next_invoice_number unverändert; create_credit_note und
-- protect_issued_invoice sind neu. notify_push unberührt.
-- Verträglich mit der heute ausgelieferten App: sie ändert nur Entwürfe (.eq('status','draft')),
-- stellt aus (draft -> issued) und storniert (Gutschrift einfügen, dann issued -> credited) – alles
-- erlaubt. Einzige Einschränkung: Schlägt beim alten Gutschrift-Weg das Storno-Kennzeichen fehl
-- (gleichzeitige Bearbeitung), kann die alte App die gerade angelegte Gutschrift nicht mehr löschen;
-- die neue App nutzt create_credit_note (atomar) und fällt nur ohne diese Funktion auf den alten Weg
-- zurück. Kein Code (App, Edge Functions, DB-Funktionen) nutzt invoice_items, invoice_totals,
-- checkin_date oder checkout_date.
-- Fehlermeldungen: Trigger mit SQLSTATE 42501 (Berechtigung), RPC ohne eigenen SQLSTATE (P0001),
-- damit die App die deutschen Texte unverändert anzeigt.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. G10-24: Altschema entfernen (nur solange leer)
-- -----------------------------------------------------------------------------
do $$
declare
    v_has_rows boolean;
    v_col text;
begin
    if to_regclass('public.invoice_items') is not null then
        execute 'select exists (select 1 from public.invoice_items)' into v_has_rows;
        if v_has_rows then
            raise warning 'INVOICES: invoice_items enthält Zeilen – invoice_items und invoice_totals NICHT entfernt.';
        else
            drop view if exists public.invoice_totals;
            drop table public.invoice_items;
        end if;
    else
        drop view if exists public.invoice_totals;
    end if;

    foreach v_col in array array['checkin_date', 'checkout_date'] loop
        if exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'invoices' and column_name = v_col) then
            execute format('select exists (select 1 from public.invoices where %I is not null)', v_col) into v_has_rows;
            if v_has_rows then
                raise warning 'INVOICES: invoices.% ist teilweise gefüllt – Spalte NICHT entfernt.', v_col;
            else
                execute format('alter table public.invoices drop column %I', v_col);
            end if;
        end if;
    end loop;
end $$;


-- -----------------------------------------------------------------------------
-- 2. G07-23: Default der Akzentfarbe = App-Standard (DEFAULT_ACCENT in pdf-template/constants.js)
-- -----------------------------------------------------------------------------
alter table public.pdf_templates alter column accent_color set default '#0ea5e9';


-- -----------------------------------------------------------------------------
-- 3. D4-10: Rechnungsnummer je Portfolio und Jahr
-- -----------------------------------------------------------------------------
create or replace function public.get_next_invoice_number(p_portfolio_id uuid, p_object_unit_id uuid, p_year integer)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
-- p_object_unit_id wird bewusst ignoriert (Parameter bleibt für ältere Aufrufer): Rechnungsnummern sind
-- je Portfolio eindeutig (invoices (portfolio_id, invoice_number)), deshalb zählt EIN Zähler je Portfolio
-- und Jahr (object_unit_id NULL). Ältere Zähler je Einheit und bereits vergebene Nummern „JJJJ-NNN“
-- fließen als Untergrenze ein.
declare
  v_caller uuid := auth.uid();
  v_owner uuid;
  v_id uuid;
  v_counter bigint;
  v_used numeric;
  v_next numeric;
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;
  if p_portfolio_id is null or p_year is null then
    raise exception 'Portfolio und Jahr sind erforderlich.';
  end if;

  select user_id into v_owner from public.portfolios where id = p_portfolio_id;
  if v_owner is null
     or (v_owner <> v_caller and not public.has_portfolio_access(p_portfolio_id, 'finanzen', 'write')) then
    raise exception 'Portfolio nicht gefunden oder keine Berechtigung.';
  end if;

  -- Vergabe je Portfolio und Jahr serialisieren
  perform pg_advisory_xact_lock(hashtextextended(
    'invoice_counter:' || p_portfolio_id::text || ':' || p_year::text, 0));

  select max(c.last_number) into v_counter
    from public.invoice_counters c
   where c.portfolio_id = p_portfolio_id
     and c.year = p_year;

  select max(substring(btrim(i.invoice_number) from ('^' || p_year::text || '-([0-9]+)$'))::numeric)
    into v_used
    from public.invoices i
   where i.portfolio_id = p_portfolio_id;

  v_next := greatest(coalesce(v_counter, 0), coalesce(v_used, 0)) + 1;
  if v_next > 2147483647 then
    raise exception 'Rechnungsnummer konnte nicht vergeben werden.';
  end if;

  select c.id into v_id
    from public.invoice_counters c
   where c.portfolio_id = p_portfolio_id
     and c.year = p_year
     and c.object_unit_id is null
     for update;

  if v_id is null then
    insert into public.invoice_counters (user_id, portfolio_id, year, object_unit_id, last_number)
    values (v_owner, p_portfolio_id, p_year, null, v_next::integer);
  else
    update public.invoice_counters
       set last_number = v_next::integer
     where id = v_id;
  end if;

  return p_year::text || '-' || case when v_next < 1000 then lpad(v_next::text, 3, '0') else v_next::text end;
end;
$function$;

comment on function public.get_next_invoice_number(uuid, uuid, integer) is
    'Nächste Rechnungsnummer „JJJJ-NNN“ je Portfolio und Jahr (p_object_unit_id wird ignoriert). '
    'Berücksichtigt Zähler und bereits vergebene Nummern. Aufruf: create_credit_note.';

revoke all on function public.get_next_invoice_number(uuid, uuid, integer) from public, anon;
grant execute on function public.get_next_invoice_number(uuid, uuid, integer) to authenticated, service_role;

comment on column public.invoice_counters.object_unit_id is
    'Veraltet: wird von get_next_invoice_number ignoriert (ein Zähler je Portfolio und Jahr, object_unit_id NULL).';


-- -----------------------------------------------------------------------------
-- 4. G10-04: Festgeschriebene Belege schützen
-- -----------------------------------------------------------------------------
create or replace function public.protect_issued_invoice()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
-- SECURITY DEFINER nur für die Existenzprüfungen (gelöschte Kontakte/Objekte/Einheiten/Konten,
-- Eigentümer der Portfolios) ohne RLS des Aufrufers. Ändert selbst keine Daten.
declare
    v_uid uuid := auth.uid();
    v_locked constant text := 'Ausgestellte Rechnungen und Gutschriften sind festgeschrieben und können nicht mehr geändert werden. Eine Korrektur ist nur über eine Gutschrift möglich.';
    v_fixed text[] := array['status', 'portfolio_id', 'contact_id', 'property_id', 'unit_id'];
begin
    if tg_op = 'DELETE' then
        if old.status = 'draft' then
            return old;
        end if;
        -- Löschen des Benutzerkontos (auth.users ON DELETE CASCADE): das Konto ist dann schon entfernt
        if not exists (select 1 from auth.users u where u.id = old.user_id) then
            return old;
        end if;
        raise exception 'Ausgestellte Rechnungen und Gutschriften können nicht gelöscht werden (Aufbewahrungspflicht). Eine Korrektur ist nur über eine Gutschrift möglich.'
            using errcode = '42501';
    end if;

    -- UPDATE eines Entwurfs: frei änderbar; als neuer Status nur Entwurf oder ausgestellt
    if old.status = 'draft' then
        if new.status is distinct from 'draft' and new.status is distinct from 'issued' then
            raise exception 'Ein Entwurf kann nur ausgestellt werden. Gutschriften entstehen nur zu ausgestellten Rechnungen.'
                using errcode = '42501';
        end if;
        return new;
    end if;

    -- a) Status: nur issued -> credited
    if new.status is distinct from old.status
       and not (old.status = 'issued' and new.status = 'credited') then
        raise exception '%', v_locked using errcode = '42501';
    end if;

    -- b) Portfolio: nur zwischen Portfolios desselben Eigentümers (der selbst handelt)
    if new.portfolio_id is distinct from old.portfolio_id
       and not (v_uid is not null
                and exists (select 1 from public.portfolios p where p.id = old.portfolio_id and p.user_id = v_uid)
                and exists (select 1 from public.portfolios p where p.id = new.portfolio_id and p.user_id = v_uid)) then
        raise exception '%', v_locked using errcode = '42501';
    end if;

    -- c) Verweise: nur auf NULL, wenn der verwiesene Datensatz nicht mehr existiert (ON DELETE SET NULL)
    if new.contact_id is distinct from old.contact_id
       and not (new.contact_id is null
                and not exists (select 1 from public.contacts c where c.id = old.contact_id)) then
        raise exception '%', v_locked using errcode = '42501';
    end if;
    if new.property_id is distinct from old.property_id
       and not (new.property_id is null
                and not exists (select 1 from public.properties p where p.id = old.property_id)) then
        raise exception '%', v_locked using errcode = '42501';
    end if;
    if new.unit_id is distinct from old.unit_id
       and not (new.unit_id is null
                and not exists (select 1 from public.units u where u.id = old.unit_id)) then
        raise exception '%', v_locked using errcode = '42501';
    end if;

    -- Alle übrigen Spalten (auch künftige) bleiben unverändert
    if (to_jsonb(new) - v_fixed) is distinct from (to_jsonb(old) - v_fixed) then
        raise exception '%', v_locked using errcode = '42501';
    end if;

    return new;
end;
$function$;

comment on function public.protect_issued_invoice() is
    'Trigger (invoices, BEFORE UPDATE OR DELETE): Entwürfe frei; ausgestellte/stornierte Rechnungen und '
    'Gutschriften unveränderlich und nicht löschbar (Ausnahmen: issued->credited, Portfolio-Übertrag durch den '
    'Eigentümer, Verweis->NULL nach Löschen des Datensatzes, Löschen mit dem Benutzerkonto).';

revoke all on function public.protect_issued_invoice() from public, anon, authenticated;

drop trigger if exists trg_invoices_protect_issued on public.invoices;
create trigger trg_invoices_protect_issued
    before update or delete on public.invoices
    for each row execute function public.protect_issued_invoice();

-- TRUNCATE umgeht RLS und Zeilen-Trigger; die App braucht es nicht
revoke truncate on public.invoices from anon, authenticated;




-- -----------------------------------------------------------------------------
-- 5. G10-04: Gutschrift (Storno) zu einer ausgestellten Rechnung – atomar
--
--    Wie bisher in der App (invoiceDocument.createCreditNote): eigener Beleg mit eigener Nummer aus dem
--    Nummernkreis des Portfolios, Datum heute (Europe/Berlin), Bezug zur Rechnung in jeder Position,
--    negative Beträge (kaufmännisch auf Cent gerundet); Steuersatz je Position eingefroren
--    (Kleinunternehmer 0 %, fehlender Satz = 7 % wie bei Altpositionen). Das Original bleibt
--    unverändert und wird als 'credited' gekennzeichnet. Alles in EINER Transaktion.
--    SECURITY INVOKER: es gelten die RLS-Regeln des Aufrufers (finanzen/write).
-- -----------------------------------------------------------------------------
create or replace function public.create_credit_note(p_invoice_id uuid)
returns public.invoices
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
    v_orig public.invoices%rowtype;
    v_new public.invoices%rowtype;
    v_today date := (now() at time zone 'Europe/Berlin')::date;
    v_small boolean;
    v_positions jsonb := '[]'::jsonb;
    v_pos jsonb;
    v_out jsonb;
    v_raw jsonb;
    v_rate numeric;
    v_key text;
    v_amount numeric;
    v_number text;
    v_attempt integer := 0;
    v_rows integer;
begin
    if auth.uid() is null then
        raise exception 'Bitte melden Sie sich an.';
    end if;
    if p_invoice_id is null then
        raise exception 'Keine Rechnung angegeben.';
    end if;

    -- Sperren (verhindert doppelte Gutschriften); FOR UPDATE liefert nur Zeilen mit Schreibrecht
    select * into v_orig from public.invoices i where i.id = p_invoice_id for update;
    if not found or not public.has_portfolio_access(v_orig.portfolio_id, 'finanzen', 'write') then
        raise exception 'Die Rechnung wurde nicht gefunden oder Sie haben keine Schreibberechtigung.';
    end if;
    if v_orig.status is distinct from 'issued' then
        raise exception 'Eine Gutschrift kann nur zu einer ausgestellten Rechnung erstellt werden. Die Rechnung wurde inzwischen geändert oder bereits storniert.';
    end if;

    -- Positionen spiegeln (entspricht isInvoiceSmallBusiness / getPositionVatRate / r2 in lib/invoiceDocument.js)
    v_small := jsonb_typeof(v_orig.positions) = 'array'
               and exists (select 1 from jsonb_array_elements(v_orig.positions) e(x)
                            where e.x -> 'smallBusiness' = 'true'::jsonb);

    for v_pos in
        select case when jsonb_typeof(e.x) = 'object' then e.x else '{}'::jsonb end
          from jsonb_array_elements(case when jsonb_typeof(v_orig.positions) = 'array'
                                         then v_orig.positions else '[]'::jsonb end)
               with ordinality as e(x, ord)
         order by e.ord
    loop
        v_raw := v_pos -> 'vatRate';
        v_rate := case
            when v_small or v_pos -> 'smallBusiness' = 'true'::jsonb then 0
            when v_raw is null or v_raw = 'null'::jsonb or v_raw = '""'::jsonb then 7
            when jsonb_typeof(v_raw) = 'number' then (v_raw #>> '{}')::numeric
            when jsonb_typeof(v_raw) = 'string'
                 and btrim(v_raw #>> '{}') ~ '^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$'
                then btrim(v_raw #>> '{}')::numeric
            else 7
        end;

        v_out := v_pos || jsonb_build_object(
            'vatRate', v_rate,
            'refInvoiceId', v_orig.id,
            'refInvoiceNumber', coalesce(v_orig.invoice_number, ''),
            'refInvoiceDate', v_orig.invoice_date);

        -- Beträge wie parseFloat(): Zahl, sonst führender Zahlenwert eines Textes, sonst 0; dann negiert
        foreach v_key in array array['pricePerNight', 'netTotal', 'vat', 'grossTotal'] loop
            v_raw := v_pos -> v_key;
            v_amount := case jsonb_typeof(v_raw)
                when 'number' then (v_raw #>> '{}')::numeric
                when 'string' then substring(v_raw #>> '{}' from '^\s*([+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)')::numeric
            end;
            v_out := v_out || jsonb_build_object(v_key, round(-coalesce(v_amount, 0), 2));
        end loop;

        if v_small then
            v_out := v_out || jsonb_build_object('smallBusiness', true);
        end if;
        v_positions := v_positions || jsonb_build_array(v_out);
    end loop;

    -- Nummer aus dem Nummernkreis des Portfolios; bei Kollision (gleichzeitige Vergabe) neu vergeben
    loop
        v_attempt := v_attempt + 1;
        v_number := public.get_next_invoice_number(v_orig.portfolio_id, null, extract(year from v_today)::integer);
        begin
            insert into public.invoices (
                user_id, portfolio_id, property_id, unit_id, contact_id, invoice_date, invoice_number,
                sender_name, sender_street, sender_zip, sender_city,
                recipient_name, recipient_street, recipient_zip, recipient_city,
                move_in, move_out, persons, nights, vat_rate, positions,
                net_amount, vat_amount, gross_amount, status)
            values (
                v_orig.user_id, v_orig.portfolio_id, v_orig.property_id, v_orig.unit_id, v_orig.contact_id,
                v_today, v_number,
                v_orig.sender_name, v_orig.sender_street, v_orig.sender_zip, v_orig.sender_city,
                v_orig.recipient_name, v_orig.recipient_street, v_orig.recipient_zip, v_orig.recipient_city,
                v_orig.move_in, v_orig.move_out, nullif(v_orig.persons, 0), v_orig.nights, v_orig.vat_rate,
                v_positions,
                round(-coalesce(v_orig.net_amount, 0), 2),
                round(-coalesce(v_orig.vat_amount, 0), 2),
                round(-coalesce(v_orig.gross_amount, 0), 2),
                'credit_note')
            returning * into v_new;
            exit;
        exception when unique_violation then
            if v_attempt >= 5 then
                raise exception 'Es konnte keine eindeutige Gutschriftsnummer vergeben werden. Bitte versuchen Sie es erneut.';
            end if;
        end;
    end loop;

    update public.invoices
       set status = 'credited'
     where id = v_orig.id
       and status = 'issued';
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
        raise exception 'Die Rechnung wurde inzwischen geändert oder bereits storniert. Es wurde keine Gutschrift erstellt.';
    end if;

    return v_new;
end;
$function$;

comment on function public.create_credit_note(uuid) is
    'Erstellt zur ausgestellten Rechnung eine Gutschrift (eigene Nummer, negative Beträge, Bezug je Position) '
    'und kennzeichnet die Rechnung als storniert – in einer Transaktion. SECURITY INVOKER (RLS des Aufrufers). '
    'Aufruf: lib/invoiceDocument.js createCreditNote.';

revoke all on function public.create_credit_note(uuid) from public, anon;
grant execute on function public.create_credit_note(uuid) to authenticated, service_role;
