-- Migration: Digital Letting Process (Neuvermietung)
-- Timestamp: 20260529153000

-- 1. Create rental_processes table
CREATE TABLE IF NOT EXISTS public.rental_processes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    unit_id UUID NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'kein_prozess' CHECK (status IN ('kein_prozess', 'in_vermietung', 'vermietet')),
    token TEXT UNIQUE NOT NULL,
    listing_title TEXT,
    listing_description TEXT,
    listing_link TEXT,
    required_documents TEXT[] DEFAULT '{}',
    custom_requirements TEXT[] DEFAULT '{}',
    rented_at TIMESTAMP WITH TIME ZONE,
    lease_start_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Create rental_applicants table
CREATE TABLE IF NOT EXISTS public.rental_applicants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    process_id UUID REFERENCES public.rental_processes(id) ON DELETE CASCADE NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'invited', 'declined', 'accepted', 'contract_requested', 'contract_declined')),
    
    -- Step 1: General Info & Contact
    earliest_move_in DATE,
    salutation TEXT,
    first_name TEXT,
    last_name TEXT,
    birth_date DATE,
    marital_status TEXT,
    phone TEXT,
    email TEXT,
    introduction TEXT,
    
    -- Step 2: Co-Applicant
    has_co_applicant BOOLEAN DEFAULT false,
    co_salutation TEXT,
    co_first_name TEXT,
    co_last_name TEXT,
    co_birth_date DATE,
    co_relationship TEXT,
    co_email TEXT,
    co_phone TEXT,
    
    -- Step 3: Additional Persons & Occupation
    additional_persons_count INTEGER DEFAULT 0,
    is_employed BOOLEAN DEFAULT false,
    monthly_income NUMERIC(10,2),
    co_is_employed BOOLEAN DEFAULT false,
    co_monthly_income NUMERIC(10,2),
    
    -- Step 4: Current Address
    street TEXT,
    house_number TEXT,
    postal_code TEXT,
    city TEXT,
    
    -- Step 5: Declarations
    has_rent_arrears BOOLEAN DEFAULT false,
    has_eviction_lawsuits BOOLEAN DEFAULT false,
    has_insolvency_proceedings BOOLEAN DEFAULT false,
    receives_social_benefits BOOLEAN DEFAULT false,
    has_pets BOOLEAN DEFAULT false,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Create rental_viewings table
CREATE TABLE IF NOT EXISTS public.rental_viewings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    process_id UUID REFERENCES public.rental_processes(id) ON DELETE CASCADE NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    slot_duration_minutes INTEGER NOT NULL DEFAULT 15,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Create rental_viewing_bookings table
CREATE TABLE IF NOT EXISTS public.rental_viewing_bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    viewing_id UUID REFERENCES public.rental_viewings(id) ON DELETE CASCADE NOT NULL,
    applicant_id UUID REFERENCES public.rental_applicants(id) ON DELETE CASCADE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'canceled')),
    canceled_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Add unique partial index to prevent double bookings
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_viewing_booking_slot 
ON public.rental_viewing_bookings (viewing_id, start_time) 
WHERE (status = 'booked');

-- 6. Trigger for updated_at on rental_processes
DROP TRIGGER IF EXISTS set_updated_at ON public.rental_processes;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.rental_processes
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 7. Enable RLS
ALTER TABLE public.rental_processes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_applicants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_viewings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_viewing_bookings ENABLE ROW LEVEL SECURITY;

-- 8. Policies
-- rental_processes policies
DROP POLICY IF EXISTS "Landlords manage own rental_processes" ON public.rental_processes;
CREATE POLICY "Landlords manage own rental_processes"
    ON public.rental_processes FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Allow public read access to active rental processes" ON public.rental_processes;
CREATE POLICY "Allow public read access to active rental processes"
    ON public.rental_processes FOR SELECT TO anon, authenticated USING (status = 'in_vermietung');

-- rental_applicants policies
DROP POLICY IF EXISTS "Landlords manage own rental_applicants" ON public.rental_applicants;
CREATE POLICY "Landlords manage own rental_applicants"
    ON public.rental_applicants FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Allow public insert to rental_applicants" ON public.rental_applicants;
