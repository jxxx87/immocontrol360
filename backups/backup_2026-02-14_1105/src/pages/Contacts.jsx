import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Table from '../components/ui/Table';
import Badge from '../components/ui/Badge';
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
    const [contacts, setContacts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [editingContact, setEditingContact] = useState(null);

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

    const columns = [
        {
            header: 'Name',
            accessor: 'name',
            render: (row) => (
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    <div style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        backgroundColor: 'var(--background-color)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginRight: 'var(--spacing-md)',
                        color: 'var(--text-secondary)'
                    }}>
                        <User size={16} />
                    </div>
                    <span style={{ fontWeight: 600 }}>{row.name}</span>
                </div>
            )
        },
        {
            header: 'Kategorie',
            accessor: 'contact_type',
            render: (row) => {
                const map = {
                    'guest': 'Gast',
                    'tenant': 'Mieter',
                    'vendor': 'Dienstleister',
                    'other': 'Sonstiges'
                };
                return <Badge variant={row.contact_type === 'vendor' ? 'blue' : 'default'}>
                    {map[row.contact_type] || row.contact_type}
                </Badge>;
            }
        },
        {
            header: 'Kontakt',
            accessor: 'contact',
            render: (row) => (
                <div>
                    {row.phone && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                            <Phone size={12} /> {row.phone}
                        </div>
                    )}
                    {row.email && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                            <Mail size={12} /> {row.email}
                        </div>
                    )}
                </div>
            )
        },
        {
            header: 'Einheit',
            accessor: 'unit_name',
            render: (row) => row.contact_type === 'tenant' ? (
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                    {row.unit_name || '—'}
                </div>
            ) : null
        },
        {
            header: 'Adresse',
            accessor: 'address',
            render: (row) => (
                <div style={{ fontSize: '0.875rem' }}>
                    {row.street && <div>{row.street}</div>}
                    {(row.zip || row.city) && <div style={{ color: 'var(--text-secondary)' }}>{row.zip} {row.city}</div>}
                </div>
            )
        },
        {
            header: 'Aktionen',
            accessor: 'actions',
            align: 'right',
            render: (row) => (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <ActionMenu
                        onEdit={() => handleOpenEdit(row)}
                        onDelete={() => handleDelete(row.id)}
                        onMessage={() => alert('Nachricht senden: Funktion folgt.')}
                    />
                </div>
            )
        }
    ];

    if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '50px' }}><Loader2 className="animate-spin" /></div>;

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-xl)' }}>
                <div>
                    <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: 'var(--spacing-xs)' }}>Kontakte</h1>
                    <p style={{ color: 'var(--text-secondary)' }}>Dienstleister, Mieter und Partner verwalten</p>
                </div>
                <Button icon={Plus} onClick={handleOpenAdd}>Kontakt erstellen</Button>
            </div>

            <Card>
                <div style={{ marginBottom: 'var(--spacing-md)' }}>
                    <div style={{ position: 'relative', maxWidth: '400px' }}>
                        <input
                            type="text"
                            placeholder="Suchen..."
                            style={{
                                width: '100%',
                                padding: '0.5rem 0.5rem 0.5rem 2rem',
                                borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--border-color)',
                                outline: 'none'
                            }}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                        <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#9CA3AF' }} />
                    </div>
                </div>

                {filteredContacts.length === 0 ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        Keine Kontakte gefunden.
                    </div>
                ) : (
                    <>
                        <div className="hidden-mobile">
                            <Table columns={columns} data={filteredContacts} />
                        </div>

                        {/* Mobile Card View */}
                        <div className="hidden-desktop" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                            {filteredContacts.map((row) => (
                                <div key={row.id} style={{
                                    border: '1px solid var(--border-color)',
                                    borderRadius: 'var(--radius-md)',
                                    padding: 'var(--spacing-md)',
                                    backgroundColor: 'var(--surface-color)',
                                    position: 'relative'
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center' }}>
                                            <div style={{
                                                width: '32px',
                                                height: '32px',
                                                borderRadius: '50%',
                                                backgroundColor: 'var(--background-color)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                marginRight: 'var(--spacing-md)',
                                                color: 'var(--text-secondary)'
                                            }}>
                                                <User size={16} />
                                            </div>
                                            <div>
                                                <div style={{ fontWeight: 600 }}>{row.name}</div>
                                                <div style={{ fontSize: '0.8rem', marginTop: '2px' }}>
                                                    {(() => {
                                                        const map = {
                                                            'guest': 'Gast',
                                                            'tenant': 'Mieter',
                                                            'vendor': 'Dienstleister',
                                                            'other': 'Sonstiges'
                                                        };
                                                        return <Badge variant={row.contact_type === 'vendor' ? 'blue' : 'default'} size="sm">
                                                            {map[row.contact_type] || row.contact_type}
                                                        </Badge>;
                                                    })()}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.85rem', marginBottom: '12px' }}>
                                        {row.phone && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)' }}>
                                                <Phone size={14} /> {row.phone}
                                            </div>
                                        )}
                                        {row.email && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)' }}>
                                                <Mail size={14} /> {row.email}
                                            </div>
                                        )}
                                        {(row.street || row.city) && (
                                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', color: 'var(--text-secondary)' }}>
                                                <MapPin size={14} style={{ marginTop: '2px' }} />
                                                <div>
                                                    {row.street && <div>{row.street}</div>}
                                                    {(row.zip || row.city) && <div>{row.zip} {row.city}</div>}
                                                </div>
                                            </div>
                                        )}
                                        {row.contact_type === 'tenant' && row.unit_name && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)' }}>
                                                <Home size={14} /> {row.unit_name}
                                            </div>
                                        )}
                                    </div>

                                    <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '12px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                                        <ActionMenu
                                            onEdit={() => handleOpenEdit(row)}
                                            onDelete={() => handleDelete(row.id)}
                                            onMessage={() => alert('Nachricht senden: Funktion folgt.')}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </Card>

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
        </div>
    );
};

export default Contacts;
