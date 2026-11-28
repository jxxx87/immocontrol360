-- =============================================================================
-- Welle 3 · Paket 12 PROPERTIES (Objekte, Wirtschaftseinheiten, Portfolio-Löschung, Mietkonto-Stichtag)
-- Befunde:
--   G13b-01  leases.booking_start_date („Mietkonto geführt ab“) – Stichtag je Vertrag, ab dem
--            Rückstände gezählt werden. Die App wertet die Spalte bereits aus (rentArrears.js).
--   G06b-09  document_templates.portfolio_id: ON DELETE SET NULL -> CASCADE. Portfolio-eigene
--            Schreibvorlagen werden beim Löschen des Portfolios mitgelöscht, statt still zu
--            allgemeinen Vorlagen zu werden (und mit unique_user_type_template zu kollidieren).
--   G12a-05  save_property_economic_unit(): Objekt + Wirtschaftseinheit (Gesamtwerte, Zuordnen,
--            Lösen) in EINER Transaktion. SECURITY INVOKER – es gelten die RLS-Regeln des Nutzers.
--   G04-11   delete_portfolio(): Übertrag aller Inhalte in ein Zielportfolio bzw. endgültiges
--            Löschen und das Löschen des Portfolios in EINER Transaktion. SECURITY DEFINER mit
--            Eigentümer-Prüfung für Quelle und Ziel.
--
-- Idempotent (add column if not exists / create or replace / Constraint nur bei Abweichung).
-- Keine Signatur bestehender Funktionen geändert (beide Funktionen sind neu). notify_push unberührt.
-- Verträglich mit der heute ausgelieferten App: neue Spalte ist nullable (NULL = bisherige Heuristik),
-- die neuen Funktionen werden von ihr nicht aufgerufen; der CASCADE-Fremdschlüssel greift nur beim
-- Löschen eines Portfolios (die heutige App löscht kollidierende Vorlagen vorher selbst, die übrigen
-- würden jetzt mitgelöscht statt zu allgemeinen Vorlagen zu werden).
-- Die neue App (Properties.jsx, Settings.jsx, Import.jsx, Dashboard.jsx) setzt diese Migration voraus.
-- Fehlermeldungen der beiden Funktionen bewusst ohne eigenen SQLSTATE (P0001): translateError zeigt
-- P0001-Texte auf Deutsch unverändert an, ersetzt 42501 aber durch eine allgemeine Berechtigungsmeldung.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. G13b-01: Beginn der Mietkonto-Führung je Vertrag
-- -----------------------------------------------------------------------------
alter table public.leases add column if not exists booking_start_date date;

comment on column public.leases.booking_start_date is
    'Beginn der Mietkonto-Führung in ImmoControl360 (z. B. Importmonat bei Bestandsverträgen). '
    'Monate vor diesem Stichtag gelten in der App nicht als Mietrückstand (einblendbar). '
    'NULL = Heuristik über den Erfassungszeitpunkt des Vertrags.';


-- -----------------------------------------------------------------------------
-- 2. G06b-09: Portfolio-Vorlagen beim Löschen des Portfolios mitlöschen
-- -----------------------------------------------------------------------------
do $$
begin
    if not exists (select 1 from pg_constraint
                    where conrelid = 'public.document_templates'::regclass
                      and conname = 'document_templates_portfolio_id_fkey'
                      and contype = 'f'
                      and confdeltype = 'c') then
        alter table public.document_templates
            drop constraint if exists document_templates_portfolio_id_fkey;
        alter table public.document_templates
            add constraint document_templates_portfolio_id_fkey
                foreign key (portfolio_id) references public.portfolios(id) on delete cascade;
    end if;
end $$;


