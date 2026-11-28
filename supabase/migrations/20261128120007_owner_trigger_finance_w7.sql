-- =============================================================================
-- Welle 7 – Paket sonstiges-2
-- Eigentümer-Trigger auch für Darlehen, Mieteingänge, Ausgaben und Dokumente
--
-- Befund:
--   A-20  loans, rent_payments, expenses und documents werden mit user_id = angemeldetes Konto
--         angelegt (Loans.jsx, Finance.jsx, Documents.jsx, TenantDetail.jsx …). Anders als
--         properties/units/leases gibt es dort keinen Trigger set_owner_user_id. Alle vier
--         user_id-Fremdschlüssel sind ON DELETE CASCADE auf auth.users: Wird das Konto eines
--         Mitnutzers gelöscht, verschwinden die von ihm erfassten Darlehen, Mieteingänge, Ausgaben
--         und Dokument-Einträge still aus dem Portfolio des Eigentümers.
--
-- Korrektur: public.set_owner_user_id() bekommt einen Zweig für die vier Tabellen, dazu je ein
--   Trigger set_owner_user_id BEFORE INSERT OR UPDATE (Name und Art wie auf properties/units/leases).
--   Eigentümer = portfolios.user_id des Portfolios, an dem die Zeile hängt:
--     loans          über portfolio_id
--     rent_payments  über lease_id → units → properties → portfolios
--     expenses,
--     documents      über property_id, sonst unit_id (gleiche Reihenfolge wie deren RLS);
--                    ohne Objekt-/Einheitsbezug bleibt user_id unverändert (RLS-Zweig „eigenes Konto“).
--   INSERT: user_id = Eigentümer (falls ermittelbar).
--   UPDATE: Ändert sich die Zuordnung (portfolio_id / lease_id / property_id bzw. unit_id) und ist ein
--           Eigentümer ermittelbar, wandert user_id zum Eigentümer des neuen Ziels (die RLS hat das
--           Schreibrecht am Ziel bereits geprüft). Sonst bleibt user_id wie bisher (old.user_id) –
--           ein mitgeschicktes user_id wird ignoriert.
--   Die Zweige für properties/units/leases sind unverändert (Verschieben zu einem anderen Eigentümer
--   bleibt dort verboten).
--   Zusammenspiel: rls_user_ok(user_id, …) in den INSERT-Policies erlaubt den Eigentümer
--   (WITH CHECK läuft nach den BEFORE-Triggern). protect_claim_rent_payments (Trigger
--   block_claim_rent_payments_modification) läuft alphabetisch vorher und sieht weiterhin das
--   ursprünglich übergebene user_id; bei UPDATE ohne neue Zuordnung ändert dieser Trigger user_id nicht.
--   record_claim_payment, delete_portfolio (Darlehen umhängen), delete_tenant_completely funktionieren
--   unverändert. send-push-notification (documents) benachrichtigt Mieter, user_id ist dort nur
--   „Ersteller nicht benachrichtigen“ – Mieter sind nie Eigentümer, keine Änderung.
--   Bestand: live 0 fremd zugeordnete Zeilen (loans 0/17, rent_payments 0/4438, expenses 0/16,
--   documents 0/1, geprüft 2026-11-28) – kein Umhängen nötig.
--
-- App: keine Änderung nötig (das mitgeschickte user_id: user.id wird vom Trigger überschrieben).
-- Rechte: unverändert (Trigger-Funktion, EXECUTE nur postgres/service_role).
-- Idempotent (create or replace, drop trigger if exists).
-- =============================================================================

create or replace function public.set_owner_user_id()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
    v_owner uuid;
    v_moved boolean := false;
