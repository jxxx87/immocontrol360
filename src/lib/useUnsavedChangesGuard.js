// Rückfrage bei ungespeicherten Änderungen, bevor die Seite verlassen wird.
//
// Die App nutzt <BrowserRouter> (kein Daten-Router) – useBlocker steht daher nicht zur Verfügung.
// Stattdessen wird, solange eine Meldung gesetzt ist, der Navigator des Routers umschlossen: Jede
// App-Navigation (Link/NavLink in Sidebar und Topbar, navigate(), navigate(-1)) fragt vorher nach.
// Neu laden, Tab schließen und externe Links deckt beforeunload ab.
// Nicht abgefangen: Zurück/Vor-Tasten des Browsers (popstate lässt sich nicht verhindern).
//
// Aufruf: useUnsavedChangesGuard(dirty ? 'Es gibt ungespeicherte Änderungen … Trotzdem verlassen?' : null)
//
// Aktionen, die die Seite auf anderem Weg beenden (z. B. Abmelden: signOut() läuft vor der Navigation),
// fragen vorher selbst über getActiveUnsavedMessage() nach und führen den Rest nach Bestätigung in
// withoutUnsavedChangesGuard() aus – sonst käme dieselbe Frage ein zweites Mal.

import { useContext, useEffect } from 'react';
import { UNSAFE_NavigationContext } from 'react-router-dom';

const currentPath = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;

// Meldungen aller gerade aktiven Wächter (zuletzt eingebundener zuletzt) und Freigabe nach Bestätigung
const activeMessages = [];
let bypassDepth = 0;

/** Meldung des zuletzt eingebundenen aktiven Wächters, sonst null. */
export const getActiveUnsavedMessage = () => activeMessages[activeMessages.length - 1] || null;

/** Merkt eine Meldung als aktiv; liefert die Funktion zum Entfernen. */
export const registerUnsavedMessage = (message) => {
    const entry = String(message);
    activeMessages.push(entry);
    return () => {
        const i = activeMessages.lastIndexOf(entry);
        if (i >= 0) activeMessages.splice(i, 1);
    };
};

/** Führt fn aus, ohne dass die Wächter erneut nachfragen (nur nach bereits bestätigter Rückfrage). */
export const withoutUnsavedChangesGuard = async (fn) => {
    bypassDepth += 1;
    try {
        return await fn();
    } finally {
        bypassDepth -= 1;
    }
};

const targetPath = (to) => {
    if (typeof to === 'string') return to;
    if (!to || typeof to !== 'object') return null;
    return `${to.pathname || window.location.pathname}${to.search || ''}${to.hash || ''}`;
};

// Umschließt push/replace/go des Navigators; liefert die Funktion zum Wiederherstellen.
export const guardNavigator = (navigator, message) => {
    const original = { push: navigator.push, replace: navigator.replace, go: navigator.go };
    const mayLeave = (to) => bypassDepth > 0 || targetPath(to) === currentPath() || window.confirm(message);
    navigator.push = (to, ...rest) => {
        if (mayLeave(to)) original.push.call(navigator, to, ...rest);
    };
    navigator.replace = (to, ...rest) => {
        if (mayLeave(to)) original.replace.call(navigator, to, ...rest);
    };
    navigator.go = (delta) => {
        if (bypassDepth > 0 || window.confirm(message)) original.go.call(navigator, delta);
    };
    return () => {
        navigator.push = original.push;
        navigator.replace = original.replace;
        navigator.go = original.go;
    };
};

export const useUnsavedChangesGuard = (message) => {
    const navigation = useContext(UNSAFE_NavigationContext);
    const navigator = navigation?.navigator;

    useEffect(() => {
        if (!message || !navigator || typeof navigator.push !== 'function') return undefined;
        return guardNavigator(navigator, message);
    }, [navigator, message]);

    useEffect(() => {
        if (!message) return undefined;
        return registerUnsavedMessage(message);
    }, [message]);

    useEffect(() => {
        if (!message) return undefined;
        const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [message]);
};
