import React from 'react';

// Fängt Renderfehler ab, damit Besucher statt einer weißen Seite einen Hinweis sehen (W1b-21).
// Sonderfall nachgeladene Seiten (React.lazy): Nach einem neuen Deploy existieren die alten
// Teil-Dateien nicht mehr – dann wird die Seite einmalig neu geladen.
const CHUNK_ERROR_RE = /dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk/i;
const RELOAD_FLAG = 'immowebsite:chunk-reload-at';
const RELOAD_GUARD_MS = 30000;

const isChunkLoadError = (error) => CHUNK_ERROR_RE.test(String(error?.message || error || ''));

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    componentDidCatch(error, info) {
        if (isChunkLoadError(error)) {
            try {
                const last = Number(window.sessionStorage.getItem(RELOAD_FLAG) || 0);
                if (Date.now() - last > RELOAD_GUARD_MS) {
                    window.sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
                    window.location.reload();
                    return;
                }
            } catch {
                // sessionStorage nicht verfügbar – dann den Hinweis anzeigen
            }
        }
        console.error('Unerwarteter Fehler beim Anzeigen der Seite:', error, info?.componentStack || '');
    }

    render() {
        if (!this.state.hasError) return this.props.children;

        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
                <div className="max-w-md w-full text-center bg-white border border-slate-200 rounded-2xl shadow-sm p-8">
                    <h1 className="text-2xl font-bold mb-3">Hier ist etwas schiefgelaufen.</h1>
                    <p className="text-slate-600 mb-8">
                        Die Seite konnte nicht vollständig geladen werden. Bitte lade sie neu oder kehre zur Startseite zurück.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-3 justify-center">
                        <button type="button" onClick={() => window.location.reload()} className="btn-primary">
                            Seite neu laden
                        </button>
                        <a href="/" className="btn-secondary">
                            Zur Startseite
                        </a>
                    </div>
                </div>
            </div>
        );
    }
}

export default ErrorBoundary;
