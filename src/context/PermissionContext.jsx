import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { usePortfolio } from './PortfolioContext';
import { useAuth } from './AuthContext';

const PermissionContext = createContext();

// Kategorien aus portfolio_shares.permissions (siehe PortfolioShareModal)
const CATEGORIES = [
    'immobilien',
    'mietverhaeltnisse',
    'finanzen',
    'nebenkosten',
    'zaehler',
    'kontakte',
    'mieterportal',
    'investorportal'
];

// Eigentümer haben in ihren eigenen Portfolios immer vollen Zugriff.
const FULL_ACCESS = Object.freeze(Object.fromEntries(CATEGORIES.map(c => [c, 'write'])));

const RANK = { none: 0, read: 1, write: 2 };

const normalizeEmail = (email) => (email || '').trim().toLowerCase();

// Führt zwei Rechte-Objekte zusammen (je Kategorie gilt das höhere Recht).
const mergePermissions = (a, b) => {
    if (!a) return b && typeof b === 'object' ? { ...b } : null;
    if (!b || typeof b !== 'object') return a;
    const merged = { ...a };
    Object.entries(b).forEach(([key, value]) => {
        if ((RANK[value] || 0) > (RANK[merged[key]] || 0)) merged[key] = value;
    });
    return merged;
};

const hasLevel = (perms, category, level) => {
    if (!perms) return false;
    if (perms === FULL_ACCESS) return true;
    if (category === '*') {
        return Object.values(perms).some(v => (RANK[v] || 0) >= RANK[level]);
    }
    return (RANK[perms[category]] || 0) >= RANK[level];
};

export const PermissionProvider = ({ children }) => {
    const { selectedPortfolioID, portfolios, loading: portfoliosLoading } = usePortfolio();
    const { user } = useAuth();

    // portfolio_id -> permissions der angenommenen Freigaben an den aktuellen Nutzer
    const [sharedPermissions, setSharedPermissions] = useState({});
    const [loadedForUser, setLoadedForUser] = useState(null);

    const portfolioKey = useMemo(
        () => (portfolios || []).map(p => p.id).sort().join(','),
        [portfolios]
    );

    useEffect(() => {
        let cancelled = false;

        const loadShares = async () => {
            if (!user) {
                setSharedPermissions({});
                setLoadedForUser(null);
                return;
            }

            try {
                // Kein Filter auf die E-Mail in der Abfrage: RLS liefert nur eigene bzw.
                // an mich gerichtete Freigaben; der Abgleich erfolgt ohne Groß-/Kleinschreibung.
                const { data, error } = await supabase
                    .from('portfolio_shares')
                    .select('portfolio_id, permissions, shared_with_email')
                    .eq('status', 'accepted');

                if (error) throw error;

                const myEmail = normalizeEmail(user.email);
                const map = {};
                (data || []).forEach(row => {
                    if (normalizeEmail(row.shared_with_email) !== myEmail) return;
                    map[row.portfolio_id] = mergePermissions(map[row.portfolio_id], row.permissions);
                });
                if (!cancelled) setSharedPermissions(map);
            } catch (err) {
                console.error('Error fetching permissions:', err);
                // Im Fehlerfall keine Rechte auf fremde Portfolios annehmen.
                if (!cancelled) setSharedPermissions({});
            } finally {
                if (!cancelled) setLoadedForUser(user.id);
            }
        };

        loadShares();
        return () => { cancelled = true; };
    }, [user, portfolioKey]);

    const ownPortfolioIds = useMemo(() => {
        if (!user) return new Set();
        return new Set((portfolios || []).filter(p => p.user_id === user.id).map(p => p.id));
    }, [portfolios, user]);

    const sharedPortfolioIds = useMemo(
        () => (portfolios || []).filter(p => !ownPortfolioIds.has(p.id) && sharedPermissions[p.id]).map(p => p.id),
        [portfolios, ownPortfolioIds, sharedPermissions]
    );

    // Rechte für ein bestimmtes Portfolio (null = kein Zugriff)
    const permissionsFor = useCallback((portfolioId) => {
        if (!user || !portfolioId) return null;
        if (ownPortfolioIds.has(portfolioId)) return FULL_ACCESS;
        return sharedPermissions[portfolioId] || null;
    }, [user, ownPortfolioIds, sharedPermissions]);

    // Rechte im aktuellen Bereich: gewähltes Portfolio oder "Alle Portfolios".
    // Bei "Alle Portfolios" gilt: wer eigene Portfolios hat (oder noch gar keine),
    // hat vollen Zugriff auf seine Daten; Datensätze aus freigegebenen Portfolios
    // prüfen die Seiten mit canWrite(kategorie, portfolioId).
    const scopePermissions = useMemo(() => {
        if (!user) return null;
        if (selectedPortfolioID) return permissionsFor(selectedPortfolioID);
        if (ownPortfolioIds.size > 0 || (portfolios || []).length === 0) return FULL_ACCESS;
        return sharedPortfolioIds.reduce((acc, id) => mergePermissions(acc, sharedPermissions[id]), null);
    }, [user, selectedPortfolioID, permissionsFor, ownPortfolioIds, portfolios, sharedPortfolioIds, sharedPermissions]);

    const isOwner = !!user && (selectedPortfolioID
        ? ownPortfolioIds.has(selectedPortfolioID)
        : sharedPortfolioIds.length === 0);

    // Erst entscheiden, wenn Freigaben UND Portfolioliste geladen sind (nur beim ersten Laden)
    const loadingPermissions = !!user && (loadedForUser !== user.id || !!portfoliosLoading);

    // canRead/canWrite(kategorie[, portfolioId]):
    //   ohne portfolioId -> aktueller Bereich (Menü, Routen, Neuanlage)
    //   mit portfolioId  -> Rechte für genau dieses Portfolio (z. B. je Datensatz in "Alle Portfolios")
    //   kategorie '*'    -> irgendeine Kategorie
    const canRead = useCallback((category, portfolioId) => {
        const perms = portfolioId ? permissionsFor(portfolioId) : scopePermissions;
        return hasLevel(perms, category, 'read');
    }, [permissionsFor, scopePermissions]);

    const canWrite = useCallback((category, portfolioId) => {
        const perms = portfolioId ? permissionsFor(portfolioId) : scopePermissions;
        return hasLevel(perms, category, 'write');
    }, [permissionsFor, scopePermissions]);

    const isSharedPortfolio = useCallback(
        (portfolioId) => !!portfolioId && !ownPortfolioIds.has(portfolioId) && !!sharedPermissions[portfolioId],
        [ownPortfolioIds, sharedPermissions]
    );

    const value = useMemo(() => ({
        permissions: scopePermissions,
        isOwner,
        canRead,
        canWrite,
        permissionsFor,
        isSharedPortfolio,
        sharedPortfolioIds,
        loadingPermissions
    }), [scopePermissions, isOwner, canRead, canWrite, permissionsFor, isSharedPortfolio, sharedPortfolioIds, loadingPermissions]);

    return (
        <PermissionContext.Provider value={value}>
            {children}
        </PermissionContext.Provider>
    );
};

export const usePermission = () => useContext(PermissionContext);
