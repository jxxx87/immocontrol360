import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import { Plus, Phone, Mail, MapPin, Loader2, User, Search, MoreVertical, Edit2, Trash2, Send, Home } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { translateError } from '../lib/errorTranslator';

const ActionMenu = ({ onEdit, onDelete, onMessage }) => {
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef(null);
    const contentRef = useRef(null);
    const [menuStyle, setMenuStyle] = useState({});

    useEffect(() => {
        const handleClickOutside = (event) => {
            const isOutsideTrigger = menuRef.current && !menuRef.current.contains(event.target);
            const isOutsideContent = contentRef.current && !contentRef.current.contains(event.target);

            if (isOutsideTrigger && isOutsideContent) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            if (menuRef.current) {
                const rect = menuRef.current.getBoundingClientRect();
                setMenuStyle({
                    position: 'fixed',
                    top: `${rect.bottom + 5}px`,
                    left: `${rect.right - 160}px`,
                    zIndex: 9999
                });
            }
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    const MenuContent = (
        <div
            ref={contentRef}
            style={{
                ...menuStyle,
                backgroundColor: 'var(--surface-color)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                minWidth: '160px',
                overflow: 'hidden'
            }}
            onClick={(e) => e.stopPropagation()}
        >
            <div style={{ display: 'flex', flexDirection: 'column', padding: '4px' }}>
                <button
                    onClick={(e) => { e.stopPropagation(); setIsOpen(false); onEdit(); }}
                    style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        padding: '8px 12px', width: '100%', textAlign: 'left',
                        border: 'none', background: 'none', cursor: 'pointer',
                        fontSize: '0.875rem', color: 'var(--text-primary)',
                        borderRadius: '4px', transition: 'background 0.2s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                    <Edit2 size={16} /> Bearbeiten
                </button>
                <button
                    onClick={(e) => { e.stopPropagation(); setIsOpen(false); onMessage(); }}
                    style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        padding: '8px 12px', width: '100%', textAlign: 'left',
                        border: 'none', background: 'none', cursor: 'pointer',
                        fontSize: '0.875rem', color: 'var(--text-primary)',
                        borderRadius: '4px', transition: 'background 0.2s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                    <Send size={16} /> Nachricht senden
                </button>
                <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '4px 0' }} />
                <button
                    onClick={(e) => { e.stopPropagation(); setIsOpen(false); onDelete(); }}
                    style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        padding: '8px 12px', width: '100%', textAlign: 'left',
                        border: 'none', background: 'none', cursor: 'pointer',
                        fontSize: '0.875rem', color: 'var(--danger-color)',
                        borderRadius: '4px', transition: 'background 0.2s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                    <Trash2 size={16} /> Löschen
                </button>
            </div>
        </div>
    );

    return (
        <div style={{ position: 'relative' }} ref={menuRef}>
            <Button variant="ghost" size="sm" icon={MoreVertical} onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }} />
            {isOpen && createPortal(MenuContent, document.body)}
        </div>
    );
};

