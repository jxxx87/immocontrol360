-- =============================================================================
-- Welle 3 · Paket 14 IMPORT (Excel-Import)
-- Befund:
--   G13b-10  Import ohne Transaktion: Ein Fehler beim Speichern (Schritt 2 in Import.jsx)
--            hinterließ einen Teilimport (Portfolios/Objekte/Einheiten/Mieter/Verträge wurden
--            nacheinander in getrennten Anfragen angelegt).
--            -> public.import_rows(p_plan jsonb) legt alles in EINER Transaktion an. Schlägt ein
--               Datensatz fehl, wird der gesamte Import zurückgerollt; die Fehlermeldung nennt die
--               Excel-Zeile(n) und den Datensatz.
--
-- SECURITY INVOKER: Es gelten die RLS-Regeln des aufrufenden Kontos (wie beim bisherigen Import
-- über die REST-Schnittstelle); die Trigger (set_owner_user_id, sync_tenant_to_contact,
-- sync_lease_to_contact, on_lease_change -> Mietperioden/Sollstellungen, ggf. die Überschneidungs-
-- prüfung aus 09_tenant-mgmt) laufen unverändert mit. Zusätzlich prüft die Funktion, dass
-- vorhandene Portfolios/Objekte/Einheiten, auf die der Plan verweist, zum eigenen Konto gehören
-- (der Import arbeitet nur mit eigenen Portfolios), und dass vorhandene Mieter sichtbar sind.
--
-- statement_timeout 60 s (Funktions-Einstellung, wird von PostgREST für den Aufruf übernommen;
-- Höchstwert für Client-Anfragen bei Supabase): Jeder neue Vertrag erzeugt über on_lease_change
-- die Sollstellungen ab Mietbeginn – bei großen Dateien mit alten Verträgen reichen die 8 s der
-- Rolle authenticated nicht. Ein Abbruch durch die Zeitgrenze rollt ebenfalls alles zurück.
--
-- Plan (von Import.jsx nach der Prüfung erzeugt; Indizes 0-basiert):
--   { "portfolios": [{ name, rows }],
--     "properties": [{ portfolio_id | portfolio_idx, street, house_number, zip, city,
--                      construction_year, property_type, rows }],
--     "units":      [{ property_id | property_idx, unit_name, floor, sqm, rooms, bathrooms, bedrooms,
--                      balcony, fitted_kitchen, is_vacation_rental, cold_rent_ist, target_rent, rows }],
--     "tenants":    [{ first_name, last_name, email, phone, occupants, rows }],
--     "leases":     [{ unit_id | unit_idx, tenant_id | tenant_idx, start_date, cold_rent,
--                      service_charge, heating_cost, other_costs, deposit, last_rent_increase,
--                      booking_start_date, rows }] }
--   rows = Excel-Zeilennummern (nur für Fehlermeldungen). Höchstens 5000 Einträge je Art.
-- Rückgabe: { portfolios, properties, units, tenants, leases, booking_start_leases } (Anzahl angelegt)
--
-- Idempotent (add column if not exists / create or replace). Neue Funktion, keine bestehende
-- Signatur geändert, notify_push unberührt. Verträglich mit der heute ausgelieferten App (ruft die
-- Funktion nicht auf). Import.jsx ruft seit Welle 4 ausschließlich import_rows auf; fehlt die
-- Funktion (PGRST202 „Funktion nicht gefunden“ / 42883), bricht der Import ohne Speichern ab
-- (kein Rückfall auf den früheren Weg über einzelne REST-Anfragen).
-- Fehlermeldungen: SQLSTATE des ursprünglichen Fehlers bleibt erhalten (Hinweis/HINT ebenso,
-- z. B. 'lease_overlap'); Text = „Zeile …: <Datensatz> konnte nicht angelegt werden: <Grund>“,
-- englische Standardtexte (RLS, Pflichtfeld, Eindeutigkeit …) als deutscher Grund, der
-- Originaltext steht dann in DETAIL.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. Spalte „Mietkonto geführt ab“ (identisch mit 12_PROPERTIES, G13b-01) – damit 14 auch vor 12
--    eingespielt werden kann. Kommentar und Rückbau der Spalte gehören zu 12_PROPERTIES.
-- -----------------------------------------------------------------------------
alter table public.leases add column if not exists booking_start_date date;


-- -----------------------------------------------------------------------------
-- 1. G13b-10: Import in einer Transaktion
-- -----------------------------------------------------------------------------
create or replace function public.import_rows(p_plan jsonb)
 returns jsonb
 language plpgsql
 security invoker
 set search_path = public, pg_temp
 set statement_timeout = '60s'
