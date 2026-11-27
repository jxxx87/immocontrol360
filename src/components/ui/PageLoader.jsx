import React from 'react';
import { Loader2 } from 'lucide-react';

// Platzhalter, solange eine nachgeladene Seite geladen wird
const PageLoader = () => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh', color: 'var(--text-secondary, #64748b)' }}>
        <Loader2 size={28} style={{ animation: 'spin 1s linear infinite' }} aria-label="Wird geladen" />
    </div>
);

export default PageLoader;
