-- =============================================================================
-- Welle 3 · Paket 04 SCHEMA
-- Rechte, Policies, Trigger und Altlasten aus der Nachprüfung vom 27.11.2026
--
-- Befunde:
--   D2-07, D2-22   notify_push: nur noch service_role darf sie ausführen, fester search_path.
--                  RUMPF UNVERÄNDERT (enthält den alten Schlüssel, Phase 0 des Nutzers).
--   D2-23 (1)      trigger_push_on_* 1:1 aus dem Live-Stand versioniert (keine Verhaltensänderung).
--   D2-23 (2),     Unbenutzte Alt-Helfer entfernt: has_contact_access, has_document_template_access,
--   R1-12          is_user_shared_with_me, has_claim_columns_access und alle Ein-Parameter-Varianten
--                  has_*_access(uuid). Geprüft am 27.11.: 0 Policies/Views (pg_depend), 0 Aufrufe aus
--                  anderen Funktionen (nur gegenseitig), 0 Aufrufe in src/ und supabase/functions/.
--   R1-14          11 Policies mit Rolle PUBLIC -> TO authenticated (Wirkung für angemeldete Nutzer gleich;
--                  anon hat ohnehin keine Tabellenrechte).
--   R2-14          Standardrechte: neue Tabellen/Sichten/Sequenzen von postgres in public nicht mehr für anon.
--   D3b-18         profiles: stripe_connect_id / stripe_connect_enabled nur noch über service_role
--                  (Edge Functions) bzw. vertrauenswürdige Funktionen änderbar – still beibehalten.
--   D3b-19         Renovierungs-Stammdaten: Freigabe-Nutzer mit Schreibrecht dürfen ändern und löschen,
--                  was sie anlegen dürfen; user_id bleibt bei UPDATE unverändert.
--   D4-11          rent_ledger: Sollstellungen, die in einer Forderung stecken, sind nicht löschbar.
--   M2-16          Bankumsätze: wird die zugeordnete Mietzahlung/Ausgabe gelöscht, wird der Umsatz
--                  wieder offen (status 'pending').
--   M2-20          sync_contact_to_tenant: Hausnummern mit Bruch ("12 1/2", "5 1/2 a").
--
-- Idempotent. Keine Signatur bestehender Funktionen geändert. Verträglich mit der heute ausgelieferten
-- App (keine der entfernten Funktionen wird von der App oder einer Edge Function aufgerufen; die
-- Stripe-Felder schreibt die App nie; die Bankabgleich-Seite ist eine reine Demo ohne Schreibzugriffe).
-- Reihenfolge: nach 03_tenant-view.sql (dort wird eine der 11 Policies entfernt – hier wird nur
-- umgestellt, was noch existiert) und vor 05_floorplan.sql (entfernt ggf. renovation_positions).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. notify_push (D2-07, D2-22): nur Rechte und search_path, der Rumpf bleibt unberührt.
--    Aufrufer sind ausschließlich die SECURITY-DEFINER-Triggerfunktionen trigger_push_on_*
--    (Eigentümer postgres) – sie brauchen kein Recht der angemeldeten Nutzer.
-- -----------------------------------------------------------------------------
do $$
begin
    if to_regprocedure('public.notify_push(text,jsonb)') is not null then
        execute 'alter function public.notify_push(text, jsonb) set search_path = public, pg_temp';
        execute 'revoke execute on function public.notify_push(text, jsonb) from public, anon, authenticated';
        execute 'grant execute on function public.notify_push(text, jsonb) to service_role';
    end if;
end $$;


-- -----------------------------------------------------------------------------
-- 2. trigger_push_on_* (D2-23 Teil 1): Live-Fassung versioniert (identisch, nur LF-Zeilenenden).
--    Die Trigger selbst stehen in 20260215103500_push_notifications.sql und bleiben unverändert.
-- -----------------------------------------------------------------------------
create or replace function public.trigger_push_on_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
BEGIN
    IF NEW.receiver_id IS NOT NULL AND NEW.sender_id IS DISTINCT FROM NEW.receiver_id THEN
        PERFORM notify_push('messages', to_jsonb(NEW));
    END IF;
    RETURN NEW;
END;
$function$;