begin
    -- Darlehen, Mieteingänge, Ausgaben, Dokumente (W7 A-20): user_id = Eigentümer des Portfolios
    if tg_table_name in ('loans', 'rent_payments', 'expenses', 'documents') then
        if tg_table_name = 'loans' then
            select po.user_id into v_owner
              from public.portfolios po
             where po.id = new.portfolio_id;
            if tg_op = 'UPDATE' then
                v_moved := new.portfolio_id is distinct from old.portfolio_id;
            end if;
        elsif tg_table_name = 'rent_payments' then
            select po.user_id into v_owner
              from public.leases l
              join public.units u on u.id = l.unit_id
              join public.properties pr on pr.id = u.property_id
              join public.portfolios po on po.id = pr.portfolio_id
             where l.id = new.lease_id;
            if tg_op = 'UPDATE' then
                v_moved := new.lease_id is distinct from old.lease_id;
            end if;
        else
            -- expenses, documents: wie deren RLS zuerst property_id, sonst unit_id
            if new.property_id is not null then
                select po.user_id into v_owner
                  from public.properties pr
                  join public.portfolios po on po.id = pr.portfolio_id
                 where pr.id = new.property_id;
            elsif new.unit_id is not null then
                select po.user_id into v_owner
                  from public.units u
                  join public.properties pr on pr.id = u.property_id
                  join public.portfolios po on po.id = pr.portfolio_id
                 where u.id = new.unit_id;
            end if;
            if tg_op = 'UPDATE' then
                v_moved := new.property_id is distinct from old.property_id
                        or new.unit_id is distinct from old.unit_id;
            end if;
        end if;

        if tg_op = 'INSERT' then
            if v_owner is not null then
                new.user_id := v_owner;
            end if;
        elsif v_moved and v_owner is not null then
            new.user_id := v_owner;
        else
            new.user_id := old.user_id;
        end if;
        return new;
    end if;

    if tg_table_name = 'properties' then
        select po.user_id into v_owner
          from public.portfolios po
         where po.id = new.portfolio_id;
        if tg_op = 'UPDATE' then
            v_moved := new.portfolio_id is distinct from old.portfolio_id;
        end if;
    elsif tg_table_name = 'units' then
        select po.user_id into v_owner
          from public.properties pr
          join public.portfolios po on po.id = pr.portfolio_id
         where pr.id = new.property_id;
        if tg_op = 'UPDATE' then
            v_moved := new.property_id is distinct from old.property_id;
        end if;
    elsif tg_table_name = 'leases' then
        select po.user_id into v_owner
          from public.units u
          join public.properties pr on pr.id = u.property_id
          join public.portfolios po on po.id = pr.portfolio_id
         where u.id = new.unit_id;
        if tg_op = 'UPDATE' then
            v_moved := new.unit_id is distinct from old.unit_id;
        end if;
    end if;

    if tg_op = 'INSERT' then
        if v_owner is not null then
            new.user_id := v_owner;
        end if;
        return new;
    end if;

    new.user_id := old.user_id;
    if v_moved and v_owner is not null and v_owner <> old.user_id then
        raise exception 'Datensätze können nur innerhalb der Portfolios desselben Eigentümers verschoben werden.'
            using errcode = '42501';
    end if;
    return new;
end;
$function$;

drop trigger if exists set_owner_user_id on public.loans;
create trigger set_owner_user_id
    before insert or update on public.loans
    for each row execute function public.set_owner_user_id();

drop trigger if exists set_owner_user_id on public.rent_payments;
create trigger set_owner_user_id
    before insert or update on public.rent_payments
    for each row execute function public.set_owner_user_id();

drop trigger if exists set_owner_user_id on public.expenses;
create trigger set_owner_user_id
    before insert or update on public.expenses
    for each row execute function public.set_owner_user_id();

drop trigger if exists set_owner_user_id on public.documents;
create trigger set_owner_user_id
    before insert or update on public.documents
    for each row execute function public.set_owner_user_id();

-- Rechte wie heute (Trigger-Funktion: nur postgres und service_role)
revoke execute on function public.set_owner_user_id() from public, anon, authenticated;
grant execute on function public.set_owner_user_id() to service_role;
