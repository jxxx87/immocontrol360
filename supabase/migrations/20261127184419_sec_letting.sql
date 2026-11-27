-- =============================================================================
-- 100600_sec_letting.sql  (Paket SEC-LETTING, Komplett-Check 2026-11-27)
--
-- Öffentliches Vermietungsportal, Besichtigungsbuchung, Bewerberunterlagen
-- (Bucket applicant-documents) und eingeschränkte Mieter-Sicht auf Objekt/Einheit.
--
-- Befunde:
--   G21-01, D3b-13, D4-07 (applicant-documents), E1-05 (Teil)  Bucket privat, Größen-/MIME-Limit,
--                                         anon nur INSERT unter <process_id>/<applicant_id>/...
--   G21-02                                anon-ALL auf rental_viewing_bookings entfernt, Buchen/
--                                         Absagen nur per Token-RPC
--   G21-03, G21-06, D3b-10, M2-12         Bewerbung nur per submit_rental_application (user_id/status
--                                         serverseitig, E-Mail normalisiert, Missbrauchsbremse)
--   G21-04, G21-11, G21-12                Bewerber-Kontext + eigene Buchung per Token-RPC (kein
--                                         select('*') für anon), max. 1 aktive Buchung je Bewerber
--   G21-13, G21-18                        nur künftige Termine, Slot-Prüfung serverseitig, Dauer > 0
--   G21-22, D1b-24 (Teil), M2-15, D3b-09  get_rental_process_by_token ohne user_id, Arrays COALESCE;
--                                         anon-SELECT auf rental_processes / rental_viewings entfernt
--   G20-05, G20-06, G20-07 (Teil)         convert_rental_applicant_to_tenant: Umwandlung in EINER
--                                         Transaktion, nur bei laufendem Prozess, Miete > 0
--   G22-04                                get_my_tenancy(): Mieter-Sicht ohne interne Objektspalten
--
-- Vertrag C1 (Edge Functions, Paket EDGE-MAIL): send-letting-email (application_received,
-- booking_confirmed, booking_canceled) und sync-applicant-files erhalten zusätzlich
-- process_token + applicant_id bzw. booking_id; Speicherpfad der Unterlagen künftig
-- <process_id>/<applicant_id>/<doc>.<ext> (Altpfad <applicant_id>/<doc>.<ext>).
--
-- Voraussetzung: Fundament 20261127100000_sec_access_helpers.sql (has_unit_access mit 3 Parametern).
-- Idempotent (create or replace, drop policy if exists).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Öffentliche Token-RPC: keine Vermieter-user_id mehr, Arrays nie NULL
--    (Signatur unverändert)
-- -----------------------------------------------------------------------------
create or replace function public.get_rental_process_by_token(p_token text)
returns json
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
    v_process record;
    v_unit record;
    v_property record;
begin
    select * into v_process
    from public.rental_processes
    where token = p_token and status = 'in_vermietung';

    if not found then
        return json_build_object('error', 'Mietobjekt ist nicht mehr aktiv oder Link ist ungültig.');
    end if;

    select * into v_unit
    from public.units
    where id = v_process.unit_id;

    if not found then
        return json_build_object('error', 'Einheit nicht gefunden.');
    end if;

    select * into v_property
    from public.properties
    where id = v_unit.property_id;

    return json_build_object(
        'id', v_process.id,
        'listing_title', coalesce(v_process.listing_title, ''),
        'listing_description', coalesce(v_process.listing_description, ''),
        'required_documents', coalesce(v_process.required_documents, '{}'::text[]),
        'custom_requirements', coalesce(v_process.custom_requirements, '{}'::text[]),

        -- Unit details
        'unit_name', v_unit.unit_name,
        'floor', coalesce(v_unit.floor, ''),
        'sqm', coalesce(v_unit.sqm, 0),
        'rooms', coalesce(v_unit.rooms, 0),
        'bathrooms', coalesce(v_unit.bathrooms, 0),
        'bedrooms', coalesce(v_unit.bedrooms, 0),
        'balcony', coalesce(v_unit.balcony, false),
        'fitted_kitchen', coalesce(v_unit.fitted_kitchen, false),
        'target_rent', coalesce(v_unit.target_rent, 0),
        'service_charge_soll', coalesce(v_unit.service_charge_soll, 0),
        'heating_cost_soll', coalesce(v_unit.heating_cost_soll, 0),

        -- Property details
        'street', v_property.street,
        'house_number', coalesce(v_property.house_number, ''),
        'city', v_property.city,
        'zip', coalesce(v_property.zip, '')
    );