const Contacts = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [contacts, setContacts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [editingContact, setEditingContact] = useState(null);
    const [invitePrompt, setInvitePrompt] = useState(null); // { contactName, tenantId }

    // Form State
    const [formData, setFormData] = useState({
        name: '',
        contact_type: 'other',
        email: '',
        phone: '',
        street: '',
        zip: '',
        city: ''
    });

    const fetchContacts = async () => {
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from('contacts')
                .select('*')
                .order('name', { ascending: true });

            if (error) throw error;
            setContacts(data || []);
        } catch (error) {
            console.error('Error fetching contacts:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (user) {
            fetchContacts();
        }
    }, [user]);

    const filteredContacts = useMemo(() => {
        if (!searchTerm) return contacts;
        const lowerTerm = searchTerm.toLowerCase();
        return contacts.filter(contact => {
            const searchStr = `
                ${contact.name || ''} 
                ${contact.email || ''} 
                ${contact.phone || ''} 
                ${contact.street || ''} 
                ${contact.city || ''} 
                ${contact.zip || ''}
                ${contact.contact_type || ''}
            `.toLowerCase();
            return searchStr.includes(lowerTerm);
        });
    }, [contacts, searchTerm]);

    const handleOpenAdd = () => {
        setEditingContact(null);
        setFormData({
            name: '',
            contact_type: 'other',
            email: '',
            phone: '',
            street: '',
            zip: '',
            city: ''
        });
        setIsModalOpen(true);
    };

    const handleOpenEdit = (contact) => {
        setEditingContact(contact);
        setFormData({
            name: contact.name || '',
            contact_type: contact.contact_type || 'other',
            email: contact.email || '',
            phone: contact.phone || '',
            street: contact.street || '',
            zip: contact.zip || '',
            city: contact.city || ''
        });
        setIsModalOpen(true);
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Möchten Sie diesen Kontakt wirklich löschen?')) return;
        try {
            const { error } = await supabase.from('contacts').delete().eq('id', id);
            if (error) throw error;
            fetchContacts();
        } catch (error) {
            alert(translateError(error));
        }
    };

    const handleSave = async () => {
        if (!formData.name) return alert('Name ist erforderlich.');
        try {
            const payload = {
                user_id: user.id,
                name: formData.name,
                contact_type: formData.contact_type,
                email: formData.email,
                phone: formData.phone,
                street: formData.street,
                zip: formData.zip,
                city: formData.city
            };

            if (editingContact) {
                const { error } = await supabase
                    .from('contacts')
                    .update(payload)
                    .eq('id', editingContact.id);
                if (error) throw error;
            } else {
                const { error } = await supabase.from('contacts').insert([payload]);
                if (error) throw error;
            }

            setIsModalOpen(false);
            fetchContacts();
        } catch (error) {
            alert(translateError(error));
        }
    };

    // ===== HANDLE MESSAGE =====
    const handleMessage = async (contact) => {
        // Only for tenants
        if (contact.contact_type !== 'tenant') {
            alert('Nachrichten können nur an Mieter gesendet werden.');
            return;
        }

        try {
            // Find matching tenant by email or name
            const { data: allTenants } = await supabase.from('tenants').select('id, first_name, last_name, email');
            let matchedTenant = null;

            if (contact.email) {
                matchedTenant = (allTenants || []).find(t => t.email && t.email.toLowerCase() === contact.email.toLowerCase());
            }
            if (!matchedTenant && contact.name) {
                // Try matching by name ("Nachname, Vorname" or "Vorname Nachname")
                matchedTenant = (allTenants || []).find(t => {
                    const fullName1 = `${t.last_name}, ${t.first_name}`.toLowerCase();
                    const fullName2 = `${t.first_name} ${t.last_name}`.toLowerCase();
                    const contactName = contact.name.toLowerCase();
                    return contactName === fullName1 || contactName === fullName2 || contactName === t.last_name.toLowerCase();
                });
            }

            if (!matchedTenant) {
                alert('Kein passender Mieter in der Mieterdatenbank gefunden.');
                return;
            }

            // Check if tenant has a user_role (= registered)
            const { data: roles } = await supabase
                .from('user_roles')
                .select('user_id')
                .eq('tenant_id', matchedTenant.id)
                .eq('role', 'tenant');

            if (roles && roles.length > 0) {
                // Tenant is registered → navigate to messages with pre-selected convo
                navigate('/investor-messages', { state: { preSelectUserId: roles[0].user_id } });
            } else {
                // Check if already invited but not yet registered
                const { data: invitations } = await supabase
                    .from('tenant_invitations')
                    .select('status')
                    .eq('tenant_id', matchedTenant.id);

                const pending = invitations?.find(i => i.status === 'pending');
                if (pending) {
                    alert(`${contact.name} wurde bereits eingeladen, hat sich aber noch nicht registriert.`);
                } else {
                    // Not invited yet → show prompt
                    setInvitePrompt({ contactName: contact.name, tenantId: matchedTenant.id });
                }
            }
        } catch (err) {
            console.error('Error checking tenant status:', err);
            alert('Fehler bei der Prüfung des Mieterstatus.');
        }
    };

    // ===== TYPE LABEL + COLOR MAP =====
    const typeConfig = {
        tenant: { label: 'Mieter', color: '#10b981', bg: 'rgba(16,185,129,0.1)' },
        vendor: { label: 'Dienstleister', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
        guest: { label: 'Gast', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
        other: { label: 'Sonstiges', color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)' }
    };

    const getInitials = (name) => {
        if (!name) return '?';
        const parts = name.trim().split(/[\s,]+/).filter(Boolean);
        if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        return name.substring(0, 2).toUpperCase();
    };

    const getAvatarColor = (name) => {
        const colors = [
            'linear-gradient(135deg, #667eea, #764ba2)',
            'linear-gradient(135deg, #f093fb, #f5576c)',
            'linear-gradient(135deg, #4facfe, #00f2fe)',
            'linear-gradient(135deg, #43e97b, #38f9d7)',
            'linear-gradient(135deg, #fa709a, #fee140)',
            'linear-gradient(135deg, #a18cd1, #fbc2eb)',
            'linear-gradient(135deg, #fccb90, #d57eeb)',
            'linear-gradient(135deg, #0ea5e9, #2dd4bf)',
        ];
        let hash = 0;
        for (let i = 0; i < (name || '').length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
        return colors[Math.abs(hash) % colors.length];
    };

    if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '50px' }}><Loader2 className="animate-spin" /></div>;

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-xl)', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                    <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: 'var(--spacing-xs)' }}>Kontakte</h1>
                    <p style={{ color: 'var(--text-secondary)' }}>Dienstleister, Mieter und Partner verwalten</p>
                </div>
                <Button icon={Plus} onClick={handleOpenAdd}>Kontakt erstellen</Button>
            </div>

            {/* Search + Count */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: '1 1 300px', maxWidth: '400px' }}>
                    <input
                        type="text"
                        placeholder="Kontakte suchen..."
                        style={{
                            width: '100%',
                            padding: '10px 12px 10px 38px',
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid var(--border-color)',
                            outline: 'none',
                            backgroundColor: 'var(--surface-color)',
                            fontSize: '0.88rem',
                            color: 'var(--text-primary)',
                            transition: 'border-color 0.2s, box-shadow 0.2s'
                        }}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        onFocus={(e) => { e.target.style.borderColor = 'var(--primary-color)'; e.target.style.boxShadow = '0 0 0 3px rgba(14,165,233,0.1)'; }}
                        onBlur={(e) => { e.target.style.borderColor = 'var(--border-color)'; e.target.style.boxShadow = 'none'; }}
                    />
                    <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                </div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                    {filteredContacts.length} {filteredContacts.length === 1 ? 'Kontakt' : 'Kontakte'}
                </div>
            </div>

            {/* Contact Cards Grid */}
            {filteredContacts.length === 0 ? (
                <Card>
                    <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        <User size={40} style={{ marginBottom: '12px', opacity: 0.3 }} />
                        <div style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '4px' }}>Keine Kontakte gefunden</div>
                        <div style={{ fontSize: '0.85rem' }}>{searchTerm ? 'Versuchen Sie einen anderen Suchbegriff.' : 'Erstellen Sie Ihren ersten Kontakt.'}</div>
                    </div>
                </Card>
            ) : (
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                    gap: '16px'
                }}>
                    {filteredContacts.map((contact) => {
                        const tc = typeConfig[contact.contact_type] || typeConfig.other;
                        return (
                            <div
                                key={contact.id}
                                style={{
                                    background: 'var(--glass-bg)',
                                    backdropFilter: 'blur(12px)',
                                    WebkitBackdropFilter: 'blur(12px)',
                                    border: '1px solid var(--glass-border)',
                                    borderRadius: 'var(--radius-lg)',
                                    padding: '20px',
                                    transition: 'transform 0.2s, box-shadow 0.2s',
                                    cursor: 'default',
                                    position: 'relative',
                                    overflow: 'hidden'
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = 'translateY(-2px)';
                                    e.currentTarget.style.boxShadow = '0 8px 30px rgba(0,0,0,0.08)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.boxShadow = 'none';
                                }}
                            >
                                {/* Top: Avatar + Name + Badge + Actions */}
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', marginBottom: '16px' }}>
                                    {/* Avatar */}
                                    <div style={{
                                        width: '48px', height: '48px', borderRadius: '14px',
                                        background: getAvatarColor(contact.name),
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        color: '#fff', fontWeight: 700, fontSize: '1rem',
                                        flexShrink: 0, boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                                    }}>
                                        {getInitials(contact.name)}
                                    </div>

                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {contact.name}
                                        </div>
                                        <span style={{
                                            display: 'inline-block', marginTop: '4px',
                                            fontSize: '0.7rem', fontWeight: 600,
                                            padding: '2px 8px', borderRadius: '6px',
                                            color: tc.color, backgroundColor: tc.bg,
                                            letterSpacing: '0.3px'
                                        }}>
                                            {tc.label}
                                        </span>
                                    </div>

                                    {/* Action Menu */}
                                    <ActionMenu
                                        onEdit={() => handleOpenEdit(contact)}
                                        onDelete={() => handleDelete(contact.id)}
                                        onMessage={() => handleMessage(contact)}
                                    />
                                </div>

                                {/* Contact Info */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {contact.phone && (
                                        <a href={`tel:${contact.phone}`} style={{
                                            display: 'flex', alignItems: 'center', gap: '10px',
                                            color: 'var(--text-secondary)', fontSize: '0.84rem',
                                            textDecoration: 'none', padding: '6px 10px',
                                            borderRadius: '8px', transition: 'background 0.15s',
                                            margin: '0 -10px'
                                        }}
                                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(14,165,233,0.06)'}
                                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                        >
                                            <Phone size={14} style={{ flexShrink: 0, color: 'var(--primary-color)' }} />
                                            <span>{contact.phone}</span>
                                        </a>
                                    )}
                                    {contact.email && (
                                        <a href={`mailto:${contact.email}`} style={{
                                            display: 'flex', alignItems: 'center', gap: '10px',
                                            color: 'var(--text-secondary)', fontSize: '0.84rem',
                                            textDecoration: 'none', padding: '6px 10px',
                                            borderRadius: '8px', transition: 'background 0.15s',
                                            margin: '0 -10px', overflow: 'hidden'
                                        }}
                                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(14,165,233,0.06)'}
                                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                        >
                                            <Mail size={14} style={{ flexShrink: 0, color: 'var(--primary-color)' }} />
                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contact.email}</span>
                                        </a>
                                    )}
                                    {(contact.street || contact.city) && (
                                        <div style={{
                                            display: 'flex', alignItems: 'flex-start', gap: '10px',
                                            color: 'var(--text-secondary)', fontSize: '0.84rem',
                                            padding: '6px 10px', margin: '0 -10px'
                                        }}>
                                            <MapPin size={14} style={{ flexShrink: 0, marginTop: '1px', color: 'var(--primary-color)' }} />
                                            <div>
                                                {contact.street && <div>{contact.street}</div>}
                                                {(contact.zip || contact.city) && <div>{contact.zip} {contact.city}</div>}
                                            </div>
                                        </div>
                                    )}
                                    {contact.contact_type === 'tenant' && contact.unit_name && (
                                        <div style={{
                                            display: 'flex', alignItems: 'center', gap: '10px',
                                            color: 'var(--text-secondary)', fontSize: '0.84rem',
                                            padding: '6px 10px', margin: '0 -10px'
                                        }}>
                                            <Home size={14} style={{ flexShrink: 0, color: 'var(--primary-color)' }} />
                                            <span>{contact.unit_name}</span>
                                        </div>
                                    )}
                                    {!contact.phone && !contact.email && !contact.street && !contact.city && (
                                        <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontStyle: 'italic', padding: '4px 0', opacity: 0.6 }}>
                                            Keine Kontaktdaten hinterlegt
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={editingContact ? 'Kontakt bearbeiten' : 'Neuen Kontakt anlegen'}
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setIsModalOpen(false)}>Abbrechen</Button>
                        <Button onClick={handleSave}>Speichern</Button>
                    </>
                }
            >
                <div style={{ marginBottom: 'var(--spacing-md)' }}>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
                        Typ
                    </label>
                    <select
                        style={{
                            width: '100%',
                            padding: '0.75rem',
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid var(--border-color)',
                            outline: 'none',
                            backgroundColor: 'var(--surface-color)'
                        }}
                        value={formData.contact_type}
                        onChange={(e) => setFormData({ ...formData, contact_type: e.target.value })}
                    >
                        <option value="other">Sonstiges</option>
                        <option value="vendor">Dienstleister / Handwerker</option>
                        <option value="tenant">Mieter</option>
                        <option value="guest">Gast</option>
                    </select>
                </div>

                <Input
                    label="Name / Firma"
                    placeholder="Muster GmbH"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                    <Input
                        label="E-Mail"
                        type="email"
                        placeholder="info@..."
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    />
                    <Input
                        label="Telefon"
                        placeholder="+49..."
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    />
                </div>

                <Input
                    label="Straße & Nr."
                    placeholder=""
                    value={formData.street}
                    onChange={(e) => setFormData({ ...formData, street: e.target.value })}
                />

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 'var(--spacing-md)' }}>
                    <Input
                        label="PLZ"
                        placeholder=""
                        value={formData.zip}
                        onChange={(e) => setFormData({ ...formData, zip: e.target.value })}
                    />
                    <Input
                        label="Ort"
                        placeholder=""
                        value={formData.city}
                        onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                    />
                </div>
            </Modal>

            {/* Invite Prompt Modal */}
            <Modal
                isOpen={!!invitePrompt}
                onClose={() => setInvitePrompt(null)}
                title="Mieter nicht registriert"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setInvitePrompt(null)}>Abbrechen</Button>
                        <Button onClick={() => {
                            setInvitePrompt(null);
                            navigate('/tenant-management');
                        }}>Ja, einladen</Button>
                    </>
                }
            >
                <div style={{ padding: '8px 0', fontSize: '0.95rem', lineHeight: 1.6 }}>
                    <p><strong>{invitePrompt?.contactName}</strong> ist noch nicht im Mieterportal registriert.</p>
                    <p style={{ marginTop: '8px' }}>Soll der Mieter eingeladen werden?</p>
                </div>
            </Modal>
        </div>
    );
};

export default Contacts;
