import { lazy } from 'react';

// Seiten werden erst bei Bedarf nachgeladen (kleineres Start-Paket).
// Schlägt das Nachladen fehl – typischerweise direkt nach einem Deploy, wenn der Browser noch die
// alten Dateinamen kennt –, wird die Seite einmalig neu geladen, damit die aktuelle index.html greift.
const RELOAD_KEY = 'ic360_chunk_reload';

export const lazyPage = (factory) => lazy(() =>
    factory()
        .then((module) => {
            try { sessionStorage.removeItem(RELOAD_KEY); } catch { /* Speicher nicht verfügbar */ }
            return module;
        })
        .catch((error) => {
            let alreadyReloaded = false;
            try { alreadyReloaded = sessionStorage.getItem(RELOAD_KEY) === '1'; } catch { /* Speicher nicht verfügbar */ }
            if (!alreadyReloaded) {
                try { sessionStorage.setItem(RELOAD_KEY, '1'); } catch { /* Speicher nicht verfügbar */ }
                window.location.reload();
                return new Promise(() => {});
            }
            throw error;
        })
);
