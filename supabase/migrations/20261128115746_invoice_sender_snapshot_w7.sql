-- =============================================================================
-- Welle 7 – Paket finanzen-2
-- Rechnungen: Absenderdaten des Portfolios beim Ausstellen einfrieren (invoices.sender_snapshot)
--
-- Befund:
--   C-4  Der Nachdruck ausgestellter Rechnungen/Gutschriften las E-Mail, Telefon, Bank, IBAN, BIC,
--        Steuernummer und USt-IdNr. bei jedem Druck/PDF frisch aus dem Portfolio (lib/invoiceDocument.js
--        getInvoiceSender). Nach einer Änderung der Stammdaten (oder dem erlaubten Umhängen auf ein
--        anderes Portfolio desselben Eigentümers) zeigte der Nachdruck andere Pflichtangaben
--        (§ 14 Abs. 4 UStG) als das versendete Exemplar (GoBD: Beleg nicht unverändert reproduzierbar).
--
-- Korrektur:
--   1. Neue Spalte public.invoices.sender_snapshot jsonb (Vorgabe null).
--   2. Neuer BEFORE INSERT OR UPDATE-Trigger trg_invoices_sender_snapshot
--      (Funktion public.invoices_freeze_sender_snapshot, SECURITY DEFINER nur zum Lesen des Portfolios):
--        - Entwurf (status 'draft'): Snapshot immer null – Entwürfe zeigen die aktuellen Portfolio-Daten.
--        - Übergang Entwurf -> ausgestellt bzw. Anlage eines nicht-Entwurfs: Snapshot aus dem Portfolio
--          der Rechnung (name, company_name, street, house_number, zip, city, email, phone, bank_name,
--          iban, bic, tax_number, vat_id, frozen_at). Ein vom Aufrufer mitgesendeter Wert wird dabei
--          überschrieben (Quelle ist immer der Portfolio-Datensatz zum Zeitpunkt des Ausstellens).
--        - Ausnahme Gutschrift (INSERT mit status 'credit_note' und mitgegebenem Snapshot-Objekt):
--          Snapshot der Originalrechnung bleibt (create_credit_note bzw. App-Weg übernehmen ihn).
--        - Festgeschriebene Belege (UPDATE mit old.status <> 'draft'): unverändert; die Spalte ist über
--          protect_issued_invoice (vergleicht alle übrigen Spalten) automatisch gesperrt.
--      Name des Triggers sortiert nach trg_invoices_protect_issued (gleiche Reihenfolge wie heute).
--   3. create_credit_note: übernimmt sender_snapshot der Originalrechnung (sonst unverändert,
--      abgeleitet aus der Live-Definition vom 2026-11-28; Signatur, SECURITY INVOKER, search_path und
--      Rechte unverändert).
--
-- Altbestand: Kein Nachtragen. Bereits ausgestellte/stornierte Rechnungen haben keinen Snapshot und
-- werden wie bisher mit den aktuellen Portfolio-Daten gedruckt (die damaligen Werte sind unbekannt).
-- Live am 2026-11-28: 6 Entwürfe, 7 stornierte Altrechnungen, keine ausgestellte Rechnung.
--
-- App (lib/invoiceDocument.js): getInvoiceSender bevorzugt den Snapshot (nur bei nicht-Entwürfen),
-- createCreditNoteInApp übernimmt ihn, wenn die Spalte geliefert wird. Vor der Migration fehlt die
-- Spalte -> unverändertes Verhalten.
-- Idempotent (add column if not exists, create or replace, drop trigger if exists).
-- =============================================================================

alter table public.invoices add column if not exists sender_snapshot jsonb;

comment on column public.invoices.sender_snapshot is
    'Beim Ausstellen eingefrorene Absenderdaten des Portfolios (Kontakt, Bank, Steuernummer/USt-IdNr.) für den unveränderten Nachdruck; null bei Entwürfen und Altbestand. Gesetzt durch trg_invoices_sender_snapshot.';

create or replace function public.invoices_freeze_sender_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
-- SECURITY DEFINER nur zum Lesen der Absenderdaten des Portfolios der Rechnung ohne RLS des
-- Aufrufers (Schreibrechte auf die Rechnung prüft weiterhin RLS). Ändert nur NEW.sender_snapshot.
declare
    v_p public.portfolios%rowtype;
begin
    -- Festgeschriebene Belege: nichts ändern (protect_issued_invoice sperrt alle Spalten)
    if tg_op = 'UPDATE' and old.status is distinct from 'draft' then
        return new;
    end if;

    -- Entwürfe zeigen die aktuellen Portfolio-Daten
    if new.status is not distinct from 'draft' then
        new.sender_snapshot := null;
        return new;
    end if;

    -- Gutschrift: Absenderdaten der Originalrechnung (von create_credit_note übernommen)
    if tg_op = 'INSERT' and new.status = 'credit_note' and jsonb_typeof(new.sender_snapshot) = 'object' then
        return new;
    end if;

    select * into v_p from public.portfolios p where p.id = new.portfolio_id;
    if not found then
        new.sender_snapshot := null;
        return new;
    end if;

    new.sender_snapshot := jsonb_build_object(
        'name', v_p.name,
        'company_name', v_p.company_name,
        'street', v_p.street,
        'house_number', v_p.house_number,
        'zip', v_p.zip,
        'city', v_p.city,
        'email', v_p.email,
        'phone', v_p.phone,
        'bank_name', v_p.bank_name,
        'iban', v_p.iban,
        'bic', v_p.bic,
        'tax_number', v_p.tax_number,
        'vat_id', v_p.vat_id,
        'frozen_at', now());
    return new;
end;
$function$;

-- Trigger-Funktion: kein EXECUTE nötig (wie protect_issued_invoice)
revoke all on function public.invoices_freeze_sender_snapshot() from public, anon, authenticated;
grant execute on function public.invoices_freeze_sender_snapshot() to service_role;

drop trigger if exists trg_invoices_sender_snapshot on public.invoices;
create trigger trg_invoices_sender_snapshot
    before insert or update on public.invoices
    for each row execute function public.invoices_freeze_sender_snapshot();

-- -----------------------------------------------------------------------------
-- create_credit_note: Snapshot der Originalrechnung übernehmen
-- (Live-Definition vom 2026-11-28, einzige Änderung: Spalte/Wert sender_snapshot im INSERT)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_credit_note(p_invoice_id uuid)
 RETURNS invoices
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
                net_amount, vat_amount, gross_amount, status, sender_snapshot)
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
                'credit_note', v_orig.sender_snapshot)
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

-- Rechte wie heute (Live: postgres, authenticated, service_role)
revoke execute on function public.create_credit_note(uuid) from public, anon;
grant execute on function public.create_credit_note(uuid) to authenticated, service_role;
