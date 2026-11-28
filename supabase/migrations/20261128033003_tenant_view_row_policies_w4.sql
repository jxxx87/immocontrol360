-- =============================================================================
-- Welle 3 · Paket 03 TENANT-VIEW · Stufe 2  (eingespielt in Welle 4, nach dem App-Deploy 2e42e1d)
--
-- Befunde: G22-04, G21-15, D3b-11 (Teil properties/units)
--   Die zeilenweisen Mieter-Policies tenants_read_own_property (properties) und
--   tenants_read_own_unit (units) geben Mietern ALLE Spalten ihres Objekts bzw. ihrer Einheit
--   (Marktwert, Investition, Eigenkapital, AfA, Soll-Miete, Vermieter-user_id …).
--   Das Mieterportal liest Objekt/Einheit über get_my_tenancy() und die Vermieter-ID
--   über get_my_landlord_info() (Stufe 1) – die Policies werden nicht mehr gebraucht.
--
-- Voraussetzungen (erfüllt am 28.11.2026): Stufe 1 eingespielt; App ohne direkte Mieter-Abfragen auf
-- properties/units live (TenantMessages, TenantTickets, Topbar, TenantStamdaten, TenantDashboard,
-- ObjectCalendar über get_my_tenancy).
-- Idempotent.
-- =============================================================================

do $$
begin
    if to_regprocedure('public.get_my_landlord_info(uuid)') is null then
        raise exception 'Stufe 1 (_fixwork/sql/wave3/03_tenant-view.sql) zuerst einspielen.';
    end if;
end $$;

drop policy if exists "tenants_read_own_property" on public.properties;
drop policy if exists "tenants_read_own_unit" on public.units;
