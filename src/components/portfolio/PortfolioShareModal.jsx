import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import Modal from '../ui/Modal';
import Input from '../ui/Input';

const CATEGORIES = [
    { id: 'immobilien', label: 'Immobilien' },
    { id: 'mietverhaeltnisse', label: 'Mietverhältnisse' },
    { id: 'finanzen', label: 'Finanzen' },
    { id: 'nebenkosten', label: 'Nebenkosten' },
    { id: 'zaehler', label: 'Zähler' },
    { id: 'kontakte', label: 'Kontakte' },
    { id: 'mieterportal', label: 'Mieterportal' },
    { id: 'investorportal', label: 'Investorportal' }
];

export const PortfolioShareModal = ({ isOpen, onClose, portfolioId }) => {
    const [email, setEmail] = useState('');
    const [permissions, setPermissions] = useState({});
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState({ text: '', type: '' });
    const [existingShares, setExistingShares] = useState([]);

    useEffect(() => {
        // Initialize default permissions (all 'none')
        const initialPerms = {};
        CATEGORIES.forEach(cat => initialPerms[cat.id] = 'none');
        setPermissions(initialPerms);
        
        if (isOpen && portfolioId) {
            fetchExistingShares();
        }
    }, [isOpen, portfolioId]);

    const fetchExistingShares = async () => {
        const { data, error } = await supabase
            .from('portfolio_shares')
            .select('*')
            .eq('portfolio_id', portfolioId);
        
        if (!error && data) {
            setExistingShares(data);
        }
    };

    const handlePermissionChange = (categoryId, value) => {
        setPermissions(prev => ({ ...prev, [categoryId]: value }));
    };

    const handleShare = async () => {
        if (!email) {
            setMessage({ text: 'Bitte eine E-Mail-Adresse eingeben.', type: 'error' });
            return;
        }

        setLoading(true);
        setMessage({ text: '', type: '' });

        try {
            // Check if user exists via RPC
            const { data: userExists, error: checkError } = await supabase.rpc('check_user_exists_by_email', { check_email: email });
            
            if (checkError) throw checkError;

            if (!userExists) {
                setMessage({ text: 'Diese E-Mail-Adresse ist noch nicht bei ImmoControlPro360 registriert.', type: 'error' });
                setLoading(false);
                return;
            }

            // Insert into portfolio_shares
            const { error: insertError } = await supabase
                .from('portfolio_shares')
                .upsert({
                    portfolio_id: portfolioId,
                    shared_with_email: email,
                    permissions: permissions,
                    status: 'pending' // They need to accept it
                }, { onConflict: 'portfolio_id, shared_with_email' });

            if (insertError) throw insertError;

            setMessage({ text: 'Erfolgreich geteilt! Eine Einladung wurde verschickt.', type: 'success' });
            fetchExistingShares();
            setEmail('');
            
        } catch (error) {
            console.error('Error sharing portfolio:', error);
            setMessage({ text: 'Ein Fehler ist aufgetreten: ' + error.message, type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const handleRemoveShare = async (shareId) => {
        try {
            await supabase.from('portfolio_shares').delete().eq('id', shareId);
            fetchExistingShares();
        } catch (error) {
            console.error("Error removing share:", error);
        }
    };

    if (!isOpen) return null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Portfolio teilen">
            <div className="space-y-6">
                <div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">Neuen Nutzer einladen</h3>
                    <p className="text-sm text-gray-500 mb-4">
                        Gib die E-Mail-Adresse des Nutzers ein, mit dem du dieses Portfolio teilen möchtest. Der Nutzer muss bereits registriert sein.
                    </p>
                    
                    <div className="mb-4">
                        <Input
                            label="E-Mail-Adresse"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="nutzer@beispiel.de"
                        />
                    </div>

                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                        <h4 className="text-sm font-semibold text-gray-700 mb-3">Berechtigungen festlegen</h4>
                        <div className="space-y-4">
                            {CATEGORIES.map(category => (
                                <div key={category.id} className="flex items-center justify-between">
                                    <span className="text-sm font-medium text-gray-700">{category.label}</span>
                                    <div className="flex gap-2">
                                        <label className="inline-flex items-center">
                                            <input type="radio" className="form-radio text-blue-600 h-4 w-4" 
                                                   checked={permissions[category.id] === 'none'}
                                                   onChange={() => handlePermissionChange(category.id, 'none')} />
                                            <span className="ml-2 text-xs text-gray-600">Kein Zugriff</span>
                                        </label>
                                        <label className="inline-flex items-center">
                                            <input type="radio" className="form-radio text-blue-600 h-4 w-4" 
                                                   checked={permissions[category.id] === 'read'}
                                                   onChange={() => handlePermissionChange(category.id, 'read')} />
                                            <span className="ml-2 text-xs text-gray-600">Lesen</span>
                                        </label>
                                        <label className="inline-flex items-center">
                                            <input type="radio" className="form-radio text-blue-600 h-4 w-4" 
                                                   checked={permissions[category.id] === 'write'}
                                                   onChange={() => handlePermissionChange(category.id, 'write')} />
                                            <span className="ml-2 text-xs text-gray-600">Schreiben</span>
                                        </label>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {message.text && (
                        <div className={`mt-4 p-3 rounded-md text-sm ${message.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
                            {message.text}
                        </div>
                    )}

                    <div className="mt-6 flex justify-end">
                        <button
                            onClick={handleShare}
                            disabled={loading}
                            className="inline-flex justify-center rounded-md border border-transparent bg-blue-600 py-2 px-4 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                        >
                            {loading ? 'Wird geteilt...' : 'Freigeben'}
                        </button>
                    </div>
                </div>

                {existingShares.length > 0 && (
                    <div className="mt-8 border-t border-gray-200 pt-6">
                        <h3 className="text-lg font-medium text-gray-900 mb-4">Aktuelle Freigaben</h3>
                        <ul className="divide-y divide-gray-200">
                            {existingShares.map(share => (
                                <li key={share.id} className="py-3 flex justify-between items-center">
                                    <div>
                                        <p className="text-sm font-medium text-gray-900">{share.shared_with_email}</p>
                                        <p className="text-xs text-gray-500">Status: {share.status === 'accepted' ? 'Akzeptiert' : 'Ausstehend'}</p>
                                    </div>
                                    <button 
                                        onClick={() => handleRemoveShare(share.id)}
                                        className="text-sm text-red-600 hover:text-red-900"
                                    >
                                        Entfernen
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </Modal>
    );
};
