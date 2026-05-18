import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
            { auth: { persistSession: false } }
        )

        const { data: rows, userId } = await req.json()

        if (!rows || !rows.length) {
            throw new Error('No data provided');
        }

        let stats = { properties: 0, units: 0, tenants: 0, errors: [] };

        // 1. Process Properties
        const propertiesMap = new Map(); // Key: street+number+zip+city, Value: ID

        for (const row of rows) {
            if (!row.street || !row.zip) continue; // Skip invalid

            const propKey = `${row.portfolio || ''}-${row.street}-${row.house_number}-${row.zip}-${row.city}`.toLowerCase();

            // Check if we already processed this in this batch to avoid multi-inserts
            if (propertiesMap.has(propKey)) continue;

            // Upsert Property
            const { data: propData, error: propError } = await supabaseClient
                .from('properties')
                .select('id')
                .eq('street', row.street)
                .eq('house_number', row.house_number)
                .eq('zip', row.zip)
                .eq('city', row.city)
                .single();

            let propertyId;

            if (propError && propError.code !== 'PGRST116') {
                stats.errors.push(`Row ${row.rowNumber}: Property check error - ${propError.message}`);
                continue;
            }

            if (propData) {
                propertyId = propData.id;
            } else {
                // Insert
                const { data: newProp, error: insertError } = await supabaseClient
                    .from('properties')
                    .insert({
                        user_id: userId,
                        portfolio_id: row.portfolio || null, // Need to resolve portfolio ID if it's a name? assuming ID or null for now. 
                        // If row.portfolio is a NAME, we need to fetch it first. 
                        // Simplified: User must provide Portfolio ID? Or we create a default?
                        // Let's assume row.portfolio is text, we try to find it.
                        street: row.street,
                        house_number: row.house_number,
                        zip: row.zip,
                        city: row.city,
                        construction_year: row.construction_year || null,
                        property_type: row.property_type || 'residential'
                    })
                    .select('id')
                    .single();

                if (insertError) {
                    stats.errors.push(`Row ${row.rowNumber}: Property insert error - ${insertError.message}`);
                    continue;
                }
                propertyId = newProp.id;
                stats.properties++;
            }
            propertiesMap.set(propKey, propertyId);
        }

        // 2. Process Units
        for (const row of rows) {
            const propKey = `${row.portfolio || ''}-${row.street}-${row.house_number}-${row.zip}-${row.city}`.toLowerCase();
            const propertyId = propertiesMap.get(propKey);

            if (!propertyId) continue; // Should have been created

            if (!row.unit_name) continue;

            // Upsert Unit
            const { data: unitData, error: unitError } = await supabaseClient
                .from('units')
                .select('id')
                .eq('property_id', propertyId)
                .eq('unit_name', row.unit_name)
                .single();

            let unitId;

            if (unitData) {
                unitId = unitData.id;
                // Update?
            } else {
                const { data: newUnit, error: insertError } = await supabaseClient
                    .from('units')
                    .insert({
                        user_id: userId,
                        property_id: propertyId,
                        unit_name: row.unit_name,
                        floor: row.floor,
                        sqm: parseFloat(row.sqm) || 0,
                        rooms: parseFloat(row.rooms) || 0,
                        bathrooms: parseFloat(row.bathrooms) || 1,
                        bedrooms: parseFloat(row.bedrooms) || 1,
                        balcony: !!row.balcony,
                        fitted_kitchen: !!row.fitted_kitchen,
                        is_vacation_rental: !!row.is_vacation_rental,
                        cold_rent_ist: parseFloat(row.cold_rent_ist) || null,
                        target_rent: parseFloat(row.target_rent) || 0
                    })
                    .select('id')
                    .single();

                if (insertError) {
                    stats.errors.push(`Row ${row.rowNumber}: Unit insert error - ${insertError.message}`);
                    continue;
                }
                unitId = newUnit.id;
                stats.units++;
            }

            // 3. Process Tenant if data present
            if (unitId && row.t_lastname) {
                // Check if tenant exists in this unit? 
                // Or just insert new tenant + lease

                // Basic logic: If unit has active lease, skip? Or upsert?
                // Let's try to find existing tenant by name + email

                const { data: existingTenant } = await supabaseClient
                    .from('tenants')
                    .select('id')
                    .eq('email', row.t_email)
                    .maybeSingle(); // If email matches, reuse. Else create.

                let tenantId = existingTenant?.id;

                if (!tenantId) {
                    const { data: newTenant, error: tenantError } = await supabaseClient
                        .from('tenants')
                        .insert({
                            user_id: userId,
                            first_name: row.t_firstname,
                            last_name: row.t_lastname,
                            email: row.t_email,
                            phone: row.t_phone,
                            occupants: parseInt(row.t_occupants) || 1
                        })
                        .select('id')
                        .single();

                    if (tenantError) {
                        stats.errors.push(`Row ${row.rowNumber}: Tenant insert error - ${tenantError.message}`);
                        continue;
                    }
                    tenantId = newTenant.id;
                    stats.tenants++;
                }

                // Create Lease
                // Check if lease exists for this unit
                // Simplification: Create new active lease if none exists
                const { data: activeLease } = await supabaseClient
                    .from('leases')
                    .select('id')
                    .eq('unit_id', unitId)
                    .eq('status', 'active')
                    .maybeSingle();

                if (!activeLease) {
                    await supabaseClient.from('leases').insert({
                        user_id: userId,
                        tenant_id: tenantId,
                        unit_id: unitId,
                        start_date: row.t_start_date || new Date().toISOString(), // Needs parsing on client!
                        cold_rent: parseFloat(row.t_cold_rent) || 0,
                        service_charge: parseFloat(row.t_service_charge) || 0,
                        heating_cost: parseFloat(row.t_heating_cost) || 0,
                        other_costs: parseFloat(row.t_other_costs) || 0,
                        deposit: parseFloat(row.t_deposit) || 0,
                        status: 'active'
                    });
                }
            }
        }

        return new Response(JSON.stringify(stats), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        })
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400,
        })
    }
})
