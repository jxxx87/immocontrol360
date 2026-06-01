import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import { Plus, Phone, Mail, MapPin, Loader2, User, Search, MoreVertical, Edit2, Trash2, Send, Home, Filter, AlertCircle, MessageSquare } from 'lucide-react';
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
    const [filterType, setFilterType] = useState('all');
    const [filterPropertyId, setFilterPropertyId] = useState('');
    const [properties, setProperties] = useState([]);
    const [editingContact, setEditingContact] = useState(null);
    const [invitePrompt, setInvitePrompt] = useState(null); // { contactName, tenantId }

    // Message modal state
    const [activeContactForMessage, setActiveContactForMessage] = useState(null);
    const [messageChannel, setMessageChannel] = useState('email');
    const [emailSubject, setEmailSubject] = useState('');
    const [emailContent, setEmailContent] = useState('');
    const [sendingMessage, setSendingMessage] = useState(false);
    const [smtpConfigured, setSmtpConfigured] = useState(true);

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
                .select(`
                    *,
                    tenant:tenants (
                        id,
                        leases (
                            id,
                            status,
                            unit:units (
                                id,
                                property_id
                            )
                        )
                    )
                `)
                .order('name', { ascending: true });

            if (error) throw error;
            setContacts(data || []);
        } catch (error) {
            console.error('Error fetching contacts:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchProperties = async () => {
        try {
            const { data, error } = await supabase
                .from('properties')
                .select('id, street, house_number')
                .order('street', { ascending: true });
            if (!error && data) {
                setProperties(data);
            }
        } catch (error) {
            console.error('Error fetching properties:', error);
        }
    };

    const checkSmtpSettings = async () => {
        if (!user) return;
        try {
            const { data } = await supabase
                .from('user_smtp_settings')
                .select('id')
                .eq('user_id', user.id)
                .maybeSingle();
            setSmtpConfigured(!!data);
        } catch (err) {
            console.error('Error checking SMTP settings:', err);
        }
    };

    useEffect(() => {
        if (user) {
            fetchContacts();
            fetchProperties();
            checkSmtpSettings();
        }
    }, [user]);

    const filteredContacts = useMemo(() => {
        let result = contacts;
        
        // Filter by Type
        if (filterType !== 'all') {
            result = result.filter(c => c.contact_type === filterType);
        }

        // Filter by Property (only if type is tenant and property filter is selected)
        if (filterType === 'tenant' && filterPropertyId) {
            result = result.filter(c => {
                if (!c.tenant) return false;
                const leases = c.tenant.leases || [];
                return leases.some(l => l.status === 'active' && l.unit?.property_id === filterPropertyId);
            });
        }
        
        // Filter by Search term
        if (!searchTerm) return result;
        const lowerTerm = searchTerm.toLowerCase();
        return result.filter(contact => {
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
    }, [contacts, filterType, filterPropertyId, searchTerm]);

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
    const handleMessage = (contact) => {
        setActiveContactForMessage(contact);
        setEmailSubject('');
        setEmailContent('');
        // For tenants, support portal channel, else only email
        if (contact.contact_type === 'tenant') {
            setMessageChannel('portal');
        } else {
            setMessageChannel('email');
        }
    };

    const handleSendMessageSubmit = async () => {
        if (!activeContactForMessage) return;

        if (messageChannel === 'portal') {
            // Run the tenant portal check and routing
            try {
                // Find matching tenant by email or name
                const { data: allTenants } = await supabase.from('tenants').select('id, first_name, last_name, email');
                let matchedTenant = null;

                if (activeContactForMessage.email) {
                    matchedTenant = (allTenants || []).find(t => t.email && t.email.toLowerCase() === activeContactForMessage.email.toLowerCase());
                }
                if (!matchedTenant && activeContactForMessage.name) {
                    matchedTenant = (allTenants || []).find(t => {
                        const fullName1 = `${t.last_name}, ${t.first_name}`.toLowerCase();
                        const fullName2 = `${t.first_name} ${t.last_name}`.toLowerCase();
                        const contactName = activeContactForMessage.name.toLowerCase();
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
                    setActiveContactForMessage(null);
                    navigate('/investor-messages', { state: { preSelectUserId: roles[0].user_id } });
                } else {
                    // Check if already invited but not yet registered
                    const { data: invitations } = await supabase
                        .from('tenant_invitations')
                        .select('status')
                        .eq('tenant_id', matchedTenant.id);

                    const pending = invitations?.find(i => i.status === 'pending');
                    if (pending) {
                        alert(`${activeContactForMessage.name} wurde bereits eingeladen, hat sich aber noch nicht registriert.`);
                    } else {
                        // Not invited yet → show prompt
                        setInvitePrompt({ contactName: activeContactForMessage.name, tenantId: matchedTenant.id });
                        setActiveContactForMessage(null);
                    }
                }
            } catch (err) {
                console.error('Error checking tenant status:', err);
                alert('Fehler bei der Prüfung des Mieterstatus.');
            }
            return;
        }

        if (messageChannel === 'email') {
            if (!activeContactForMessage.email) {
                alert('Dieser Kontakt hat keine E-Mailadresse hinterlegt.');
                return;
            }
            if (!emailSubject.trim() || !emailContent.trim()) {
                alert('Bitte Betreff und Nachricht eingeben.');
                return;
            }

            try {
                setSendingMessage(true);

                const { data, error } = await supabase.functions.invoke('send-letting-email', {
                    body: {
                        action: 'send_custom_email',
                        userId: user.id,
                        to: activeContactForMessage.email,
                        subject: emailSubject,
                        html: `
                            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
                                <div style="padding: 20px; color: #1e293b; line-height: 1.6;">
                                    <p>${emailContent.replace(/\n/g, '<br/>')}</p>
                                </div>
                            </div>
                        `
                    }
                });

                if (error) throw error;
                if (data?.error) throw new Error(data.error);

                alert('E-Mail wurde erfolgreich versendet!');
                setActiveContactForMessage(null);
            } catch (err) {
                alert('Fehler beim E-Mail-Versand: ' + err.message);
            } finally {
                setSendingMessage(false);
            }
            return;
        }

        if (messageChannel === 'epost') {
            alert('Die E-Post-Schnittstelle wird in Kürze implementiert.');
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

            {/* Search and Count */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', minWidth: '240px', maxWidth: '360px', flex: '1' }}>
                    <input
                        type="text"
                        placeholder="Kontakte suchen..."
                        className="search-input-padding"
                        style={{
                            width: '100%',
                            padding: '10px 12px 10px 44px',
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
                    <Search size={16} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                </div>
                
                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                    {filteredContacts.length} {filteredContacts.length === 1 ? 'Kontakt' : 'Kontakte'}
                </div>
            </div>

            {/* Filter Bar */}
            <div style={{ 
                marginBottom: 'var(--spacing-lg)', 
                display: 'flex', 
                alignItems: 'center', 
                gap: 'var(--spacing-md)', 
                flexWrap: 'wrap',
                backgroundColor: 'rgba(0, 0, 0, 0.02)',
                padding: '12px 16px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-color)'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Filter size={18} style={{ color: 'var(--text-secondary)' }} />
                    <span style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-secondary)' }}>Filter:</span>
                </div>
                
                <div>
                    <select
                        value={filterType}
                        onChange={e => {
                            setFilterType(e.target.value);
                            setFilterPropertyId(''); // Reset property filter when type changes
                        }}
                        style={{ 
                            padding: '8px 12px', 
                            borderRadius: '6px', 
                            border: '1px solid var(--border-color)', 
                            minWidth: '160px', 
                            fontSize: '0.875rem',
                            backgroundColor: 'var(--surface-color)',
                            color: 'var(--text-primary)',
                            outline: 'none',
                            cursor: 'pointer'
                        }}
                    >
                        <option value="all">Alle Kategorien</option>
                        <option value="tenant">Mieter</option>
                        <option value="vendor">Dienstleister</option>
                        <option value="guest">Gäste</option>
                        <option value="other">Sonstige</option>
                    </select>
                </div>

                {filterType === 'tenant' && (
                    <div>
                        <select
                            value={filterPropertyId}
                            onChange={e => setFilterPropertyId(e.target.value)}
                            style={{ 
                                padding: '8px 12px', 
                                borderRadius: '6px', 
                                border: '1px solid var(--border-color)', 
                                minWidth: '200px', 
                                fontSize: '0.875rem',
                                backgroundColor: 'var(--surface-color)',
                                color: 'var(--text-primary)',
                                outline: 'none',
                                cursor: 'pointer'
                            }}
                        >
                            <option value="">Alle Immobilien</option>
                            {properties.map(p => (
                                <option key={p.id} value={p.id}>{p.street} {p.house_number}</option>
                            ))}
                        </select>
                    </div>
                )}
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
            {/* Unified Messaging Modal */}
            <Modal
                isOpen={!!activeContactForMessage}
                onClose={() => setActiveContactForMessage(null)}
                title={`Nachricht an ${activeContactForMessage?.name || 'Kontakt'}`}
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setActiveContactForMessage(null)}>Abbrechen</Button>
                        <Button 
                            onClick={handleSendMessageSubmit} 
                            disabled={sendingMessage || (messageChannel === 'email' && !activeContactForMessage?.email)}
                        >
                            {sendingMessage ? 'Sendet...' : (messageChannel === 'portal' ? 'Weiter' : 'Nachricht senden')}
                        </Button>
                    </>
                }
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {/* Channel selection */}
                    <div>
                        <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '8px' }}>
                            Versandkanal wählen
                        </label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                            <button
                                type="button"
                                onClick={() => setMessageChannel('email')}
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    padding: '12px 8px',
                                    borderRadius: '8px',
                                    border: `2px solid ${messageChannel === 'email' ? 'var(--primary-color)' : 'var(--border-color)'}`,
                                    backgroundColor: messageChannel === 'email' ? 'rgba(14,165,233,0.04)' : 'var(--surface-color)',
                                    color: messageChannel === 'email' ? 'var(--primary-color)' : 'var(--text-secondary)',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s',
                                    gap: '6px'
                                }}
                            >
                                <Mail size={20} />
                                <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>E-Mail</span>
                            </button>
                            
                            <button
                                type="button"
                                disabled={activeContactForMessage?.contact_type !== 'tenant'}
                                onClick={() => setMessageChannel('portal')}
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    padding: '12px 8px',
                                    borderRadius: '8px',
                                    border: `2px solid ${messageChannel === 'portal' ? 'var(--primary-color)' : 'var(--border-color)'}`,
                                    backgroundColor: messageChannel === 'portal' ? 'rgba(14,165,233,0.04)' : 'var(--surface-color)',
                                    color: messageChannel === 'portal' ? 'var(--primary-color)' : 'var(--text-secondary)',
                                    cursor: activeContactForMessage?.contact_type === 'tenant' ? 'pointer' : 'not-allowed',
                                    opacity: activeContactForMessage?.contact_type === 'tenant' ? 1 : 0.4,
                                    transition: 'all 0.2s',
                                    gap: '6px'
                                }}
                                title={activeContactForMessage?.contact_type !== 'tenant' ? 'Nur für Mieter verfügbar' : ''}
                            >
                                <MessageSquare size={20} />
                                <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>Mieterportal</span>
                            </button>

                            <button
                                type="button"
                                onClick={() => setMessageChannel('epost')}
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    padding: '12px 8px',
                                    borderRadius: '8px',
                                    border: `2px solid ${messageChannel === 'epost' ? 'var(--primary-color)' : 'var(--border-color)'}`,
                                    backgroundColor: messageChannel === 'epost' ? 'rgba(14,165,233,0.04)' : 'var(--surface-color)',
                                    color: messageChannel === 'epost' ? 'var(--primary-color)' : 'var(--text-secondary)',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s',
                                    gap: '6px'
                                }}
                            >
                                <FileText size={20} />
                                <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>E-Post (Brief)</span>
                            </button>
                        </div>
                    </div>

                    {/* Email Channel Content */}
                    {messageChannel === 'email' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {!activeContactForMessage?.email ? (
                                <div style={{
                                    display: 'flex',
                                    gap: '8px',
                                    padding: '12px',
                                    backgroundColor: '#FFFBEB',
                                    border: '1px solid #FDE68A',
                                    borderRadius: '8px',
                                    color: '#92400E',
                                    fontSize: '0.85rem'
                                }}>
                                    <AlertCircle size={18} style={{ flexShrink: 0 }} />
                                    <span>Für diesen Kontakt ist keine E-Mailadresse hinterlegt. Bitte fügen Sie erst eine E-Mailadresse hinzu.</span>
                                </div>
                            ) : (
                                <>
                                    {!smtpConfigured && (
                                        <div style={{
                                            display: 'flex',
                                            gap: '8px',
                                            padding: '10px 12px',
                                            backgroundColor: '#FFFBEB',
                                            border: '1px solid #FDE68A',
                                            borderRadius: '8px',
                                            color: '#92400E',
                                            fontSize: '0.8rem'
                                        }}>
                                            <AlertCircle size={16} style={{ flexShrink: 0 }} />
                                            <span>Hinweis: Kein eigener E-Mail-Server in den Einstellungen eingerichtet. Versand erfolgt über System-Fallback.</span>
                                        </div>
                                    )}

                                    <Input
                                        label="Betreff"
                                        placeholder="Ihre Nachricht von ..."
                                        value={emailSubject}
                                        onChange={e => setEmailSubject(e.target.value)}
                                        required
                                    />

                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '6px' }}>
                                            Nachricht *
                                        </label>
                                        <textarea
                                            rows={6}
                                            style={{
                                                width: '100%',
                                                padding: '10px 12px',
                                                borderRadius: 'var(--radius-md)',
                                                border: '1px solid var(--border-color)',
                                                outline: 'none',
                                                backgroundColor: 'var(--surface-color)',
                                                color: 'var(--text-primary)',
                                                fontSize: '0.9rem',
                                                resize: 'vertical',
                                                fontFamily: 'sans-serif'
                                            }}
                                            placeholder="Guten Tag..."
                                            value={emailContent}
                                            onChange={e => setEmailContent(e.target.value)}
                                            required
                                        />
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {/* Mieterportal Channel Content */}
                    {messageChannel === 'portal' && (
                        <div style={{
                            display: 'flex',
                            gap: '10px',
                            padding: '12px',
                            backgroundColor: 'rgba(16, 185, 129, 0.05)',
                            border: '1px solid rgba(16, 185, 129, 0.2)',
                            borderRadius: '8px',
                            color: '#065f46',
                            fontSize: '0.875rem',
                            lineHeight: 1.5
                        }}>
                            <MessageSquare size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
                            <span>
                                Sie werden zum Mieterportal-Chat weitergeleitet. Dort können Sie direkt mit dem Mieter schreiben oder ihn einladen, falls er noch nicht registriert ist.
                            </span>
                        </div>
                    )}

                    {/* E-Post Channel Content */}
                    {messageChannel === 'epost' && (
                        <div style={{
                            display: 'flex',
                            gap: '10px',
                            padding: '12px',
                            backgroundColor: '#F0F9FF',
                            border: '1px solid #B9E6FE',
                            borderRadius: '8px',
                            color: '#0369A1',
                            fontSize: '0.875rem',
                            lineHeight: 1.5
                        }}>
                            <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
                            <span>
                                Der physische Briefversand per E-Post-Schnittstelle wird in Kürze freigeschaltet. Sie können hiermit Dokumente und Briefe direkt aus der Anwendung drucken und per Post senden lassen.
                            </span>
                        </div>
                    )}
                </div>
            </Modal>
        </div>
    );
};

export default Contacts;
