-- =============================================================================
-- Welle 5 – Paket R_APPLICANT_SALUTATION
-- Anrede des Bewerbers beim Umwandeln in einen Mieter übernehmen.
--
-- Befund: convert_rental_applicant_to_tenant legte den Mieter ohne Anrede an
-- (tenants.salutation blieb NULL, obwohl das Bewerbungsportal die Anrede
-- abfragt). Die App trug sie bisher nachträglich per UPDATE nach (Letting.jsx);
-- das bleibt unschädlich (setzt denselben Wert).
--
-- Werte:
--   rental_applicants.salutation  = Freitext aus dem Portal ('Frau'/'Herr'/'Divers',
--                                   künftig auch NULL = "Keine Angabe")
--   tenants.salutation            = CHECK: NULL | 'female' | 'male' | 'diverse'
-- Abbildung (ohne Groß-/Kleinschreibung, getrimmt):
--   Frau/female -> 'female', Herr/male -> 'male', Divers/diverse -> 'diverse',
--   leer/unbekannt -> NULL (neutrale Briefanrede)
--
-- Unverändert: Signatur, Rückgabe (json), SECURITY INVOKER, search_path, Rechte
-- (nur postgres, authenticated, service_role), übrige Logik byte-gleich.
-- Idempotent (create or replace).
-- =============================================================================

create or replace function public.convert_rental_applicant_to_tenant(
    p_applicant_id uuid,
    p_start_date date,
    p_cold_rent numeric,
    p_service_charge numeric default 0,
    p_heating_cost numeric default 0,
    p_deposit numeric default null::numeric,
    p_payment_due_day integer default 3)
 returns json
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare
    v_uid uuid := auth.uid();
    v_app public.rental_applicants%rowtype;
    v_process public.rental_processes%rowtype;
    v_tenant_id uuid;
    v_lease_id uuid;
    v_salutation text;
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

    -- Anrede aus dem Bewerbungsportal als tenants.salutation; leer/unbekannt = keine Angabe (neutrale Briefanrede)
    v_salutation := case lower(btrim(coalesce(v_app.salutation, '')))
                        when 'frau' then 'female'
                        when 'female' then 'female'
                        when 'herr' then 'male'
                        when 'male' then 'male'
                        when 'divers' then 'diverse'
                        when 'diverse' then 'diverse'
                        else null
                    end;

    insert into public.tenants (user_id, salutation, first_name, last_name, email, phone, occupants)
    values (v_uid, v_salutation, v_app.first_name, v_app.last_name, v_app.email, v_app.phone,
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

-- Rechte wie im Live-Stand (create or replace behält sie; hier nur festgeschrieben)
revoke execute on function public.convert_rental_applicant_to_tenant(uuid, date, numeric, numeric, numeric, numeric, integer)
    from public, anon;
grant execute on function public.convert_rental_applicant_to_tenant(uuid, date, numeric, numeric, numeric, numeric, integer)
    to authenticated, service_role;
