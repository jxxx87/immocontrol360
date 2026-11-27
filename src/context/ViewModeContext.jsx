import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';

const ViewModeContext = createContext();

// eslint-disable-next-line react-refresh/only-export-components
export const useViewMode = () => useContext(ViewModeContext);

const STORAGE_KEY = 'viewMode';
const MOBILE_BREAKPOINT = 768;

const isNativePlatform = () => !!window.Capacitor?.isNativePlatform?.();
const isNarrowWindow = () => window.innerWidth < MOBILE_BREAKPOINT;

// Gespeicherte Wahl: 'mobile' | 'desktop' | null (= automatisch nach Fensterbreite)
const readStoredPreference = () => {
    try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        return stored === 'mobile' || stored === 'desktop' ? stored : null;
    } catch {
        return null;
    }
};

const writeStoredPreference = (preference) => {
    try {
        if (preference) window.localStorage.setItem(STORAGE_KEY, preference);
        else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
        // Speicher nicht verfügbar (z.B. privater Modus) – die Wahl gilt dann bis zum Neuladen
    }
};

export const ViewModeProvider = ({ children }) => {
    // On Capacitor / real mobile devices, always use mobile mode
    const [isNative] = useState(isNativePlatform);
    const [preference, setPreference] = useState(readStoredPreference);
    const [isNarrow, setIsNarrow] = useState(isNarrowWindow);

    // Fensterbreite immer verfolgen (nicht in der nativen App); wirkt nur im Automatik-Modus
    useEffect(() => {
        if (isNative) return undefined;
        const handleResize = () => setIsNarrow(isNarrowWindow());
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [isNative]);

    const isMobile = isNative ? true : (preference ? preference === 'mobile' : isNarrow);

    const toggleViewMode = useCallback(() => {
        if (isNative) return; // No toggle in native app
        const next = isMobile ? 'desktop' : 'mobile';
        writeStoredPreference(next);
        setPreference(next);
    }, [isNative, isMobile]);

    // Zurück zur Automatik (Ansicht folgt wieder der Fensterbreite)
    const resetViewMode = useCallback(() => {
        writeStoredPreference(null);
        setPreference(null);
        setIsNarrow(isNarrowWindow());
    }, []);

    const value = useMemo(() => ({
        isMobile,
        toggleViewMode,
        resetViewMode,
        // 'auto' | 'mobile' | 'desktop' | 'native'
        viewModePreference: isNative ? 'native' : (preference || 'auto')
    }), [isMobile, toggleViewMode, resetViewMode, isNative, preference]);

    return (
        <ViewModeContext.Provider value={value}>
            {children}
        </ViewModeContext.Provider>
    );
};
