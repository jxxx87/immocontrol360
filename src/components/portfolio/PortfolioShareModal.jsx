import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import { useAuth } from '../../context/AuthContext';
import { Trash2, Shield, UserPlus, CheckCircle, Mail, Settings2 } from 'lucide-react';

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
    const { user } = useAuth();
    const [email, setEmail] = useState('');
    const [permissions, setPermissions] = useState({});
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState({ text: '', type: '' });
    const [existingShares, setExistingShares] = useState([]);

    useEffect(() => {
        // Initialize default permissions
        const initialPerms = {};
        CATEGORIES.forEach(cat => initialPerms[cat.id] = 'none');
        setPermissions(initialPerms);
        
        if (isOpen && portfolioId) {
            fetchExistingShares();
            setMessage({ text: '', type: '' });
            setEmail('');
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
                    status: 'pending', // They need to accept it
                    created_by: user.id
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
        if (!window.confirm("Zugang wirklich widerrufen?")) return;
        try {
            await supabase.from('portfolio_shares').delete().eq('id', shareId);
            fetchExistingShares();
        } catch (error) {
            console.error("Error removing share:", error);
        }
    };

    if (!isOpen) return null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Portfolio Zugriff verwalten">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                
                {/* Invite Section */}
                <div style={{ backgroundColor: 'var(--surface-color)', padding: '20px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                        <div style={{ backgroundColor: '#E0F2FE', padding: '8px', borderRadius: '8px', color: 'var(--primary-color)' }}>
                            <UserPlus size={20} />
                        </div>
                        <div>
                            <h3 style={{ fontSize: '1.05rem', fontWeight: 600, margin: 0, color: 'var(--text-color)' }}>Neuen Nutzer einladen</h3>
                            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>Der Nutzer muss bereits ein Konto bei ImmoControlPro360 besitzen.</p>
                        </div>
                    </div>
                    
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', marginBottom: '24px' }}>
                        <div style={{ flex: 1 }}>
                            <Input
                                label="E-Mail-Adresse des Nutzers"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="name@beispiel.de"
                                icon={Mail}
                            />
                        </div>
                        <Button variant="primary" onClick={handleShare} disabled={loading} style={{ height: '40px' }}>
                            {loading ? 'Lade...' : 'Einladen'}
                        </Button>
                    </div>

                    <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                        <h4 style={{ fontSize: '0.9rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', color: 'var(--text-color)' }}>
                            <Settings2 size={16} /> Berechtigungen konfigurieren
                        </h4>
                        
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '12px' }}>
                            {CATEGORIES.map(category => (
                                <div key={category.id} style={{ 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    justifyContent: 'space-between', 
                                    padding: '12px', 
                                    backgroundColor: '#F9FAFB', 
                                    borderRadius: 'var(--radius-md)', 
                                    border: '1px solid #E5E7EB' 
                                }}>
                                    <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-color)' }}>{category.label}</span>
                                    <div style={{ display: 'flex', gap: '4px', backgroundColor: '#E5E7EB', padding: '4px', borderRadius: '8px' }}>
                                        {[
                                            { value: 'none', label: 'Kein' },
                                            { value: 'read', label: 'Lesen' },
                                            { value: 'write', label: 'Schreiben' }
                                        ].map(opt => (
                                            <button
                                                key={opt.value}
                                                onClick={() => handlePermissionChange(category.id, opt.value)}
                                                style={{
                                                    padding: '4px 10px',
                                                    fontSize: '0.75rem',
                                                    fontWeight: permissions[category.id] === opt.value ? 600 : 400,
                                                    color: permissions[category.id] === opt.value ? (opt.value === 'none' ? '#374151' : 'var(--primary-color)') : '#6B7280',
                                                    backgroundColor: permissions[category.id] === opt.value ? 'white' : 'transparent',
                                                    border: 'none',
                                                    borderRadius: '6px',
                                                    cursor: 'pointer',
                                                    boxShadow: permissions[category.id] === opt.value ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                                                    transition: 'all 0.2s'
                                                }}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {message.text && (
                        <div style={{ 
                            marginTop: '20px', 
                            padding: '12px', 
                            borderRadius: '8px', 
                            fontSize: '0.85rem', 
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            backgroundColor: message.type === 'error' ? '#FEF2F2' : '#F0FDF4', 
                            color: message.type === 'error' ? '#991B1B' : '#166534',
                            border: `1px solid ${message.type === 'error' ? '#FECACA' : '#BBF7D0'}`
                        }}>
                            {message.type === 'error' ? <Shield size={16} /> : <CheckCircle size={16} />}
                            {message.text}
                        </div>
                    )}
                </div>

                {/* Existing Shares Section */}
                {existingShares.length > 0 && (
                    <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '24px' }}>
                        <h3 style={{ fontSize: '1.05rem', fontWeight: 600, margin: '0 0 16px 0', color: 'var(--text-color)' }}>Aktuelle Freigaben</h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {existingShares.map(share => (
                                <div key={share.id} style={{ 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    justifyContent: 'space-between',
                                    padding: '16px',
                                    backgroundColor: 'white',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: 'var(--radius-md)'
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                        <div style={{ width: '36px', height: '36px', borderRadius: '50%', backgroundColor: '#F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6B7280' }}>
                                            <Mail size={18} />
                                        </div>
                                        <div>
                                            <p style={{ margin: 0, fontWeight: 500, fontSize: '0.95rem', color: 'var(--text-color)' }}>{share.shared_with_email}</p>
                                            <div style={{ margin: '4px 0 0 0' }}>
                                                {share.status === 'accepted' 
                                                    ? <Badge variant="success">Akzeptiert</Badge> 
                                                    : <Badge variant="warning">Ausstehend</Badge>
                                                }
                                            </div>
                                        </div>
                                    </div>
                                    <Button 
                                        variant="ghost" 
                                        icon={Trash2} 
                                        style={{ color: 'var(--danger-color)' }}
                                        onClick={() => handleRemoveShare(share.id)}
                                    >
                                        Entfernen
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
            
            <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                <Button variant="ghost" onClick={onClose}>Schließen</Button>
            </div>
        </Modal>
    );
};