CREATE POLICY "Allow public insert to rental_applicants"
    ON public.rental_applicants FOR INSERT TO anon, authenticated 
    WITH CHECK (EXISTS (SELECT 1 FROM public.rental_processes rp WHERE rp.id = process_id AND rp.status = 'in_vermietung'));

-- rental_viewings policies
DROP POLICY IF EXISTS "Landlords manage own rental_viewings" ON public.rental_viewings;
CREATE POLICY "Landlords manage own rental_viewings"
    ON public.rental_viewings FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Allow public read access to rental_viewings" ON public.rental_viewings;
CREATE POLICY "Allow public read access to rental_viewings"
    ON public.rental_viewings FOR SELECT TO anon, authenticated
    USING (EXISTS (SELECT 1 FROM public.rental_processes rp WHERE rp.id = process_id AND rp.status = 'in_vermietung'));

-- rental_viewing_bookings policies
DROP POLICY IF EXISTS "Landlords manage own rental_viewing_bookings" ON public.rental_viewing_bookings;
CREATE POLICY "Landlords manage own rental_viewing_bookings"
    ON public.rental_viewing_bookings FOR ALL 
    USING (EXISTS (SELECT 1 FROM public.rental_viewings rv WHERE rv.id = viewing_id AND rv.user_id = auth.uid()));

DROP POLICY IF EXISTS "Allow public manage access to bookings" ON public.rental_viewing_bookings;
CREATE POLICY "Allow public manage access to bookings"
    ON public.rental_viewing_bookings FOR ALL TO anon, authenticated
    USING (EXISTS (SELECT 1 FROM public.rental_viewings rv WHERE rv.id = viewing_id))
    WITH CHECK (EXISTS (SELECT 1 FROM public.rental_viewings rv WHERE rv.id = viewing_id));

-- 9. Secure RPC for applicants getting process details by token
CREATE OR REPLACE FUNCTION public.get_rental_process_by_token(p_token text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_process record;
    v_unit record;
    v_property record;
BEGIN
    -- Find active rental process
    SELECT * INTO v_process 
    FROM rental_processes 
    WHERE token = p_token AND status = 'in_vermietung';
    
    IF NOT FOUND THEN
        RETURN json_build_object('error', 'Mietobjekt ist nicht mehr aktiv oder Link ist ungültig.');
    END IF;
    
    -- Get unit
    SELECT * INTO v_unit 
    FROM units 
    WHERE id = v_process.unit_id;
    
    IF NOT FOUND THEN
        RETURN json_build_object('error', 'Einheit nicht gefunden.');
    END IF;
    
    -- Get property
    SELECT * INTO v_property 
    FROM properties 
    WHERE id = v_unit.property_id;
    
    RETURN json_build_object(
        'id', v_process.id,
        'user_id', v_process.user_id,
        'listing_title', COALESCE(v_process.listing_title, ''),
        'listing_description', COALESCE(v_process.listing_description, ''),
        'required_documents', v_process.required_documents,
        'custom_requirements', v_process.custom_requirements,
        
        -- Unit details
        'unit_name', v_unit.unit_name,
        'floor', COALESCE(v_unit.floor, ''),
        'sqm', COALESCE(v_unit.sqm, 0),
        'rooms', COALESCE(v_unit.rooms, 0),
        'bathrooms', COALESCE(v_unit.bathrooms, 0),
        'bedrooms', COALESCE(v_unit.bedrooms, 0),
        'balcony', COALESCE(v_unit.balcony, false),
        'fitted_kitchen', COALESCE(v_unit.fitted_kitchen, false),
        'target_rent', COALESCE(v_unit.target_rent, 0),
        'service_charge_soll', COALESCE(v_unit.service_charge_soll, 0),
        'heating_cost_soll', COALESCE(v_unit.heating_cost_soll, 0),
        
        -- Property details
        'street', v_property.street,
        'house_number', COALESCE(v_property.house_number, ''),
        'city', v_property.city,
        'zip', COALESCE(v_property.zip, '')
    );
END;
$$;
