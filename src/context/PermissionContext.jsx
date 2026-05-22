import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { usePortfolio } from './PortfolioContext';
import { useAuth } from './AuthContext'; // Assuming AuthContext exists

const PermissionContext = createContext();

export const PermissionProvider = ({ children }) => {
    const { selectedPortfolioID, portfolios } = usePortfolio();
    const { user } = useAuth();
    const [permissions, setPermissions] = useState(null);
    const [isOwner, setIsOwner] = useState(false);
    const [loadingPermissions, setLoadingPermissions] = useState(true);

    useEffect(() => {
        const checkPermissions = async () => {
            setLoadingPermissions(true);
            setPermissions(null);
            setIsOwner(false);

            if (!user) {
                setLoadingPermissions(false);
                return;
            }

            // If "All Portfolios" is selected (empty string), grant full access in the UI.
            // The backend RLS will ensure they only see data from portfolios they have access to.
            if (!selectedPortfolioID) {
                setIsOwner(true);
                setPermissions({
                    immobilien: 'write',
                    mietverhaeltnisse: 'write',
                    finanzen: 'write',
                    nebenkosten: 'write',
                    zaehler: 'write',
                    kontakte: 'write',
                    mieterportal: 'write',
                    investorportal: 'write'
                });
                setLoadingPermissions(false);
                return;
            }

            // Check if current user is the owner of the selected portfolio
            const selectedPortfolio = portfolios.find(p => p.id === selectedPortfolioID);
            if (selectedPortfolio && selectedPortfolio.user_id === user.id) {
                setIsOwner(true);
                // Owners have full access, so we can mock full permissions or just rely on isOwner flag
                setPermissions({
                    immobilien: 'write',
                    mietverhaeltnisse: 'write',
                    finanzen: 'write',
                    nebenkosten: 'write',
                    zaehler: 'write',
                    kontakte: 'write',
                    mieterportal: 'write',
                    investorportal: 'write'
                });
                setLoadingPermissions(false);
                return;
            }

            // If not owner, fetch permissions from portfolio_shares
            try {
                const { data, error } = await supabase
                    .from('portfolio_shares')
                    .select('permissions')
                    .eq('portfolio_id', selectedPortfolioID)
                    .eq('shared_with_email', user.email)
                    .eq('status', 'accepted')
                    .maybeSingle();

                if (error) throw error;

                if (data && data.permissions) {
                    setPermissions(data.permissions);
                } else {
                    setPermissions(null);
                }
            } catch (err) {
                console.error("Error fetching permissions:", err);
                setPermissions(null);
            } finally {
                setLoadingPermissions(false);
            }
        };

        checkPermissions();
    }, [selectedPortfolioID, portfolios, user]);

    // Helper functions
    const canRead = (category) => {
        if (isOwner) return true;
        if (!permissions) return false;
        return permissions[category] === 'read' || permissions[category] === 'write';
    };

    const canWrite = (category) => {
        if (isOwner) return true;
        if (!permissions) return false;
        return permissions[category] === 'write';
    };

    return (
        <PermissionContext.Provider value={{ permissions, isOwner, canRead, canWrite, loadingPermissions }}>
            {children}
        </PermissionContext.Provider>
    );
};

export const usePermission = () => useContext(PermissionContext);
