// Anrede des Mieters für die Briefanrede in Schreibvorlagen (tenants.salutation)
import { describe, it, expect, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: { from: vi.fn() } }));

import { buildTemplateTenantData, TENANT_SALUTATIONS, TENANT_SALUTATION_OPTIONS } from './leaseRentPeriods';

describe('buildTemplateTenantData – Anrede', () => {
    it('gibt die gespeicherte Anrede als gender weiter', () => {
        expect(buildTemplateTenantData({ tenant: { first_name: 'Anna', last_name: 'Muster', salutation: 'female' } }).gender).toBe('female');
        expect(buildTemplateTenantData({ tenant: { first_name: 'Ben', last_name: 'Muster', salutation: 'male' } }).gender).toBe('male');
        expect(buildTemplateTenantData({ tenant: { salutation: 'diverse' } }).gender).toBe('diverse');
    });

    it('ohne oder mit unbekannter Anrede: null (neutrale Briefanrede)', () => {
        expect(buildTemplateTenantData({ tenant: { first_name: 'Chris' } }).gender).toBeNull();
        expect(buildTemplateTenantData({ tenant: { salutation: 'Frau' } }).gender).toBeNull();
        expect(buildTemplateTenantData({}).gender).toBeNull();
    });

    it('Auswahl im Formular passt zur Prüfregel der Datenbank', () => {
        TENANT_SALUTATION_OPTIONS.forEach(opt => {
            expect(opt.value === '' || TENANT_SALUTATIONS.includes(opt.value)).toBe(true);
        });
        expect(TENANT_SALUTATIONS).toEqual(['female', 'male', 'diverse']);
    });
});