create or replace function public.trigger_push_on_ticket()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
BEGIN
    PERFORM notify_push('tickets', to_jsonb(NEW));
    RETURN NEW;
END;
$function$;

create or replace function public.trigger_push_on_announcement()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
BEGIN
    PERFORM notify_push('announcements', to_jsonb(NEW));
    RETURN NEW;
END;
$function$;

create or replace function public.trigger_push_on_document()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
BEGIN
    PERFORM notify_push('documents', to_jsonb(NEW));
    RETURN NEW;
END;
$function$;

create or replace function public.trigger_push_on_registration()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
BEGIN
    IF NEW.role = 'tenant' THEN
        PERFORM notify_push('user_roles', to_jsonb(NEW));
    END IF;
    RETURN NEW;
END;
$function$;

revoke execute on function public.trigger_push_on_message() from public, anon, authenticated;
revoke execute on function public.trigger_push_on_ticket() from public, anon, authenticated;
revoke execute on function public.trigger_push_on_announcement() from public, anon, authenticated;
revoke execute on function public.trigger_push_on_document() from public, anon, authenticated;
revoke execute on function public.trigger_push_on_registration() from public, anon, authenticated;
grant execute on function public.trigger_push_on_message() to service_role;
grant execute on function public.trigger_push_on_ticket() to service_role;
grant execute on function public.trigger_push_on_announcement() to service_role;
grant execute on function public.trigger_push_on_document() to service_role;
grant execute on function public.trigger_push_on_registration() to service_role;


-- -----------------------------------------------------------------------------
-- 3. Unbenutzte Alt-Helfer entfernen (R1-12, D2-23 Teil 2). Ohne CASCADE: hinge noch eine Policy,
--    Sicht oder BEGIN-ATOMIC-Funktion daran, bricht die Migration hier ab.
--    Die rechte-bewussten Drei-Parameter-Varianten has_*_access(uuid, text, text) bleiben.
-- -----------------------------------------------------------------------------
drop function if exists public.has_contact_access(uuid, uuid);
drop function if exists public.has_document_template_access(uuid, uuid);
drop function if exists public.is_user_shared_with_me(uuid);
drop function if exists public.has_claim_access(uuid);
drop function if exists public.has_claim_columns_access(uuid, uuid);
drop function if exists public.has_renovation_calc_trade_access(uuid);
drop function if exists public.has_renovation_project_trade_access(uuid);
drop function if exists public.has_renovation_calculation_access(uuid);
drop function if exists public.has_renovation_project_access(uuid);
drop function if exists public.has_economic_unit_access(uuid);
drop function if exists public.has_invoice_access(uuid);
drop function if exists public.has_lease_access(uuid);
drop function if exists public.has_tenant_access(uuid);
drop function if exists public.has_unit_access(uuid);
drop function if exists public.has_property_access(uuid);
drop function if exists public.has_portfolio_access(uuid);


-- -----------------------------------------------------------------------------
-- 4. Policies mit Rolle PUBLIC auf authenticated einschränken (R1-14).
--    Nur was noch existiert (03_tenant-view.sql entfernt die portfolios-Policy, die zurückgestellte
--    Stufe 03b die beiden auf properties/units).
-- -----------------------------------------------------------------------------
do $$
declare
    r record;
begin
    for r in
        select p.tablename, p.policyname
          from pg_policies p
          join (values
                ('announcements',           'tenants_read_announcements'),
                ('documents',               'tenants_read_general_docs'),
                ('documents',               'tenants_read_personal_docs'),
                ('leases',                  'tenants_read_own_leases'),
                ('objektkalender_events',   'ok_tenants_read_events'),
                ('objektkalender_history',  'ok_tenants_read_history'),
                ('objektkalender_settings', 'ok_tenants_read_settings'),
                ('portfolios',              'Tenants can view their property portfolio'),
                ('properties',              'tenants_read_own_property'),
                ('tenants',                 'tenants_owner_all'),
                ('units',                   'tenants_read_own_unit')
               ) as v(tbl, pol)
            on v.tbl = p.tablename and v.pol = p.policyname
         where p.schemaname = 'public'
           and 'public' = any (p.roles)
    loop
        execute format('alter policy %I on public.%I to authenticated', r.policyname, r.tablename);
    end loop;
