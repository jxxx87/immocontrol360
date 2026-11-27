-- =============================================================================
-- 101000_schema_integrity.sql · Paket DB-SCHEMA · Komplett-Check 2026-11-27
--
-- Fremdschlüssel, Lösch-Regeln, Indizes, Constraints, Sicht invoice_totals.
-- Keine Policies (die gehören SEC-*), keine Änderung bestehender Funktions-Signaturen.
--
-- Befunde:
--   D4-02 (Thema 4.16, DB-Teil; dazu DB-Teil von G04-03, G12a-03, G17-02, G18-04)
--         Löschkaskaden für Buchungsdaten -> RESTRICT. Ein Löschen von Portfolio, Objekt,
--         Einheit oder Mietvertrag bricht ab, solange Mietverträge, Mietzahlungen, bearbeitete
--         Sollstellungen, Rechnungen oder NK-Abrechnungen daran hängen (statt still zu löschen).
--   M1-18 / M2-14 / D4-06 (teilweise)
--         user_id-Fremdschlüssel ohne Löschregel (rent_ledger, loans, economic_units, bank_*)
--         -> ON DELETE CASCADE, damit eine Konto-Löschung nicht an Altdaten hängen bleibt.
--         Akteur-Spalten objektkalender_events.completed_by / pdf_templates.updated_by -> SET NULL.
--   D4-08 (teilweise) leases.tenant_id SET NULL -> RESTRICT (Mieter mit Vertrag nicht direkt
--         löschbar; delete_tenant_completely trennt die Verträge vorher bewusst).
--   D4-11 Fremdschlüssel für economic_unit_id (properties SET NULL, loans/utility_settlements RESTRICT).
--   G14-08 / M2-16 bank_transactions: connection_id RESTRICT, Eindeutigkeit je Bankverbindung,
--         CHECK auf status.
--   M2-05 / D4-03 (SMTP-Teil) smtp_pass für den Browser nicht mehr lesbar (Spaltenrechte),
--         Tabelle aus der Realtime-Publication entfernt.
--   D4-05 Rechnungsnummer eindeutig je Portfolio; CHECK auf invoices.status; Beträge NOT NULL.
--   D4-10 invoice_counters: Eindeutigkeit auch bei object_unit_id NULL (NULLS NOT DISTINCT).
--   D4-13 invoice_totals: Brutto = gerundetes Netto + gerundete USt je Steuersatz.
--   D4-14 (teilweise) utility_settlements: user_id NOT NULL, Objekt oder Wirtschaftseinheit
--         Pflicht, status CHECK; rent_ledger.paid_amount/status NOT NULL.
--   M1-23 Standard-Verteilerschlüssel eindeutig (global) bzw. je Nutzer.
--   M2-11 (Datenteil) mandantenfremde Kontakt->Mieter-Verknüpfungen gelöst (live: 2).
--   M2-21 FCM-Token global eindeutig, „letzte Anmeldung gewinnt" per Trigger.
--   R2-12 (Schema-Teil) CHECK interest_rate >= 0 (claims, loans), Einheit dokumentiert.
--   G20-14 höchstens ein laufender Vermietungsprozess je Einheit.
--   G21-18 CHECK rental_viewings.slot_duration_minutes > 0.
--   CALENDAR-Hinweise: CHECK Farbe, cleaning_weekday NOT NULL, eine Einstellung je Objekt.
--   D2-21 Index portfolio_shares(lower(shared_with_email), status).
--   Advisor „unindexed foreign keys" (83 live): Index je Fremdschlüssel.
--
-- Bewusst NICHT geändert (Begründung im Bericht _fixwork/reports/DB-SCHEMA.md):
--   invoice_counters.portfolio_id bleibt CASCADE (ein Zähler ohne Rechnungen würde das Löschen
--   bzw. den Portfolio-Übertrag sonst unsichtbar blockieren; Rechnungen selbst sind RESTRICT),
--   loans.portfolio_id/property_id und documents.* bleiben ohne Löschregel (blockieren bereits),
--   tickets/messages-Kaskaden, user_roles SET NULL, Geldspalten-Präzision, Unique für
--   cloud_connections (alte cloud-auth-Version legt bei Neuverbindung neue Zeilen an).
--
-- Reihenfolge: nach 20261127100000_sec_access_helpers.sql und 100100…100900 (insbesondere
--   100300 delete_tenant_completely, 100800 Forderungen nicht löschbar, 100900 Miethistorie),
--   vor 109000_revoke_anon.sql. Keine Abhängigkeit zu 101100…101400.
-- Kompatibilität: Die App fragt vor jedem Löschen selbst ab und zeigt eigene Meldungen; die
--   Fremdschlüssel sind die serverseitige Absicherung (Fehler 23503 bzw. die deutsche Meldung des
--   Vertrags-Triggers). EmailSettings/Topbar/Contacts/Letting lesen smtp_pass nicht mehr; die
--   Edge Function send-letting-email liest mit service_role.
--   Einspiel-Reihenfolge: erst NACH Auslieferung der neuen Web-App. Die bisher ausgelieferte
--   Version (auch eine installierte Android-App mit gebündelten Dateien) liest in Topbar und
--   EmailSettings user_smtp_settings per select('*') und erhielte danach 42501 (Status
--   „nicht verbunden", leeres Formular) – Android-App vorher neu bauen.
-- Idempotent: mehrfaches Ausführen ist unschädlich. Constraints, die an Bestandsdaten scheitern
--   würden, werden mit WARNING übersprungen bzw. als NOT VALID angelegt (live geprüft: keine Treffer).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Datenbereinigung vor den Constraints
-- -----------------------------------------------------------------------------

-- 1a. M2-11: Kontakte, die mit einem Mieter eines ANDEREN Vermieters verknüpft sind, entkoppeln.
--     Der Kontakt bleibt erhalten; der Eigentümer des Mieters hat jeweils einen eigenen Kontakt.
update public.contacts c
   set tenant_id = null
  from public.tenants t
 where t.id = c.tenant_id
   and c.user_id is distinct from t.user_id;

-- 1b. D4-11: verwaiste economic_unit_id (live: keine) leeren, damit die neuen Fremdschlüssel greifen
update public.properties p
   set economic_unit_id = null
 where p.economic_unit_id is not null
   and not exists (select 1 from public.economic_units e where e.id = p.economic_unit_id);
update public.loans l
   set economic_unit_id = null
 where l.economic_unit_id is not null
   and not exists (select 1 from public.economic_units e where e.id = l.economic_unit_id);
update public.utility_settlements s
   set economic_unit_id = null
 where s.economic_unit_id is not null
   and not exists (select 1 from public.economic_units e where e.id = s.economic_unit_id);

-- 1c. M2-21: mehrfach (für verschiedene Nutzer) gespeicherte FCM-Tokens -> nur die jüngste Zeile
--     behalten (live: keine). Das Gerät registriert sich bei der nächsten Anmeldung neu.
delete from public.push_subscriptions p
 using public.push_subscriptions q
 where p.fcm_token = q.fcm_token
   and p.id <> q.id
   and (coalesce(p.updated_at, p.created_at, '-infinity'::timestamptz), p.id::text)
     < (coalesce(q.updated_at, q.created_at, '-infinity'::timestamptz), q.id::text);


-- -----------------------------------------------------------------------------
-- 2. Lösch-Regeln (D4-02, Thema 4.16)
--    Buchungsdaten: RESTRICT statt CASCADE. Die Kaskaden Portfolio -> Objekt -> Einheit
--    bleiben für reine Stammdaten bestehen; sie brechen ab, sobald darunter Buchungsdaten liegen.
--    Konto-Löschung (auth.users): alle user_id-Spalten kaskadieren weiterhin bzw. neu, damit die
--    eigenen Buchungsdaten eines Kontos im selben Löschvorgang entfernt werden (die RESTRICT-
--    Prüfungen laufen am Ende der Anweisung, nachdem die user_id-Kaskaden ausgeführt sind).
-- -----------------------------------------------------------------------------

-- Mietverträge: Einheit mit Vertrag nicht löschbar (vorher: Vertrag samt Mietkonto mitgelöscht)
alter table public.leases
    drop constraint if exists leases_unit_id_fkey,
    add constraint leases_unit_id_fkey
        foreign key (unit_id) references public.units(id) on delete restrict;

-- Mieter mit Vertrag nicht direkt löschbar (delete_tenant_completely löst die Verträge vorher)
alter table public.leases
    drop constraint if exists leases_tenant_id_fkey,
    add constraint leases_tenant_id_fkey
        foreign key (tenant_id) references public.tenants(id) on delete restrict;

-- Mietzahlungen hängen am Vertrag
alter table public.rent_payments
    drop constraint if exists rent_payments_lease_id_fkey,
    add constraint rent_payments_lease_id_fkey
        foreign key (lease_id) references public.leases(id) on delete restrict;

-- Mietkonto (Sollstellungen) hängt am Vertrag; unbearbeitete Auto-Sollstellungen ohne Zahlung
-- entfernt der Trigger unten beim Löschen des Vertrags
alter table public.rent_ledger
    drop constraint if exists rent_ledger_lease_id_fkey,
    add constraint rent_ledger_lease_id_fkey
        foreign key (lease_id) references public.leases(id) on delete restrict;

-- M1-18: Mietkonto-Zeilen eines gelöschten Kontos werden mitgelöscht (vorher: Konto nicht löschbar)
alter table public.rent_ledger
    drop constraint if exists rent_ledger_user_id_fkey,
    add constraint rent_ledger_user_id_fkey
        foreign key (user_id) references auth.users(id) on delete cascade;

-- Ausgangsrechnungen (Aufbewahrungspflicht § 147 AO, § 14b UStG)
alter table public.invoices
    drop constraint if exists invoices_portfolio_id_fkey,
    add constraint invoices_portfolio_id_fkey
        foreign key (portfolio_id) references public.portfolios(id) on delete restrict;

-- Nebenkostenabrechnungen
alter table public.utility_settlements
    drop constraint if exists utility_settlements_property_id_fkey,
    add constraint utility_settlements_property_id_fkey
        foreign key (property_id) references public.properties(id) on delete restrict;

-- Ratenplan-Anfragen gehören zur Forderungsakte (Forderungen selbst sind nicht löschbar)
alter table public.payment_plan_requests
    drop constraint if exists payment_plan_requests_claim_id_fkey,
    add constraint payment_plan_requests_claim_id_fkey
        foreign key (claim_id) references public.claims(id) on delete restrict;

-- G14-08: Bankverbindung mit Umsätzen nicht löschbar (verbuchte Umsätze = Nachweis)
alter table public.bank_transactions
    drop constraint if exists bank_transactions_connection_id_fkey,
    add constraint bank_transactions_connection_id_fkey
        foreign key (connection_id) references public.bank_connections(id) on delete restrict;

-- M1-18 / M2-14 / D4-06: Konto-Löschung nicht mehr durch Altdaten blockiert
alter table public.loans
    drop constraint if exists loans_user_id_fkey,
    add constraint loans_user_id_fkey
        foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.economic_units
    drop constraint if exists economic_units_user_id_fkey,
    add constraint economic_units_user_id_fkey
        foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.bank_connections
    drop constraint if exists bank_connections_user_id_fkey,
    add constraint bank_connections_user_id_fkey
        foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.bank_transactions
    drop constraint if exists bank_transactions_user_id_fkey,
    add constraint bank_transactions_user_id_fkey
        foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.bank_matching_rules
    drop constraint if exists bank_matching_rules_user_id_fkey,
    add constraint bank_matching_rules_user_id_fkey
        foreign key (user_id) references auth.users(id) on delete cascade;

-- Akteur-Spalten: Zeile bleibt, nur der Verweis auf das gelöschte Konto entfällt
-- (z. B. Mieter-Portalkonto, das einen Kalendertermin abgehakt hat)
alter table public.objektkalender_events
    drop constraint if exists objektkalender_events_completed_by_fkey,
    add constraint objektkalender_events_completed_by_fkey
        foreign key (completed_by) references auth.users(id) on delete set null;

alter table public.pdf_templates
    drop constraint if exists pdf_templates_updated_by_fkey,
    add constraint pdf_templates_updated_by_fkey
        foreign key (updated_by) references auth.users(id) on delete set null;

-- D4-11: Wirtschaftseinheiten
alter table public.properties
    drop constraint if exists properties_economic_unit_id_fkey,
    add constraint properties_economic_unit_id_fkey
        foreign key (economic_unit_id) references public.economic_units(id) on delete set null;

alter table public.loans
    drop constraint if exists loans_economic_unit_id_fkey,
    add constraint loans_economic_unit_id_fkey
        foreign key (economic_unit_id) references public.economic_units(id) on delete restrict;

alter table public.utility_settlements
    drop constraint if exists utility_settlements_economic_unit_id_fkey,
    add constraint utility_settlements_economic_unit_id_fkey
        foreign key (economic_unit_id) references public.economic_units(id) on delete restrict;


-- -----------------------------------------------------------------------------
-- 3. Vertrag löschen: verständliche Meldung + Auto-Sollstellungen entfernen (D4-02, G17-02, G18-04)
--    - Direktes Löschen (App/RPC, pg_trigger_depth() = 1): Abbruch mit deutscher Meldung, wenn
--      Zahlungen, Forderungen oder bearbeitete Sollstellungen (bezahlt, 'loss', Notiz,
--      in einer Forderung) vorliegen. Gleiche Regel wie checkLeaseDeletion in der App.
--    - Immer: unbezahlte, unbearbeitete, automatisch erzeugte Sollstellungen entfallen mit dem
--      Vertrag (bisheriges Verhalten der Kaskade); alles andere hält der Fremdschlüssel fest.
--    - Bei Kaskaden (Konto-Löschung) keine Meldung: dort entscheiden die Fremdschlüssel.
-- -----------------------------------------------------------------------------
create or replace function public.lease_before_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
    if pg_trigger_depth() = 1 then
        if exists (select 1 from public.rent_payments rp where rp.lease_id = old.id)
           or exists (select 1 from public.claims c where c.lease_id = old.id)
           or exists (
               select 1
                 from public.rent_ledger rl
                where rl.lease_id = old.id
                  and (coalesce(rl.paid_amount, 0) <> 0
                       or rl.status = 'loss'
                       or coalesce(rl.note, '') <> ''
                       or exists (select 1 from public.claim_items ci
                                   where ci.rent_ledger_id = rl.id
                                      or rl.id = any(ci.rent_ledger_ids)))
           ) then
            raise exception 'Dieses Mietverhältnis kann nicht gelöscht werden, weil bereits Buchungen vorliegen (Mietzahlungen, Forderungen oder bearbeitete Sollstellungen). Bitte beenden Sie das Mietverhältnis stattdessen – Zahlungshistorie und Mietkonto bleiben dann erhalten.'
                using hint = 'lease_has_bookings';
        end if;
    end if;

    if not exists (select 1 from public.rent_payments rp where rp.lease_id = old.id) then
        delete from public.rent_ledger rl
         where rl.lease_id = old.id
           and coalesce(rl.paid_amount, 0) = 0
           and coalesce(rl.status, 'open') <> 'loss'
           and coalesce(rl.note, '') = ''
           and not exists (select 1 from public.claim_items ci
                            where ci.rent_ledger_id = rl.id
                               or rl.id = any(ci.rent_ledger_ids));
    end if;

    return old;
end;
$function$;

comment on function public.lease_before_delete() is
    'BEFORE-DELETE-Trigger auf leases (Paket DB-SCHEMA): verhindert das direkte Löschen von Verträgen mit Buchungsdaten und entfernt unbearbeitete Auto-Sollstellungen.';

drop trigger if exists trigger_lease_before_delete on public.leases;
create trigger trigger_lease_before_delete
    before delete on public.leases
    for each row execute function public.lease_before_delete();


-- -----------------------------------------------------------------------------
-- 4. Rechnungen (D4-05, D4-10, D4-13, D4-14)
-- -----------------------------------------------------------------------------

-- D4-05: Rechnungsnummer eindeutig je Portfolio – unabhängig davon, wer die Rechnung angelegt hat
-- (bisher nur je user_id + Portfolio). Die App wiederholt die Vergabe bei 23505.
do $$
begin
    create unique index if not exists invoices_portfolio_id_invoice_number_key
        on public.invoices (portfolio_id, invoice_number);
exception when unique_violation then
    raise warning 'DB-SCHEMA: doppelte Rechnungsnummern je Portfolio vorhanden – Index invoices_portfolio_id_invoice_number_key NICHT angelegt. Bitte bereinigen und Migration erneut ausführen.';
end $$;

-- Belegstatus der App (invoiceDocument.js): Entwurf, ausgestellt, storniert, Gutschrift
do $$
begin
    if not exists (select 1 from pg_constraint
                    where conrelid = 'public.invoices'::regclass and conname = 'invoices_status_check') then
        alter table public.invoices add constraint invoices_status_check
            check (status in ('draft', 'issued', 'credited', 'credit_note')) not valid;
    end if;
    begin
        alter table public.invoices validate constraint invoices_status_check;
    exception when check_violation then
        raise warning 'DB-SCHEMA: invoices.status enthält unbekannte Werte – Constraint bleibt NOT VALID (gilt nur für neue/geänderte Zeilen).';
    end;
end $$;

-- Summenspalten haben Default 0; NULL ergäbe leere Beträge im Beleg
do $$
begin
    alter table public.invoices alter column net_amount set not null;
    alter table public.invoices alter column vat_amount set not null;
    alter table public.invoices alter column gross_amount set not null;
exception when not_null_violation then
    raise warning 'DB-SCHEMA: invoices enthält Zeilen ohne Beträge – NOT NULL für net/vat/gross_amount NICHT gesetzt.';
end $$;

-- D4-10: ein Zähler je (Portfolio, Jahr, Objekt) – auch wenn object_unit_id NULL ist
do $$
begin
    alter table public.invoice_counters
        drop constraint if exists invoice_counters_unique_portfolio_year_object,
        add constraint invoice_counters_unique_portfolio_year_object
            unique nulls not distinct (portfolio_id, year, object_unit_id);
exception when unique_violation then
    raise warning 'DB-SCHEMA: invoice_counters enthält doppelte Zähler (object_unit_id NULL) – Eindeutigkeit unverändert.';
end $$;

-- D4-13: Brutto = gerundetes Netto + gerundete USt, je Steuersatz summiert
-- (bisher drei unabhängig gerundete Summen: 5,00 + 0,35 <> 5,34)
create or replace view public.invoice_totals
with (security_invoker = on)
as
select i.id as invoice_id,
       i.user_id,
       coalesce(sum(r.net_amount), 0::numeric)::numeric(12,2) as net_amount,
       coalesce(sum(r.vat_amount), 0::numeric)::numeric(12,2) as vat_amount,
       coalesce(sum(r.net_amount + r.vat_amount), 0::numeric)::numeric(12,2) as gross_amount
  from public.invoices i
  left join lateral (
        select round(sum(ii.quantity * ii.unit_price), 2) as net_amount,
               round(sum(ii.quantity * ii.unit_price * (ii.vat_rate / 100.0)), 2) as vat_amount
          from public.invoice_items ii
         where ii.invoice_id = i.id
         group by ii.vat_rate
       ) r on true
 group by i.id, i.user_id;


-- -----------------------------------------------------------------------------
-- 5. Bankabgleich (M2-16, G14-08)
-- -----------------------------------------------------------------------------

-- Eindeutig je Bankverbindung statt je Nutzer (gleiche Umsatz-IDs zweier Konten kollidierten)
do $$
begin
    begin
        if not exists (select 1 from pg_constraint
                        where conrelid = 'public.bank_transactions'::regclass
                          and conname = 'bank_transactions_connection_id_transaction_id_key') then
            alter table public.bank_transactions
                add constraint bank_transactions_connection_id_transaction_id_key
                unique (connection_id, transaction_id);
        end if;
        alter table public.bank_transactions
            drop constraint if exists bank_transactions_user_id_transaction_id_key;
    exception when unique_violation then
        raise warning 'DB-SCHEMA: doppelte transaction_id je Bankverbindung – bisherige Eindeutigkeit (user_id, transaction_id) bleibt.';
        create index if not exists idx_fk_bank_transactions_connection_id
            on public.bank_transactions (connection_id);
    end;

    if not exists (select 1 from pg_constraint
                    where conrelid = 'public.bank_transactions'::regclass
                      and conname = 'bank_transactions_status_check') then
        alter table public.bank_transactions add constraint bank_transactions_status_check
            check (status in ('pending', 'matched', 'ignored')) not valid;
    end if;
    begin
        alter table public.bank_transactions validate constraint bank_transactions_status_check;
    exception when check_violation then
        raise warning 'DB-SCHEMA: bank_transactions.status enthält unbekannte Werte – Constraint bleibt NOT VALID.';
    end;
end $$;


-- -----------------------------------------------------------------------------
-- 6. SMTP-Zugangsdaten (M2-05, D4-03 SMTP-Teil)
--    Der Browser kann das Passwort nur noch setzen, nicht mehr lesen. Lesen nur per service_role
--    (Edge Function send-letting-email). Insert/Update/Delete der App funktionieren weiter
--    (PostgREST antwortet ohne Rückgabe der Zeile). Ein Upsert mit EXCLUDED.smtp_pass braucht
--    SELECT auf smtp_pass und scheitert (42501) – EmailSettings.jsx speichert daher seit
--    Commit e0f9043 per Insert, bei 23505 per Update. Verschlüsselung (Vault) folgt mit der Edge
--    Function (siehe Bericht).
-- -----------------------------------------------------------------------------
-- REVOKE auf Tabellenebene entfernt auch vorhandene Spaltenrechte (daher wiederholbar)
revoke all on table public.user_smtp_settings from anon;
revoke all on table public.user_smtp_settings from authenticated;
grant select (id, user_id, smtp_host, smtp_port, smtp_user, smtp_sender, created_at, updated_at)
    on public.user_smtp_settings to authenticated;
grant insert, update, delete on public.user_smtp_settings to authenticated;
grant all on table public.user_smtp_settings to service_role;

do $$
begin
    if exists (select 1 from pg_publication_tables
                where pubname = 'supabase_realtime'
                  and schemaname = 'public'
                  and tablename = 'user_smtp_settings') then
        alter publication supabase_realtime drop table public.user_smtp_settings;
    end if;
end $$;

comment on column public.user_smtp_settings.smtp_pass is
    'SMTP-Passwort. Für authenticated nur schreibbar (kein SELECT-Recht), lesen nur service_role (Edge Function send-letting-email).';


-- -----------------------------------------------------------------------------
-- 7. Weitere Constraints
-- -----------------------------------------------------------------------------

-- 7a. M1-23: Standard-Verteilerschlüssel global eindeutig, eigene Schlüssel je Nutzer eindeutig
do $$
begin
    create unique index if not exists distribution_keys_global_name_key
        on public.distribution_keys (name) where user_id is null;
exception when unique_violation then
    raise warning 'DB-SCHEMA: doppelte globale Verteilerschlüssel – Index distribution_keys_global_name_key NICHT angelegt.';
end $$;

do $$
begin
    create unique index if not exists distribution_keys_user_name_key
        on public.distribution_keys (user_id, name) where user_id is not null;
exception when unique_violation then
    raise warning 'DB-SCHEMA: doppelte Verteilerschlüssel eines Nutzers – Index distribution_keys_user_name_key NICHT angelegt.';
end $$;

-- 7b. M2-21: ein FCM-Token gehört genau einem Konto. Meldet sich auf dem Gerät ein anderes Konto
--     an, übernimmt es das Token (bisherige Zeile des alten Kontos wird entfernt), damit das Gerät
--     keine Benachrichtigungen des vorherigen Kontos mehr erhält. Upsert der App
--     (onConflict user_id,fcm_token) bleibt unverändert gültig.
create or replace function public.push_subscriptions_release_token()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
    if new.fcm_token is not null then
        delete from public.push_subscriptions
         where fcm_token = new.fcm_token
           and user_id is distinct from new.user_id
           and id is distinct from new.id;
    end if;
    return new;
end;
$function$;

comment on function public.push_subscriptions_release_token() is
    'BEFORE-Trigger auf push_subscriptions (Paket DB-SCHEMA): ein FCM-Token gehört nur dem zuletzt angemeldeten Konto.';

drop trigger if exists trigger_push_subscriptions_release_token on public.push_subscriptions;
create trigger trigger_push_subscriptions_release_token
    before insert or update of fcm_token, user_id on public.push_subscriptions
    for each row execute function public.push_subscriptions_release_token();

do $$
begin
    create unique index if not exists push_subscriptions_fcm_token_key
        on public.push_subscriptions (fcm_token);
exception when unique_violation then
    raise warning 'DB-SCHEMA: FCM-Token mehrfach vorhanden – Index push_subscriptions_fcm_token_key NICHT angelegt.';
end $$;

-- 7c. G20-14: höchstens ein laufender Vermietungsprozess je Einheit (App prüft vorher)
do $$
begin
    create unique index if not exists rental_processes_one_running_per_unit
        on public.rental_processes (unit_id) where status = 'in_vermietung';
exception when unique_violation then
    raise warning 'DB-SCHEMA: mehrere laufende Vermietungsprozesse je Einheit – Index rental_processes_one_running_per_unit NICHT angelegt.';
end $$;

-- 7d. G21-18: Slot-Länge > 0 (sonst Endlosschleife in der Terminbuchung)
do $$
begin
    if not exists (select 1 from pg_constraint
                    where conrelid = 'public.rental_viewings'::regclass
                      and conname = 'rental_viewings_slot_duration_check') then
        alter table public.rental_viewings add constraint rental_viewings_slot_duration_check
            check (slot_duration_minutes > 0) not valid;
    end if;
    begin
        alter table public.rental_viewings validate constraint rental_viewings_slot_duration_check;
    exception when check_violation then
        raise warning 'DB-SCHEMA: rental_viewings mit slot_duration_minutes <= 0 vorhanden – Constraint bleibt NOT VALID.';
    end;
end $$;

-- 7e. Objektkalender (Hinweise Paket CALENDAR): Farbe nur #rrggbb, Wochentag Pflicht,
--     eine Einstellung je Objekt (die App aktualisiert eine vorhandene Zeile per id)
do $$
begin
    if not exists (select 1 from pg_constraint
                    where conrelid = 'public.objektkalender_events'::regclass
                      and conname = 'objektkalender_events_color_check') then
        alter table public.objektkalender_events add constraint objektkalender_events_color_check
            check (color is null or color ~ '^#[0-9A-Fa-f]{6}$') not valid;
    end if;
    begin
        alter table public.objektkalender_events validate constraint objektkalender_events_color_check;
    exception when check_violation then
        raise warning 'DB-SCHEMA: objektkalender_events.color mit ungültigen Werten – Constraint bleibt NOT VALID.';
    end;
end $$;

do $$
begin
    alter table public.objektkalender_settings alter column cleaning_weekday set not null;
exception when not_null_violation then
    raise warning 'DB-SCHEMA: objektkalender_settings.cleaning_weekday enthält NULL – NOT NULL NICHT gesetzt.';
end $$;

do $$
begin
    create unique index if not exists objektkalender_settings_property_id_key
        on public.objektkalender_settings (property_id);
exception when unique_violation then
    raise warning 'DB-SCHEMA: mehrere Kalender-Einstellungen je Objekt – Index objektkalender_settings_property_id_key NICHT angelegt.';
    create index if not exists idx_fk_objektkalender_settings_property_id
        on public.objektkalender_settings (property_id);
end $$;

-- 7f. D4-14: Nebenkostenabrechnung ohne Besitzer bzw. ohne Objekt/Wirtschaftseinheit wäre für
--     niemanden sichtbar und nie mehr löschbar; Status nur draft/done (App UtilityCosts.jsx)
do $$
begin
    alter table public.utility_settlements alter column user_id set not null;
exception when not_null_violation then
    raise warning 'DB-SCHEMA: utility_settlements ohne user_id vorhanden – NOT NULL NICHT gesetzt.';
end $$;

do $$
begin
    if not exists (select 1 from pg_constraint
                    where conrelid = 'public.utility_settlements'::regclass
                      and conname = 'utility_settlements_scope_check') then
        alter table public.utility_settlements add constraint utility_settlements_scope_check
            check (property_id is not null or economic_unit_id is not null) not valid;
    end if;
    begin
        alter table public.utility_settlements validate constraint utility_settlements_scope_check;
    exception when check_violation then
        raise warning 'DB-SCHEMA: utility_settlements ohne Objekt und Wirtschaftseinheit – Constraint bleibt NOT VALID.';
    end;

    if not exists (select 1 from pg_constraint
                    where conrelid = 'public.utility_settlements'::regclass
                      and conname = 'utility_settlements_status_check') then
        alter table public.utility_settlements add constraint utility_settlements_status_check
            check (status in ('draft', 'done')) not valid;
    end if;
    begin
        alter table public.utility_settlements validate constraint utility_settlements_status_check;
    exception when check_violation then
        raise warning 'DB-SCHEMA: utility_settlements.status mit unbekannten Werten – Constraint bleibt NOT VALID.';
    end;
end $$;

do $$
begin
    alter table public.utility_settlements alter column status set not null;
exception when not_null_violation then
    raise warning 'DB-SCHEMA: utility_settlements.status enthält NULL – NOT NULL NICHT gesetzt.';
end $$;

-- 7g. D4-14: Mietkonto-Zeilen haben immer Zahlbetrag und Status (Defaults 0 / 'open')
do $$
begin
    alter table public.rent_ledger alter column paid_amount set not null;
    alter table public.rent_ledger alter column status set not null;
exception when not_null_violation then
    raise warning 'DB-SCHEMA: rent_ledger enthält NULL in paid_amount/status – NOT NULL NICHT gesetzt.';
end $$;

-- 7h. R2-12 (Schema-Teil): Zinssätze nie negativ. Einheit in beiden Tabellen: Prozent p. a.
--     (claims 5.0000 = 5 %, loans z. B. 3.5 = 3,5 %; live geprüft). Der Standard 5 % für
--     Forderungen bleibt – die Wahl des Zinssatzes ist eine fachliche Entscheidung.
do $$
begin
    if not exists (select 1 from pg_constraint
                    where conrelid = 'public.claims'::regclass and conname = 'claims_interest_rate_check') then
        alter table public.claims add constraint claims_interest_rate_check
            check (interest_rate >= 0) not valid;
    end if;
    begin
        alter table public.claims validate constraint claims_interest_rate_check;
    exception when check_violation then
        raise warning 'DB-SCHEMA: claims mit negativem Zinssatz – Constraint bleibt NOT VALID.';
    end;

    if not exists (select 1 from pg_constraint
                    where conrelid = 'public.loans'::regclass and conname = 'loans_interest_rate_check') then
        alter table public.loans add constraint loans_interest_rate_check
            check (interest_rate >= 0) not valid;
    end if;
    begin
        alter table public.loans validate constraint loans_interest_rate_check;
    exception when check_violation then
        raise warning 'DB-SCHEMA: loans mit negativem Zinssatz – Constraint bleibt NOT VALID.';
    end;
end $$;

comment on column public.claims.interest_rate is
    'Verzugszinssatz in Prozent p. a. (5.0000 = 5 %).';
comment on column public.loans.interest_rate is
    'Sollzinssatz in Prozent p. a. (z. B. 3.5 = 3,5 %).';


-- -----------------------------------------------------------------------------
-- 8. Indizes
-- -----------------------------------------------------------------------------

-- D2-21: Freigabe-Prüfung über die E-Mail im JWT (has_portfolio_access & Co.)
create index if not exists idx_portfolio_shares_email_status
    on public.portfolio_shares (lower(shared_with_email), status);

-- Advisor „unindexed foreign keys": je Fremdschlüssel ein Index (beschleunigt RLS-Joins und
-- vor allem die Lösch-Prüfungen/Kaskaden). Spalten, die schon durch einen Unique-Index mit
-- führender Spalte abgedeckt sind (bank_transactions.connection_id,
-- objektkalender_settings.property_id), fehlen hier bewusst.
create index if not exists idx_fk_announcements_created_by on public.announcements (created_by);
create index if not exists idx_fk_bank_connections_user_id on public.bank_connections (user_id);
create index if not exists idx_fk_bank_matching_rules_property_id on public.bank_matching_rules (property_id);
create index if not exists idx_fk_bank_matching_rules_unit_id on public.bank_matching_rules (unit_id);
create index if not exists idx_fk_claim_access_links_created_by on public.claim_access_links (created_by);
create index if not exists idx_fk_claim_events_document_id on public.claim_events (document_id);
create index if not exists idx_fk_claims_cancelled_by on public.claims (cancelled_by);
create index if not exists idx_fk_cloud_connections_user_id on public.cloud_connections (user_id);
create index if not exists idx_fk_contacts_tenant_id on public.contacts (tenant_id);
create index if not exists idx_fk_distribution_keys_user_id on public.distribution_keys (user_id);
create index if not exists idx_fk_documents_property_id on public.documents (property_id);
create index if not exists idx_fk_documents_tenant_id on public.documents (tenant_id);
create index if not exists idx_fk_documents_unit_id on public.documents (unit_id);
create index if not exists idx_fk_economic_units_user_id on public.economic_units (user_id);
create index if not exists idx_fk_expense_categories_distribution_key_id on public.expense_categories (distribution_key_id);
create index if not exists idx_fk_expenses_category_id on public.expenses (category_id);
create index if not exists idx_fk_floor_plans_unit_id on public.floor_plans (unit_id);
create index if not exists idx_fk_invoice_counters_user_id on public.invoice_counters (user_id);
create index if not exists idx_fk_invoices_contact_id on public.invoices (contact_id);
create index if not exists idx_fk_invoices_property_id on public.invoices (property_id);
create index if not exists idx_fk_invoices_unit_id on public.invoices (unit_id);
create index if not exists idx_fk_leases_tenant_id on public.leases (tenant_id);
create index if not exists idx_fk_loans_economic_unit_id on public.loans (economic_unit_id);
create index if not exists idx_fk_meter_readings_meter_id on public.meter_readings (meter_id);
create index if not exists idx_fk_meter_readings_portfolio_id on public.meter_readings (portfolio_id);
create index if not exists idx_fk_meter_readings_user_id on public.meter_readings (user_id);
create index if not exists idx_fk_meters_portfolio_id on public.meters (portfolio_id);
create index if not exists idx_fk_meters_property_id on public.meters (property_id);
create index if not exists idx_fk_meters_unit_id on public.meters (unit_id);
create index if not exists idx_fk_meters_user_id on public.meters (user_id);
create index if not exists idx_fk_objektkalender_events_assigned_unit_id on public.objektkalender_events (assigned_unit_id);
create index if not exists idx_fk_objektkalender_events_completed_by on public.objektkalender_events (completed_by);
create index if not exists idx_fk_objektkalender_events_property_id on public.objektkalender_events (property_id);
create index if not exists idx_fk_objektkalender_history_event_id on public.objektkalender_history (event_id);
create index if not exists idx_fk_objektkalender_history_property_id on public.objektkalender_history (property_id);
create index if not exists idx_fk_payment_plan_requests_access_link_id on public.payment_plan_requests (access_link_id);
create index if not exists idx_fk_payment_plan_requests_decided_by on public.payment_plan_requests (decided_by);
create index if not exists idx_fk_payment_plans_cancelled_by on public.payment_plans (cancelled_by);
create index if not exists idx_fk_pdf_templates_updated_by on public.pdf_templates (updated_by);
create index if not exists idx_fk_pdf_templates_user_id on public.pdf_templates (user_id);
create index if not exists idx_fk_portfolio_cloud_links_cloud_connection_id on public.portfolio_cloud_links (cloud_connection_id);
create index if not exists idx_fk_portfolio_cloud_links_portfolio_id on public.portfolio_cloud_links (portfolio_id);
create index if not exists idx_fk_portfolio_shares_created_by on public.portfolio_shares (created_by);
create index if not exists idx_fk_renovation_calc_subtrades_user_id on public.renovation_calc_subtrades (user_id);
create index if not exists idx_fk_renovation_calc_trades_user_id on public.renovation_calc_trades (user_id);
create index if not exists idx_fk_renovation_calculations_property_id on public.renovation_calculations (property_id);
create index if not exists idx_fk_renovation_calculations_unit_id on public.renovation_calculations (unit_id);
create index if not exists idx_fk_renovation_invoices_user_id on public.renovation_invoices (user_id);
create index if not exists idx_fk_renovation_milestone_templates_user_id on public.renovation_milestone_templates (user_id);
create index if not exists idx_fk_renovation_milestones_project_trade_id on public.renovation_milestones (project_trade_id);
create index if not exists idx_fk_renovation_milestones_user_id on public.renovation_milestones (user_id);
create index if not exists idx_fk_renovation_project_subtrades_project_id on public.renovation_project_subtrades (project_id);
create index if not exists idx_fk_renovation_project_subtrades_responsible_contact_id on public.renovation_project_subtrades (responsible_contact_id);
create index if not exists idx_fk_renovation_project_subtrades_user_id on public.renovation_project_subtrades (user_id);
create index if not exists idx_fk_renovation_project_trades_depends_on on public.renovation_project_trades (depends_on);
create index if not exists idx_fk_renovation_project_trades_user_id on public.renovation_project_trades (user_id);
create index if not exists idx_fk_renovation_projects_unit_id on public.renovation_projects (unit_id);
create index if not exists idx_fk_renovation_subtrades_trade_id on public.renovation_subtrades (trade_id);
create index if not exists idx_fk_renovation_subtrades_user_id on public.renovation_subtrades (user_id);
create index if not exists idx_fk_renovation_tasks_project_trade_id on public.renovation_tasks (project_trade_id);
create index if not exists idx_fk_renovation_tasks_property_id on public.renovation_tasks (property_id);
create index if not exists idx_fk_renovation_tasks_user_id on public.renovation_tasks (user_id);
create index if not exists idx_fk_renovation_trades_user_id on public.renovation_trades (user_id);
create index if not exists idx_fk_rent_ledger_user_id on public.rent_ledger (user_id);
create index if not exists idx_fk_rental_applicants_process_id on public.rental_applicants (process_id);
create index if not exists idx_fk_rental_applicants_user_id on public.rental_applicants (user_id);
create index if not exists idx_fk_rental_processes_unit_id on public.rental_processes (unit_id);
create index if not exists idx_fk_rental_processes_user_id on public.rental_processes (user_id);
create index if not exists idx_fk_rental_viewing_bookings_applicant_id on public.rental_viewing_bookings (applicant_id);
create index if not exists idx_fk_rental_viewings_process_id on public.rental_viewings (process_id);
create index if not exists idx_fk_rental_viewings_user_id on public.rental_viewings (user_id);
create index if not exists idx_fk_tenant_invitations_invited_by on public.tenant_invitations (invited_by);
create index if not exists idx_fk_tenant_invitations_property_id on public.tenant_invitations (property_id);
create index if not exists idx_fk_tenant_invitations_tenant_id on public.tenant_invitations (tenant_id);
create index if not exists idx_fk_tenant_invitations_unit_id on public.tenant_invitations (unit_id);
create index if not exists idx_fk_tenant_verification_links_created_by on public.tenant_verification_links (created_by);
create index if not exists idx_fk_tenant_verification_links_tenant_id on public.tenant_verification_links (tenant_id);
create index if not exists idx_fk_user_roles_property_id on public.user_roles (property_id);
create index if not exists idx_fk_user_roles_tenant_id on public.user_roles (tenant_id);
create index if not exists idx_fk_user_roles_unit_id on public.user_roles (unit_id);
create index if not exists idx_fk_utility_settlements_economic_unit_id on public.utility_settlements (economic_unit_id);
create index if not exists idx_fk_utility_settlements_property_id on public.utility_settlements (property_id);
create index if not exists idx_fk_utility_settlements_user_id on public.utility_settlements (user_id);

-- Sicherheitsnetz: übrige einspaltige Fremdschlüssel in public ohne Index mit führender Spalte
-- (z. B. Tabellen, die andere Migrationen dieses Pakets angelegt haben) erhalten ebenfalls einen.
do $$
declare
    r record;
    v_name text;
begin
    for r in
        select c.conrelid,
               cl.relname,
               a.attname
          from pg_constraint c
          join pg_class cl on cl.oid = c.conrelid
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
         where c.contype = 'f'
           and c.connamespace = 'public'::regnamespace
           and array_length(c.conkey, 1) = 1
           and not exists (
               select 1
                 from pg_index i
                where i.indrelid = c.conrelid
                  and i.indkey[0] = c.conkey[1]
                  and i.indpred is null
           )
    loop
        v_name := left('idx_fk_' || r.relname || '_' || r.attname, 63);
        execute format('create index if not exists %I on public.%I (%I)', v_name, r.relname, r.attname);
        raise notice 'DB-SCHEMA: Index % angelegt', v_name;
    end loop;
end $$;
