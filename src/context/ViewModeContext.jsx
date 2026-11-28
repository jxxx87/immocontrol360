import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';

const ViewModeContext = createContext();

export const useViewMode = () => useContext(ViewModeContext);

const MOBILE_BREAKPOINT = 768;

const isNativePlatform = () => !!window.Capacitor?.isNativePlatform?.();
const isNarrowWindow = () => window.innerWidth < MOBILE_BREAKPOINT;

// Die Ansicht folgt immer der Fensterbreite (in der nativen App immer mobil). Eine feste Wahl
// (localStorage 'viewMode' mit toggleViewMode/resetViewMode) hatte nie ein Bedienelement und ist entfallen.
export const ViewModeProvider = ({ children }) => {
    // On Capacitor / real mobile devices, always use mobile mode
    const [isNative] = useState(isNativePlatform);
    const [isNarrow, setIsNarrow] = useState(isNarrowWindow);

    // Fensterbreite verfolgen (nicht in der nativen App)
    useEffect(() => {
        if (isNative) return undefined;
        const handleResize = () => setIsNarrow(isNarrowWindow());
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [isNative]);

    const isMobile = isNative || isNarrow;

    const value = useMemo(() => ({ isMobile }), [isMobile]);

    return (
        <ViewModeContext.Provider value={value}>
            {children}
        </ViewModeContext.Provider>
    );
};
