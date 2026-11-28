import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Erkennung des Reset-Links beim App-Start (lib/supabase.js, Befund C-1).
// Kein Netzwerk: createClient wird ersetzt; window/sessionStorage sind einfache Attrappen.
const authListeners = [];
const createClientMock = vi.fn();
vi.mock('@supabase/supabase-js', () => ({ createClient: (...args) => createClientMock(...args) }));

const makeStorage = () => {
    const data = new Map();
    return {
        getItem: (k) => (data.has(k) ? data.get(k) : null),
        setItem: (k, v) => { data.set(k, String(v)); },
        removeItem: (k) => { data.delete(k); },
    };
};

const loadWithHash = async (hash) => {
    vi.resetModules();
    globalThis.window = { location: { hash }, dispatchEvent: vi.fn() };
    globalThis.sessionStorage = makeStorage();
    return import('./supabase');
};

beforeEach(() => {
    authListeners.length = 0;
    createClientMock.mockReset();
    createClientMock.mockImplementation(() => {
        // Wie der echte Client: wertet den Hash aus und leert ihn danach
        globalThis.window.location.hash = '';
        return { auth: { onAuthStateChange: (cb) => { authListeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; } } };
    });
});

afterEach(() => {
    delete globalThis.window;
    delete globalThis.sessionStorage;
});

describe('Passwort-Wiederherstellung beim App-Start', () => {
    it('setzt den Merker aus dem Hash, bevor der Client ihn leert', async () => {
        const mod = await loadWithHash('#access_token=x&type=recovery&expires_in=3600');
        expect(mod.readRecoveryFlag()).toBe(true);
        expect(mod.initialLinkError).toBe(false);
    });

    it('registriert den Listener sofort beim Laden des Moduls', async () => {
        const mod = await loadWithHash('');
        expect(authListeners).toHaveLength(1);
        expect(mod.readRecoveryFlag()).toBe(false);

        authListeners[0]('PASSWORD_RECOVERY', {});
        expect(mod.readRecoveryFlag()).toBe(true);
        expect(globalThis.window.dispatchEvent).toHaveBeenCalledTimes(1);

        authListeners[0]('SIGNED_OUT', null);
        expect(mod.readRecoveryFlag()).toBe(false);
    });

    it('erkennt einen abgelaufenen Link', async () => {
        const mod = await loadWithHash('#error=access_denied&error_code=otp_expired');
        expect(mod.initialLinkError).toBe(true);
        expect(mod.readRecoveryFlag()).toBe(false);
    });

    it('ignoriert andere Hashes (z. B. Magic Link)', async () => {
        const mod = await loadWithHash('#access_token=x&type=magiclink');
        expect(mod.readRecoveryFlag()).toBe(false);
        expect(mod.initialLinkError).toBe(false);
    });
});