end $$;


-- -----------------------------------------------------------------------------
-- 5. Standardrechte für künftige Objekte (R2-14): von postgres im Schema public angelegte Tabellen,
--    Sichten und Sequenzen bekommen anon nicht mehr automatisch. (Funktionen haben anon bereits nicht;
--    die Zeile ist ein idempotentes No-op.) Die Standardrechte der Rolle supabase_admin lassen sich
--    nur über Supabase ändern; Migrationen laufen als postgres.
-- -----------------------------------------------------------------------------
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on functions from anon;


-- -----------------------------------------------------------------------------
-- 6. profiles: Stripe-Connect-Felder schützen (D3b-18).
--    Angemeldete Nutzer (Rolle authenticated/anon) können sie weder setzen noch ändern; die Werte
--    werden still beibehalten, damit "Profil speichern" mit vollem Objekt weiter funktioniert.
--    Edge Functions (service_role) und SECURITY-DEFINER-Funktionen (Eigentümer postgres) sind frei.
--    SECURITY INVOKER ist hier Absicht: current_user muss die aufrufende Rolle sein.
-- -----------------------------------------------------------------------------
create or replace function public.profiles_protect_stripe_connect()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
    if current_user in ('authenticated', 'anon') then
        if tg_op = 'INSERT' then
            new.stripe_connect_id := null;
            new.stripe_connect_enabled := false;
        else
            new.stripe_connect_id := old.stripe_connect_id;
            new.stripe_connect_enabled := old.stripe_connect_enabled;
        end if;
    end if;
    return new;
end;
$function$;

comment on function public.profiles_protect_stripe_connect() is
    'Stripe-Connect-Konto und -Status sind nur für service_role (Edge Functions stripe-connect-onboard/stripe-webhook) änderbar.';

revoke all on function public.profiles_protect_stripe_connect() from public, anon, authenticated;
grant execute on function public.profiles_protect_stripe_connect() to service_role;

drop trigger if exists profiles_protect_stripe_connect on public.profiles;
create trigger profiles_protect_stripe_connect
    before insert or update on public.profiles
    for each row execute function public.profiles_protect_stripe_connect();


-- -----------------------------------------------------------------------------
-- 7. Renovierungs-Stammdaten (D3b-19): UPDATE/DELETE wie INSERT auch für Freigabe-Nutzer mit
--    Schreibrecht (immobilien oder investorportal). Eltern-Prüfung (gleiche user_id) bleibt.
--    Zusätzlich hält keep_user_id_on_update() die user_id fest, damit ein Freigabe-Nutzer eine
--    Vorlage nicht auf sein eigenes Konto umhängen kann.
-- -----------------------------------------------------------------------------
do $$
declare
    v_tbl text;
    v_cond constant text :=
        '(user_id = (select auth.uid())) or public.rls_owner_shares(user_id, ''immobilien'', ''write'') '
        || 'or public.rls_owner_shares(user_id, ''investorportal'', ''write'')';
    v_parent text;
begin
    foreach v_tbl in array array['renovation_trades', 'renovation_subtrades', 'renovation_positions', 'renovation_milestone_templates']
    loop
        if to_regclass('public.' || v_tbl) is null then
            continue;
        end if;

        v_parent := case v_tbl
            when 'renovation_subtrades' then
                ' and exists (select 1 from public.renovation_trades t where t.id = renovation_subtrades.trade_id and t.user_id = renovation_subtrades.user_id)'
            when 'renovation_positions' then
                ' and exists (select 1 from public.renovation_subtrades s where s.id = renovation_positions.subtrade_id and s.user_id = renovation_positions.user_id)'
            else ''
        end;

        execute format('drop policy if exists %I on public.%I', v_tbl || '_update', v_tbl);
        execute format('create policy %I on public.%I for update to authenticated using (%s) with check ((%s)%s)',
                       v_tbl || '_update', v_tbl, v_cond, v_cond, v_parent);

        execute format('drop policy if exists %I on public.%I', v_tbl || '_delete', v_tbl);
        execute format('create policy %I on public.%I for delete to authenticated using (%s)',
                       v_tbl || '_delete', v_tbl, v_cond);

        execute format('drop trigger if exists keep_user_id_on_update on public.%I', v_tbl);
        execute format('create trigger keep_user_id_on_update before update on public.%I '
                       'for each row execute function public.keep_user_id_on_update()', v_tbl);
    end loop;
