// Rückfrage bei ungespeicherten Änderungen, bevor die Seite verlassen wird.
//
// Die App nutzt <BrowserRouter> (kein Daten-Router) – useBlocker steht daher nicht zur Verfügung.
// Stattdessen wird, solange eine Meldung gesetzt ist, der Navigator des Routers umschlossen: Jede
// App-Navigation (Link/NavLink in Sidebar und Topbar, navigate(), navigate(-1)) fragt vorher nach.
// Neu laden, Tab schließen und externe Links deckt beforeunload ab.
// Nicht abgefangen: Zurück/Vor-Tasten des Browsers (popstate lässt sich nicht verhindern).
//
// Aufruf: useUnsavedChangesGuard(dirty ? 'Es gibt ungespeicherte Änderungen … Trotzdem verlassen?' : null)

import { useContext, useEffect } from 'react';
import { UNSAFE_NavigationContext } from 'react-router-dom';

const currentPath = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;

const targetPath = (to) => {
    if (typeof to === 'string') return to;
    if (!to || typeof to !== 'object') return null;
    return `${to.pathname || window.location.pathname}${to.search || ''}${to.hash || ''}`;
};

// Umschließt push/replace/go des Navigators; liefert die Funktion zum Wiederherstellen.
export const guardNavigator = (navigator, message) => {
    const original = { push: navigator.push, replace: navigator.replace, go: navigator.go };
    const mayLeave = (to) => targetPath(to) === currentPath() || window.confirm(message);
    navigator.push = (to, ...rest) => {
        if (mayLeave(to)) original.push.call(navigator, to, ...rest);
    };
    navigator.replace = (to, ...rest) => {
        if (mayLeave(to)) original.replace.call(navigator, to, ...rest);
    };
    navigator.go = (delta) => {
        if (window.confirm(message)) original.go.call(navigator, delta);
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
        const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [message]);
};