end;
$function$;


-- -----------------------------------------------------------------------------
-- 2. Prüf-Funktionen für den Bucket applicant-documents
-- -----------------------------------------------------------------------------

-- Darf (auch anonym) diese Datei hochgeladen werden?
--   Pfad <process_id>/<applicant_id>/<doc>[_<nr>].<pdf|jpg|jpeg|png>,
--   Prozess öffentlich (in_vermietung), Bewerber gehört zum Prozess und ist höchstens
--   24 Stunden alt, höchstens 12 Dateien je Bewerber.
create or replace function public.applicant_document_upload_allowed(p_object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
    v_process_id uuid;
    v_applicant_id uuid;
    v_existing integer;
begin
    if p_object_name is null
       or p_object_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-z_]{1,40}(_[0-9]{1,16})?\.(pdf|jpg|jpeg|png)$' then
        return false;
    end if;

    v_process_id := split_part(p_object_name, '/', 1)::uuid;
    v_applicant_id := split_part(p_object_name, '/', 2)::uuid;

    if not exists (
        select 1
        from public.rental_applicants a
        join public.rental_processes p on p.id = a.process_id
        where a.id = v_applicant_id
          and p.id = v_process_id
          and p.status = 'in_vermietung'
          and a.created_at > now() - interval '24 hours'
    ) then
        return false;
    end if;

    select count(*) into v_existing
    from storage.objects o
    where o.bucket_id = 'applicant-documents'
      and o.name like v_process_id::text || '/' || v_applicant_id::text || '/%';

    return v_existing < 12;
end;
$function$;

