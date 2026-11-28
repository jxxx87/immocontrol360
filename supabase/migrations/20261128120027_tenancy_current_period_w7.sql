-- =============================================================================
-- Welle 7 · Paket sonstiges-3 · 01 tenancy_current_period
-- Befund:
--   B-43  Mietbeträge am Vertrag veralten bei künftiger Mietänderung: leases.cold_rent /
--         service_charge / heating_cost / other_costs / payment_due_day werden nur von
--         sync_lease_rent_from_periods auf den Mietzeitraum des laufenden Monats gesetzt
--         (Trigger on_lease_rent_period_change und sync_all_rent_ledgers; kein pg_cron).
--         Tritt eine Mietänderung „gültig ab“ einem künftigen Monat ein, zeigte das
--         Mieterportal (Dashboard, Stammdaten) über get_my_tenancy weiter die alte Miete.
--         -> get_my_tenancy liest die Beträge jetzt aus dem Mietzeitraum zum heutigen Tag
--            (lease_rent_period_for_month(l.id, current_date), dieselbe Regel wie
--            sync_lease_rent_from_periods und die Sollstellung); ohne Mietzeitraum bleiben
--            die Vertragsspalten maßgeblich.
--         Die Vertragsspalten selbst hält die Vermieter-App aktuell: Dashboard.jsx ruft
--         sync_all_rent_ledgers höchstens einmal am Tag je Konto auf (App-Teil, kein SQL).
--
-- Nur create or replace der bestehenden Funktion: Signatur, Rückgabeform (json, gleiche
-- Schlüssel), STABLE, SECURITY DEFINER, search_path und Rechte unverändert. Die App funktioniert
-- vor und nach dieser Migration (Schlüssel und Typen gleich, nur die Werte sind aktuell).
-- Idempotent. Rückbau: rollback/sonstiges-3_01_tenancy_current_period.rollback.sql
-- =============================================================================

create or replace function public.get_my_tenancy()
 returns json
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
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

    -- B-43: Beträge aus dem Mietzeitraum zum heutigen Tag (Mietänderung „gültig ab“), nicht aus den
    -- Vertragsspalten, die erst beim nächsten Abgleich (sync_lease_rent_from_periods) nachziehen.
    -- Ohne Mietzeitraum (rp.id is null) gelten die Vertragsspalten.
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
                   'cold_rent', case when rp.id is not null then rp.cold_rent else l.cold_rent end,
                   'service_charge', case when rp.id is not null then rp.service_charge else l.service_charge end,
                   'heating_cost', case when rp.id is not null then rp.heating_cost else l.heating_cost end,
                   'other_costs', case when rp.id is not null then rp.other_costs else l.other_costs end,
                   'deposit', l.deposit,
                   'payment_due_day', case when rp.id is not null then rp.payment_due_day else l.payment_due_day end,
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
        left join lateral public.lease_rent_period_for_month(l.id, current_date) rp on true
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

-- Rechte wie heute live: nur angemeldete Konten (und service_role), nicht anon/PUBLIC
revoke execute on function public.get_my_tenancy() from public, anon;
grant execute on function public.get_my_tenancy() to authenticated, service_role;
