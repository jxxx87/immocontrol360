-- =============================================================================
-- Welle 3 · Paket 09 TENANT-MGMT (Mieterverwaltung)
-- Befunde: G17b-07, G19-10 (Änderungsprotokoll Mieterdaten-Link), G19-06 (Löschsperre),
--          G17-07 (Plausibilität/Überschneidung Mietverträge), G17-10 (Eigentümer bei
--          Freigabe-Nutzern), G23-11 (Ticket-Verlauf für Teammitglieder), G20-09 (Kontakte
--          für Freigabe-Nutzer), G18-10 (interne Notizen), D4-14 (tenant_verification_links
--          .tenant_id NOT NULL + Doku), D4-07 (Bucket tenant-documents; Bucket documents
--          folgt in deferred/09b nach dem App-Deploy).
--
-- Idempotent (create or replace / if not exists / drop … if exists). Signaturen bestehender
-- Funktionen bleiben unverändert. Verträglich mit der heute ausgelieferten App (siehe Bericht
-- _fixwork/wave3/reports/09_TENANT-MGMT.md, Abschnitt „Einspielen").
-- notify_push wird nicht berührt.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. G17b-07 / G19-10: Änderungsprotokoll für Mieterdaten-Links
--    Vorher/Nachher-Werte jeder Aktualisierung über den Link. Nur lesbar für Konten mit
--    Leserecht „mietverhaeltnisse" auf den Mieter; schreiben nur die Datenbankfunktion.
-- -----------------------------------------------------------------------------
create table if not exists public.tenant_change_log (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    link_id uuid references public.tenant_verification_links(id) on delete set null,
    source text not null default 'token_link',
    old_values jsonb not null default '{}'::jsonb,
    new_values jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

comment on table public.tenant_change_log is
    'Änderungsprotokoll der Mieter-Stammdaten (heute: Aktualisierung über den Mieterdaten-Link). '
    'Wird nur von update_tenant_by_token geschrieben; App-Konten dürfen nur lesen.';

create index if not exists idx_tenant_change_log_tenant on public.tenant_change_log (tenant_id, created_at desc);
create index if not exists idx_tenant_change_log_link on public.tenant_change_log (link_id);

alter table public.tenant_change_log enable row level security;

drop policy if exists tenant_change_log_select on public.tenant_change_log;
create policy tenant_change_log_select on public.tenant_change_log
    for select to authenticated
    using (public.has_tenant_access(tenant_id, 'mietverhaeltnisse', 'read'));

revoke all on table public.tenant_change_log from anon, public;
revoke insert, update, delete, truncate, references, trigger on table public.tenant_change_log from authenticated;
grant select on table public.tenant_change_log to authenticated;
grant all on table public.tenant_change_log to service_role;

-- update_tenant_by_token: Ablauf wie live, zusätzlich Protokollzeile (alte + neue Werte)
create or replace function public.update_tenant_by_token(p_token text, p_first_name text, p_last_name text, p_street text, p_house_number text, p_postal_code text, p_city text, p_phone text, p_email text)
 returns json
 language plpgsql
 security definer
 set search_path = public, pg_temp
as $function$
declare
  v_hash text := public.tenant_link_token_hash(p_token);
  v_link public.tenant_verification_links%rowtype;
  v_old public.tenants%rowtype;
  v_new public.tenants%rowtype;
  v_first text := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last text := nullif(btrim(coalesce(p_last_name, '')), '');
  v_street text := nullif(btrim(coalesce(p_street, '')), '');
  v_house text := nullif(btrim(coalesce(p_house_number, '')), '');
  v_zip text := nullif(btrim(coalesce(p_postal_code, '')), '');
  v_city text := nullif(btrim(coalesce(p_city, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_email text := lower(nullif(btrim(coalesce(p_email, '')), ''));
begin
  if v_hash is null then
    return json_build_object('error', 'Link ist ungültig oder abgelaufen.');
  end if;

  select * into v_link
  from public.tenant_verification_links
  where token_hash = v_hash and expires_at > now()
  limit 1
  for update;

  if not found then
    return json_build_object('error', 'Link ist ungültig oder abgelaufen.');
  end if;

  if v_link.is_updated then
    return json_build_object(
      'error', 'Dieser Link wurde bereits verwendet. Wenn Sie weitere Änderungen mitteilen möchten, wenden Sie sich bitte an Ihren Vermieter.',
      'used', true);
  end if;

  select * into v_old from public.tenants where id = v_link.tenant_id for update;
  if not found then
    return json_build_object('error', 'Mieter nicht gefunden.');
  end if;

  if coalesce(v_first, v_old.first_name) is null and coalesce(v_last, v_old.last_name) is null then
    return json_build_object('error', 'Bitte geben Sie Ihren Vor- und Nachnamen an.');
  end if;
  if length(coalesce(v_first, '')) > 100 or length(coalesce(v_last, '')) > 100
     or length(coalesce(v_street, '')) > 200 or length(coalesce(v_house, '')) > 20
     or length(coalesce(v_zip, '')) > 20 or length(coalesce(v_city, '')) > 100
     or length(coalesce(v_phone, '')) > 50 or length(coalesce(v_email, '')) > 254 then
    return json_build_object('error', 'Eine Eingabe ist zu lang. Bitte kürzen Sie die Angaben.');
  end if;
  if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return json_build_object('error', 'Bitte geben Sie eine gültige E-Mail-Adresse an.');
  end if;

  perform set_config('immo.tenant_update_source', 'token_link', true);

  update public.tenants
     set first_name = coalesce(v_first, v_old.first_name, ''),
         last_name = coalesce(v_last, v_old.last_name, ''),
         street = v_street,
         house_number = v_house,
         postal_code = v_zip,
         city = v_city,
         phone = v_phone,
         email = coalesce(v_email, v_old.email)
   where id = v_old.id
  returning * into v_new;

  perform set_config('immo.tenant_update_source', '', true);

  -- G17b-07/G19-10: alte und neue Werte sichern (der Vermieter sieht den Vergleich im Verlauf)
  insert into public.tenant_change_log (tenant_id, link_id, source, old_values, new_values)
  values (
    v_old.id,
    v_link.id,
    'token_link',
    jsonb_build_object(
      'first_name', v_old.first_name, 'last_name', v_old.last_name,
      'street', v_old.street, 'house_number', v_old.house_number,
      'postal_code', v_old.postal_code, 'city', v_old.city,
      'phone', v_old.phone, 'email', v_old.email),
    jsonb_build_object(
      'first_name', v_new.first_name, 'last_name', v_new.last_name,
      'street', v_new.street, 'house_number', v_new.house_number,
      'postal_code', v_new.postal_code, 'city', v_new.city,
      'phone', v_new.phone, 'email', v_new.email)
  );

  update public.tenant_verification_links
     set is_updated = true,
         updated_at = now()
   where id = v_link.id;

  return json_build_object('success', true);
end;
$function$;

-- Öffentliche Mieterdaten-Seite (ohne Anmeldung): anon braucht EXECUTE (Token-Funktion, Whitelist)
revoke execute on function public.update_tenant_by_token(text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.update_tenant_by_token(text, text, text, text, text, text, text, text, text) to anon, authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 2. G19-06: delete_tenant_completely – Sperre bei laufendem/künftigem Mietvertrag oder
--    offener Forderung. Sonst Ablauf unverändert wie live.
--    „Laufend/künftig" wie getLeaseTimeState in der App: Ende >= heute, oder kein Ende und
--    Status 'active'. „Offen" = Status nicht settled/cancelled/archived (wie Forderungsmodul).
-- -----------------------------------------------------------------------------
create or replace function public.delete_tenant_completely(p_tenant_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path = public, pg_temp
as $function$
declare
  v_caller uuid := auth.uid();
  v_landlord_id uuid;
  v_account_ids uuid[];
  v_uid uuid;
begin
  select user_id into v_landlord_id from public.tenants where id = p_tenant_id;

  if v_caller is null or v_landlord_id is null or v_landlord_id <> v_caller then
    raise exception 'Not authorized to delete this tenant';
  end if;

  if exists (select 1 from public.leases l
              where l.tenant_id = p_tenant_id
                and (l.end_date >= current_date
                     or (l.end_date is null and l.status = 'active'))) then
    raise exception 'Der Mieter hat einen laufenden oder künftigen Mietvertrag und kann deshalb nicht gelöscht werden. Bitte beenden Sie zuerst das Mietverhältnis oder entziehen Sie nur den Portalzugang.'
      using hint = 'tenant_has_active_lease';
  end if;

  if exists (select 1 from public.claims c
              where (c.tenant_id = p_tenant_id
                     or c.lease_id in (select l.id from public.leases l where l.tenant_id = p_tenant_id))
                and c.status not in ('settled', 'cancelled', 'archived')) then
    raise exception 'Für den Mieter bestehen noch offene Forderungen. Bitte schließen Sie diese zuerst ab (erledigt oder storniert) oder entziehen Sie nur den Portalzugang.'
      using hint = 'tenant_has_open_claims';
  end if;

  select coalesce(array_agg(distinct ur.user_id), '{}')
    into v_account_ids
  from public.user_roles ur
  join auth.users u on u.id = ur.user_id
  where ur.tenant_id = p_tenant_id
    and ur.role = 'tenant'
    and ur.user_id <> v_caller
    and exists (select 1 from public.tenant_invitations i
                where i.tenant_id = p_tenant_id
                  and lower(trim(i.email)) = lower(trim(u.email)));

  update public.documents set tenant_id = null where tenant_id = p_tenant_id;
  update public.claims set tenant_id = null where tenant_id = p_tenant_id;
  update public.leases set tenant_id = null where tenant_id = p_tenant_id;
  update public.contacts set tenant_id = null where tenant_id = p_tenant_id;

  delete from public.tenant_verification_links where tenant_id = p_tenant_id;
  delete from public.tenant_invitations where tenant_id = p_tenant_id;
  delete from public.user_roles where tenant_id = p_tenant_id;

  foreach v_uid in array v_account_ids loop
    if not exists (select 1 from public.user_roles where user_id = v_uid)
       and not exists (select 1 from public.portfolios where user_id = v_uid)
       and not exists (select 1 from public.properties where user_id = v_uid)
       and not exists (select 1 from public.tenants where user_id = v_uid)
    then
      begin
        delete from public.profiles where id = v_uid;
        delete from auth.users where id = v_uid;
      exception when foreign_key_violation then
        null;
      end;
    end if;
  end loop;

  delete from public.tenants where id = p_tenant_id;
end;
$function$;

revoke execute on function public.delete_tenant_completely(uuid) from public, anon;
grant execute on function public.delete_tenant_completely(uuid) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 3. G17-07: Plausibilität und Überschneidung von Mietverträgen
-- -----------------------------------------------------------------------------
-- 3a. Mietende nicht vor Mietbeginn (live 0 Verstöße)
do $$
begin
    if not exists (select 1 from pg_constraint
                    where conrelid = 'public.leases'::regclass and conname = 'leases_end_after_start') then
        alter table public.leases add constraint leases_end_after_start
            check (end_date is null or end_date >= start_date) not valid;
    end if;
    begin
        alter table public.leases validate constraint leases_end_after_start;
    exception when check_violation then
        raise warning 'TENANT-MGMT: Verträge mit Mietende vor Mietbeginn vorhanden – leases_end_after_start bleibt NOT VALID.';
    end;
end $$;

-- 3b. Keine zweite Belegung derselben Einheit im selben Zeitraum (gleiche Regel wie
--     findOverlappingLeases in src/lib/leaseRentPeriods.js: Zeiträume inklusive, offenes Ende =
--     unbegrenzt, „beendet ohne Enddatum" belegt nicht). Geprüft werden nur neue bzw. in Einheit,
--     Laufzeit oder Status geänderte Verträge; Überschneidungen, die schon vor einer Änderung
--     bestanden (Altbestand), blockieren die Änderung nicht – Verkürzen/Beenden bleibt möglich.
create or replace function public.leases_check_overlap()
 returns trigger
 language plpgsql
 security definer
 set search_path = public, pg_temp
as $function$
declare
  v_new_end date := coalesce(new.end_date, 'infinity'::date);
  v_check_old boolean := false;
  v_old_start date;
  v_old_end date;
  v_conflict record;
begin
  if new.unit_id is null or new.start_date is null then
    return new;
  end if;
  -- beendet ohne Enddatum (Altdaten): belegt die Einheit nicht
  if new.status is distinct from 'active' and new.end_date is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.unit_id is not distinct from old.unit_id
       and new.start_date is not distinct from old.start_date
       and new.end_date is not distinct from old.end_date
       and new.status is not distinct from old.status then
      return new;
    end if;
    v_check_old := old.unit_id = new.unit_id
                   and not (old.status is distinct from 'active' and old.end_date is null)
                   and old.start_date is not null;
    v_old_start := old.start_date;
    v_old_end := coalesce(old.end_date, 'infinity'::date);
  end if;

  -- gleichzeitige Anlage auf derselben Einheit nacheinander prüfen
  perform pg_advisory_xact_lock(hashtextextended('public.leases.unit:' || new.unit_id::text, 0));

  select l.id, l.start_date, l.end_date
    into v_conflict
    from public.leases l
   where l.unit_id = new.unit_id
     and l.id <> new.id
     and not (l.status is distinct from 'active' and l.end_date is null)
     and l.start_date <= v_new_end
     and new.start_date <= coalesce(l.end_date, 'infinity'::date)
     and not (v_check_old
              and l.start_date <= v_old_end
              and v_old_start <= coalesce(l.end_date, 'infinity'::date))
   order by l.start_date
   limit 1;

  if found then
    raise exception 'Für diese Einheit besteht im gewählten Zeitraum bereits ein Mietvertrag (% – %). Bitte beenden Sie zuerst den bestehenden Vertrag oder wählen Sie einen Mietbeginn nach dessen Ende.',
      to_char(v_conflict.start_date, 'DD.MM.YYYY'),
      coalesce(to_char(v_conflict.end_date, 'DD.MM.YYYY'), 'unbefristet')
      using hint = 'lease_overlap';
  end if;

  return new;
end;
$function$;

revoke execute on function public.leases_check_overlap() from public, anon, authenticated;
grant execute on function public.leases_check_overlap() to service_role;

drop trigger if exists trg_leases_check_overlap on public.leases;
create trigger trg_leases_check_overlap
    before insert or update of unit_id, start_date, end_date, status on public.leases
    for each row execute function public.leases_check_overlap();


-- -----------------------------------------------------------------------------
-- 4. G17-10: Verträge und Mieter gehören dem Eigentümer der Einheit
-- -----------------------------------------------------------------------------
-- 4a. set_owner_user_id um leases erweitert (Eigentümer über Einheit -> Objekt -> Portfolio).
--     Beim Anlegen: user_id = Eigentümer. Beim Ändern: user_id bleibt; Verschieben zu einem
--     anderen Eigentümer wird abgelehnt (wie bei Objekten/Einheiten).
create or replace function public.set_owner_user_id()
 returns trigger
 language plpgsql
 security definer
 set search_path = public, pg_temp
as $function$
declare
    v_owner uuid;
    v_moved boolean := false;
begin
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

revoke execute on function public.set_owner_user_id() from public, anon, authenticated;
grant execute on function public.set_owner_user_id() to service_role;

drop trigger if exists set_owner_user_id on public.leases;
create trigger set_owner_user_id
    before insert or update on public.leases
    for each row execute function public.set_owner_user_id();

-- 4b. Mieter (und sein automatisch angelegter Kontakt), den ein Freigabe-Nutzer selbst angelegt
--     hat, geht beim ersten Vertrag auf den Eigentümer der Einheit über – sonst behielte der
--     Freigabe-Nutzer nach Entzug der Freigabe Vollzugriff (tenants_owner_all) und der Eigentümer
--     sähe seinen Mieter nicht (has_tenant_access verlangt Mieter-Eigentümer = Objekt-Eigentümer).
--     Nur wenn: Anlegender = bisheriger Mieter-Eigentümer und der Mieter keine Verträge bei einem
--     anderen Eigentümer hat. Läuft vor trg_sync_lease_to_contact (alphabetisch), damit der
--     Kontakt danach die Einheit erhält.
create or replace function public.leases_sync_tenant_owner()
 returns trigger
 language plpgsql
 security definer
 set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_tenant_owner uuid;
begin
  if new.tenant_id is null or v_uid is null then
    return null;
  end if;
  if tg_op = 'UPDATE'
     and new.tenant_id is not distinct from old.tenant_id
     and new.unit_id is not distinct from old.unit_id then
    return null;
  end if;

  select po.user_id into v_owner
    from public.units u
    join public.properties pr on pr.id = u.property_id
    join public.portfolios po on po.id = pr.portfolio_id
   where u.id = new.unit_id;

  select t.user_id into v_tenant_owner from public.tenants t where t.id = new.tenant_id;

  if v_owner is null or v_tenant_owner is null or v_tenant_owner = v_owner or v_tenant_owner <> v_uid then
    return null;
  end if;

  if exists (select 1
               from public.leases l
               join public.units u on u.id = l.unit_id
               join public.properties pr on pr.id = u.property_id
               join public.portfolios po on po.id = pr.portfolio_id
              where l.tenant_id = new.tenant_id
                and l.id <> new.id
                and po.user_id <> v_owner) then
    return null;
  end if;

  update public.tenants set user_id = v_owner
   where id = new.tenant_id and user_id = v_tenant_owner;
  update public.contacts set user_id = v_owner
   where tenant_id = new.tenant_id and user_id = v_tenant_owner;

  return null;
end;
$function$;

revoke execute on function public.leases_sync_tenant_owner() from public, anon, authenticated;
grant execute on function public.leases_sync_tenant_owner() to service_role;

drop trigger if exists trg_leases_owner_sync on public.leases;
create trigger trg_leases_owner_sync
    after insert or update of tenant_id, unit_id on public.leases
    for each row execute function public.leases_sync_tenant_owner();


-- -----------------------------------------------------------------------------
-- 5. G23-11: Ticket-Verlauf für alle mit Leserecht „mieterportal" auf das Objekt des Tickets
--    (bisher nur Absender/Empfänger). Mieter sehen nicht mehr als bisher: Ticket-Nachrichten
--    haben immer den Mieter als Absender oder Empfänger.
-- -----------------------------------------------------------------------------
create or replace function public.rls_ticket_message_visible(p_ticket_id uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path = public, pg_temp
as $function$
  select coalesce(
    auth.uid() is not null
    and p_ticket_id is not null
    and exists (select 1 from public.tickets t
                 where t.id = p_ticket_id
                   and public.has_property_access(t.property_id, 'mieterportal', 'read')),
    false)
$function$;

revoke execute on function public.rls_ticket_message_visible(uuid) from public, anon;
grant execute on function public.rls_ticket_message_visible(uuid) to authenticated, service_role;

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
    for select to authenticated
    using (
        (sender_id = (select auth.uid()))
        or (receiver_id = (select auth.uid()))
        or (ticket_id is not null and public.rls_ticket_message_visible(ticket_id))
    );


-- -----------------------------------------------------------------------------
-- 6. G20-09: Kontakte – Freigabe-Nutzer mit Schreibrecht „kontakte" dürfen nicht mit einem
--    Mieter verknüpfte Kontakte des Eigentümers bearbeiten und löschen. Besitzer (user_id) ist
--    über die API nicht änderbar (restriktive Policy, wie tenant_user_id_unchanged).
-- -----------------------------------------------------------------------------
create or replace function public.rls_contact_user_id_unchanged(p_contact_id uuid, p_user_id uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path = public, pg_temp
as $function$
  select not exists (select 1 from public.contacts c
                      where c.id = p_contact_id
                        and c.user_id is distinct from p_user_id)
$function$;

revoke execute on function public.rls_contact_user_id_unchanged(uuid, uuid) from public, anon;
grant execute on function public.rls_contact_user_id_unchanged(uuid, uuid) to authenticated, service_role;

drop policy if exists contacts_update on public.contacts;
create policy contacts_update on public.contacts
    for update to authenticated
    using (
        (user_id = (select auth.uid()))
        or (tenant_id is null and public.rls_owner_shares(user_id, 'kontakte', 'write'))
    )
    with check (
        ((user_id = (select auth.uid()))
         or (tenant_id is null and public.rls_owner_shares(user_id, 'kontakte', 'write')))
        and (public.rls_tenant_ok(tenant_id, 'user', user_id)
             or public.rls_tenant_link_unchanged('contacts', id, tenant_id))
    );

drop policy if exists contacts_user_id_unchanged on public.contacts;
create policy contacts_user_id_unchanged on public.contacts
    as restrictive
    for update to authenticated
    using (true)
    with check (public.rls_contact_user_id_unchanged(id, user_id));

drop policy if exists contacts_delete on public.contacts;
create policy contacts_delete on public.contacts
    for delete to authenticated
    using (
        (user_id = (select auth.uid()))
        or (tenant_id is null and public.rls_owner_shares(user_id, 'kontakte', 'write'))
    );


-- -----------------------------------------------------------------------------
-- 7. G18-10: Interne Notizen je Mietverhältnis (bisher nur localStorage).
--    Eigene Tabelle, damit Mieter (die ihre leases-Zeile lesen) die Notizen nicht sehen.
-- -----------------------------------------------------------------------------
create table if not exists public.lease_notes (
    lease_id uuid primary key references public.leases(id) on delete cascade,
    notes text not null default '',
    updated_at timestamptz not null default now(),
    updated_by uuid references auth.users(id) on delete set null,
    constraint lease_notes_length check (char_length(notes) <= 20000)
);

comment on table public.lease_notes is
    'Interne Notizen des Vermieters/Teams zu einem Mietverhältnis (nicht für Mieter sichtbar).';

alter table public.lease_notes enable row level security;

drop policy if exists lease_notes_select on public.lease_notes;
create policy lease_notes_select on public.lease_notes
    for select to authenticated
    using (public.has_lease_access(lease_id, 'mietverhaeltnisse', 'read'));

drop policy if exists lease_notes_insert on public.lease_notes;
create policy lease_notes_insert on public.lease_notes
    for insert to authenticated
    with check (public.has_lease_access(lease_id, 'mietverhaeltnisse', 'write'));

drop policy if exists lease_notes_update on public.lease_notes;
create policy lease_notes_update on public.lease_notes
    for update to authenticated
    using (public.has_lease_access(lease_id, 'mietverhaeltnisse', 'write'))
    with check (public.has_lease_access(lease_id, 'mietverhaeltnisse', 'write'));

drop policy if exists lease_notes_delete on public.lease_notes;
create policy lease_notes_delete on public.lease_notes
    for delete to authenticated
    using (public.has_lease_access(lease_id, 'mietverhaeltnisse', 'write'));

revoke all on table public.lease_notes from anon, public;
revoke truncate, references, trigger on table public.lease_notes from authenticated;
grant select, insert, update, delete on table public.lease_notes to authenticated;
grant all on table public.lease_notes to service_role;

-- Zeitpunkt und Bearbeiter setzt die Datenbank
create or replace function public.lease_notes_set_meta()
 returns trigger
 language plpgsql
 set search_path = public, pg_temp
as $function$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$function$;

revoke execute on function public.lease_notes_set_meta() from public, anon, authenticated;
grant execute on function public.lease_notes_set_meta() to service_role;

drop trigger if exists trg_lease_notes_set_meta on public.lease_notes;
create trigger trg_lease_notes_set_meta
    before insert or update on public.lease_notes
    for each row execute function public.lease_notes_set_meta();


-- -----------------------------------------------------------------------------
-- 8. D4-14: Mieterdaten-Link immer mit Mieter (live 0 NULL-Zeilen; einziger Insert in
--    TenantManagement.jsx setzt tenant_id). Bewusst nullable Spalten dokumentieren.
-- -----------------------------------------------------------------------------
do $$
begin
    alter table public.tenant_verification_links alter column tenant_id set not null;
exception when not_null_violation then
    raise warning 'TENANT-MGMT: tenant_verification_links ohne tenant_id vorhanden – NOT NULL NICHT gesetzt.';
end $$;

comment on column public.expense_categories.user_id is
    'Eigentümer der Kategorie; NULL = globale Standardkategorie (für alle sichtbar, nicht änderbar).';
comment on column public.claims.tenant_id is
    'Mieter der Forderung; bewusst nullable: delete_tenant_completely löst den Bezug (Lösch-Regel D2-17), die Forderung bleibt über lease_id zugeordnet.';
comment on column public.leases.tenant_id is
    'Mieter des Vertrags; bewusst nullable: delete_tenant_completely löst den Bezug (Lösch-Regel D2-17), Vertrag und Mietkonto bleiben erhalten.';


-- -----------------------------------------------------------------------------
-- 9. D4-07: Bucket tenant-documents (in der App unbenutzt, 0 Objekte) nur PDF/Bilder.
--    Bucket documents folgt in deferred/09b_documents-bucket-mime.sql (erst nach App-Deploy).
-- -----------------------------------------------------------------------------
update storage.buckets
   set allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp']
 where id = 'tenant-documents';
