-- =============================================================================
-- Welle 3 · Paket 03 TENANT-VIEW · Stufe 1
-- Mieter-Sicht auf Vermieter-Daten über eine eng begrenzte Funktion statt ganzer Zeilen
--
-- Befunde:
--   M1-05, M1-05/G02-06, G02-06, G04-21   profiles-Policy "Tenants can view owner profile settings"
--                                          gab Mietern die ganze Vermieter-Profilzeile (IBAN, BIC,
--                                          Steuernummer, USt-ID, Stripe-ID, Privatadresse, Telefon)
--   D3b-11 (Teil profiles/portfolios)      portfolios-Policy "Tenants can view their property portfolio"
--                                          gab Mietern die ganze Portfolio-Zeile (IBAN, Steuernummer,
--                                          USt-ID), ohne Rollenprüfung
--   G21-15 / G22-04 (vorbereitet)          Die App liest Vermieter-ID und Öffnungszeiten nur noch über
--                                          get_my_landlord_info(); Objekt/Einheit über get_my_tenancy().
--                                          Das Entfernen der zeilenweisen Mieter-Policies auf properties
--                                          und units ist Stufe 2 (_fixwork/sql/wave3/deferred/), weil der
--                                          Objektkalender (ObjectCalendar.jsx, anderes Paket) sie noch liest.
--
-- Neu:      public.get_my_landlord_info(p_property_id uuid default null) returns json
--           (SECURITY DEFINER; liefert NUR property_id, landlord_user_id und die zwei Öffnungszeiten-Felder)
-- Entfernt: Policy "Tenants can view owner profile settings" on public.profiles
--           Policy "Tenants can view their property portfolio" on public.portfolios
-- Unverändert: rls_is_my_landlord(uuid) bleibt bestehen (danach von keiner Policy mehr benutzt).
--
-- Reihenfolge: ERST die App mit den Änderungen aus Paket TENANT-VIEW ausliefern (Topbar ruft die neue
-- Funktion auf und fällt ohne sie auf den alten Weg zurück), DANN diese Migration einspielen. Eine noch
-- geöffnete alte App-Version zeigt nach der Migration im Mieterportal die Standard-Öffnungszeiten statt
-- der des Vermieters (kein Fehler, Neuladen genügt).
-- Idempotent.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Vermieter-Kurzinfo für das Mieterkonto
--    Objekt = p_property_id, wenn es zum Mieterkonto gehört (Rollen-Objekt, Objekt der
--    Rollen-Einheit oder Objekt eines eigenen Mietvertrags), sonst das Rollen-Objekt.
--    Fremde Objekt-IDs liefern NULL (kein Ausforschen anderer Vermieter).
-- -----------------------------------------------------------------------------
create or replace function public.get_my_landlord_info(p_property_id uuid default null)
returns json
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
    v_uid uuid := auth.uid();
    v_role record;
    v_property_id uuid;
    v_property_owner uuid;
    v_portfolio_owner uuid;
    v_visible boolean;
    v_text text;
begin
    if v_uid is null then
        return null;
    end if;

    select ur.tenant_id, ur.unit_id, ur.property_id into v_role
    from public.user_roles ur
    where ur.user_id = v_uid
      and ur.role = 'tenant'
    order by ur.created_at desc nulls last
    limit 1;

    if not found then
        return null;
    end if;

    if p_property_id is not null then
        if p_property_id is distinct from v_role.property_id
           and not exists (select 1 from public.units u
                           where u.id = v_role.unit_id
                             and u.property_id = p_property_id)
           and not exists (select 1 from public.leases l
                           join public.units u on u.id = l.unit_id
                           where v_role.tenant_id is not null
                             and l.tenant_id = v_role.tenant_id
                             and u.property_id = p_property_id) then
            return null;
        end if;
        v_property_id := p_property_id;
    else
        v_property_id := coalesce(
            v_role.property_id,
            (select u.property_id from public.units u where u.id = v_role.unit_id)
        );
    end if;

    if v_property_id is null then
        return null;
    end if;

    select pr.user_id, po.user_id
      into v_property_owner, v_portfolio_owner
    from public.properties pr
    left join public.portfolios po on po.id = pr.portfolio_id
    where pr.id = v_property_id;

    if not found then
        return null;
    end if;

    -- Öffnungszeiten aus dem Profil des Portfolio-Eigentümers (wie bisher in der Topbar)
    select p.settings_opening_hours_visible, p.settings_opening_hours_text
      into v_visible, v_text
    from public.profiles p
    where p.id = coalesce(v_portfolio_owner, v_property_owner);

    return json_build_object(
        'property_id', v_property_id,
        'landlord_user_id', coalesce(v_property_owner, v_portfolio_owner),
        'opening_hours_visible', v_visible,
        'opening_hours_text', v_text
    );
end;
$function$;

comment on function public.get_my_landlord_info(uuid) is
    'Mieterportal: Vermieter-ID (Nachrichten-Empfänger) und Öffnungszeiten für das eigene Objekt. Keine weiteren Profil-, Portfolio- oder Objektspalten.';

revoke all on function public.get_my_landlord_info(uuid) from public, anon;
grant execute on function public.get_my_landlord_info(uuid) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 2. Zeilenweise Mieter-Freigaben auf Vermieter-Profil und Portfolio entfernen
--    (einzige Nutzer im Code: Topbar.jsx – jetzt über get_my_landlord_info;
--     PortfolioContext lädt für Mieterkonten keine Portfolios mehr)
-- -----------------------------------------------------------------------------
drop policy if exists "Tenants can view owner profile settings" on public.profiles;
drop policy if exists "Tenants can view their property portfolio" on public.portfolios;
