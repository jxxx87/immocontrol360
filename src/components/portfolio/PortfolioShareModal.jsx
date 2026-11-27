import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Button from '../ui/Button';
import { useAuth } from '../../context/AuthContext';
import { Shield, UserPlus, CheckCircle, Mail, Settings2 } from 'lucide-react';

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

const normalizeEmail = (value) => (value || '').trim().toLowerCase();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// existingShare (optional): { id, shared_with_email, permissions, status } -> nur Rechte ändern
export const PortfolioShareModal = ({ isOpen, onClose, portfolioId, onShareSuccess, existingShare = null }) => {
    const { user } = useAuth();
    const [email, setEmail] = useState('');
    const [permissions, setPermissions] = useState({});
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState({ text: '', type: '' });

    useEffect(() => {
        // Initialize default permissions (bzw. die der bestehenden Freigabe)
        const initialPerms = {};
        CATEGORIES.forEach(cat => {
            const current = existingShare?.permissions?.[cat.id];
            initialPerms[cat.id] = current === 'read' || current === 'write' ? current : 'none';
        });
        setPermissions(initialPerms);

        if (isOpen && portfolioId) {
            setMessage({ text: '', type: '' });
            setEmail(existingShare?.shared_with_email || '');
        }
    }, [isOpen, portfolioId, existingShare]);

    const handlePermissionChange = (categoryId, value) => {
        setPermissions(prev => ({ ...prev, [categoryId]: value }));
    };

    const handleShare = async () => {
        const normalizedEmail = normalizeEmail(email);

        if (!normalizedEmail) {
            setMessage({ text: 'Bitte eine E-Mail-Adresse eingeben.', type: 'error' });
            return;
        }
        if (!EMAIL_PATTERN.test(normalizedEmail)) {
            setMessage({ text: 'Bitte eine gültige E-Mail-Adresse eingeben.', type: 'error' });
            return;
        }
        if (normalizedEmail === normalizeEmail(user?.email)) {
            setMessage({ text: 'Sie können ein Portfolio nicht mit sich selbst teilen.', type: 'error' });
            return;
        }
        if (!Object.values(permissions).some(v => v === 'read' || v === 'write')) {
            setMessage({ text: 'Bitte mindestens für einen Bereich „Lesen" oder „Schreiben" auswählen – sonst sieht die eingeladene Person nichts.', type: 'error' });
            return;
        }

        setLoading(true);
        setMessage({ text: '', type: '' });

        try {
            // Bestehende Freigabe für diese Adresse? Dann nur die Rechte ändern – eine
            // bereits angenommene Freigabe bleibt aktiv (kein Zurücksetzen auf "ausstehend").
            let target = existingShare;
            if (!target) {
                const { data: rows, error: existingError } = await supabase
                    .from('portfolio_shares')
                    .select('id, status, shared_with_email')
                    .eq('portfolio_id', portfolioId);
                if (existingError) throw existingError;
                target = (rows || []).find(r => normalizeEmail(r.shared_with_email) === normalizedEmail) || null;
            }

            if (target) {
                const { data: updated, error: updateError } = await supabase
                    .from('portfolio_shares')
                    .update({ permissions, updated_at: new Date().toISOString() })
                    .eq('id', target.id)
                    .select('id');
                if (updateError) throw updateError;
                if (!updated || updated.length === 0) {
                    throw new Error('Die Freigabe konnte nicht geändert werden (keine Berechtigung).');
                }

                alert(target.status === 'accepted'
                    ? 'Die Rechte wurden aktualisiert. Die Freigabe bleibt aktiv.'
                    : 'Die Rechte der offenen Einladung wurden aktualisiert.');
            } else {
                // Check if user exists via RPC
                const { data: userExists, error: checkError } = await supabase.rpc('check_user_exists_by_email', { check_email: normalizedEmail });
                if (checkError) throw checkError;

                if (!userExists) {
                    setMessage({ text: 'Diese E-Mail-Adresse ist noch nicht bei ImmoControlPro360 registriert. Die Person muss sich zuerst registrieren.', type: 'error' });
                    setLoading(false);
                    return;
                }

                const { error: insertError } = await supabase
                    .from('portfolio_shares')
                    .insert({
                        portfolio_id: portfolioId,
                        shared_with_email: normalizedEmail,
                        permissions: permissions,
                        status: 'pending', // They need to accept it
                        created_by: user.id
                    });

                if (insertError) throw insertError;

                // Es wird keine E-Mail verschickt – die Einladung erscheint beim nächsten Login.
                alert('Einladung angelegt. Es wird keine E-Mail versendet: Die eingeladene Person sieht die Einladung beim nächsten Login unter Einstellungen > Portfolios und muss sie dort annehmen.');
            }

            setMessage({ text: '', type: '' });
            setEmail('');
            if (onShareSuccess) onShareSuccess();
            onClose();

        } catch (error) {
            console.error('Error sharing portfolio:', error);
            setMessage({ text: 'Ein Fehler ist aufgetreten: ' + (error?.message || 'Unbekannter Fehler'), type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    const isEditMode = !!existingShare;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={isEditMode ? 'Freigabe-Rechte ändern' : 'Portfolio Zugriff verwalten'}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

                {/* Invite Section */}
                <div style={{ backgroundColor: 'var(--surface-color)', padding: '20px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                        <div style={{ backgroundColor: '#E0F2FE', padding: '8px', borderRadius: '8px', color: 'var(--primary-color)' }}>
                            <UserPlus size={20} />
                        </div>
                        <div>
                            <h3 style={{ fontSize: '1.05rem', fontWeight: 600, margin: 0, color: 'var(--text-color)' }}>
                                {isEditMode ? 'Rechte für bestehende Freigabe' : 'Neuen Nutzer einladen'}
                            </h3>
                            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
                                {isEditMode
                                    ? 'Die Freigabe bleibt bestehen; es ändern sich nur die Rechte.'
                                    : 'Der Nutzer muss bereits ein Konto bei ImmoControlPro360 besitzen. Es wird keine E-Mail versendet.'}
                            </p>
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
                                disabled={isEditMode}
                            />
                        </div>
                        <Button variant="primary" onClick={handleShare} disabled={loading} style={{ height: '40px' }}>
                            {loading ? 'Lade...' : (isEditMode ? 'Speichern' : 'Einladen')}
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
                        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '12px 0 0 0' }}>
                            Hinweis: Sobald ein Bereich freigegeben ist, sieht die Person die Grunddaten des Portfolios
                            (Portfolio, Objekte, Einheiten). Portfolio-Stammdaten ändern oder löschen kann nur der Eigentümer.
                        </p>
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
            </div>

            <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                <Button variant="ghost" onClick={onClose}>Schließen</Button>
            </div>
        </Modal>
    );
};
