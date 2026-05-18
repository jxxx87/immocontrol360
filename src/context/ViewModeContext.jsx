import React, { createContext, useContext, useState, useEffect } from 'react';

const ViewModeContext = createContext();

export const useViewMode = () => useContext(ViewModeContext);

export const ViewModeProvider = ({ children }) => {
    // On Capacitor / real mobile devices, always use mobile mode
    const [isMobile, setIsMobile] = useState(() => {
        // If running inside Capacitor (native app), always mobile
        if (window.Capacitor?.isNativePlatform?.()) return true;
        // Otherwise check screen width
        return window.innerWidth < 768;
    });

    // Listen for resize on web only (not in native app)
    useEffect(() => {
        if (window.Capacitor?.isNativePlatform?.()) return;
        const handleResize = () => {
            if (!localStorage.getItem('viewMode')) {
                setIsMobile(window.innerWidth < 768);
            }
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const toggleViewMode = () => {
        if (window.Capacitor?.isNativePlatform?.()) return; // No toggle in native app
        setIsMobile(prev => {
            const next = !prev;
            localStorage.setItem('viewMode', next ? 'mobile' : 'desktop');
            return next;
        });
    };

    return (
        <ViewModeContext.Provider value={{ isMobile, toggleViewMode }}>
            {children}
        </ViewModeContext.Provider>
    );
};
