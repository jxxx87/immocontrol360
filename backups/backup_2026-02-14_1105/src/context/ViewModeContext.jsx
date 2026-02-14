import React, { createContext, useContext, useState, useEffect } from 'react';

const ViewModeContext = createContext();

export const useViewMode = () => useContext(ViewModeContext);

export const ViewModeProvider = ({ children }) => {
    const [isMobile, setIsMobile] = useState(() => {
        const saved = localStorage.getItem('viewMode');
        if (saved) return saved === 'mobile';
        return window.innerWidth < 768;
    });

    const toggleViewMode = () => {
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