-- -----------------------------------------------------------------------------
-- 3. G12a-05: Objekt speichern inkl. Wirtschaftseinheit – atomar
--
--    p_property_id      NULL = neues Objekt, sonst das bearbeitete Objekt
--    p_portfolio_id     Portfolio des Objekts (beim Bearbeiten unverändert)
--    p_property         {street, house_number, zip, city, construction_year, property_type,
--                        total_investment_cost, equity_invested, thumbnail_image}
--                        – total_investment_cost/equity_invested sind die Formularwerte
--                          (bei einer WE deren Gesamtwerte)
--    p_we_id            Wirtschaftseinheit (NULL = keine); existiert sie nicht, wird sie angelegt
--    p_join_ids         Objekte, die der WE angehören sollen (bereits zugeordnete werden übersprungen)
--    p_remove_ids       Objekte, die aus der WE gelöst werden
--    p_add_member_values  Werte neu zugeordneter Objekte zu den WE-Gesamtwerten addieren
--
--    Ablauf: Mitglieder sperren und prüfen -> WE-Gesamtwerte -> Objekt -> Mitglieder zuordnen
--    (Einzelwerte 0) -> Mitglieder lösen. Trifft ein Schritt weniger Zeilen als erwartet (z. B. von
--    RLS blockiert), bricht alles ab – es bleibt nichts halb gespeichert.
-- -----------------------------------------------------------------------------
create or replace function public.save_property_economic_unit(
    p_property_id uuid,
    p_portfolio_id uuid,
    p_property jsonb,
    p_we_id uuid default null,
    p_join_ids uuid[] default '{}'::uuid[],
    p_remove_ids uuid[] default '{}'::uuid[],
    p_add_member_values boolean default true
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
    v_uid uuid := auth.uid();
    v_owner uuid;
    v_prop_id uuid := p_property_id;
    v_join uuid[];
    v_remove uuid[];
    v_joining uuid[] := '{}'::uuid[];
    v_street text;
    v_house text;
    v_investment numeric;
    v_equity numeric;
    v_join_investment numeric := 0;
    v_join_equity numeric := 0;
    v_other_portfolio int := 0;
    v_other_we int := 0;
    v_rows int;
begin
    if v_uid is null then
        raise exception 'Bitte melden Sie sich an.';
    end if;
    if p_portfolio_id is null then
        raise exception 'Bitte wählen Sie ein Portfolio aus.';
    end if;
    if p_property is null or jsonb_typeof(p_property) <> 'object' then
        raise exception 'Die Angaben zur Immobilie fehlen.';
    end if;

    v_join := coalesce((select array_agg(distinct x) from unnest(coalesce(p_join_ids, '{}'::uuid[])) as t(x) where x is not null), '{}'::uuid[]);
    v_remove := coalesce((select array_agg(distinct x) from unnest(coalesce(p_remove_ids, '{}'::uuid[])) as t(x) where x is not null), '{}'::uuid[]);

    v_street := btrim(coalesce(p_property ->> 'street', ''));
    v_house := btrim(coalesce(p_property ->> 'house_number', ''));
    if v_street = '' or v_house = '' then
        raise exception 'Bitte geben Sie Straße und Hausnummer an.';
    end if;

    v_investment := coalesce(nullif(p_property ->> 'total_investment_cost', '')::numeric, 0);
    v_equity := coalesce(nullif(p_property ->> 'equity_invested', '')::numeric, 0);
    if v_investment < 0 or v_equity < 0 then
        raise exception 'Gesamtinvestition und Eigenkapital dürfen nicht negativ sein.';
    end if;

    if p_we_id is null and (cardinality(v_join) > 0 or cardinality(v_remove) > 0) then
        raise exception 'Ohne Wirtschaftseinheit können keine Objekte zugeordnet oder gelöst werden.';
    end if;
    if (v_join && v_remove) or (v_prop_id is not null and (v_prop_id = any(v_join) or v_prop_id = any(v_remove))) then
        raise exception 'Die Auswahl der Wirtschaftseinheit ist widersprüchlich. Bitte laden Sie die Seite neu.';
    end if;

    -- Eigentümer des Portfolios (neue Wirtschaftseinheiten gehören ihm); nur sichtbare Portfolios
    select po.user_id into v_owner from public.portfolios po where po.id = p_portfolio_id;
    if v_owner is null then
        raise exception 'Das Portfolio wurde nicht gefunden oder Sie haben keinen Zugriff darauf.';
    end if;

    -- 1. Mitglieder sperren. FOR UPDATE liefert nur Zeilen, die der Nutzer auch ändern darf.
    if cardinality(v_join) > 0 then
        select count(*) into v_rows
          from (select pr.id from public.properties pr where pr.id = any(v_join) for update) s;
        if v_rows <> cardinality(v_join) then
            raise exception 'Mindestens ein ausgewähltes Objekt der Wirtschaftseinheit ist nicht mehr verfügbar oder Sie haben keine Schreibberechtigung dafür. Es wurde nichts geändert.';
        end if;

        select count(*) filter (where pr.portfolio_id <> p_portfolio_id),
               count(*) filter (where pr.economic_unit_id is not null and pr.economic_unit_id <> p_we_id),
               coalesce(array_agg(pr.id) filter (where pr.economic_unit_id is distinct from p_we_id), '{}'::uuid[]),
               coalesce(sum(coalesce(pr.total_investment_cost, 0)) filter (where pr.economic_unit_id is distinct from p_we_id), 0),
               coalesce(sum(coalesce(pr.equity_invested, 0)) filter (where pr.economic_unit_id is distinct from p_we_id), 0)
          into v_other_portfolio, v_other_we, v_joining, v_join_investment, v_join_equity
          from public.properties pr
         where pr.id = any(v_join);

        if v_other_portfolio > 0 then
            raise exception 'Eine Wirtschaftseinheit kann nur Objekte desselben Portfolios enthalten. Es wurde nichts geändert.';
        end if;
        if v_other_we > 0 then
            raise exception 'Mindestens ein ausgewähltes Objekt gehört bereits zu einer anderen Wirtschaftseinheit. Bitte lösen Sie es zuerst dort heraus. Es wurde nichts geändert.';
        end if;
    end if;

    if cardinality(v_remove) > 0 then
        select count(*) into v_rows
          from (select pr.id from public.properties pr
                 where pr.id = any(v_remove) and pr.economic_unit_id = p_we_id
                 for update) s;
        if v_rows <> cardinality(v_remove) then
            raise exception 'Mindestens ein zu lösendes Objekt gehört nicht mehr zu dieser Wirtschaftseinheit oder Sie haben keine Schreibberechtigung dafür. Bitte laden Sie die Seite neu. Es wurde nichts geändert.';
        end if;
    end if;

    -- 2. Wirtschaftseinheit: Gesamtwerte (user_id nur beim Anlegen)
    if p_we_id is not null then
        update public.economic_units e
           set total_investment_cost = v_investment + case when p_add_member_values then v_join_investment else 0 end,
               equity_invested = v_equity + case when p_add_member_values then v_join_equity else 0 end,
               updated_at = now()
         where e.id = p_we_id;
        get diagnostics v_rows = row_count;
        if v_rows = 0 then
            begin
                insert into public.economic_units (id, user_id, total_investment_cost, equity_invested, updated_at)
                values (p_we_id, v_owner,
                        v_investment + case when p_add_member_values then v_join_investment else 0 end,
                        v_equity + case when p_add_member_values then v_join_equity else 0 end,
                        now());
            exception when unique_violation then
                -- existiert, ist für den Nutzer aber nicht änderbar
                raise exception 'Die Gesamtwerte der Wirtschaftseinheit konnten nicht gespeichert werden (keine Berechtigung). Es wurde nichts geändert.';
            end;
        end if;
    end if;

    -- 3. Objekt (Eigentümer und Portfolio bleiben beim Bearbeiten unverändert)
    if v_prop_id is null then
        insert into public.properties (
            user_id, portfolio_id, street, house_number, zip, city, construction_year, property_type,
            total_investment_cost, equity_invested, economic_unit_id, thumbnail_image)
        values (
            v_owner, p_portfolio_id, v_street, v_house,
            btrim(coalesce(p_property ->> 'zip', '')),
            btrim(coalesce(p_property ->> 'city', '')),
            nullif(p_property ->> 'construction_year', '')::integer,
            coalesce(nullif(p_property ->> 'property_type', ''), 'residential'),
            case when p_we_id is null then v_investment else 0 end,
            case when p_we_id is null then v_equity else 0 end,
            p_we_id,
            nullif(p_property ->> 'thumbnail_image', ''))
        returning id into v_prop_id;
    else
        update public.properties pr
           set street = v_street,
               house_number = v_house,
               zip = btrim(coalesce(p_property ->> 'zip', '')),
               city = btrim(coalesce(p_property ->> 'city', '')),
               construction_year = nullif(p_property ->> 'construction_year', '')::integer,
               property_type = case when p_property ? 'property_type'
                                    then coalesce(nullif(p_property ->> 'property_type', ''), pr.property_type)
                                    else pr.property_type end,
               total_investment_cost = case when p_we_id is null then v_investment else 0 end,
               equity_invested = case when p_we_id is null then v_equity else 0 end,
               economic_unit_id = p_we_id,
               thumbnail_image = case when p_property ? 'thumbnail_image'
                                      then nullif(p_property ->> 'thumbnail_image', '')
                                      else pr.thumbnail_image end
         where pr.id = v_prop_id
           and pr.portfolio_id = p_portfolio_id;
        get diagnostics v_rows = row_count;
        if v_rows = 0 then
            raise exception 'Die Immobilie konnte nicht gespeichert werden (keine Berechtigung oder nicht mehr vorhanden). Es wurde nichts geändert.';
        end if;
    end if;

    -- 4. Neue Mitglieder zuordnen; ihre Einzelwerte stecken (optional) in den WE-Gesamtwerten
    if cardinality(v_joining) > 0 then
        update public.properties pr
           set economic_unit_id = p_we_id,
               total_investment_cost = 0,
               equity_invested = 0
         where pr.id = any(v_joining);
        get diagnostics v_rows = row_count;
        if v_rows <> cardinality(v_joining) then
            raise exception 'Mindestens ein Objekt konnte der Wirtschaftseinheit nicht zugeordnet werden (keine Berechtigung). Es wurde nichts geändert.';
        end if;
    end if;

    -- 5. Mitglieder lösen (ihre Einzelwerte trägt der Nutzer danach selbst ein)
    if cardinality(v_remove) > 0 then
        update public.properties pr
           set economic_unit_id = null
         where pr.id = any(v_remove)
           and pr.economic_unit_id = p_we_id;
        get diagnostics v_rows = row_count;
        if v_rows <> cardinality(v_remove) then
            raise exception 'Mindestens ein Objekt konnte nicht aus der Wirtschaftseinheit gelöst werden (keine Berechtigung). Es wurde nichts geändert.';
        end if;
    end if;

    return v_prop_id;
end;
$$;

comment on function public.save_property_economic_unit(uuid, uuid, jsonb, uuid, uuid[], uuid[], boolean) is
    'Speichert ein Objekt samt Wirtschaftseinheit (Gesamtwerte, Zuordnen, Lösen) in einer Transaktion. '
    'SECURITY INVOKER: es gelten die RLS-Regeln des aufrufenden Nutzers. Aufruf: Properties.jsx handleSaveProperty.';

revoke all on function public.save_property_economic_unit(uuid, uuid, jsonb, uuid, uuid[], uuid[], boolean) from public, anon;
grant execute on function public.save_property_economic_unit(uuid, uuid, jsonb, uuid, uuid[], uuid[], boolean) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 4. G04-11: Portfolio löschen – Übertrag bzw. endgültiges Löschen in einer Transaktion
--
--    p_target_id gesetzt: Objekte (mit Einheiten, Verträgen, Mietkonto, Zahlungen, Abrechnungen,
--      Dokumenten, Forderungen), Zähler, Zählerstände, Rechnungen, Darlehen und Deals wandern ins
--      Ziel; Rechnungsnummern-Zähler werden zusammengeführt (höchster Stand gewinnt); Portfolio-
--      Vorlagen und die PDF-Vorlage werden übernommen, sofern das Ziel keine gleichartige hat.
--    p_target_id NULL: nie mit Rechnungen (Aufbewahrungspflicht) oder Darlehen; Objekte nur mit
--      p_delete_properties = true und ohne Mietverträge, NK-Abrechnungen, Dokumente, Forderungen.
--    Freigaben und Cloud-Verknüpfung des Portfolios entfallen (Fremdschlüssel CASCADE).
--    Jeder Fehler bricht ALLES ab – es bleibt kein teilübertragener Stand zurück.
-- -----------------------------------------------------------------------------
create or replace function public.delete_portfolio(
    p_portfolio_id uuid,
    p_target_id uuid default null,
    p_delete_properties boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_uid uuid := auth.uid();
    v_src public.portfolios%rowtype;
    v_n int;
    v_dupes text;
    v_we_ids uuid[];
    v_result jsonb := '{}'::jsonb;
begin
    if v_uid is null then
        raise exception 'Bitte melden Sie sich an.';
    end if;
    if p_portfolio_id is null then
        raise exception 'Kein Portfolio angegeben.';
    end if;

    -- Quelle sperren (gleichzeitige Löschungen/Überträge serialisieren); nur der Eigentümer
    select * into v_src from public.portfolios po where po.id = p_portfolio_id for update;
    if not found or v_src.user_id is distinct from v_uid then
        raise exception 'Nur der Eigentümer kann dieses Portfolio löschen.';
    end if;
    if coalesce(v_src.is_primary, false) then
        raise exception 'Das Hauptportfolio kann nicht gelöscht werden.';
    end if;

    if p_target_id is not null then
        if p_target_id = p_portfolio_id then
            raise exception 'Bitte wählen Sie ein anderes Portfolio als Ziel.';
        end if;
        perform 1 from public.portfolios po where po.id = p_target_id and po.user_id = v_uid for update;
        if not found then
            raise exception 'Bitte wählen Sie eines Ihrer eigenen Portfolios als Ziel.';
        end if;

        -- Doppelte Rechnungsnummern würden den Übertrag am Unique-Index scheitern lassen
        select string_agg(num, ', ') into v_dupes
          from (select distinct s.invoice_number as num
                  from public.invoices s
                  join public.invoices d on d.portfolio_id = p_target_id and d.invoice_number = s.invoice_number
                 where s.portfolio_id = p_portfolio_id
                 order by 1
                 limit 3) x;
        if v_dupes is not null then
            raise exception 'Im Zielportfolio gibt es bereits Rechnungen mit denselben Nummern (z. B. %). Die Rechnungen können deshalb nicht übertragen werden. Bitte wählen Sie ein anderes Zielportfolio. Es wurde nichts verändert.', v_dupes;
        end if;

        update public.properties set portfolio_id = p_target_id where portfolio_id = p_portfolio_id;
        get diagnostics v_n = row_count;
        v_result := v_result || jsonb_build_object('properties', v_n);

        update public.meters set portfolio_id = p_target_id where portfolio_id = p_portfolio_id;
        get diagnostics v_n = row_count;
        v_result := v_result || jsonb_build_object('meters', v_n);

        update public.meter_readings set portfolio_id = p_target_id where portfolio_id = p_portfolio_id;
        get diagnostics v_n = row_count;
        v_result := v_result || jsonb_build_object('meter_readings', v_n);

        update public.invoices set portfolio_id = p_target_id where portfolio_id = p_portfolio_id;
        get diagnostics v_n = row_count;
        v_result := v_result || jsonb_build_object('invoices', v_n);

        update public.loans set portfolio_id = p_target_id where portfolio_id = p_portfolio_id;
        get diagnostics v_n = row_count;
        v_result := v_result || jsonb_build_object('loans', v_n);

        update public.deals set portfolio_id = p_target_id where portfolio_id = p_portfolio_id;
        get diagnostics v_n = row_count;
        v_result := v_result || jsonb_build_object('deals', v_n);

        -- Rechnungsnummern-Zähler: gleicher Zähler im Ziel -> höchster Stand; sonst umhängen.
        -- Zusammengeführte Quell-Zähler entfallen mit dem Portfolio (CASCADE).
        update public.invoice_counters d
           set last_number = greatest(d.last_number, s.last_number)
          from public.invoice_counters s
         where s.portfolio_id = p_portfolio_id
           and d.portfolio_id = p_target_id
           and d.year = s.year
           and d.object_unit_id is not distinct from s.object_unit_id;
        update public.invoice_counters s
           set portfolio_id = p_target_id
         where s.portfolio_id = p_portfolio_id
           and not exists (select 1 from public.invoice_counters d
                            where d.portfolio_id = p_target_id
                              and d.year = s.year
                              and d.object_unit_id is not distinct from s.object_unit_id);

        -- Portfolio-Vorlagen: übernehmen, sofern das Ziel keine Vorlage gleichen Typs hat (sonst entfallen sie)
        delete from public.document_templates s
         where s.portfolio_id = p_portfolio_id
           and exists (select 1 from public.document_templates d
                        where d.portfolio_id = p_target_id and d.type = s.type);
        update public.document_templates set portfolio_id = p_target_id where portfolio_id = p_portfolio_id;
        get diagnostics v_n = row_count;
        v_result := v_result || jsonb_build_object('document_templates', v_n);

        -- PDF-Vorlage (eine je Portfolio): nur übernehmen, wenn das Ziel noch keine hat
        if not exists (select 1 from public.pdf_templates where portfolio_id = p_target_id) then
            update public.pdf_templates
               set portfolio_id = p_target_id
             where id = (select t.id from public.pdf_templates t where t.portfolio_id = p_portfolio_id limit 1);
        end if;
    else
        if exists (select 1 from public.invoices where portfolio_id = p_portfolio_id) then
            raise exception 'Dieses Portfolio enthält Rechnungen. Rechnungen unterliegen Aufbewahrungspflichten (§ 147 AO, § 14b UStG) und werden nicht mitgelöscht. Bitte übertragen Sie die Inhalte in ein anderes Portfolio.';
        end if;
        if exists (select 1 from public.loans l
                    where l.portfolio_id = p_portfolio_id
                       or l.property_id in (select pr.id from public.properties pr where pr.portfolio_id = p_portfolio_id)) then
            raise exception 'Dieses Portfolio enthält Darlehen. Bitte übertragen Sie die Inhalte in ein anderes Portfolio oder löschen Sie die Darlehen zuerst unter „Finanzierungen“.';
        end if;

        if exists (select 1 from public.properties where portfolio_id = p_portfolio_id) then
            if not coalesce(p_delete_properties, false) then
                raise exception 'Dieses Portfolio enthält Immobilien. Bitte wählen Sie ein Ziel-Portfolio für die Übertragung aus ODER bestätigen Sie die endgültige Löschung.';
            end if;
            if exists (select 1 from public.documents doc
                        where doc.property_id in (select pr.id from public.properties pr where pr.portfolio_id = p_portfolio_id)
                           or doc.unit_id in (select u.id from public.units u
                                                join public.properties pr on pr.id = u.property_id
                                               where pr.portfolio_id = p_portfolio_id))
               or exists (select 1 from public.claims c
                            join public.leases l on l.id = c.lease_id
                            join public.units u on u.id = l.unit_id
                            join public.properties pr on pr.id = u.property_id
                           where pr.portfolio_id = p_portfolio_id) then
                raise exception 'Zu den Objekten gibt es noch Dokumente oder Forderungsakten. Diese verhindern das Löschen. Bitte übertragen Sie die Inhalte in ein anderes Portfolio oder entfernen Sie Dokumente/Forderungen zuerst.';
            end if;
            if exists (select 1 from public.leases l
                         join public.units u on u.id = l.unit_id
                         join public.properties pr on pr.id = u.property_id
                        where pr.portfolio_id = p_portfolio_id) then
                raise exception 'Zu den Objekten gibt es noch Mietverträge. Mietverträge mit Mietkonto und Zahlungen werden nicht mitgelöscht. Bitte übertragen Sie die Inhalte in ein anderes Portfolio oder entfernen Sie die Mietverträge zuerst.';
            end if;
            if exists (select 1 from public.utility_settlements us
                        where us.property_id in (select pr.id from public.properties pr where pr.portfolio_id = p_portfolio_id)) then
                raise exception 'Zu den Objekten gibt es noch Nebenkostenabrechnungen. Diese werden nicht mitgelöscht. Bitte übertragen Sie die Inhalte in ein anderes Portfolio.';
            end if;

            select coalesce(array_agg(distinct pr.economic_unit_id), '{}'::uuid[]) into v_we_ids
              from public.properties pr
             where pr.portfolio_id = p_portfolio_id and pr.economic_unit_id is not null;

            -- Objekte mit Einheiten, Zählern usw. (Fremdschlüssel); weitere Sperren der DB brechen alles ab
            delete from public.properties where portfolio_id = p_portfolio_id;
            get diagnostics v_n = row_count;
            v_result := v_result || jsonb_build_object('properties_deleted', v_n);

            -- Verwaiste Wirtschaftseinheiten ohne Darlehen und NK-Abrechnungen entfernen
            delete from public.economic_units e
             where e.id = any(v_we_ids)
               and not exists (select 1 from public.properties pr where pr.economic_unit_id = e.id)
               and not exists (select 1 from public.loans l where l.economic_unit_id = e.id)
               and not exists (select 1 from public.utility_settlements us where us.economic_unit_id = e.id);
        end if;

        -- Portfolio-eigene Schreibvorlagen entfallen mit dem Portfolio (unabhängig vom Fremdschlüssel)
        delete from public.document_templates where portfolio_id = p_portfolio_id;
        get diagnostics v_n = row_count;
        v_result := v_result || jsonb_build_object('document_templates_deleted', v_n);
    end if;

    delete from public.portfolios po
     where po.id = p_portfolio_id
       and po.user_id = v_uid
       and coalesce(po.is_primary, false) = false;
    get diagnostics v_n = row_count;
    if v_n <> 1 then
        raise exception 'Das Portfolio wurde nicht gelöscht (keine Berechtigung).';
    end if;

    return v_result || jsonb_build_object('deleted', true);
end;
$$;

comment on function public.delete_portfolio(uuid, uuid, boolean) is
    'Löscht ein eigenes Nicht-Hauptportfolio; mit Ziel werden alle Inhalte vorher übertragen. '
    'Alles in einer Transaktion. SECURITY DEFINER mit Eigentümer-Prüfung (Quelle und Ziel). Aufruf: Settings.jsx.';

revoke all on function public.delete_portfolio(uuid, uuid, boolean) from public, anon;
grant execute on function public.delete_portfolio(uuid, uuid, boolean) to authenticated, service_role;
