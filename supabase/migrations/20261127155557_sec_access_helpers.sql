-- =============================================================================
-- Sicherheits-Fundament (Komplett-Check 2026-11-27, Phase 1 / Schritt 6)
--
-- Rechte-bewusste Prüf-Funktionen für Portfolio-Freigaben.
--   category    : Schlüssel aus portfolio_shares.permissions
--                 (immobilien, mietverhaeltnisse, finanzen, nebenkosten, zaehler,
--                  kontakte, mieterportal, investorportal) oder '*' = beliebige Kategorie
--   access_type : 'read'  -> Freigabe mit 'read' oder 'write'
--                 'write' -> Freigabe mit 'write'
-- Der Eigentümer des Portfolios hat immer vollen Zugriff.
-- Nicht angemeldete Aufrufer (auth.uid() IS NULL) erhalten immer false.
--
-- Die bisherigen Ein-Parameter-Varianten bleiben erhalten (alte Policies), aber
-- has_tenant_access / has_claim_columns_access zählen einen Mietvertrag nur noch,
-- wenn das Objekt demselben Vermieter gehört wie der Mieter (Befund D2-05).
-- =============================================================================

create or replace function public.share_permits(p_permissions jsonb, p_category text, p_access text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_permissions is null or jsonb_typeof(p_permissions) <> 'object' then false
    when p_category = '*' then exists (
      select 1 from jsonb_each_text(p_permissions) e
      where (p_access = 'read'  and e.value in ('read', 'write'))
         or (p_access = 'write' and e.value = 'write'))
    when p_access = 'read'  then coalesce(p_permissions ->> p_category, '') in ('read', 'write')
    when p_access = 'write' then coalesce(p_permissions ->> p_category, '') = 'write'
    else false
  end
$$;

create or replace function public.has_portfolio_access(check_portfolio_id uuid, category text, access_type text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
     and check_portfolio_id is not null
     and (
       exists (select 1 from public.portfolios p
               where p.id = check_portfolio_id and p.user_id = auth.uid())
       or exists (select 1 from public.portfolio_shares s
                  where s.portfolio_id = check_portfolio_id
                    and s.status = 'accepted'
                    and lower(s.shared_with_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
                    and public.share_permits(s.permissions, category, access_type))
     )
$$;

create or replace function public.has_property_access(check_property_id uuid, category text, access_type text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.properties pr
    where pr.id = check_property_id
      and public.has_portfolio_access(pr.portfolio_id, category, access_type))
$$;

create or replace function public.has_unit_access(check_unit_id uuid, category text, access_type text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.units u
    join public.properties pr on pr.id = u.property_id
    where u.id = check_unit_id
      and public.has_portfolio_access(pr.portfolio_id, category, access_type))
$$;

create or replace function public.has_lease_access(check_lease_id uuid, category text, access_type text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.leases l
    join public.units u on u.id = l.unit_id
    join public.properties pr on pr.id = u.property_id
    where l.id = check_lease_id
      and public.has_portfolio_access(pr.portfolio_id, category, access_type))
$$;

-- Mieter gehören einem Vermieter (tenants.user_id). Zugriff: der Vermieter selbst,
-- oder ein Mitnutzer eines Portfolios desselben Vermieters, in dem der Mieter einen
-- Mietvertrag hat.
create or replace function public.has_tenant_access(check_tenant_id uuid, category text, access_type text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
     and check_tenant_id is not null
     and (
       exists (select 1 from public.tenants t
               where t.id = check_tenant_id and t.user_id = auth.uid())
       or exists (select 1 from public.tenants t
                  join public.leases l on l.tenant_id = t.id
                  join public.units u on u.id = l.unit_id
                  join public.properties pr on pr.id = u.property_id
                  join public.portfolios po on po.id = pr.portfolio_id
                  where t.id = check_tenant_id
                    and po.user_id = t.user_id
                    and public.has_portfolio_access(pr.portfolio_id, category, access_type))
     )
$$;

create or replace function public.has_invoice_access(check_invoice_id uuid, category text, access_type text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.invoices i
    where i.id = check_invoice_id
      and public.has_portfolio_access(i.portfolio_id, category, access_type))
$$;

create or replace function public.has_claim_access(check_claim_id uuid, category text, access_type text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.claims c
    join public.leases l on l.id = c.lease_id
    join public.units u on u.id = l.unit_id
    join public.properties pr on pr.id = u.property_id
    where c.id = check_claim_id
      and public.has_portfolio_access(pr.portfolio_id, category, access_type))
$$;

create or replace function public.has_economic_unit_access(check_economic_unit_id uuid, category text, access_type text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
     and check_economic_unit_id is not null
     and (
       exists (select 1 from public.economic_units e
               where e.id = check_economic_unit_id and e.user_id = auth.uid())
       or exists (select 1 from public.properties pr
                  where pr.economic_unit_id = check_economic_unit_id
                    and public.has_portfolio_access(pr.portfolio_id, category, access_type))
     )
$$;

create or replace function public.has_renovation_project_access(check_project_id uuid, category text, access_type text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.renovation_projects p
    where p.id = check_project_id
      and (p.user_id = auth.uid()
           or public.has_property_access(p.property_id, category, access_type)))
$$;

create or replace function public.has_renovation_calculation_access(check_calc_id uuid, category text, access_type text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.renovation_calculations c
    where c.id = check_calc_id
      and (c.user_id = auth.uid()
           or public.has_property_access(c.property_id, category, access_type)))
$$;

-- -----------------------------------------------------------------------------
-- Bestehende Ein-Parameter-Varianten: Mietvertrag zählt nur, wenn Objekt-Eigentümer
-- und Mieter-Eigentümer übereinstimmen (D2-05). Semantik sonst unverändert.
-- -----------------------------------------------------------------------------
create or replace function public.has_tenant_access(check_tenant_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
begin
    return exists (
        select 1 from public.tenants t
        join public.leases l on l.tenant_id = t.id
        join public.units u on l.unit_id = u.id
        join public.properties p on u.property_id = p.id
        join public.portfolios po on po.id = p.portfolio_id
        where t.id = check_tenant_id
          and po.user_id = t.user_id
          and public.has_portfolio_access(p.portfolio_id)
    );
end;
$function$;

create or replace function public.has_claim_columns_access(check_lease_id uuid, check_tenant_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
begin
    if check_lease_id is not null then
        return exists (
            select 1 from public.leases l
            join public.units u on l.unit_id = u.id
            join public.properties p on u.property_id = p.id
            where l.id = check_lease_id
              and public.has_portfolio_access(p.portfolio_id)
        );
    end if;

    if check_tenant_id is not null then
        return public.has_tenant_access(check_tenant_id);
    end if;

    return false;
end;
$function$;