-- Gehört die Datei einem Vorgang/Bewerber des angemeldeten Vermieters?
--   neu: <process_id>/<applicant_id>/<datei>   alt: <applicant_id>/<datei>
create or replace function public.is_applicant_document_owner(p_object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
    v_first text := split_part(coalesce(p_object_name, ''), '/', 1);
    v_id uuid;
begin
    if auth.uid() is null
       or v_first !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        return false;
    end if;
    v_id := v_first::uuid;

    if exists (select 1 from public.rental_processes p
               where p.id = v_id and p.user_id = auth.uid()) then
        return true;
    end if;

    return exists (select 1 from public.rental_applicants a
                   where a.id = v_id and a.user_id = auth.uid());
end;
$function$;


-- -----------------------------------------------------------------------------
-- 3. Bucket applicant-documents: privat, 10 MB, nur PDF/JPEG/PNG; Storage-Policies
-- -----------------------------------------------------------------------------
update storage.buckets
   set public = false,
       file_size_limit = 10485760,
       allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png']
 where id = 'applicant-documents';

drop policy if exists "Allow system/landlord delete from applicant-documents" on storage.objects;
drop policy if exists "Allow public uploads to applicant-documents" on storage.objects;
drop policy if exists "Allow public read to applicant-documents" on storage.objects;
drop policy if exists applicant_docs_public_insert on storage.objects;
drop policy if exists applicant_docs_owner_select on storage.objects;
drop policy if exists applicant_docs_owner_delete on storage.objects;

-- Hochladen (Bewerber, ohne Anmeldung) – nur unter dem eigenen Bewerberordner eines öffentlichen Vorgangs
create policy applicant_docs_public_insert on storage.objects
    for insert to anon, authenticated
    with check (bucket_id = 'applicant-documents'
                and public.applicant_document_upload_allowed(name));

-- Lesen / Löschen nur durch den Vermieter (Eigentümer des Vorgangs)
create policy applicant_docs_owner_select on storage.objects
    for select to authenticated
    using (bucket_id = 'applicant-documents'
           and public.is_applicant_document_owner(name));

create policy applicant_docs_owner_delete on storage.objects
    for delete to authenticated
    using (bucket_id = 'applicant-documents'
           and public.is_applicant_document_owner(name));


-- -----------------------------------------------------------------------------
-- 4. RLS der Vermietungstabellen: nur Eigentümer, keine anonymen Policies mehr
-- -----------------------------------------------------------------------------

-- rental_processes ------------------------------------------------------------
alter table public.rental_processes enable row level security;
drop policy if exists "Allow public read access to active rental processes" on public.rental_processes;
drop policy if exists "Landlords manage own rental_processes" on public.rental_processes;
drop policy if exists rental_processes_owner_select on public.rental_processes;
drop policy if exists rental_processes_owner_insert on public.rental_processes;
drop policy if exists rental_processes_owner_update on public.rental_processes;
drop policy if exists rental_processes_owner_delete on public.rental_processes;

create policy rental_processes_owner_select on public.rental_processes
    for select to authenticated
    using (user_id = auth.uid());

create policy rental_processes_owner_insert on public.rental_processes
    for insert to authenticated
    with check (
        user_id = auth.uid()
        and exists (select 1 from public.units u
                    where u.id = rental_processes.unit_id
                      and (u.user_id = auth.uid()
                           or public.has_unit_access(u.id, 'mieterportal', 'write')))
    );

create policy rental_processes_owner_update on public.rental_processes
    for update to authenticated
    using (user_id = auth.uid())
    with check (
        user_id = auth.uid()
        and exists (select 1 from public.units u
                    where u.id = rental_processes.unit_id
                      and (u.user_id = auth.uid()
                           or public.has_unit_access(u.id, 'mieterportal', 'write')))
    );

create policy rental_processes_owner_delete on public.rental_processes
    for delete to authenticated
    using (user_id = auth.uid());

-- rental_applicants -----------------------------------------------------------
-- Kein INSERT-Recht mehr für Clients: Bewerbungen nur über submit_rental_application.
alter table public.rental_applicants enable row level security;
drop policy if exists "Allow public insert to rental_applicants" on public.rental_applicants;
drop policy if exists "Landlords manage own rental_applicants" on public.rental_applicants;
drop policy if exists rental_applicants_owner_select on public.rental_applicants;
drop policy if exists rental_applicants_owner_update on public.rental_applicants;
drop policy if exists rental_applicants_owner_delete on public.rental_applicants;

create policy rental_applicants_owner_select on public.rental_applicants
    for select to authenticated
    using (
        user_id = auth.uid()
        and exists (select 1 from public.rental_processes p
                    where p.id = rental_applicants.process_id and p.user_id = auth.uid())
    );

create policy rental_applicants_owner_update on public.rental_applicants
    for update to authenticated
    using (
        user_id = auth.uid()
        and exists (select 1 from public.rental_processes p
                    where p.id = rental_applicants.process_id and p.user_id = auth.uid())
    )
    with check (
        user_id = auth.uid()
        and exists (select 1 from public.rental_processes p
                    where p.id = rental_applicants.process_id and p.user_id = auth.uid())
    );

create policy rental_applicants_owner_delete on public.rental_applicants
    for delete to authenticated
    using (
        user_id = auth.uid()
        and exists (select 1 from public.rental_processes p
                    where p.id = rental_applicants.process_id and p.user_id = auth.uid())
    );

-- rental_viewings -------------------------------------------------------------
alter table public.rental_viewings enable row level security;
drop policy if exists "Allow public read access to rental_viewings" on public.rental_viewings;
drop policy if exists "Landlords manage own rental_viewings" on public.rental_viewings;
drop policy if exists rental_viewings_owner_select on public.rental_viewings;
drop policy if exists rental_viewings_owner_insert on public.rental_viewings;
drop policy if exists rental_viewings_owner_update on public.rental_viewings;
drop policy if exists rental_viewings_owner_delete on public.rental_viewings;

create policy rental_viewings_owner_select on public.rental_viewings
    for select to authenticated
    using (user_id = auth.uid());

create policy rental_viewings_owner_insert on public.rental_viewings
    for insert to authenticated
    with check (
        user_id = auth.uid()
        and exists (select 1 from public.rental_processes p
                    where p.id = rental_viewings.process_id and p.user_id = auth.uid())
    );

create policy rental_viewings_owner_update on public.rental_viewings
    for update to authenticated
    using (user_id = auth.uid())
    with check (
        user_id = auth.uid()
        and exists (select 1 from public.rental_processes p
                    where p.id = rental_viewings.process_id and p.user_id = auth.uid())
    );

create policy rental_viewings_owner_delete on public.rental_viewings
    for delete to authenticated
    using (user_id = auth.uid());

-- rental_viewing_bookings -----------------------------------------------------
-- Buchen/Absagen durch Bewerber nur über book_viewing / cancel_viewing_booking.
alter table public.rental_viewing_bookings enable row level security;
drop policy if exists "Allow public manage access to bookings" on public.rental_viewing_bookings;
drop policy if exists "Landlords manage own rental_viewing_bookings" on public.rental_viewing_bookings;
drop policy if exists rental_viewing_bookings_owner_select on public.rental_viewing_bookings;
drop policy if exists rental_viewing_bookings_owner_update on public.rental_viewing_bookings;
drop policy if exists rental_viewing_bookings_owner_delete on public.rental_viewing_bookings;

create policy rental_viewing_bookings_owner_select on public.rental_viewing_bookings
    for select to authenticated
    using (exists (select 1 from public.rental_viewings v
                   where v.id = rental_viewing_bookings.viewing_id and v.user_id = auth.uid()));

create policy rental_viewing_bookings_owner_update on public.rental_viewing_bookings
    for update to authenticated
    using (exists (select 1 from public.rental_viewings v
                   where v.id = rental_viewing_bookings.viewing_id and v.user_id = auth.uid()))
    with check (exists (select 1 from public.rental_viewings v
                        where v.id = rental_viewing_bookings.viewing_id and v.user_id = auth.uid()));

create policy rental_viewing_bookings_owner_delete on public.rental_viewing_bookings
    for delete to authenticated
    using (exists (select 1 from public.rental_viewings v
                   where v.id = rental_viewing_bookings.viewing_id and v.user_id = auth.uid()));


-- -----------------------------------------------------------------------------
-- 5. Öffentliche Bewerber-/Buchungs-RPCs (Token-geprüft, SECURITY DEFINER)
-- -----------------------------------------------------------------------------

-- Bewerbung einreichen. user_id (Vermieter) und status werden serverseitig gesetzt,
-- nur bekannte Felder werden übernommen. Rückgabe: id der Bewerbung.
create or replace function public.submit_rental_application(p_token text, p_application jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
    v_process public.rental_processes%rowtype;
    v_app jsonb := coalesce(p_application, '{}'::jsonb);
    v_first text;
    v_last text;
    v_email text;
    v_has_co boolean;
    v_income numeric;
    v_co_income numeric;
    v_count integer;
    v_id uuid;
begin
    if jsonb_typeof(v_app) <> 'object' then
        raise exception 'Ungültige Bewerbungsdaten.';
    end if;

    select * into v_process
    from public.rental_processes
    where token = p_token and status = 'in_vermietung';

    if not found then
        raise exception 'Mietobjekt ist nicht mehr aktiv oder Link ist ungültig.';
    end if;

    v_first := left(nullif(btrim(v_app->>'first_name'), ''), 100);
    v_last := left(nullif(btrim(v_app->>'last_name'), ''), 100);
    v_email := lower(btrim(coalesce(v_app->>'email', '')));

    if v_first is null or v_last is null then
        raise exception 'Bitte geben Sie Vor- und Nachnamen an.';
    end if;
    if length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
        raise exception 'Bitte geben Sie eine gültige E-Mail-Adresse an.';
    end if;

    -- Missbrauchsbremse (Massen-Einreichungen)
    select count(*) into v_count
    from public.rental_applicants
    where process_id = v_process.id
      and created_at > now() - interval '10 minutes';
    if v_count >= 30 then
        raise exception 'Zu viele Bewerbungen in kurzer Zeit. Bitte versuchen Sie es in einigen Minuten erneut.';
    end if;

    select count(*) into v_count
    from public.rental_applicants
    where process_id = v_process.id
      and lower(email) = v_email
      and created_at > now() - interval '24 hours';
    if v_count >= 3 then
        raise exception 'Zu viele Bewerbungen in kurzer Zeit. Bitte versuchen Sie es später erneut.';
    end if;

    v_has_co := coalesce((v_app->>'has_co_applicant')::boolean, false);
    v_income := nullif(btrim(v_app->>'monthly_income'), '')::numeric;
    v_co_income := nullif(btrim(v_app->>'co_monthly_income'), '')::numeric;

    insert into public.rental_applicants (
        process_id, user_id, status,
        earliest_move_in, salutation, first_name, last_name, birth_date, marital_status,
        phone, email, introduction,
        has_co_applicant, co_salutation, co_first_name, co_last_name, co_birth_date,
        co_relationship, co_email, co_phone,
        additional_persons_count, is_employed, monthly_income, co_is_employed, co_monthly_income,
        street, house_number, postal_code, city,
        has_rent_arrears, has_eviction_lawsuits, has_insolvency_proceedings,
        receives_social_benefits, has_pets
    ) values (
        v_process.id, v_process.user_id, 'applied',
        nullif(btrim(v_app->>'earliest_move_in'), '')::date,
        left(nullif(btrim(v_app->>'salutation'), ''), 30),
        v_first,
        v_last,
        nullif(btrim(v_app->>'birth_date'), '')::date,
        left(nullif(btrim(v_app->>'marital_status'), ''), 30),
        left(nullif(btrim(v_app->>'phone'), ''), 50),
        v_email,
        left(nullif(btrim(v_app->>'introduction'), ''), 4000),
        v_has_co,
        case when v_has_co then left(nullif(btrim(v_app->>'co_salutation'), ''), 30) end,
        case when v_has_co then left(nullif(btrim(v_app->>'co_first_name'), ''), 100) end,
        case when v_has_co then left(nullif(btrim(v_app->>'co_last_name'), ''), 100) end,
        case when v_has_co then nullif(btrim(v_app->>'co_birth_date'), '')::date end,
        case when v_has_co then left(nullif(btrim(v_app->>'co_relationship'), ''), 100) end,
        case when v_has_co then left(lower(nullif(btrim(v_app->>'co_email'), '')), 254) end,
        case when v_has_co then left(nullif(btrim(v_app->>'co_phone'), ''), 50) end,
        least(greatest(coalesce(nullif(btrim(v_app->>'additional_persons_count'), '')::integer, 0), 0), 20),
        coalesce((v_app->>'is_employed')::boolean, false),
        case when v_income is null then null else least(greatest(v_income, 0), 99999999) end,
        case when v_has_co then coalesce((v_app->>'co_is_employed')::boolean, false) else false end,
        case when v_has_co and v_co_income is not null then least(greatest(v_co_income, 0), 99999999) end,
        left(nullif(btrim(v_app->>'street'), ''), 150),
        left(nullif(btrim(v_app->>'house_number'), ''), 20),
        left(nullif(btrim(v_app->>'postal_code'), ''), 10),
        left(nullif(btrim(v_app->>'city'), ''), 100),
        coalesce((v_app->>'has_rent_arrears')::boolean, false),
        coalesce((v_app->>'has_eviction_lawsuits')::boolean, false),
        coalesce((v_app->>'has_insolvency_proceedings')::boolean, false),
        coalesce((v_app->>'receives_social_benefits')::boolean, false),
        coalesce((v_app->>'has_pets')::boolean, false)
    )
    returning id into v_id;

    return v_id;
end;
$function$;

-- Besichtigungstage (ab heute, deutsche Zeit) und belegte Slots – ohne Bewerber-IDs
create or replace function public.get_rental_viewing_schedule(p_token text)
returns json
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
    v_process_id uuid;
    v_today date := (now() at time zone 'Europe/Berlin')::date;
begin
    select id into v_process_id
    from public.rental_processes
    where token = p_token and status = 'in_vermietung';

    if v_process_id is null then
        return json_build_object('error', 'Mietobjekt ist nicht mehr aktiv oder Link ist ungültig.');
    end if;

    return json_build_object(
        'viewings', coalesce((
            select json_agg(json_build_object(
                       'id', v.id,
                       'date', v.date,
                       'start_time', to_char(v.start_time, 'HH24:MI:SS'),
                       'end_time', to_char(v.end_time, 'HH24:MI:SS'),
                       'slot_duration_minutes', v.slot_duration_minutes
                   ) order by v.date, v.start_time)
            from public.rental_viewings v
            where v.process_id = v_process_id
              and v.date >= v_today
              and v.slot_duration_minutes > 0
        ), '[]'::json),
        'booked', coalesce((
            select json_agg(json_build_object(
                       'viewing_id', b.viewing_id,
                       'start_time', to_char(b.start_time, 'HH24:MI:SS')
                   ))
            from public.rental_viewing_bookings b
            join public.rental_viewings v on v.id = b.viewing_id
            where v.process_id = v_process_id
              and v.date >= v_today
              and b.status = 'booked'
        ), '[]'::json)
    );
end;
$function$;

-- Bewerber-Kontext für die Buchungsseite: nur Name, Buchbarkeit und eigene künftige Buchung.
-- Nachweis = öffentliches Token + Bewerber-ID aus dem persönlichen Link.
create or replace function public.get_rental_applicant_for_booking(p_token text, p_applicant_id uuid)
returns json
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
    v_process_id uuid;
    v_today date := (now() at time zone 'Europe/Berlin')::date;
    v_app record;
    v_booking json;
begin
    if p_applicant_id is null then
        return null;
    end if;

    select id into v_process_id
    from public.rental_processes
    where token = p_token and status = 'in_vermietung';
    if v_process_id is null then
        return null;
    end if;

    select a.id, a.first_name, a.last_name, a.status into v_app
    from public.rental_applicants a
    where a.id = p_applicant_id and a.process_id = v_process_id;
    if not found then
        return null;
    end if;

    select json_build_object(
               'id', b.id,
               'viewing_id', b.viewing_id,
               'date', v.date,
               'start_time', to_char(b.start_time, 'HH24:MI:SS'),
               'end_time', to_char(b.end_time, 'HH24:MI:SS')
           )
      into v_booking
    from public.rental_viewing_bookings b
    join public.rental_viewings v on v.id = b.viewing_id
    where b.applicant_id = v_app.id
      and b.status = 'booked'
      and v.process_id = v_process_id
      and v.date >= v_today
    order by v.date, b.start_time
    limit 1;

    return json_build_object(
        'id', v_app.id,
        'first_name', v_app.first_name,
        'last_name', v_app.last_name,
        'can_book', v_app.status not in ('declined', 'accepted', 'contract_declined'),
        'booking', v_booking
    );
end;
$function$;

-- Termin buchen: Slot muss zum Raster des Besichtigungstags passen und in der Zukunft liegen;
-- höchstens eine aktive (künftige) Buchung je Bewerber und Vorgang.
create or replace function public.book_viewing(
    p_token text,
    p_applicant_id uuid,
    p_viewing_id uuid,
    p_start_time time
)
returns json
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
    v_process_id uuid;
    v_now timestamp := now() at time zone 'Europe/Berlin';
    v_app record;
    v_viewing public.rental_viewings%rowtype;
    v_start_min integer;
    v_view_start integer;
    v_view_end integer;
    v_end time;
    v_booking public.rental_viewing_bookings%rowtype;
begin
    select id into v_process_id
    from public.rental_processes
    where token = p_token and status = 'in_vermietung';
    if v_process_id is null then
        raise exception 'Mietobjekt ist nicht mehr aktiv oder Link ist ungültig.';
    end if;

    -- Sperre auf die Bewerbung: parallele Buchungen desselben Bewerbers werden serialisiert
    select a.id, a.status into v_app
    from public.rental_applicants a
    where a.id = p_applicant_id and a.process_id = v_process_id
    for update;
    if not found then
        raise exception 'Bewerbung nicht gefunden. Bitte nutzen Sie den persönlichen Link aus Ihrer Bestätigungs-E-Mail.';
    end if;
    if v_app.status in ('declined', 'accepted', 'contract_declined') then
        raise exception 'Für diese Bewerbung ist keine Terminbuchung möglich.';
    end if;

    select * into v_viewing
    from public.rental_viewings
    where id = p_viewing_id and process_id = v_process_id;
    if not found then
        raise exception 'Besichtigungstag nicht gefunden.';
    end if;

    if p_start_time is null
       or v_viewing.slot_duration_minutes is null
       or v_viewing.slot_duration_minutes <= 0
       or extract(second from p_start_time) <> 0 then
        raise exception 'Ungültiger Termin.';
    end if;

    v_start_min := extract(hour from p_start_time)::integer * 60 + extract(minute from p_start_time)::integer;
    v_view_start := extract(hour from v_viewing.start_time)::integer * 60 + extract(minute from v_viewing.start_time)::integer;
    v_view_end := extract(hour from v_viewing.end_time)::integer * 60 + extract(minute from v_viewing.end_time)::integer;

    if v_start_min < v_view_start
       or (v_start_min - v_view_start) % v_viewing.slot_duration_minutes <> 0
       or v_start_min + v_viewing.slot_duration_minutes > v_view_end then
        raise exception 'Ungültiger Termin.';
    end if;

    if (v_viewing.date + p_start_time) <= v_now then
        raise exception 'Dieser Termin liegt in der Vergangenheit. Bitte wählen Sie einen anderen Termin.';
    end if;

    if exists (
        select 1
        from public.rental_viewing_bookings b
        join public.rental_viewings v on v.id = b.viewing_id
        where b.applicant_id = v_app.id
          and b.status = 'booked'
          and v.process_id = v_process_id
          and v.date >= v_now::date
    ) then
        raise exception 'Sie haben bereits einen Termin gebucht. Bitte sagen Sie diesen zuerst ab, wenn Sie einen anderen Termin wählen möchten.';
    end if;

    v_end := p_start_time + make_interval(mins => v_viewing.slot_duration_minutes);

    begin
        insert into public.rental_viewing_bookings (viewing_id, applicant_id, start_time, end_time, status)
        values (v_viewing.id, v_app.id, p_start_time, v_end, 'booked')
        returning * into v_booking;
    exception when unique_violation then
        raise exception 'Dieser Termin wurde gerade von einem anderen Bewerber gebucht. Bitte wählen Sie einen anderen Slot.'
            using errcode = 'unique_violation';
    end;

    return json_build_object(
        'id', v_booking.id,
        'viewing_id', v_booking.viewing_id,
        'date', v_viewing.date,
        'start_time', to_char(v_booking.start_time, 'HH24:MI:SS'),
        'end_time', to_char(v_booking.end_time, 'HH24:MI:SS'),
        'status', v_booking.status
    );
end;
$function$;

-- Termin absagen: Buchung muss zum Bewerber und zum öffentlichen Vorgang des Tokens gehören
create or replace function public.cancel_viewing_booking(
    p_token text,
    p_booking_id uuid,
    p_applicant_id uuid
)
returns json
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
    v_booking_id uuid;
begin
    update public.rental_viewing_bookings b
       set status = 'canceled',
           canceled_at = now()
      from public.rental_viewings v,
           public.rental_processes p
     where b.id = p_booking_id
       and b.applicant_id = p_applicant_id
       and b.status = 'booked'
       and v.id = b.viewing_id
       and p.id = v.process_id
       and p.token = p_token
       and p.status = 'in_vermietung'
    returning b.id into v_booking_id;

    if v_booking_id is null then
        raise exception 'Termin nicht gefunden oder bereits abgesagt.';
    end if;

    return json_build_object('id', v_booking_id, 'status', 'canceled');
end;
$function$;


-- -----------------------------------------------------------------------------
-- 6. Bewerber -> Mieter + Mietvertrag in EINER Transaktion (SECURITY INVOKER:
--    es gelten die RLS-Regeln des angemeldeten Vermieters)
-- -----------------------------------------------------------------------------
create or replace function public.convert_rental_applicant_to_tenant(
    p_applicant_id uuid,
    p_start_date date,
    p_cold_rent numeric,
    p_service_charge numeric default 0,
    p_heating_cost numeric default 0,
    p_deposit numeric default null,
    p_payment_due_day integer default 3
)
returns json
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $function$
declare
    v_uid uuid := auth.uid();
    v_app public.rental_applicants%rowtype;
    v_process public.rental_processes%rowtype;
    v_tenant_id uuid;
    v_lease_id uuid;
begin
    if v_uid is null then
        raise exception 'Nicht angemeldet.';
    end if;
    if p_start_date is null then
        raise exception 'Bitte einen Mietbeginn angeben.';
    end if;
    if p_cold_rent is null or p_cold_rent <= 0 then
        raise exception 'Bitte eine Kaltmiete größer 0 € angeben.';
    end if;
    if coalesce(p_service_charge, 0) < 0 or coalesce(p_heating_cost, 0) < 0 or coalesce(p_deposit, 0) < 0 then
        raise exception 'Beträge dürfen nicht negativ sein.';
    end if;
    if p_payment_due_day is null or p_payment_due_day < 1 or p_payment_due_day > 31 then
        raise exception 'Bitte einen Fälligkeitstag zwischen 1 und 31 angeben.';
    end if;

    select * into v_app from public.rental_applicants where id = p_applicant_id;
    if not found then
        raise exception 'Bewerbung nicht gefunden.';
    end if;

    select * into v_process from public.rental_processes where id = v_app.process_id for update;
    if not found then
        raise exception 'Vermietungsprozess nicht gefunden.';
    end if;
    if v_process.status <> 'in_vermietung' then
        raise exception 'Für diesen Vermietungsprozess wurde bereits ein Mieter angenommen.';
    end if;

    if exists (select 1 from public.leases l
               where l.unit_id = v_process.unit_id
                 and l.status = 'active'
                 and (l.end_date is null or l.end_date >= p_start_date)) then
        raise exception 'Für diese Einheit besteht bereits ein aktiver Mietvertrag, der den gewählten Mietbeginn überschneidet.';
    end if;

    insert into public.tenants (user_id, first_name, last_name, email, phone, occupants)
    values (v_uid, v_app.first_name, v_app.last_name, v_app.email, v_app.phone,
            coalesce(v_app.additional_persons_count, 0) + 1)
    returning id into v_tenant_id;

    insert into public.leases (user_id, tenant_id, unit_id, start_date, cold_rent, service_charge,
                               heating_cost, deposit, payment_due_day, lease_type, status)
    values (v_uid, v_tenant_id, v_process.unit_id, p_start_date, p_cold_rent, coalesce(p_service_charge, 0),
            coalesce(p_heating_cost, 0), p_deposit, p_payment_due_day, 'normal', 'active')
    returning id into v_lease_id;

    update public.rental_processes
       set status = 'vermietet',
           lease_start_date = p_start_date,
           rented_at = now()
     where id = v_process.id;

    update public.rental_applicants
       set status = 'accepted'
     where id = v_app.id;

    return json_build_object('tenant_id', v_tenant_id, 'lease_id', v_lease_id);
end;
$function$;


-- -----------------------------------------------------------------------------
-- 7. Eingeschränkte Mieter-Sicht (Mieterportal): nur Adresse/Bezeichnung/Fläche von
--    Objekt und Einheit, keine internen Spalten (Marktwert, Investition, Eigenkapital,
--    AfA, Soll-Miete, user_id des Vermieters)
-- -----------------------------------------------------------------------------
create or replace function public.get_my_tenancy()
returns json
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
    v_uid uuid := auth.uid();
    v_role record;
    v_tenant json;
    v_leases json;
    v_role_unit json;
begin
    if v_uid is null then
        return null;
    end if;

    select ur.tenant_id, ur.unit_id, ur.property_id into v_role
    from public.user_roles ur
    where ur.user_id = v_uid
      and ur.role = 'tenant'
      and ur.tenant_id is not null
    order by ur.created_at desc nulls last
    limit 1;

    if not found then
        return null;
    end if;

    select json_build_object('id', t.id, 'first_name', t.first_name, 'last_name', t.last_name)
      into v_tenant
    from public.tenants t
    where t.id = v_role.tenant_id;

    select coalesce(json_agg(x.obj order by x.sort_active, x.start_date desc), '[]'::json)
      into v_leases
    from (
        select l.start_date,
               case when lower(l.status) in ('active', 'aktiv') then 0 else 1 end as sort_active,
               json_build_object(
                   'id', l.id,
                   'status', l.status,
                   'start_date', l.start_date,
                   'end_date', l.end_date,
                   'cold_rent', l.cold_rent,
                   'service_charge', l.service_charge,
                   'heating_cost', l.heating_cost,
                   'other_costs', l.other_costs,
                   'deposit', l.deposit,
                   'payment_due_day', l.payment_due_day,
                   'unit', json_build_object(
                       'id', u.id,
                       'unit_name', u.unit_name,
                       'floor', u.floor,
                       'sqm', u.sqm,
                       'rooms', u.rooms,
                       'property', json_build_object(
                           'id', p.id,
                           'street', p.street,
                           'house_number', p.house_number,
                           'zip', p.zip,
                           'city', p.city
                       )
                   )
               ) as obj
        from public.leases l
        join public.units u on u.id = l.unit_id
        join public.properties p on p.id = u.property_id
        where l.tenant_id = v_role.tenant_id
    ) x;

    if v_role.unit_id is not null then
        select json_build_object(
                   'id', u.id,
                   'unit_name', u.unit_name,
                   'floor', u.floor,
                   'sqm', u.sqm,
                   'rooms', u.rooms,
                   'property', json_build_object(
                       'id', p.id,
                       'street', p.street,
                       'house_number', p.house_number,
                       'zip', p.zip,
                       'city', p.city
                   )
               )
          into v_role_unit
        from public.units u
        join public.properties p on p.id = u.property_id
        where u.id = v_role.unit_id;
    end if;

    return json_build_object(
        'tenant_id', v_role.tenant_id,
        'unit_id', v_role.unit_id,
        'property_id', v_role.property_id,
        'tenant', v_tenant,
        'leases', v_leases,
        'role_unit', v_role_unit
    );
end;
$function$;


-- -----------------------------------------------------------------------------
-- 8. Ausführungsrechte (nur GRANT; zentrale REVOKEs laut RULES 4 macht der Koordinator).
--    Achtung beim zentralen REVOKE: anon braucht EXECUTE auf die öffentlichen RPCs
--    und auf applicant_document_upload_allowed (wird in der anon-Storage-Policy ausgewertet).
-- -----------------------------------------------------------------------------
grant execute on function public.get_rental_process_by_token(text) to anon, authenticated;
grant execute on function public.submit_rental_application(text, jsonb) to anon, authenticated;
grant execute on function public.get_rental_viewing_schedule(text) to anon, authenticated;
grant execute on function public.get_rental_applicant_for_booking(text, uuid) to anon, authenticated;
grant execute on function public.book_viewing(text, uuid, uuid, time) to anon, authenticated;
grant execute on function public.cancel_viewing_booking(text, uuid, uuid) to anon, authenticated;
grant execute on function public.applicant_document_upload_allowed(text) to anon, authenticated;
grant execute on function public.is_applicant_document_owner(text) to authenticated;
grant execute on function public.convert_rental_applicant_to_tenant(uuid, date, numeric, numeric, numeric, numeric, integer) to authenticated;
grant execute on function public.get_my_tenancy() to authenticated;