as $function$
declare
    c_max constant integer := 5000;
    v_uid uuid := auth.uid();
    v_list text;
    v_item jsonb;
    v_i integer;
    v_idx integer;
    v_id uuid;
    v_ref uuid;
    v_unit_id uuid;
    v_tenant_id uuid;
    v_rows text;
    v_ctx text;
    v_portfolio_ids uuid[] := '{}';
    v_property_ids uuid[] := '{}';
    v_unit_ids uuid[] := '{}';
    v_tenant_ids uuid[] := '{}';
    v_leases integer := 0;
    v_booking integer := 0;
    v_booking_start date;
    v_state text;
    v_msg text;
    v_detail text;
    v_hint text;
    v_column text;
    v_constraint text;
    v_reason text;
begin
    if v_uid is null then
        raise exception 'Nicht angemeldet.' using errcode = '42501';
    end if;
    if p_plan is null or jsonb_typeof(p_plan) <> 'object' then
        raise exception 'Ungültiger Importplan.' using errcode = '22023';
    end if;
    foreach v_list in array array['portfolios', 'properties', 'units', 'tenants', 'leases'] loop
        if p_plan ? v_list and jsonb_typeof(p_plan -> v_list) <> 'array' then
            raise exception 'Ungültiger Importplan (%).', v_list using errcode = '22023';
        end if;
        if jsonb_array_length(coalesce(p_plan -> v_list, '[]'::jsonb)) > c_max then
            raise exception 'Zu viele Einträge im Import (%): höchstens % je Art.', v_list, c_max using errcode = '22023';
        end if;
    end loop;

    begin
        -- 1. Portfolios
        v_i := 0;
        for v_item in select value from jsonb_array_elements(coalesce(p_plan -> 'portfolios', '[]'::jsonb)) loop
            v_i := v_i + 1;
            v_rows := (select string_agg(r, ', ') from jsonb_array_elements_text(
                           case when jsonb_typeof(v_item -> 'rows') = 'array' then v_item -> 'rows' else '[]'::jsonb end) r);
            v_ctx := coalesce('Zeile ' || v_rows || ': ', '')
                     || 'Portfolio „' || coalesce(v_item ->> 'name', '') || '“ konnte nicht angelegt werden';

            insert into public.portfolios (user_id, name)
            values (v_uid, nullif(btrim(v_item ->> 'name'), ''))
            returning id into v_id;
            v_portfolio_ids[v_i] := v_id;
        end loop;

        -- 2. Immobilien
        v_i := 0;
        for v_item in select value from jsonb_array_elements(coalesce(p_plan -> 'properties', '[]'::jsonb)) loop
            v_i := v_i + 1;
            v_rows := (select string_agg(r, ', ') from jsonb_array_elements_text(
                           case when jsonb_typeof(v_item -> 'rows') = 'array' then v_item -> 'rows' else '[]'::jsonb end) r);
            v_ctx := coalesce('Zeile ' || v_rows || ': ', '')
                     || 'Immobilie ' || btrim(coalesce(v_item ->> 'street', '') || ' ' || coalesce(v_item ->> 'house_number', ''))
                     || ' konnte nicht angelegt werden';

            v_ref := nullif(v_item ->> 'portfolio_id', '')::uuid;
            if v_ref is null then
                v_idx := (v_item ->> 'portfolio_idx')::integer;
                if v_idx >= 0 and v_idx < coalesce(array_length(v_portfolio_ids, 1), 0) then
                    v_ref := v_portfolio_ids[v_idx + 1];
                end if;
                if v_ref is null then
                    raise exception 'Verweis auf das Portfolio fehlt im Importplan.';
                end if;
            elsif not exists (select 1 from public.portfolios po where po.id = v_ref and po.user_id = v_uid) then
                raise exception 'Das Portfolio wurde nicht gefunden oder gehört nicht zu Ihrem Konto.';
            end if;

            insert into public.properties (user_id, portfolio_id, street, house_number, zip, city, construction_year, property_type)
            values (v_uid, v_ref,
                    nullif(btrim(v_item ->> 'street'), ''),
                    nullif(btrim(v_item ->> 'house_number'), ''),
                    nullif(btrim(v_item ->> 'zip'), ''),
                    nullif(btrim(v_item ->> 'city'), ''),
                    (v_item ->> 'construction_year')::integer,
                    coalesce(nullif(btrim(v_item ->> 'property_type'), ''), 'residential'))
            returning id into v_id;
            v_property_ids[v_i] := v_id;
        end loop;

        -- 3. Einheiten
        v_i := 0;
        for v_item in select value from jsonb_array_elements(coalesce(p_plan -> 'units', '[]'::jsonb)) loop
            v_i := v_i + 1;
            v_rows := (select string_agg(r, ', ') from jsonb_array_elements_text(
                           case when jsonb_typeof(v_item -> 'rows') = 'array' then v_item -> 'rows' else '[]'::jsonb end) r);
            v_ctx := coalesce('Zeile ' || v_rows || ': ', '')
                     || 'Einheit „' || coalesce(v_item ->> 'unit_name', '') || '“ konnte nicht angelegt werden';

            v_ref := nullif(v_item ->> 'property_id', '')::uuid;
            if v_ref is null then
                v_idx := (v_item ->> 'property_idx')::integer;
                if v_idx >= 0 and v_idx < coalesce(array_length(v_property_ids, 1), 0) then
                    v_ref := v_property_ids[v_idx + 1];
                end if;
                if v_ref is null then
                    raise exception 'Verweis auf die Immobilie fehlt im Importplan.';
                end if;
            elsif not exists (select 1
                                from public.properties pr
                                join public.portfolios po on po.id = pr.portfolio_id
                               where pr.id = v_ref and po.user_id = v_uid) then
                raise exception 'Die Immobilie wurde nicht gefunden oder gehört nicht zu Ihrem Konto.';
            end if;

            insert into public.units (user_id, property_id, unit_name, floor, sqm, rooms, bathrooms, bedrooms,
                                      balcony, fitted_kitchen, is_vacation_rental, cold_rent_ist, target_rent)
            values (v_uid, v_ref,
                    nullif(btrim(v_item ->> 'unit_name'), ''),
                    nullif(btrim(v_item ->> 'floor'), ''),
                    (v_item ->> 'sqm')::numeric,
                    (v_item ->> 'rooms')::numeric,
                    (v_item ->> 'bathrooms')::integer,
                    (v_item ->> 'bedrooms')::integer,
                    coalesce((v_item ->> 'balcony')::boolean, false),
                    coalesce((v_item ->> 'fitted_kitchen')::boolean, false),
                    coalesce((v_item ->> 'is_vacation_rental')::boolean, false),
                    (v_item ->> 'cold_rent_ist')::numeric,
                    (v_item ->> 'target_rent')::numeric)
            returning id into v_id;
            v_unit_ids[v_i] := v_id;
        end loop;

        -- 4. Mieter
        v_i := 0;
        for v_item in select value from jsonb_array_elements(coalesce(p_plan -> 'tenants', '[]'::jsonb)) loop
            v_i := v_i + 1;
            v_rows := (select string_agg(r, ', ') from jsonb_array_elements_text(
                           case when jsonb_typeof(v_item -> 'rows') = 'array' then v_item -> 'rows' else '[]'::jsonb end) r);
            v_ctx := coalesce('Zeile ' || v_rows || ': ', '')
                     || 'Mieter ' || coalesce(v_item ->> 'last_name', '') || ' konnte nicht angelegt werden';

            insert into public.tenants (user_id, first_name, last_name, email, phone, occupants)
            values (v_uid,
                    nullif(btrim(v_item ->> 'first_name'), ''),
                    nullif(btrim(v_item ->> 'last_name'), ''),
                    nullif(btrim(v_item ->> 'email'), ''),
                    nullif(btrim(v_item ->> 'phone'), ''),
                    (v_item ->> 'occupants')::integer)
            returning id into v_id;
            v_tenant_ids[v_i] := v_id;
        end loop;

        -- 5. Mietverträge
        for v_item in select value from jsonb_array_elements(coalesce(p_plan -> 'leases', '[]'::jsonb)) loop
            v_rows := (select string_agg(r, ', ') from jsonb_array_elements_text(
                           case when jsonb_typeof(v_item -> 'rows') = 'array' then v_item -> 'rows' else '[]'::jsonb end) r);
            v_ctx := coalesce('Zeile ' || v_rows || ': ', '') || 'Mietvertrag konnte nicht angelegt werden';

            v_unit_id := nullif(v_item ->> 'unit_id', '')::uuid;
            if v_unit_id is null then
                v_idx := (v_item ->> 'unit_idx')::integer;
                if v_idx >= 0 and v_idx < coalesce(array_length(v_unit_ids, 1), 0) then
                    v_unit_id := v_unit_ids[v_idx + 1];
                end if;
                if v_unit_id is null then
                    raise exception 'Verweis auf die Einheit fehlt im Importplan.';
                end if;
            elsif not exists (select 1
                                from public.units u
                                join public.properties pr on pr.id = u.property_id
                                join public.portfolios po on po.id = pr.portfolio_id
                               where u.id = v_unit_id and po.user_id = v_uid) then
                raise exception 'Die Einheit wurde nicht gefunden oder gehört nicht zu Ihrem Konto.';
            end if;

            v_tenant_id := nullif(v_item ->> 'tenant_id', '')::uuid;
            if v_tenant_id is null then
                v_idx := (v_item ->> 'tenant_idx')::integer;
                if v_idx >= 0 and v_idx < coalesce(array_length(v_tenant_ids, 1), 0) then
                    v_tenant_id := v_tenant_ids[v_idx + 1];
                end if;
                if v_tenant_id is null then
                    raise exception 'Verweis auf den Mieter fehlt im Importplan.';
                end if;
            elsif not exists (select 1 from public.tenants t where t.id = v_tenant_id) then
                raise exception 'Der Mieter wurde nicht gefunden.';
            end if;

            v_booking_start := (v_item ->> 'booking_start_date')::date;

            insert into public.leases (user_id, unit_id, tenant_id, status, start_date, cold_rent, service_charge,
                                       heating_cost, other_costs, deposit, last_rent_increase, booking_start_date)
            values (v_uid, v_unit_id, v_tenant_id, 'active',
                    (v_item ->> 'start_date')::date,
                    coalesce((v_item ->> 'cold_rent')::numeric, 0),
                    coalesce((v_item ->> 'service_charge')::numeric, 0),
                    coalesce((v_item ->> 'heating_cost')::numeric, 0),
                    coalesce((v_item ->> 'other_costs')::numeric, 0),
                    (v_item ->> 'deposit')::numeric,
                    (v_item ->> 'last_rent_increase')::date,
                    v_booking_start);
            v_leases := v_leases + 1;
            if v_booking_start is not null then
                v_booking := v_booking + 1;
            end if;
        end loop;

    exception when others then
        -- Zeitüberschreitung/Abbruch (query_canceled) fängt "others" nicht – rollt ebenfalls alles zurück.
        get stacked diagnostics
            v_state = returned_sqlstate,
            v_msg = message_text,
            v_detail = pg_exception_detail,
            v_hint = pg_exception_hint,
            v_column = column_name,
            v_constraint = constraint_name;

        v_reason := case
            when v_state = '42501' and (v_msg like 'new row violates row-level security policy%' or v_msg like 'permission denied%')
                then 'keine Berechtigung für diesen Datensatz'
            when v_state = '23502'
                then 'Pflichtangabe fehlt' || coalesce(' (' || v_column || ')', '')
            when v_state = '23505'
                then 'ein gleichartiger Datensatz ist bereits vorhanden' || coalesce(' (' || v_constraint || ')', '')
            when v_state = '23503'
                then 'ein verknüpfter Datensatz fehlt oder wurde inzwischen gelöscht'
            when v_state = '23514'
                then 'unzulässiger Wert' || coalesce(' (' || v_constraint || ')', '')
            when v_state in ('22P02', '22007', '22008', '22003', '22023', '2200N')
                then 'ungültiger Wert im Importplan'
            else null
        end;

        raise exception using
            errcode = v_state,
            message = coalesce(v_ctx || ': ', '') || coalesce(v_reason, v_msg),
            detail = case when v_reason is not null then v_msg else coalesce(v_detail, '') end,
            hint = coalesce(v_hint, '');
    end;

    return jsonb_build_object(
        'portfolios', coalesce(array_length(v_portfolio_ids, 1), 0),
        'properties', coalesce(array_length(v_property_ids, 1), 0),
        'units', coalesce(array_length(v_unit_ids, 1), 0),
        'tenants', coalesce(array_length(v_tenant_ids, 1), 0),
        'leases', v_leases,
        'booking_start_leases', v_booking
    );
end;
$function$;

comment on function public.import_rows(jsonb) is
    'Excel-Import (Import.jsx): legt Portfolios, Immobilien, Einheiten, Mieter und Mietverträge aus dem '
    'geprüften Importplan in einer Transaktion an (alles oder nichts). SECURITY INVOKER – RLS des Aufrufers.';

revoke all on function public.import_rows(jsonb) from public, anon;
grant execute on function public.import_rows(jsonb) to authenticated;
