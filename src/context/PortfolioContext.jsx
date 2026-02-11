import React, { createContext, useState, useEffect, useContext } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

const PortfolioContext = createContext();

export const PortfolioProvider = ({ children }) => {
    const { user } = useAuth();
    const [portfolios, setPortfolios] = useState([]);
    // Load initial selection from localStorage
    const [selectedPortfolioID, setSelectedPortfolioID] = useState(() => {
        return localStorage.getItem('selectedPortfolioID') || '';
    });

    const [loading, setLoading] = useState(true);

    // Persist selection change
    useEffect(() => {
        if (selectedPortfolioID) {
            localStorage.setItem('selectedPortfolioID', selectedPortfolioID);
        } else {
            // If empty string (All Portfolios), store empty string explicitly? 
            // Or remove? "All" is usually represented as empty string in my app logic so far.
            // Let's store empty string if it's explicitly "All".
            // However, on first load it might be empty because nothing is set.
            // But if user explicitly sets it to empty (All), we should save that.
            localStorage.setItem('selectedPortfolioID', '');
        }
    }, [selectedPortfolioID]);

    useEffect(() => {
        const fetchPortfolios = async () => {
            if (!user) {
                setPortfolios([]);
                setSelectedPortfolioID('');
                setLoading(false);
                return;
            }

            try {
                const { data, error } = await supabase
                    .from('portfolios')
                    .select('*')
                    .order('name');

                if (error) throw error;

                setPortfolios(data || []);

                // Logic:
                // 1. If we have a stored ID in state (from localStorage), check if it still exists in the fetched list.
                // 2. If it doesn't exist (deleted?), default to first or All.
                // 3. If nothing stored (first run ever), default to All or First? User asked for Persistence. 
                //    Previous logic forced first portfolio.

                const storedID = localStorage.getItem('selectedPortfolioID');

                if (data && data.length > 0) {
                    // Check if stored ID is valid
                    const exists = data.find(p => p.id === storedID);
                    if (storedID && !exists) {
                        // ID was deleted or invalid, fallback to All or First
                        // Let's fallback to First to guide user, or All if they prefer.
                        // But if storedID is explicit empty string (All), exists is undefined.
                        if (storedID !== '') {
                            setSelectedPortfolioID(''); // or data[0].id
                        }
                    }
                    // If storedID is '' (All), we leave it as ''.
                }

            } catch (error) {
                console.error('Error fetching portfolios:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchPortfolios();
    }, [user]);

    const value = {
        portfolios,
        selectedPortfolioID,
        setSelectedPortfolioID,
        loading
    };

    return (
        <PortfolioContext.Provider value={value}>
            {children}
        </PortfolioContext.Provider>
    );
};

export const usePortfolio = () => {
    return useContext(PortfolioContext);
};