end $$;


-- -----------------------------------------------------------------------------
-- 8. rent_ledger: Sollstellungen in Forderungen nicht löschbar (D4-11).
--    lease_before_delete() und recalculate_rent_ledger_entry() löschen solche Zeilen schon heute
--    nicht; der Trigger schließt das direkte DELETE (Policy rent_ledger_delete) und jeden anderen Weg.
--    SECURITY DEFINER, damit die Prüfung alle claim_items sieht (unabhängig von der Freigabe-Kategorie).
-- -----------------------------------------------------------------------------
create index if not exists idx_claim_items_rent_ledger_ids_gin
    on public.claim_items using gin (rent_ledger_ids);

create or replace function public.rent_ledger_block_claimed_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
    if exists (select 1
                 from public.claim_items ci
                where ci.rent_ledger_id = old.id
                   or ci.rent_ledger_ids @> array[old.id]) then
        raise exception 'Die Sollstellung für % ist Teil einer Forderung und kann nicht gelöscht werden.',
                        coalesce(to_char(old.period_month, 'MM/YYYY'), 'diesen Monat')
            using errcode = '23503',
                  hint = 'Sollstellungen, die in einer Forderung verwendet werden (auch in stornierten), bleiben erhalten.';
    end if;
    return old;
end;
$function$;

revoke all on function public.rent_ledger_block_claimed_delete() from public, anon, authenticated;
grant execute on function public.rent_ledger_block_claimed_delete() to service_role;

drop trigger if exists trigger_rent_ledger_block_claimed_delete on public.rent_ledger;
create trigger trigger_rent_ledger_block_claimed_delete
    before delete on public.rent_ledger
    for each row execute function public.rent_ledger_block_claimed_delete();


-- -----------------------------------------------------------------------------
-- 9. Bankumsätze (M2-16): matched_target_id ist polymorph (income -> rent_payments.id,
--    expense -> expenses.id). Wird das Ziel gelöscht, wird der Umsatz wieder offen.
--    SECURITY DEFINER, weil der Umsatz dem Verbindungs-Eigentümer gehört, die Buchung aber auch ein
--    Freigabe-Nutzer löschen kann. (Altbestand aus der früheren Demo trägt teils Vertrags- bzw.
--    Kostenart-IDs; er wird von diesem Trigger nicht berührt.)
-- -----------------------------------------------------------------------------
create index if not exists idx_bank_transactions_matched_target_id
    on public.bank_transactions (matched_target_id)
    where matched_target_id is not null;

create or replace function public.bank_transactions_unmatch_deleted_target()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
    v_type text;
begin
    v_type := case tg_table_name
                  when 'rent_payments' then 'income'
                  when 'expenses' then 'expense'
              end;
    if v_type is not null then
        update public.bank_transactions bt
           set status = 'pending',
               matched_type = null,
               matched_target_id = null
         where bt.matched_target_id = old.id
           and bt.matched_type = v_type;
    end if;
    return old;
end;
$function$;

comment on function public.bank_transactions_unmatch_deleted_target() is
    'Setzt Bankumsätze auf pending zurück, wenn die zugeordnete Mietzahlung (income) bzw. Ausgabe (expense) gelöscht wird.';

revoke all on function public.bank_transactions_unmatch_deleted_target() from public, anon, authenticated;
grant execute on function public.bank_transactions_unmatch_deleted_target() to service_role;

drop trigger if exists trigger_bank_tx_unmatch_on_delete on public.rent_payments;
create trigger trigger_bank_tx_unmatch_on_delete
    after delete on public.rent_payments
    for each row execute function public.bank_transactions_unmatch_deleted_target();

drop trigger if exists trigger_bank_tx_unmatch_on_delete on public.expenses;
create trigger trigger_bank_tx_unmatch_on_delete
    after delete on public.expenses
    for each row execute function public.bank_transactions_unmatch_deleted_target();


