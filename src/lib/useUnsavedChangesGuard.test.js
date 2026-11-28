// Unit-Tests: Navigations-Wächter für ungespeicherte Änderungen (guardNavigator).
// Ohne DOM: window wird durch einen Stub mit location und confirm ersetzt.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    guardNavigator, getActiveUnsavedMessage, registerUnsavedMessage, withoutUnsavedChangesGuard,
} from './useUnsavedChangesGuard';

const MESSAGE = 'Es gibt ungespeicherte Änderungen. Trotzdem verlassen?';

let confirmAnswer;
const confirmSpy = vi.fn(() => confirmAnswer);

const makeNavigator = () => {
    const calls = [];
    return {
        calls,
        push: (...args) => calls.push(['push', ...args]),
        replace: (...args) => calls.push(['replace', ...args]),
        go: (...args) => calls.push(['go', ...args]),
    };
};

beforeEach(() => {
    confirmAnswer = false;
    confirmSpy.mockClear();
    vi.stubGlobal('window', {
        location: { pathname: '/settings/pdf-template', search: '', hash: '' },
        confirm: confirmSpy,
    });
});
afterEach(() => vi.unstubAllGlobals());

describe('guardNavigator', () => {
    it('fragt vor dem Seitenwechsel nach und bleibt bei „Abbrechen“', () => {
        const nav = makeNavigator();
        guardNavigator(nav, MESSAGE);
        nav.push({ pathname: '/invoices', search: '', hash: '' }, undefined, {});
        expect(confirmSpy).toHaveBeenCalledWith(MESSAGE);
        expect(nav.calls).toHaveLength(0);
    });

    it('wechselt nach Bestätigung mit unveränderten Argumenten', () => {
        const nav = makeNavigator();
        guardNavigator(nav, MESSAGE);
        confirmAnswer = true;
        const to = { pathname: '/settings', search: '?tab=1', hash: '' };
        nav.push(to, { from: 'x' }, { replace: false });
        nav.replace('/login');
        expect(nav.calls).toEqual([['push', to, { from: 'x' }, { replace: false }], ['replace', '/login']]);
    });

    it('fragt beim Zurück (navigate(-1)) nach', () => {
        const nav = makeNavigator();
        guardNavigator(nav, MESSAGE);
        nav.go(-1);
        expect(confirmSpy).toHaveBeenCalledTimes(1);
        expect(nav.calls).toHaveLength(0);
        confirmAnswer = true;
        nav.go(-1);
        expect(nav.calls).toEqual([['go', -1]]);
    });

    it('fragt nicht, wenn das Ziel die aktuelle Seite ist', () => {
        const nav = makeNavigator();
        guardNavigator(nav, MESSAGE);
        nav.replace({ pathname: '/settings/pdf-template', search: '', hash: '' });
        expect(confirmSpy).not.toHaveBeenCalled();
        expect(nav.calls).toHaveLength(1);
    });

    it('stellt die ursprünglichen Funktionen wieder her', () => {
        const nav = makeNavigator();
        const { push, replace, go } = nav;
        const restore = guardNavigator(nav, MESSAGE);
        expect(nav.push).not.toBe(push);
        restore();
        expect([nav.push, nav.replace, nav.go]).toEqual([push, replace, go]);
        nav.push('/invoices');
        expect(confirmSpy).not.toHaveBeenCalled();
    });

    it('fragt in withoutUnsavedChangesGuard nicht erneut (z. B. Abmelden nach Bestätigung)', async () => {
        const nav = makeNavigator();
        const restore = guardNavigator(nav, MESSAGE);
        await withoutUnsavedChangesGuard(async () => {
            await Promise.resolve();
            nav.push('/login');
            nav.go(-1);
        });
        expect(confirmSpy).not.toHaveBeenCalled();
        expect(nav.calls).toEqual([['push', '/login'], ['go', -1]]);
        // Danach greift der Wächter wieder
        nav.push('/invoices');
        expect(confirmSpy).toHaveBeenCalledTimes(1);
        restore();
    });

    it('gibt die Freigabe auch nach einem Fehler wieder ab', async () => {
        const nav = makeNavigator();
        const restore = guardNavigator(nav, MESSAGE);
        await expect(withoutUnsavedChangesGuard(async () => { throw new Error('signOut fehlgeschlagen'); }))
            .rejects.toThrow('signOut fehlgeschlagen');
        nav.push('/invoices');
        expect(confirmSpy).toHaveBeenCalledTimes(1);
        expect(nav.calls).toHaveLength(0);
        restore();
    });
});

describe('getActiveUnsavedMessage', () => {
    it('liefert die Meldung des zuletzt eingebundenen Wächters und null ohne aktive Wächter', () => {
        expect(getActiveUnsavedMessage()).toBeNull();
        const removeA = registerUnsavedMessage('A');
        const removeB = registerUnsavedMessage('B');
        expect(getActiveUnsavedMessage()).toBe('B');
        removeB();
        expect(getActiveUnsavedMessage()).toBe('A');
        removeA();
        expect(getActiveUnsavedMessage()).toBeNull();
    });
});
