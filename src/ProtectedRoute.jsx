import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { usePermission } from './context/PermissionContext';

const CATEGORY_LABELS = {
    immobilien: 'Immobilien',
    mietverhaeltnisse: 'Mietverhältnisse',
    finanzen: 'Finanzen',
    nebenkosten: 'Nebenkosten',
    zaehler: 'Zähler',
    kontakte: 'Kontakte',
    mieterportal: 'Mieterportal',
    investorportal: 'Investorportal'
};

const RouteLoading = () => (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '60px', color: 'var(--text-secondary)' }}>
        Lade...
    </div>
);

export const ProtectedRoute = ({ children }) => {
    const { session, loading } = useAuth();

    if (loading) {
        return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>Lade...</div>;
    }

    if (!session) {
        return <Navigate to="/login" replace />;
    }

    return children;
};

// Bereiche des Mieterportals: nur für Konten mit Rolle 'tenant'.
export const TenantRoute = ({ children }) => {
    const { userRole } = useAuth();

    if (userRole === 'tenant') return children;
    if (!userRole) return <RouteLoading />;
    return <Navigate to="/" replace />;
};

// Bereiche der Vermieter-/Investor-Oberfläche.
//   category    : Freigabe-Kategorie, für die mindestens Leserecht nötig ist
//                 (im gewählten Portfolio bzw. in "Alle Portfolios"); eine Liste
//                 bedeutet: Leserecht für mindestens eine davon (wie die RLS der Daten,
//                 z. B. loans: finanzen ODER investorportal)
//   allowTenant : Seite wird auch im Mieterportal genutzt (z. B. Objektkalender)
export const InvestorRoute = ({ category, allowTenant = false, children }) => {
    const { userRole } = useAuth();
    const { canRead, loadingPermissions } = usePermission() || {};

    if (userRole === 'tenant') {
        return allowTenant ? children : <Navigate to="/tenant" replace />;
    }
    if (!userRole) return <RouteLoading />;
    if (userRole !== 'investor') {
        return (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                Für Ihr Konto ist dieser Bereich nicht freigeschaltet.
            </div>
        );
    }

    const categories = !category ? [] : (Array.isArray(category) ? category : [category]);
    if (categories.length > 0) {
        if (loadingPermissions) return <RouteLoading />;
        if (!canRead || !categories.some((c) => canRead(c))) {
            const label = categories.map((c) => `„${CATEGORY_LABELS[c] || c}"`).join(' oder ');
            return (
                <Navigate
                    to="/"
                    replace
                    state={{ accessNotice: `Für den Bereich ${label} haben Sie im gewählten Portfolio keine Berechtigung. Bitten Sie den Eigentümer des Portfolios um eine Freigabe oder wählen Sie oben ein anderes Portfolio.` }}
                />
            );
        }
    }

    return children;
};