-- -----------------------------------------------------------------------------
-- 10. sync_contact_to_tenant (M2-20): Live-Fassung, nur das Hausnummern-Muster ist erweitert
--     um einen optionalen Bruch (" 1/2") und einen Buchstaben danach (" a").
--     Geprüft: "12 1/2", "12a 1/2", "5 1/2 a", "1 1/4", "12 1/2 - 14" werden jetzt getrennt;
--     "12 a", "3-5", "12/2", "12 - 14", "12a", "7 b-c", "Straße des 17. Juni 5", "100" unverändert.
-- -----------------------------------------------------------------------------
create or replace function public.sync_contact_to_tenant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_tenant public.tenants%rowtype;
  v_first text;
  v_last text;
  v_name text;
  v_tenant_first text;
  v_tenant_last text;
  v_street text;
  v_house text;
  v_matches text[];
  v_name_changed boolean;
  v_street_changed boolean;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if new.contact_type is distinct from 'tenant' or new.tenant_id is null then
    return new;
  end if;

  select * into v_tenant from public.tenants t where t.id = new.tenant_id and t.user_id = new.user_id;
  if not found then
    return new;
  end if;

  v_name_changed := new.name is distinct from old.name;
  v_street_changed := new.street is distinct from old.street;

  if not (v_name_changed
          or v_street_changed
          or new.email is distinct from old.email
          or new.phone is distinct from old.phone
          or new.zip is distinct from old.zip
          or new.city is distinct from old.city) then
    return new;
  end if;

  v_first := v_tenant.first_name;
  v_last := v_tenant.last_name;
  if v_name_changed then
    v_name := btrim(coalesce(new.name, ''));
    v_tenant_first := btrim(coalesce(v_tenant.first_name, ''));
    v_tenant_last := btrim(coalesce(v_tenant.last_name, ''));

    if v_name = '' or v_name = btrim(v_tenant_first || ' ' || v_tenant_last) then
      null;
    elsif v_tenant_first = '' then
      v_last := v_name;
    elsif left(v_name, length(v_tenant_first) + 1) = v_tenant_first || ' ' then
      v_first := v_tenant_first;
      v_last := btrim(substr(v_name, length(v_tenant_first) + 2));
    elsif v_tenant_last <> '' and length(v_name) > length(v_tenant_last) + 1
          and right(v_name, length(v_tenant_last) + 1) = ' ' || v_tenant_last then
      v_last := v_tenant_last;
      v_first := btrim(left(v_name, length(v_name) - length(v_tenant_last) - 1));
    elsif position(' ' in v_name) > 0 then
      v_first := substr(v_name, 1, position(' ' in v_name) - 1);
      v_last := btrim(substr(v_name, position(' ' in v_name) + 1));
    else
      v_first := '';
      v_last := v_name;
    end if;
  end if;

  v_street := v_tenant.street;
  v_house := v_tenant.house_number;
  if v_street_changed then
    if coalesce(btrim(new.street), '') = '' then
      v_street := '';
      v_house := '';
    else
      v_matches := regexp_match(btrim(new.street),
                                '^(.*?\S)\s+(\d+\s?[A-Za-z]?(?:\s\d+/\d+)?(?:\s?[A-Za-z](?![A-Za-z]))?(?:\s?[-/]\s?\d*\s?[A-Za-z]?)*)$');
      if v_matches is not null then
        v_street := btrim(v_matches[1]);
        v_house := btrim(v_matches[2]);
      else
        v_street := btrim(new.street);
        v_house := '';
      end if;
    end if;
  end if;

  update public.tenants t
     set first_name   = v_first,
         last_name    = v_last,
         email        = case when new.email is distinct from old.email then new.email else t.email end,
         phone        = case when new.phone is distinct from old.phone then new.phone else t.phone end,
         street       = v_street,
         house_number = v_house,
         postal_code  = case when new.zip is distinct from old.zip then new.zip else t.postal_code end,
         city         = case when new.city is distinct from old.city then new.city else t.city end
   where t.id = v_tenant.id
     and t.user_id = new.user_id;

  return new;
end;
$function$;

revoke execute on function public.sync_contact_to_tenant() from public, anon, authenticated;
grant execute on function public.sync_contact_to_tenant() to service_role;
