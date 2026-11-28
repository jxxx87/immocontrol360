-- =============================================================================
-- Welle 6 – Paket AB_CONTACT_FK_GUARD
-- Kontakt-Verweise (invoices.contact_id, renovation_project_subtrades.responsible_contact_id)
--
-- Befund (Abschluss-Kritik Welle 5): contacts_select gibt einen Kontakt auch frei, wenn er an
-- einem lesbaren Datensatz hängt:
--   * invoices.contact_id                          (has_portfolio_access … 'finanzen', 'read')
--   * renovation_project_subtrades.responsible_contact_id
--                                                  (has_renovation_project_access … 'read')
-- Die Insert-/Update-Policies dieser Tabellen prüfen nicht, ob der Bearbeiter den Kontakt sehen
-- darf; die Fremdschlüsselprüfung läuft ohne RLS. Wer die UUID eines fremden Kontakts kennt
-- (z. B. früherer Mitnutzer), hängt ihn an einen eigenen Datensatz und liest ihn danach.
-- Live nachgewiesen am 2026-11-28 (tests/02_contact_fk_guard.pre.sql, "PRE: LUECKEN BESTAETIGT"):
--   * fremdes Konto: INSERT und UPDATE bei beiden Tabellen -> Kontakt danach lesbar
--   * Mitnutzer mit Schreibrecht finanzen/immobilien, aber OHNE kontakte: kann jeden Kontakt
--     des Eigentümers per UUID verknüpfen und so lesen
-- Weitere Verweise auf contacts gibt es live nicht (pg_constraint confrelid = contacts: nur diese
-- zwei Fremdschlüssel; keine *contact_id*-Spalten ohne FK; keine Views; keine weiteren Policies,
-- die über contacts freigeben).
--
-- Korrektur (keine neuen Rechte; Policies unverändert):
--   BEFORE-Trigger contact_reference_guard() auf beiden Tabellen,
--     - beim INSERT, wenn ein Kontakt gesetzt ist,
--     - beim UPDATE nur, wenn sich die Kontakt-Spalte ändert (Altbestand mit unverändertem
--       Kontakt bleibt immer bearbeitbar; auch das Leeren ist immer erlaubt).
--   Der Kontakt muss für den Bearbeiter OHNE den neuen Verweis sichtbar sein. Die Funktion ist
--   SECURITY INVOKER und fragt contacts unter der RLS des Bearbeiters ab, entscheidend ist also
--   genau contacts_select (eigene Kontakte, Kontakte des Eigentümers bei Freigabe "kontakte",
--   Mieter-Kontakte, bereits bestehende Verweise in lesbaren Rechnungen/Untergewerken). Die neue
--   Zeile bzw. der neue Wert ist im BEFORE-Trigger noch nicht gespeichert und zählt nicht mit.
--   Keine Rekursion: contacts_select liest invoices/renovation_project_subtrades, deren Policies
--   lesen contacts nicht.
--   Sonst 42501. Nicht vorhandene und nicht sichtbare UUIDs liefern dieselbe Meldung.
--   Legitime Auswahl bleibt: Die App bietet nur Kontakte an, die der Nutzer per RLS lesen darf
--   (InvoiceForm: alle sichtbaren Kontakte; RenovationWizard/RenovationProjectDetail: eigene +
--   die des Objekt-Eigentümers); Gutschriften (create_credit_note, SECURITY INVOKER) übernehmen
--   den Kontakt der Originalrechnung, der über diese sichtbar ist.
--   Greift nur bei current_user = authenticated. ON DELETE SET NULL (läuft als Tabellen-
--   eigentümer), SECURITY-DEFINER-RPCs (z. B. delete_portfolio) und Server/Admin bleiben unberührt.
--   Altbestand live (2026-11-28): 8 Rechnungen und 2 Untergewerke mit Kontakt, davon 0 mit einem
--   Kontakt, der weder dem Eigentümer noch dem Zeilen-Konto gehört. Nichts geändert.
--
-- Idempotent (create or replace / drop … if exists). Trigger-Funktion SECURITY INVOKER,
-- search_path = public, pg_temp, kein EXECUTE für public/anon/authenticated.
-- Rollback: rollback/02_contact_fk_guard.rollback.sql
-- Tests:    tests/02_contact_fk_guard.test.sql (Gegenprobe ohne Migration: tests/02_…pre.sql)
-- =============================================================================

create or replace function public.contact_reference_guard()
 returns trigger
 language plpgsql
 set search_path = public, pg_temp
as $function$
declare
    v_contact uuid;
begin
    -- Nur direkte Änderungen angemeldeter Nutzer; RPCs (SECURITY DEFINER), Server, Admin und
    -- ON DELETE SET NULL bleiben unberührt.
    if current_user <> 'authenticated' or auth.uid() is null then
        return new;
    end if;

    case tg_table_name
        when 'invoices' then
            v_contact := new.contact_id;
        when 'renovation_project_subtrades' then
            v_contact := new.responsible_contact_id;
        else
            raise exception 'contact_reference_guard: Tabelle % ist nicht vorgesehen', tg_table_name;
    end case;

    if v_contact is null then
        return new;
    end if;

    -- SECURITY INVOKER: contacts_select des Bearbeiters entscheidet. Der neue Verweis ist im
    -- BEFORE-Trigger noch nicht gespeichert und verschafft daher selbst kein Leserecht.
    if not exists (select 1 from public.contacts c where c.id = v_contact) then
        raise exception 'Der Kontakt kann nicht verknüpft werden: Er wurde nicht gefunden oder Sie haben keinen Zugriff darauf.'
            using errcode = '42501';
    end if;
    return new;
end;
$function$;

revoke execute on function public.contact_reference_guard()
    from public, anon, authenticated;

-- invoices.contact_id ----------------------------------------------------------
drop trigger if exists trg_invoices_contact_guard_ins on public.invoices;
create trigger trg_invoices_contact_guard_ins
    before insert on public.invoices
    for each row when (new.contact_id is not null)
    execute function public.contact_reference_guard();

drop trigger if exists trg_invoices_contact_guard_upd on public.invoices;
create trigger trg_invoices_contact_guard_upd
    before update on public.invoices
    for each row when (new.contact_id is not null and old.contact_id is distinct from new.contact_id)
    execute function public.contact_reference_guard();

-- renovation_project_subtrades.responsible_contact_id --------------------------
drop trigger if exists trg_renovation_project_subtrades_contact_guard_ins on public.renovation_project_subtrades;
create trigger trg_renovation_project_subtrades_contact_guard_ins
    before insert on public.renovation_project_subtrades
    for each row when (new.responsible_contact_id is not null)
    execute function public.contact_reference_guard();

drop trigger if exists trg_renovation_project_subtrades_contact_guard_upd on public.renovation_project_subtrades;
create trigger trg_renovation_project_subtrades_contact_guard_upd
    before update on public.renovation_project_subtrades
    for each row when (new.responsible_contact_id is not null
                       and old.responsible_contact_id is distinct from new.responsible_contact_id)
    execute function public.contact_reference_guard();
