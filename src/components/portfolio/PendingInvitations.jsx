import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { usePortfolio } from '../../context/PortfolioContext';

export const PendingInvitations = () => {
    const { user } = useAuth();
    const { refreshPortfolios } = usePortfolio();
    const [invitations, setInvitations] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (user) {
            fetchInvitations();
        }
    }, [user]);

    const fetchInvitations = async () => {
        setLoading(true);
        try {
            // We need to fetch portfolio_shares where email matches and status is pending
            const { data, error } = await supabase
                .from('portfolio_shares')
                .select(`
                    id,
                    portfolio_id,
                    created_at,
                    portfolios (
                        name
                    )
                `)
                .eq('shared_with_email', user.email)
                .eq('status', 'pending');

            if (error) throw error;
            setInvitations(data || []);
        } catch (error) {
            console.error("Error fetching invitations:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleAccept = async (shareId) => {
        try {
            const { data, error } = await supabase.rpc('accept_portfolio_share', { share_id: shareId });
            
            if (error) throw error;
            
            if (data) {
                // Success! Refresh the list and portfolios
                fetchInvitations();
                refreshPortfolios();
            }
        } catch (error) {
            console.error("Error accepting invitation:", error);
            alert("Fehler beim Annehmen der Einladung.");
        }
    };

    const handleDecline = async (shareId) => {
        try {
            const { error } = await supabase
                .from('portfolio_shares')
                .delete()
                .eq('id', shareId);
            
            if (error) throw error;
            
            fetchInvitations();
        } catch (error) {
            console.error("Error declining invitation:", error);
        }
    };

    if (loading || invitations.length === 0) return null;

    return (
        <div className="mb-6 bg-white rounded-lg shadow border border-blue-100 overflow-hidden">
            <div className="px-4 py-5 sm:px-6 bg-blue-50 border-b border-blue-100">
                <h3 className="text-lg leading-6 font-medium text-blue-900">
                    Ausstehende Portfolio-Einladungen ({invitations.length})
                </h3>
                <p className="mt-1 max-w-2xl text-sm text-blue-700">
                    Andere Nutzer haben Portfolios mit dir geteilt.
                </p>
            </div>
            <div className="px-4 py-5 sm:p-0">
                <ul className="divide-y divide-gray-200">
                    {invitations.map((invitation) => (
                        <li key={invitation.id} className="p-4 sm:px-6 flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-gray-900 truncate">
                                    Portfolio: {invitation.portfolios?.name || 'Unbekannt'}
                                </p>
                                <p className="text-sm text-gray-500">
                                    Eingeladen am {new Date(invitation.created_at).toLocaleDateString('de-DE')}
                                </p>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => handleAccept(invitation.id)}
                                    className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none"
                                >
                                    Annehmen
                                </button>
                                <button
                                    onClick={() => handleDecline(invitation.id)}
                                    className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none"
                                >
                                    Ablehnen
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
};
