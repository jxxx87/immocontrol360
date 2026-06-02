import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Table from '../components/ui/Table';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import CurrencyInput from '../components/ui/CurrencyInput';
import { Plus, Building2, ChevronDown, ChevronRight, MoreVertical, Edit, Edit3, Trash2, AlertCircle, Home, Key, LayoutGrid, List, Check, Filter, Upload, Image, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { usePortfolio } from '../context/PortfolioContext';
import { useAuth } from '../context/AuthContext';
import { translateError } from '../lib/errorTranslator';
import { useViewMode } from '../context/ViewModeContext';
import { useSubscription } from '../context/SubscriptionContext';
import ExportDropdown from '../components/ExportDropdown';

import LoadingOverlay from '../components/ui/LoadingOverlay';

// Loan Helper functions
const calculateCurrentDebt = (loan) => {
    const originalAmount = parseFloat(loan.loan_amount || 0);
    const interestRate = parseFloat(loan.interest_rate || 0) / 100;
    let monthlyPayment = parseFloat(loan.fixed_annuity || 0);

    if (!monthlyPayment) {
        const repaymentRate = parseFloat(loan.initial_repayment_rate || 0) / 100;
        monthlyPayment = (originalAmount * (interestRate + repaymentRate)) / 12;
    }

    const hasActual = loan.actual_residual_debt !== null && loan.actual_residual_debt !== undefined;
    const amount = hasActual ? parseFloat(loan.actual_residual_debt) : originalAmount;
    const startDateStr = hasActual && loan.actual_residual_debt_date ? loan.actual_residual_debt_date : loan.start_date;

    if (!startDateStr) return amount;
    
    const startDate = new Date(startDateStr);
    let endDateTarget = loan.end_date ? new Date(loan.end_date) : null;

    if (!endDateTarget || isNaN(endDateTarget.getTime())) {
        endDateTarget = new Date(startDate);
        endDateTarget.setFullYear(endDateTarget.getFullYear() + 50);
    }

    const validUntil = new Date(); // TODAY

    let currentBalance = amount;
    let currentDate = new Date(startDate);

    let months = 0;
    while (currentBalance > 0.01 && months < 600) {
        if (currentDate > validUntil) break;
        const monthlyInterest = currentBalance * interestRate / 12;
        const principal = monthlyPayment - monthlyInterest;
        const endBalance = currentBalance - principal;

        currentBalance = endBalance < 0 ? 0 : endBalance;
        currentDate.setMonth(currentDate.getMonth() + 1);
        months++;
    }

    return currentBalance;
};

const calculateMonthlyPayment = (loan) => {
    if (loan.fixed_annuity) return parseFloat(loan.fixed_annuity);
    const originalAmount = parseFloat(loan.loan_amount || 0);
    const interestRate = parseFloat(loan.interest_rate || 0) / 100;
    const repaymentRate = parseFloat(loan.initial_repayment_rate || 0) / 100;
    return (originalAmount * (interestRate + repaymentRate)) / 12;
};


// CloudImage Component
const CloudImage = ({ provider, itemId, fallbackIcon: FallbackIcon, style, premiumView = false }) => {
    const [imgSrc, setImgSrc] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!itemId) {
            setLoading(false);
            return;
        }
        let isMounted = true;
        const loadThumbnail = async () => {
            try {
                const { data, error } = await supabase.functions.invoke('cloud-drive', {
                    body: { 
                        action: 'get_download_link', 
                        provider: provider || 'onedrive',
                        itemId: itemId
                    }
                });
                if (!error && data && data.downloadUrl && isMounted) {
                    setImgSrc(data.downloadUrl);
                }
            } catch (e) {
                console.error("Error loading thumbnail:", e);
            } finally {
                if (isMounted) setLoading(false);
            }
        };
        loadThumbnail();
        return () => { isMounted = false; };
    }, [itemId, provider]);

    if (loading) {
        return (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: 'var(--radius-sm)', ...style }}>
                <Loader2 className="animate-spin" size={16} color="var(--primary-color)" />
            </div>
        );
    }

    if (!imgSrc) {
        return (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.05)', color: 'var(--text-secondary)', borderRadius: 'var(--radius-sm)', ...style }}>
                <FallbackIcon size={24} strokeWidth={1.5} />
            </div>
        );
    }

    if (premiumView) {
        return (
            <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', borderRadius: 'var(--radius-sm)', ...style }}>
                {/* Blurred background glow */}
                <img 
                    src={imgSrc} 
                    alt="" 
                    style={{ 
                        position: 'absolute', 
                        top: '-10px', 
                        left: '-10px', 
                        width: 'calc(100% + 20px)', 
                        height: 'calc(100% + 20px)', 
                        objectFit: 'cover', 
                        filter: 'blur(8px) brightness(0.6)', 
                        zIndex: 1 
                    }} 
                />
                {/* Main uncropped image */}
                <img 
                    src={imgSrc} 
                    alt="Vorschau" 
                    style={{ 
                        position: 'relative', 
                        width: '100%', 
                        height: '100%', 
                        objectFit: 'contain', 
                        zIndex: 2 
                    }} 
                    onError={() => setImgSrc(null)}
                />
            </div>
        );
    }

    return (
        <img 
            src={imgSrc} 
            alt="Vorschau" 
            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'var(--radius-sm)', ...style }} 
            onError={() => setImgSrc(null)}
        />
    );
};

// CloudImageManager Component
const CloudImageManager = ({ 
    provider, 
    propertyFolderName, 
    relativePath, 
    currentThumbnailId, 
    onSelectThumbnail,
    isNewEntity,
    localFiles = [],
    onLocalFilesChange,
    pendingThumbnailIndex,
    onSelectPendingThumbnail
}) => {
    const [images, setImages] = useState([]);
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const fileInputRef = React.useRef(null);

    const fullPath = propertyFolderName + (relativePath ? '/' + relativePath : '');

    const fetchImages = async () => {
        if (isNewEntity || !propertyFolderName) return;
        setLoading(true);
        try {
            const { data, error } = await supabase.functions.invoke('cloud-drive', {
                body: { 
                    action: 'list', 
                    provider: provider || 'onedrive',
                    path: fullPath
                }
            });
            if (error) throw error;
            const list = (data?.files || []).filter(f => 
                !f.isFolder && f.name.toLowerCase().match(/\.(jpg|jpeg|png|gif|webp)$/)
            );
            setImages(list);
        } catch (e) {
            console.error("Error fetching images:", e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchImages();
    }, [provider, propertyFolderName, relativePath, isNewEntity]);

    const handleUpload = async (e) => {
        if (isNewEntity) {
            const selectedFiles = Array.from(e.target.files || []);
            if (selectedFiles.length > 0) {
                onLocalFilesChange([...localFiles, ...selectedFiles]);
                if (pendingThumbnailIndex === null || pendingThumbnailIndex === undefined) {
                    onSelectPendingThumbnail(0);
                }
            }
            if (fileInputRef.current) fileInputRef.current.value = '';
            return;
        }

        const file = e.target.files?.[0];
        if (!file || !propertyFolderName) return;
        setUploading(true);
        try {
            const formData = new FormData();
            formData.append('action', 'upload');
            formData.append('provider', provider || 'onedrive');
            formData.append('path', fullPath);
            formData.append('file', file);
            
            const { data, error } = await supabase.functions.invoke('cloud-drive', {
                body: formData
            });
            if (error) throw error;
            fetchImages();
        } catch (err) {
            console.error("Upload error:", err);
            alert("Fehler beim Hochladen des Bildes.");
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleDeleteCloudImage = async (e, imgId) => {
        e.stopPropagation();
        if (!confirm("Möchten Sie dieses Bild wirklich aus der Cloud löschen?")) return;
        setLoading(true);
        try {
            const { error } = await supabase.functions.invoke('cloud-drive', {
                body: { 
                    action: 'delete', 
                    provider: provider || 'onedrive',
                    itemId: imgId
                }
            });
            if (error) throw error;
            if (imgId === currentThumbnailId) {
                onSelectThumbnail(null);
            }
            fetchImages();
        } catch (err) {
            console.error("Delete image error:", err);
            alert("Fehler beim Löschen des Bildes.");
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteLocalFile = (e, idx) => {
        e.stopPropagation();
        const updated = localFiles.filter((_, i) => i !== idx);
        onLocalFilesChange(updated);
        
        if (pendingThumbnailIndex === idx) {
            onSelectPendingThumbnail(updated.length > 0 ? 0 : null);
        } else if (pendingThumbnailIndex > idx) {
            onSelectPendingThumbnail(pendingThumbnailIndex - 1);
        }
    };

    return (
        <div style={{
            backgroundColor: 'rgba(0,0,0,0.02)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--spacing-md)',
            marginTop: 'var(--spacing-sm)'
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    {isNewEntity ? 'Lokale Bilder (Werden beim Speichern hochgeladen)' : 'Bilder in der Cloud'}
                </span>
                <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleUpload} 
                    style={{ display: 'none' }} 
                    accept="image/*"
                    multiple={isNewEntity}
                />
                <Button 
                    type="button"
                    variant="secondary"
                    size="sm" 
                    icon={uploading ? undefined : Upload} 
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading || loading}
                >
                    {uploading ? 'Wird hochgeladen...' : 'Bilder hinzufügen'}
                </Button>
            </div>

            {loading ? (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                    <Loader2 className="animate-spin" size={20} style={{ margin: '0 auto 8px', color: 'var(--primary-color)' }} />
                    Lade Bilder aus der Cloud...
                </div>
            ) : isNewEntity ? (
                localFiles.length === 0 ? (
                    <div style={{
                        padding: '24px',
                        textAlign: 'center',
                        color: 'var(--text-secondary)',
                        fontSize: '0.85rem',
                        border: '1px dashed var(--border-color)',
                        borderRadius: 'var(--radius-md)',
                        backgroundColor: 'var(--surface-color)'
                    }}>
                        Keine Bilder ausgewählt. Klicken Sie auf "Bilder hinzufügen".
                    </div>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '12px', maxHeight: '200px', overflowY: 'auto', padding: '4px' }}>
                        {localFiles.map((file, idx) => {
                            const isSelected = idx === pendingThumbnailIndex;
                            const previewUrl = URL.createObjectURL(file);
                            return (
                                <div 
                                    key={idx}
                                    onClick={() => onSelectPendingThumbnail(idx)}
                                    style={{
                                        position: 'relative',
                                        aspectRatio: '1.25',
                                        cursor: 'pointer',
                                        border: isSelected ? '2px solid var(--primary-color)' : '1px solid var(--border-color)',
                                        borderRadius: 'var(--radius-md)',
                                        overflow: 'hidden',
                                        boxShadow: isSelected ? '0 0 0 2px rgba(59, 130, 246, 0.2)' : 'var(--shadow-sm)',
                                        transition: 'all 0.15s ease',
                                        transform: isSelected ? 'scale(1.02)' : 'none'
                                    }}
                                >
                                    <img 
                                        src={previewUrl} 
                                        alt="Vorschau" 
                                        style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                                    />
                                    
                                    {isSelected && (
                                        <div style={{
                                            position: 'absolute',
                                            top: '4px',
                                            left: '4px',
                                            backgroundColor: 'var(--primary-color)',
                                            color: 'white',
                                            borderRadius: '12px',
                                            padding: '2px 6px',
                                            fontSize: '0.65rem',
                                            fontWeight: 700,
                                            boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                                        }}>
                                            Titelbild
                                        </div>
                                    )}

                                    <button
                                        type="button"
                                        onClick={(e) => handleDeleteLocalFile(e, idx)}
                                        style={{
                                            position: 'absolute',
                                            top: '4px',
                                            right: '4px',
                                            backgroundColor: 'rgba(239, 68, 68, 0.9)',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '50%',
                                            width: '20px',
                                            height: '20px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            cursor: 'pointer',
                                            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                                            transition: 'transform 0.15s'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
                                        onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )
            ) : (
                images.length === 0 ? (
                    <div style={{
                        padding: '24px',
                        textAlign: 'center',
                        color: 'var(--text-secondary)',
                        fontSize: '0.85rem',
                        border: '1px dashed var(--border-color)',
                        borderRadius: 'var(--radius-md)',
                        backgroundColor: 'var(--surface-color)'
                    }}>
                        Keine Bilder in der Cloud unter /Bilder vorhanden.
                    </div>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '12px', maxHeight: '200px', overflowY: 'auto', padding: '4px' }}>
                        {images.map(img => {
                            const isSelected = img.id === currentThumbnailId;
                            return (
                                <div 
                                    key={img.id}
                                    onClick={() => onSelectThumbnail(img.id)}
                                    style={{
                                        position: 'relative',
                                        aspectRatio: '1.25',
                                        cursor: 'pointer',
                                        border: isSelected ? '2px solid var(--primary-color)' : '1px solid var(--border-color)',
                                        borderRadius: 'var(--radius-md)',
                                        overflow: 'hidden',
                                        boxShadow: isSelected ? '0 0 0 2px rgba(59, 130, 246, 0.2)' : 'var(--shadow-sm)',
                                        transition: 'all 0.15s ease',
                                        transform: isSelected ? 'scale(1.02)' : 'none'
                                    }}
                                >
                                    <CloudImage provider={provider} itemId={img.id} fallbackIcon={Home} />
                                    
                                    {isSelected && (
                                        <div style={{
                                            position: 'absolute',
                                            top: '4px',
                                            left: '4px',
                                            backgroundColor: 'var(--primary-color)',
                                            color: 'white',
                                            borderRadius: '12px',
                                            padding: '2px 6px',
                                            fontSize: '0.65rem',
                                            fontWeight: 700,
                                            boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                                        }}>
                                            Titelbild
                                        </div>
                                    )}

                                    <button
                                        type="button"
                                        onClick={(e) => handleDeleteCloudImage(e, img.id)}
                                        style={{
                                            position: 'absolute',
                                            top: '4px',
                                            right: '4px',
                                            backgroundColor: 'rgba(239, 68, 68, 0.9)',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '50%',
                                            width: '20px',
                                            height: '20px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            cursor: 'pointer',
                                            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                                            transition: 'transform 0.15s'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
                                        onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )
            )}
        </div>
    );
};

const resolveCloudConnection = async (portfolioId) => {
    if (!portfolioId) return null;
    try {
        const { data: linkData } = await supabase
            .from('portfolio_cloud_links')
            .select('cloud_connection_id')
            .eq('portfolio_id', portfolioId)
            .maybeSingle();

        if (linkData?.cloud_connection_id) {
            const { data: connData } = await supabase
                .from('cloud_connections')
                .select('*')
                .eq('id', linkData.cloud_connection_id)
                .maybeSingle();
            return connData;
        }

        const { data: fallbackConns } = await supabase
            .from('cloud_connections')
            .select('*')
            .limit(1);
        if (fallbackConns && fallbackConns.length > 0) {
            return fallbackConns[0];
        }
    } catch (e) {
        console.error("Error resolving cloud connection:", e);
    }
    return null;
};

const getPropertyFolderName = (property, allProperties = []) => {
    if (!property) return '';
    
    if (property.isGroup) {
        return property.displayFolderName || '';
    }
    
    if (property.economic_unit_id) {
        const members = allProperties.filter(p => p.economic_unit_id === property.economic_unit_id);
        if (members.length > 0) {
            const groupedByStreet = {};
            members.forEach(m => {
                if (!m.street) return;
                if (!groupedByStreet[m.street]) groupedByStreet[m.street] = [];
                if (m.house_number) {
                    groupedByStreet[m.street].push(m.house_number);
                }
            });
            const parts = Object.keys(groupedByStreet).map(street => {
                const nums = groupedByStreet[street];
                if (nums.length > 0) {
                    return `${street} ${nums.join(' & ')}`;
                }
                return street;
            });
            const displayNames = parts.slice(0, 2).join(' | ');
            const groupName = parts.length > 2 ? `${displayNames} u.a.` : displayNames;
            return `WG: ${groupName || 'Wirtschaftsgemeinschaft'}`;
        }
    }
    
    return `${property.street || ''} ${property.house_number || ''}`.trim();
};

const Properties = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { user } = useAuth();
    const { selectedPortfolioID, portfolios } = usePortfolio();
    const { checkUsageLimit, checkGlobalAccess } = useSubscription();
    const { isMobile } = useViewMode();
    const [properties, setProperties] = useState([]);
    const [loans, setLoans] = useState([]);
    const [economicUnits, setEconomicUnits] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [returnTo, setReturnTo] = useState(null); // Track where to redirect after save
    const [searchTerm, setSearchTerm] = useState('');
    const [viewMode, setViewMode] = useState(() => localStorage.getItem('properties_view_mode') || 'grid');
    const [newPropertyImages, setNewPropertyImages] = useState([]);
    const [newUnitImages, setNewUnitImages] = useState([]);
    const [pendingPropertyThumbnailIndex, setPendingPropertyThumbnailIndex] = useState(null);
    const [pendingUnitThumbnailIndex, setPendingUnitThumbnailIndex] = useState(null);
    const [propertyProvider, setPropertyProvider] = useState('onedrive');
    const [unitProvider, setUnitProvider] = useState('onedrive');

    // Property Modal State
    const [isPropertyModalOpen, setIsPropertyModalOpen] = useState(false);
    const [propertyForm, setPropertyForm] = useState({
        portfolio_id: '',
        street: '',
        house_number: '',
        zip: '',
        city: '',
        construction_year: '',
        property_type: 'residential', // residential, commercial, mixed
        economic_unit_members: [], // Array of property IDs
        _original_economic_unit_id: null
    });

    // Units and Group Logic
    const [expandedPropertyId, setExpandedPropertyId] = useState(null);
    const [expandedWEId, setExpandedWEId] = useState(null); // For Economic Units
    const [units, setUnits] = useState({}); // Map: propertyId -> [units]
    const [loadingUnits, setLoadingUnits] = useState({}); // Map: propertyId -> boolean

    // Unit Modal State
    const [isUnitModalOpen, setIsUnitModalOpen] = useState(false);
    const [currentPropertyForUnit, setCurrentPropertyForUnit] = useState(null);
    const [editingUnitId, setEditingUnitId] = useState(null); // Track if editing
    const [unitForm, setUnitForm] = useState({
        unit_name: '',
        floor: '',
        sqm: '',
        rooms: '',
        bathrooms: 1,
        bedrooms: 1,
        balcony: false,
        fitted_kitchen: false,
        is_vacation_rental: false,
        cold_rent_ist: '', service_charge_soll: '', heating_cost_soll: '', other_costs_soll: '', deposit_soll: ''
    });

    // Unit Action Menu State
    const [openActionMenuId, setOpenActionMenuId] = useState(null);
    const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });

    // Property Action Menu State
    const [openPropertyActionMenuId, setOpenPropertyActionMenuId] = useState(null);
    const [propertyMenuPos, setPropertyMenuPos] = useState({ top: 0, left: 0 });
    const [editingPropertyId, setEditingPropertyId] = useState(null);

    useEffect(() => {
        localStorage.setItem('properties_view_mode', viewMode);
    }, [viewMode]);

    // Fetch Properties with Aggregated Data
    const fetchProperties = async () => {
        try {
            setLoading(true);
            let query = supabase
                .from('properties')
                .select(`
                    *,
                    units (
                        id,
                        unit_name,
                        floor,
                        sqm,
                        rooms,
                        target_rent,
                        cold_rent_ist,
                        is_vacation_rental,
                        balcony,
                        fitted_kitchen,
                        leases (
                            cold_rent,
                            status
                        )
                    )
                `)
                .order('street');

            if (selectedPortfolioID) {
                query = query.eq('portfolio_id', selectedPortfolioID);
            }

            const { data, error } = await query;
            if (error) throw error;

            // Fetch Loans
            let loanQuery = supabase.from('loans').select('*');
            if (selectedPortfolioID) {
                loanQuery = loanQuery.eq('portfolio_id', selectedPortfolioID);
            }
            const { data: loanData, error: loanError } = await loanQuery;
            if (loanError) throw loanError;

            setLoans(loanData || []);

            // Fetch Economic Units
            const { data: weData, error: weError } = await supabase.from('economic_units').select('*');
            if (weError) throw weError;
            setEconomicUnits(weData || []);

            // Fetch cloud connections & links to map providers
            const { data: connData } = await supabase.from('cloud_connections').select('id, provider');
            const { data: linkData } = await supabase.from('portfolio_cloud_links').select('portfolio_id, cloud_connection_id');
            const providerMap = {};
            const defaultProvider = connData && connData.length > 0 ? connData[0].provider : 'onedrive';
            if (linkData && connData) {
                linkData.forEach(link => {
                    const conn = connData.find(c => c.id === link.cloud_connection_id);
                    if (conn) {
                        providerMap[link.portfolio_id] = conn.provider;
                    }
                });
            }

            // Calculate Aggregations
            const propertiesWithStats = data.map(p => {
                const units = p.units || [];
                const totalUnits = units.length;
                const totalArea = units.reduce((sum, u) => sum + (u.sqm || 0), 0);
                const totalTargetRent = units.reduce((sum, u) => sum + (u.target_rent || 0), 0);

                // Calculate Actual Rent (Sum of active leases' cold_rent)
                const totalActualRent = units.reduce((sum, u) => {
                    if (u.is_vacation_rental) return sum + (parseFloat(u.cold_rent_ist) || parseFloat(u.target_rent) || 0);
                    const activeLease = u.leases?.find(l => l.status === 'active');
                    return sum + (activeLease ? (parseFloat(activeLease.cold_rent) || 0) : 0);
                }, 0);

                // Calculate Loan Stats
                const propLoans = (loanData || []).filter(l => l.property_id === p.id);
                const remainingDebt = propLoans.reduce((sum, l) => sum + calculateCurrentDebt(l), 0);
                const monthlyLoanPayment = propLoans.reduce((sum, l) => sum + calculateMonthlyPayment(l), 0);

                return {
                    ...p,
                    cloud_provider: providerMap[p.portfolio_id] || defaultProvider,
                    remaining_debt: remainingDebt,
                    monthly_loan_payment: monthlyLoanPayment,
                    stats: {
                        totalUnits,
                        totalArea,
                        totalTargetRent,
                        totalActualRent
                    }
                };
            });

            setProperties(propertiesWithStats || []);

            // If expanded property is no longer in list (e.g. portfolio switch), collapse
            if (expandedPropertyId && data && !data.find(p => p.id === expandedPropertyId)) {
                setExpandedPropertyId(null);
            }
        } catch (error) {
            console.error('Error fetching properties:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (user) {
            fetchProperties();
        }
    }, [user, selectedPortfolioID]);



    // Fetch Units for a Property
    const fetchUnitsForProperty = async (propertyId) => {
        try {
            setLoadingUnits(prev => ({ ...prev, [propertyId]: true }));
            const { data, error } = await supabase
                .from('units')
                .select('*, leases(status, start_date, end_date, cold_rent)')
                .eq('property_id', propertyId)
                .order('unit_name');

            if (error) throw error;

            const today = new Date().toISOString().split('T')[0];
            const processedUnits = (data || []).map(u => {
                if (u.is_vacation_rental) {
                    return { ...u, status: 'vacation_rental' };
                }
                const activeLease = u.leases?.find(l =>
                    l.status === 'active' &&
                    l.start_date <= today &&
                    (!l.end_date || l.end_date >= today)
                );
                return { ...u, status: activeLease ? 'rented' : 'vacant' };
            });

            setUnits(prev => ({ ...prev, [propertyId]: processedUnits }));
        } catch (error) {
            console.error('Error fetching units:', error);
        } finally {
            setLoadingUnits(prev => ({ ...prev, [propertyId]: false }));
        }
    };

    const toggleExpand = (propertyId) => {
        if (expandedPropertyId === propertyId) {
            setExpandedPropertyId(null);
        } else {
            setExpandedPropertyId(propertyId);
            fetchUnitsForProperty(propertyId);
        }
    };

    // Save Property
    const handleSaveProperty = async () => {
        if (!propertyForm.portfolio_id && portfolios.length > 0) {
            alert('Bitte wählen Sie ein Portfolio aus.');
            return;
        }

        try {
            setIsSaving(true);
            
            let finalEconomicUnitId = propertyForm._original_economic_unit_id;

            if (propertyForm.economic_unit_members && propertyForm.economic_unit_members.length > 0) {
                if (!finalEconomicUnitId) {
                    finalEconomicUnitId = crypto.randomUUID();
                }
            } else {
                // No members selected, current property leaves the unit
                finalEconomicUnitId = null;
            }

            // If it is part of an economic unit, save these values to economic_units table
            if (finalEconomicUnitId) {
                const weData = {
                    id: finalEconomicUnitId,
                    user_id: user.id,
                    total_investment_cost: parseFloat(propertyForm.total_investment_cost) || 0,
                    equity_invested: parseFloat(propertyForm.equity_invested) || 0,
                    updated_at: new Date().toISOString()
                };
                const { error: weError } = await supabase
                    .from('economic_units')
                    .upsert(weData, { onConflict: 'id' });
                if (weError) throw weError;
            }

            const propData = {
                user_id: user.id,
                portfolio_id: propertyForm.portfolio_id || null,
                street: propertyForm.street,
                house_number: propertyForm.house_number,
                zip: propertyForm.zip,
                city: propertyForm.city,
                construction_year: parseInt(propertyForm.construction_year) || null,
                property_type: propertyForm.property_type,
                total_investment_cost: finalEconomicUnitId ? 0 : (parseFloat(propertyForm.total_investment_cost) || 0),
                equity_invested: finalEconomicUnitId ? 0 : (parseFloat(propertyForm.equity_invested) || 0),
                economic_unit_id: finalEconomicUnitId,
                thumbnail_image: propertyForm.thumbnail_image || null
            };

            let error;
            let currentPropId = editingPropertyId;

            if (editingPropertyId) {
                const { error: updateError } = await supabase.from('properties').update(propData).eq('id', editingPropertyId);
                error = updateError;
            } else {
                // Insert first to get the ID
                const { data: insertData, error: insertError } = await supabase
                    .from('properties')
                    .insert([propData])
                    .select('id')
                    .single();
                error = insertError;
                if (insertData) currentPropId = insertData.id;
            }

            if (error) throw error;
            
            // Now handle updating other members
            if (finalEconomicUnitId) {
                // Add newly checked members and set their property-level investment/equity to 0
                const allMembers = [currentPropId, ...propertyForm.economic_unit_members].filter(Boolean);
                
                await supabase.from('properties')
                    .update({ 
                        economic_unit_id: finalEconomicUnitId,
                        total_investment_cost: 0,
                        equity_invested: 0
                    })
                    .in('id', allMembers);
                
                // Remove unchecked members that were previously in THIS unit
                if (propertyForm._original_economic_unit_id) {
                    const removedMembers = properties
                        .filter(p => p.economic_unit_id === propertyForm._original_economic_unit_id && p.id !== editingPropertyId)
                        .filter(p => !propertyForm.economic_unit_members.includes(p.id))
                        .map(p => p.id);
                        
                    if (removedMembers.length > 0) {
                        await supabase.from('properties')
                            .update({ economic_unit_id: null })
                            .in('id', removedMembers);
                    }
                }
            } else {
                // If it was previously in a unit but now has no members, remove it from the unit
                if (propertyForm._original_economic_unit_id && editingPropertyId) {
                    const otherMembers = properties.filter(p => p.economic_unit_id === propertyForm._original_economic_unit_id && p.id !== editingPropertyId);
                    // If only 1 other member is left, it's no longer a group, so we can dissolve it or leave it.
                    // For now, just set the original unit ID to null on this property (handled by propData).
                }
            }

            // Sync and upload initial files if this is a new property
            if (!editingPropertyId && currentPropId) {
                try {
                    await supabase.functions.invoke('cloud-sync', {
                        body: { provider: 'onedrive', action: 'create' }
                    });
                    await supabase.functions.invoke('cloud-sync', {
                        body: { provider: 'googledrive', action: 'create' }
                    });

                    // Upload local files selected during creation
                    if (newPropertyImages.length > 0) {
                        const folderName = `${propData.street} ${propData.house_number || ''}`.trim();
                        const targetPath = `${folderName}/Bilder`;
                        let uploadedThumbnailId = null;

                        for (let i = 0; i < newPropertyImages.length; i++) {
                            const file = newPropertyImages[i];
                            try {
                                const formData = new FormData();
                                formData.append('action', 'upload');
                                formData.append('provider', propertyProvider);
                                formData.append('path', targetPath);
                                formData.append('file', file);
                                
                                const response = await supabase.functions.invoke('cloud-drive', { body: formData });
                                if (response.data?.success && response.data?.file?.id) {
                                    if (i === pendingPropertyThumbnailIndex) {
                                        uploadedThumbnailId = response.data.file.id;
                                    }
                                }
                            } catch (uploadErr) {
                                console.error("Error uploading initial property file:", uploadErr);
                            }
                        }

                        if (uploadedThumbnailId) {
                            await supabase
                                .from('properties')
                                .update({ thumbnail_image: uploadedThumbnailId })
                                .eq('id', currentPropId);
                        }
                    }
                } catch (syncErr) {
                    console.error("Cloud folder sync/upload error:", syncErr);
                }
            }

            await new Promise(resolve => setTimeout(resolve, 500));

            // Redirect based on returnTo (e.g. back to Cockpit after edit from InvestorPortal)
            if (returnTo === 'cockpit') {
                setReturnTo(null);
                navigate('/investor-portal');
            } else {
                window.location.reload();
            }
        } catch (error) {
            alert(translateError(error));
        } finally {
            setIsSaving(false);
        }
    };

    // Save Unit
    // Save Unit
    const handleOpenUnitModal = async (property) => {
        setCurrentPropertyForUnit(property);
        setEditingUnitId(null); // Reset editing state
        setNewUnitImages([]);
        
        const conn = await resolveCloudConnection(property.portfolio_id);
        if (conn && conn.provider) {
            setUnitProvider(conn.provider);
        } else {
            setUnitProvider('onedrive');
        }

        setUnitForm({
            unit_name: '', floor: '', sqm: '', rooms: '', target_rent: '',
            bathrooms: 1, bedrooms: 1, balcony: false, fitted_kitchen: false, is_vacation_rental: false,
            cold_rent_ist: '', service_charge_soll: '', heating_cost_soll: '', other_costs_soll: '', deposit_soll: '',
            thumbnail_image: ''
        });
        setIsUnitModalOpen(true);
    };

    const handleSaveUnit = async () => {
        if (!currentPropertyForUnit) return;

        try {
            setIsSaving(true);

            // Limit Check for NEW units
            if (!editingUnitId) {
                const { count, error } = await supabase
                    .from('units')
                    .select('*', { count: 'exact', head: true }) // Fast count
                    .eq('user_id', user.id);

                if (error) throw error;

                // checkUsageLimit handles the Paywall trigger internally
                if (!checkUsageLimit(count)) {
                    setIsSaving(false);
                    return; // Stop here
                }
            }

            const unitData = {
                user_id: user.id,
                property_id: currentPropertyForUnit.id,
                unit_name: unitForm.unit_name,
                floor: unitForm.floor,
                sqm: parseFloat(unitForm.sqm) || 0,
                target_rent: parseFloat(unitForm.target_rent) || 0,
                rooms: parseFloat(unitForm.rooms) || 0,
                bathrooms: parseFloat(unitForm.bathrooms) || 0,
                bedrooms: parseFloat(unitForm.bedrooms) || 0,
                balcony: unitForm.balcony,
                fitted_kitchen: unitForm.fitted_kitchen,
                is_vacation_rental: unitForm.is_vacation_rental,
                cold_rent_ist: parseFloat(unitForm.cold_rent_ist) || null,
                service_charge_soll: parseFloat(unitForm.service_charge_soll) || null,
                heating_cost_soll: parseFloat(unitForm.heating_cost_soll) || null,
                other_costs_soll: parseFloat(unitForm.other_costs_soll) || null,
                deposit_soll: parseFloat(unitForm.deposit_soll) || null,
                thumbnail_image: unitForm.thumbnail_image || null
            };

            let error;
            let currentUnitId = editingUnitId;

            if (editingUnitId) {
                // UPDATE
                const { error: updateError } = await supabase
                    .from('units')
                    .update(unitData)
                    .eq('id', editingUnitId);
                error = updateError;
            } else {
                // INSERT
                const { data: insertData, error: insertError } = await supabase
                    .from('units')
                    .insert([unitData])
                    .select('id')
                    .single();
                error = insertError;
                if (insertData) currentUnitId = insertData.id;
            }

            if (error) throw error;

            // Trigger sync to ensure folders are created and upload files if needed
            if (!editingUnitId && currentUnitId) {
                try {
                    await supabase.functions.invoke('cloud-sync', {
                        body: { provider: 'onedrive', action: 'create' }
                    });
                    await supabase.functions.invoke('cloud-sync', {
                        body: { provider: 'googledrive', action: 'create' }
                    });

                    // Upload local files selected during creation
                    if (newUnitImages.length > 0) {
                        const propFolderName = getPropertyFolderName(currentPropertyForUnit, properties);
                        let targetPath = '';
                        if (currentPropertyForUnit?.economic_unit_id) {
                            const houseNumber = currentPropertyForUnit.house_number || 'Ohne Hausnummer';
                            targetPath = `${propFolderName}/${houseNumber}/Einheiten/${unitForm.unit_name}/Bilder`;
                        } else {
                            targetPath = `${propFolderName}/Einheiten/${unitForm.unit_name}/Bilder`;
                        }
                        let uploadedThumbnailId = null;

                        for (let i = 0; i < newUnitImages.length; i++) {
                            const file = newUnitImages[i];
                            try {
                                const formData = new FormData();
                                formData.append('action', 'upload');
                                formData.append('provider', unitProvider);
                                formData.append('path', targetPath);
                                formData.append('file', file);
                                
                                const response = await supabase.functions.invoke('cloud-drive', { body: formData });
                                if (response.data?.success && response.data?.file?.id) {
                                    if (i === pendingUnitThumbnailIndex) {
                                        uploadedThumbnailId = response.data.file.id;
                                    }
                                }
                            } catch (uploadErr) {
                                console.error("Error uploading initial file:", uploadErr);
                            }
                        }

                        if (uploadedThumbnailId) {
                            await supabase
                                .from('units')
                                .update({ thumbnail_image: uploadedThumbnailId })
                                .eq('id', currentUnitId);
                        }
                    }
                } catch (syncErr) {
                    console.error("Cloud folder creation/upload error:", syncErr);
                }
            }

            await new Promise(resolve => setTimeout(resolve, 500));
            window.location.reload();
        } catch (error) {
            alert(translateError(error));
        } finally {
            setIsSaving(false);
        }
    };

    const handleEditUnit = async (property, unit) => {
        setCurrentPropertyForUnit(property);
        setEditingUnitId(unit.id);
        
        const conn = await resolveCloudConnection(property.portfolio_id);
        if (conn && conn.provider) {
            setUnitProvider(conn.provider);
        } else {
            setUnitProvider('onedrive');
        }

        setUnitForm({
            unit_name: unit.unit_name,
            floor: unit.floor,
            sqm: unit.sqm,
            target_rent: unit.target_rent,
            rooms: unit.rooms,
            bathrooms: unit.bathrooms,
            bedrooms: unit.bedrooms,
            balcony: unit.balcony,
            fitted_kitchen: unit.fitted_kitchen,
            is_vacation_rental: unit.is_vacation_rental,
            cold_rent_ist: unit.cold_rent_ist || '',
            service_charge_soll: unit.service_charge_soll || '',
            heating_cost_soll: unit.heating_cost_soll || '',
            other_costs_soll: unit.other_costs_soll || '',
            deposit_soll: unit.deposit_soll || '',
            thumbnail_image: unit.thumbnail_image || ''
        });
        setIsUnitModalOpen(true);
    };

    const handleDeleteUnit = async (propertyId, unitId) => {
        if (!confirm('Möchten Sie diese Einheit wirklich löschen?')) return;

        try {
            const { error } = await supabase.from('units').delete().eq('id', unitId);
            if (error) throw error;
            window.location.reload();
        } catch (error) {
            alert(translateError(error));
        }
    };

    const handleDeleteProperty = async (propertyId) => {
        if (!confirm('Möchten Sie diese Immobilie wirklich löschen? Alle zugehörigen Einheiten und Mietverträge werden ebenfalls gelöscht.')) return;

        try {
            setIsSaving(true);
            const { error } = await supabase.from('properties').delete().eq('id', propertyId);
            if (error) throw error;
            window.location.reload();
        } catch (error) {
            alert(translateError(error));
        } finally {
            setIsSaving(false);
        }
    };

    const handleEditProperty = async (property, source = null) => {
        setEditingPropertyId(property.id);
        if (source) setReturnTo(source);
        
        // Find economic unit if it exists
        const weRow = property.economic_unit_id 
            ? economicUnits.find(eu => eu.id === property.economic_unit_id) 
            : null;

        const conn = await resolveCloudConnection(property.portfolio_id);
        if (conn && conn.provider) {
            setPropertyProvider(conn.provider);
        } else {
            setPropertyProvider('onedrive');
        }

        setPropertyForm({
            portfolio_id: property.portfolio_id || '',
            street: property.street || '',
            house_number: property.house_number || '',
            zip: property.zip || '',
            city: property.city || '',
            construction_year: property.construction_year || '',
            property_type: property.property_type || 'residential',
            total_investment_cost: weRow ? (weRow.total_investment_cost || '') : (property.total_investment_cost || ''),
            equity_invested: weRow ? (weRow.equity_invested || '') : (property.equity_invested || ''),
            economic_unit_members: property.economic_unit_id 
                ? properties.filter(p => p.economic_unit_id === property.economic_unit_id && p.id !== property.id).map(p => p.id) 
                : [],
            _original_economic_unit_id: property.economic_unit_id,
            thumbnail_image: property.thumbnail_image || ''
        });
        
        setIsPropertyModalOpen(true);
    };

    // Handle deep-link from Cockpit: ?editPropertyId=...&returnTo=cockpit
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const editId = params.get('editPropertyId');
        const ret = params.get('returnTo');
        if (editId && properties.length > 0) {
            const prop = properties.find(p => p.id === editId);
            if (prop) {
                handleEditProperty(prop, ret);
                // Clear URL params
                navigate(location.pathname, { replace: true });
            }
        }
    }, [location.search, properties]);

    // Filter properties by selected property
    const filteredProperties = properties.filter(p => {
        if (!searchTerm) return true;
        return p.id === searchTerm;
    });

    // Group Properties by Economic Unit
    const groupedProperties = React.useMemo(() => {
        const groups = {};
        const result = [];

        filteredProperties.forEach(p => {
            if (p.economic_unit_id) {
                if (!groups[p.economic_unit_id]) {
                    groups[p.economic_unit_id] = {
                        id: 'we_' + p.economic_unit_id,
                        isGroup: true,
                        economic_unit_id: p.economic_unit_id,
                        street: 'Wirtschaftseinheit',
                        house_number: '',
                        property_type: 'mixed',
                        properties: [],
                        stats: { totalUnits: 0, totalArea: 0, totalTargetRent: 0, totalActualRent: 0 },
                        total_investment_cost: 0,
                        equity_invested: 0,
                        market_value_total: 0,
                        remaining_debt: 0,
                        monthly_loan_payment: 0
                    };
                }
                const group = groups[p.economic_unit_id];
                group.properties.push(p);
                group.stats.totalUnits += (p.stats?.totalUnits || 0);
                group.stats.totalArea += (p.stats?.totalArea || 0);
                group.stats.totalTargetRent += (p.stats?.totalTargetRent || 0);
                group.stats.totalActualRent += (p.stats?.totalActualRent || 0);
                group.total_investment_cost += (p.total_investment_cost || 0);
                group.equity_invested += (p.equity_invested || 0);
                group.market_value_total += (p.market_value_total || 0);
                group.remaining_debt += (p.remaining_debt || 0);
                group.monthly_loan_payment += (p.monthly_loan_payment || 0);
            } else {
                result.push(p);
            }
        });

        // Resolve Groups: If a group only has 1 property, flatten it (unless it has custom WE data). Otherwise, generate name and add to result.
        Object.values(groups).forEach(g => {
            const weRow = economicUnits.find(eu => eu.id === g.economic_unit_id);
            const weLoans = (loans || []).filter(l => l.economic_unit_id === g.economic_unit_id && !l.property_id);
            const weRemainingDebt = weLoans.reduce((sum, l) => sum + calculateCurrentDebt(l), 0);
            const weMonthlyLoanPayment = weLoans.reduce((sum, l) => sum + calculateMonthlyPayment(l), 0);

            g.remaining_debt += weRemainingDebt;
            g.monthly_loan_payment += weMonthlyLoanPayment;

            if (g.properties.length === 1 && !weRow) {
                const flatProp = { ...g.properties[0] };
                flatProp.remaining_debt += weRemainingDebt;
                flatProp.monthly_loan_payment += weMonthlyLoanPayment;
                result.push(flatProp);
            } else if (g.properties.length > 0) {
                const streets = Array.from(new Set(g.properties.map(pr => pr.street).filter(Boolean)));
                const streetName = streets.length > 0 ? streets.join(', ') : 'Diverse';
                const numbers = g.properties.map(pr => pr.house_number).filter(Boolean).join(' & ');
                g.street = (weRow?.name && weRow.name !== 'Wirtschaftseinheit') ? weRow.name : `Wirtschaftseinheit: ${streetName}`;
                g.house_number = numbers;

                if (weRow) {
                    if (parseFloat(weRow.total_investment_cost) > 0) g.total_investment_cost = parseFloat(weRow.total_investment_cost);
                    if (parseFloat(weRow.equity_invested) > 0) g.equity_invested = parseFloat(weRow.equity_invested);
                    if (parseFloat(weRow.market_value_total) > 0) g.market_value_total = parseFloat(weRow.market_value_total);
                }

                result.push(g);
            }
        });

        // Sort by street name
        return result.sort((a, b) => (a.street || '').localeCompare(b.street || ''));
    }, [filteredProperties, loans, economicUnits]);

    const propertyColumns = [
        {
            header: '',
            accessor: 'expand',
            width: '40px',
            render: (row) => (
                <button
                    onClick={(e) => { 
                        e.stopPropagation(); 
                        if (row.isGroup) {
                            setExpandedWEId(expandedWEId === row.id ? null : row.id);
                        } else {
                            toggleExpand(row.id); 
                        }
                    }}
                    style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center' }}
                >
                    {(row.isGroup ? expandedWEId === row.id : expandedPropertyId === row.id) ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                </button>
            )
        },
        {
            header: 'Immobilie',
            accessor: 'street',
            render: (row) => (
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    <div style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: 'var(--radius-md)',
                        backgroundColor: row.isGroup ? 'rgba(139, 92, 246, 0.1)' : 'var(--surface-color)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginRight: 'var(--spacing-md)',
                        color: row.isGroup ? 'var(--accent-color)' : 'var(--primary-color)'
                    }}>
                        <Building2 size={20} />
                    </div>
                    <div>
                        <div style={{ fontWeight: 600, color: row.isGroup ? 'var(--accent-color)' : 'inherit' }}>{row.street} {row.house_number}</div>
                        {!row.isGroup && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{row.zip} {row.city}</div>}
                        {row.isGroup && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{row.properties.length} Gebäude verknüpft</div>}
                    </div>
                </div>
            )
        },
        {
            header: 'Typ',
            accessor: 'property_type',
            render: (row) => row.property_type === 'commercial' ? 'Gewerbe' : 'Wohnen'
        },
        {
            header: 'Einh.',
            accessor: 'stats.totalUnits',
            render: (row) => row.stats?.totalUnits || 0
        },
        {
            header: 'Fläche',
            accessor: 'stats.totalArea',
            render: (row) => <span>{row.stats?.totalArea ? (parseFloat(row.stats.totalArea) || 0).toLocaleString('de-DE', { maximumFractionDigits: 2 }) : '0'} m²</span>
        },
        {
            header: 'Soll',
            accessor: 'stats.totalTargetRent',
            render: (row) => <span>{row.stats?.totalTargetRent?.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</span>
        },
        {
            header: 'Ist',
            accessor: 'stats.totalActualRent',
            render: (row) => <span style={{ fontWeight: 600 }}>{row.stats?.totalActualRent?.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</span>
        },
        {
            header: 'Aktionen',
            accessor: 'actions',
            align: 'right',
            render: (row) => row.isGroup ? null : (
                <div style={{ position: 'relative', display: 'inline-block' }}>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            if (openPropertyActionMenuId === row.id) {
                                setOpenPropertyActionMenuId(null);
                            } else {
                                const rect = e.currentTarget.getBoundingClientRect();
                                setPropertyMenuPos({ top: rect.bottom, left: rect.right });
                                setOpenPropertyActionMenuId(row.id);
                            }
                        }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: '4px', display: 'flex', alignItems: 'center' }}
                    >
                        <MoreVertical size={16} color="var(--text-secondary)" />
                    </button>

                    {openPropertyActionMenuId === row.id && createPortal(
                        <>
                            <div
                                style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9998, cursor: 'default' }}
                                onClick={(e) => { e.stopPropagation(); setOpenPropertyActionMenuId(null); }}
                            />
                            <div style={{
                                position: 'fixed',
                                top: propertyMenuPos.top + 5,
                                left: propertyMenuPos.left,
                                transform: 'translateX(-100%)',
                                backgroundColor: 'var(--surface-color)',
                                border: '1px solid var(--border-color)',
                                borderRadius: 'var(--radius-md)',
                                boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                                zIndex: 9999,
                                minWidth: '160px',
                                display: 'flex',
                                flexDirection: 'column',
                                padding: '4px'
                            }}
                                onClick={(e) => e.stopPropagation()}>
                                <button
                                    onClick={(e) => { e.stopPropagation(); setOpenPropertyActionMenuId(null); toggleExpand(row.id); }}
                                    style={{ textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', color: 'var(--text-primary)' }}
                                >
                                    <Home size={14} /> Details / Einheiten
                                </button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); setOpenPropertyActionMenuId(null); handleEditProperty(row); }}
                                    style={{ textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', color: 'var(--text-primary)' }}
                                >
                                    <Edit size={14} /> Bearbeiten
                                </button>
                                <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '4px 0' }} />
                                <button
                                    onClick={(e) => { e.stopPropagation(); setOpenPropertyActionMenuId(null); handleDeleteProperty(row.id); }}
                                    style={{ textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', color: 'var(--danger-color)' }}
                                >
                                    <Trash2 size={14} /> Löschen
                                </button>
                            </div>
                        </>,
                        document.body
                    )}
                </div>
            )
        }
    ];

    return (
        <div>
            <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', marginBottom: 'var(--spacing-xl)', gap: isMobile ? '10px' : '0' }}>
                <div>
                    <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: 'var(--spacing-xs)' }}>Immobilien</h1>
                    <p style={{ color: 'var(--text-secondary)' }}>Übersicht Ihrer Wohn- und Gewerbeobjekte</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ display: 'flex', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '2px', backgroundColor: 'var(--bg-secondary)' }}>
                        <button
                            onClick={() => setViewMode('table')}
                            style={{
                                padding: '6px 12px',
                                borderRadius: '4px',
                                border: 'none',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                fontSize: '0.85rem',
                                cursor: 'pointer',
                                backgroundColor: viewMode === 'table' ? 'var(--surface-color)' : 'transparent',
                                color: viewMode === 'table' ? 'var(--primary-color)' : 'var(--text-secondary)',
                                boxShadow: viewMode === 'table' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                                fontWeight: viewMode === 'table' ? 600 : 'normal'
                            }}
                        >
                            <List size={14} /> Tabelle
                        </button>
                        <button
                            onClick={() => setViewMode('grid')}
                            style={{
                                padding: '6px 12px',
                                borderRadius: '4px',
                                border: 'none',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                fontSize: '0.85rem',
                                cursor: 'pointer',
                                backgroundColor: viewMode === 'grid' ? 'var(--surface-color)' : 'transparent',
                                color: viewMode === 'grid' ? 'var(--primary-color)' : 'var(--text-secondary)',
                                boxShadow: viewMode === 'grid' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                                fontWeight: viewMode === 'grid' ? 600 : 'normal'
                            }}
                        >
                            <LayoutGrid size={14} /> Kacheln
                        </button>
                    </div>
                    <ExportDropdown
                        reportType="immobilien"
                        data={groupedProperties.map(p => {
                            const formattedAddress = p.isGroup ? (() => {
                                const streets = Array.from(new Set(p.properties.map(pr => pr.street).filter(Boolean)));
                                const streetName = streets.length > 0 ? streets.join(', ') : 'Diverse';
                                const numbers = p.properties.map(pr => pr.house_number).filter(Boolean).join(' & ');
                                return `${streetName} ${numbers}`.trim();
                            })() : `${p.street} ${p.house_number || ''}`.trim();

                            return {
                                property_id: p.id,
                                adresse: formattedAddress,
                                einheiten: p.stats?.totalUnits || 0,
                                kaufpreis: p.total_investment_cost || 0,
                                marktpreis: p.market_value_total || 0,
                                restschuld: p.remaining_debt || 0,
                                miete_monat: p.stats?.totalActualRent || 0,
                                bankrate: p.monthly_loan_payment || 0,
                                cashflow_monat: (p.stats?.totalActualRent || 0) - (p.monthly_loan_payment || 0),
                                wohnflaeche: p.stats?.totalArea || 0,
                                leerstand: p.stats?.totalUnits ? `${p.stats.totalUnits - (p.stats.occupiedUnits || p.stats.totalUnits)} / ${p.stats.totalUnits}` : '–',
                                ltv: p.market_value_total > 0 ? (p.remaining_debt || 0) / p.market_value_total : 0,
                                dscr: p.monthly_loan_payment > 0 ? (p.stats?.totalActualRent || 0) / p.monthly_loan_payment : 0,
                                _propertyLabel: formattedAddress,
                            };
                        })}
                        unitData={Object.fromEntries(groupedProperties.map(p => [
                            p.id,
                            (p.isGroup ? p.properties.flatMap(subP => subP.units || []) : (p.units || [])).map(u => ({
                                unit_name: u.unit_name || '–',
                                floor: u.floor || '–',
                                sqm: u.sqm || 0,
                                rooms: u.rooms || '–',
                                target_rent: u.is_vacation_rental 
                                    ? (parseFloat(u.cold_rent_ist) || parseFloat(u.target_rent) || 0) 
                                    : (parseFloat(u.leases?.find(l => l.status === 'active')?.cold_rent) || 0),
                                status: u.is_vacation_rental ? 'Ferienwohnung' : (u.leases?.find(l => l.status === 'active') ? 'Vermietet' : 'Leerstand'),
                            })),
                        ]))}
                        properties={properties.map(p => ({ id: p.id, label: `${p.street} ${p.house_number || ''}`.trim() }))}
                        totalRows={groupedProperties.length}
                    />
                    <Button icon={Plus} onClick={async () => {
                        if (!checkGlobalAccess()) return;
                        setEditingPropertyId(null);
                        setNewPropertyImages([]);
                        
                        const conn = await resolveCloudConnection(selectedPortfolioID || (portfolios[0]?.id));
                        if (conn && conn.provider) {
                            setPropertyProvider(conn.provider);
                        } else {
                            setPropertyProvider('onedrive');
                        }

                        setPropertyForm({
                            portfolio_id: selectedPortfolioID || '',
                            street: '',
                            house_number: '',
                            zip: '',
                            city: '',
                            construction_year: '',
                            property_type: 'residential',
                            total_investment_cost: '',
                            equity_invested: '',
                            economic_unit_members: [],
                            _original_economic_unit_id: null,
                            thumbnail_image: ''
                        });
                        setIsPropertyModalOpen(true);
                    }}>Neue Immobilie</Button>
                </div>
            </div>

            {/* Filter Bar */}
            {properties.length > 0 && (
                <div style={{ marginBottom: 'var(--spacing-lg)', display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <Filter size={18} style={{ color: 'var(--text-secondary)' }} />
                        <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Filter:</span>
                    </div>
                    <div>
                        <select
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            style={{ padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', minWidth: '200px' }}
                        >
                            <option value="">Alle Immobilien</option>
                            {properties.map(p => (
                                <option key={p.id} value={p.id}>{p.street} {p.house_number}</option>
                            ))}
                        </select>
                    </div>
                </div>
            )}

            <Card>
                {filteredProperties.length === 0 ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        {properties.length === 0 ? 'Keine Immobilien gefunden.' : 'Keine Immobilien gefunden für diesen Filter.'}
                    </div>
                ) : (
                    <>
                        {viewMode === 'table' ? (
                            <div style={{ overflowX: 'auto' }}>
                            {/* Custom Table Rendering to support expansion */}
                            <table style={{ width: '100%', minWidth: '800px', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr>
                                        {propertyColumns.map((col, idx) => (
                                            <th key={idx} style={{ textAlign: col.align || 'left', width: col.width }}>{col.header}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {groupedProperties.map(propertyOrGroup => (
                                        <React.Fragment key={propertyOrGroup.id}>
                                            <tr
                                                className="table-row"
                                                onClick={() => {
                                                    if (propertyOrGroup.isGroup) {
                                                        setExpandedWEId(expandedWEId === propertyOrGroup.id ? null : propertyOrGroup.id);
                                                    } else {
                                                        toggleExpand(propertyOrGroup.id);
                                                    }
                                                }}
                                                style={{
                                                    borderBottom: (propertyOrGroup.isGroup ? expandedWEId === propertyOrGroup.id : expandedPropertyId === propertyOrGroup.id) ? 'none' : '1px solid var(--border-color)',
                                                    cursor: 'pointer',
                                                    backgroundColor: propertyOrGroup.isGroup ? 'rgba(139, 92, 246, 0.02)' : 'transparent'
                                                }}
                                            >
                                                {propertyColumns.map((col, idx) => (
                                                    <td key={idx} style={{ textAlign: col.align || 'left', fontWeight: propertyOrGroup.isGroup ? 600 : 'normal' }}>
                                                        {col.render ? col.render(propertyOrGroup) : propertyOrGroup[col.accessor]}
                                                    </td>
                                                ))}
                                            </tr>
                                            
                                            {/* If it's a Group and expanded, render sub-properties */}
                                            {propertyOrGroup.isGroup && expandedWEId === propertyOrGroup.id && (
                                                <>
                                                    {propertyOrGroup.properties.map(subProp => (
                                                        <React.Fragment key={subProp.id}>
                                                            <tr
                                                                className="table-row"
                                                                onClick={(e) => { e.stopPropagation(); toggleExpand(subProp.id); }}
                                                                style={{
                                                                    borderBottom: expandedPropertyId === subProp.id ? 'none' : '1px solid var(--border-color)',
                                                                    cursor: 'pointer',
                                                                    backgroundColor: 'rgba(0,0,0,0.01)'
                                                                }}
                                                            >
                                                                {propertyColumns.map((col, idx) => (
                                                                    <td key={idx} style={{ textAlign: col.align || 'left', paddingLeft: idx === 1 ? '40px' : undefined }}>
                                                                        {col.render ? col.render(subProp) : subProp[col.accessor]}
                                                                    </td>
                                                                ))}
                                                            </tr>
                                                            {/* Render Units for Sub-Property */}
                                                            {expandedPropertyId === subProp.id && (
                                                                <tr style={{ backgroundColor: 'var(--background-color)', borderBottom: '1px solid var(--border-color)' }}>
                                                                    <td colSpan={propertyColumns.length} style={{ padding: 'var(--spacing-md) var(--spacing-xl) var(--spacing-md) 60px' }}>
                                                                        <div style={{ marginBottom: 'var(--spacing-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                            <h4 style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                                <Home size={16} /> Einheiten
                                                                            </h4>
                                                                            <Button size="sm" icon={Plus} onClick={() => {
                                                                                if (!checkGlobalAccess()) return;
                                                                                handleOpenUnitModal(subProp);
                                                                            }}>Neue Einheit</Button>
                                                                        </div>
                                                                        
                                                                        {loadingUnits[subProp.id] ? (
                                                                            <div style={{ padding: '10px', color: 'var(--text-secondary)' }}>Lade Einheiten...</div>
                                                                        ) : (
                                                                            !units[subProp.id] || units[subProp.id].length === 0 ? (
                                                                                <div style={{ padding: '10px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>Keine Einheiten angelegt.</div>
                                                                            ) : (
                                                                                    <table style={{ width: '100%', backgroundColor: 'var(--surface-color)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: '0.875rem' }}>
                                                                                        <thead style={{ backgroundColor: 'var(--background-color)' }}>
                                                                                            <tr>
                                                                                                <th style={{ padding: '8px' }}>Name</th>
                                                                                                <th style={{ padding: '8px' }}>Etage</th>
                                                                                                <th style={{ padding: '8px' }}>Fläche</th>
                                                                                                <th style={{ padding: '8px' }}>Zimmer</th>
                                                                                                <th style={{ padding: '8px' }}>Status</th>
                                                                                                <th style={{ padding: '8px' }}>Istmiete</th>
                                                                                                <th style={{ padding: '8px' }}></th>
                                                                                            </tr>
                                                                                        </thead>
                                                                                        <tbody>
                                                                                            {units[subProp.id].map(unit => (
                                                                                                <tr key={unit.id} className="table-row" style={{ borderTop: '1px solid var(--border-color)' }}>
                                                                                                    <td style={{ padding: '8px' }}>{unit.unit_name}</td>
                                                                                                    <td style={{ padding: '8px' }}>{unit.floor}</td>
                                                                                                    <td style={{ padding: '8px' }}>{unit.sqm ? (parseFloat(unit.sqm) || 0).toLocaleString('de-DE', { maximumFractionDigits: 2 }) : '—'} m²</td>
                                                                                                    <td style={{ padding: '8px' }}>{unit.rooms}</td>
                                                                                                    <td style={{ padding: '8px' }}>
                                                                                                        {unit.status === 'vacation_rental' ? (
                                                                                                            <span style={{ color: 'var(--primary-color)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', fontWeight: 600, backgroundColor: 'rgba(59, 130, 246, 0.1)', padding: '2px 8px', borderRadius: '12px', width: 'fit-content' }}>
                                                                                                                <Home size={12} /> Ferienwohnung
                                                                                                            </span>
                                                                                                        ) : unit.status === 'rented' ? (
                                                                                                            <span style={{ color: 'var(--success-color)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', fontWeight: 600, backgroundColor: 'rgba(16, 185, 129, 0.1)', padding: '2px 8px', borderRadius: '12px', width: 'fit-content' }}>
                                                                                                                <Key size={12} /> Vermietet
                                                                                                            </span>
                                                                                                        ) : (
                                                                                                            <span style={{ color: 'var(--danger-color)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', fontWeight: 600, backgroundColor: 'rgba(239, 68, 68, 0.1)', padding: '2px 8px', borderRadius: '12px', width: 'fit-content' }}>
                                                                                                                <AlertCircle size={12} /> Leerstand
                                                                                                            </span>
                                                                                                        )}
                                                                                                    </td>
                                                                                                    <td style={{ padding: '8px', fontWeight: 600 }}>
                                                                                                        {unit.is_vacation_rental 
                                                                                                            ? (parseFloat(unit.cold_rent_ist) || parseFloat(unit.target_rent) || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
                                                                                                            : (unit.leases?.find(l => l.status === 'active')?.cold_rent || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
                                                                                                        }
                                                                                                    </td>
                                                                                                    <td style={{ padding: '8px', textAlign: 'right' }}>
                                                                                                        <div style={{ position: 'relative', display: 'inline-block' }}>
                                                                                                            <button
                                                                                                                onClick={(e) => {
                                                                                                                    e.stopPropagation();
                                                                                                                    if (openActionMenuId === unit.id) {
                                                                                                                        setOpenActionMenuId(null);
                                                                                                                    } else {
                                                                                                                        const rect = e.currentTarget.getBoundingClientRect();
                                                                                                                        setMenuPos({ top: rect.bottom, left: rect.right });
                                                                                                                        setOpenActionMenuId(unit.id);
                                                                                                                    }
                                                                                                                }}
                                                                                                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: '4px', display: 'flex', alignItems: 'center' }}
                                                                                                            >
                                                                                                                <MoreVertical size={16} color="var(--text-secondary)" />
                                                                                                            </button>

                                                                                                            {openActionMenuId === unit.id && createPortal(
                                                                                                                <>
                                                                                                                    <div
                                                                                                                        style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9998, cursor: 'default' }}
                                                                                                                        onClick={(e) => { e.stopPropagation(); setOpenActionMenuId(null); }}
                                                                                                                    />
                                                                                                                    <div style={{
                                                                                                                        position: 'fixed',
                                                                                                                        top: menuPos.top + 5,
                                                                                                                        left: menuPos.left,
                                                                                                                        transform: 'translateX(-100%)',
                                                                                                                        backgroundColor: 'var(--surface-color)',
                                                                                                                        border: '1px solid var(--border-color)',
                                                                                                                        borderRadius: 'var(--radius-md)',
                                                                                                                        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                                                                                                                        zIndex: 9999,
                                                                                                                        minWidth: '160px',
                                                                                                                        display: 'flex',
                                                                                                                        flexDirection: 'column',
                                                                                                                        padding: '4px'
                                                                                                                    }}>
                                                                                                                        {unit.status === 'vacant' && (
                                                                                                                            <button
                                                                                                                                onClick={(e) => { e.stopPropagation(); setOpenActionMenuId(null); navigate(`/tenants?action=create&propertyId=${subProp.id}&unitId=${unit.id}`); }}
                                                                                                                                style={{ textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', color: 'var(--success-color)' }}
                                                                                                                                title="Einheit vermieten"
                                                                                                                            >
                                                                                                                                <Plus size={14} /> Vermieten
                                                                                                                            </button>
                                                                                                                        )}
                                                                                                                        <button
                                                                                                                            onClick={(e) => { e.stopPropagation(); setOpenActionMenuId(null); handleEditUnit(subProp, unit); }}
                                                                                                                            style={{ textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', color: 'var(--text-primary)' }}
                                                                                                                            title="Einheit bearbeiten"
                                                                                                                        >
                                                                                                                            <Edit size={14} /> Bearbeiten
                                                                                                                        </button>
                                                                                                                        <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '4px 0' }} />
                                                                                                                        <button
                                                                                                                            onClick={(e) => { e.stopPropagation(); setOpenActionMenuId(null); handleDeleteUnit(subProp.id, unit.id); }}
                                                                                                                            style={{ textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', color: 'var(--danger-color)' }}
                                                                                                                            title="Einheit löschen"
                                                                                                                        >
                                                                                                                            <Trash2 size={14} /> Löschen
                                                                                                                        </button>
                                                                                                                    </div>
                                                                                                                </>,
                                                                                                                document.body
                                                                                                            )}
                                                                                                        </div>
                                                                                                    </td>
                                                                                                </tr>
                                                                                            ))}
                                                                                        </tbody>
                                                                                    </table>
                                                                                )
                                                                            )}
                                                                        </td>
                                                                    </tr>
                                                                )}
                                                            </React.Fragment>
                                                        ))}
                                                    </>
                                                )}

                                                {/* Render Units for Normal Property (Not Group) */}
                                                {!propertyOrGroup.isGroup && expandedPropertyId === propertyOrGroup.id && (
                                                    <tr style={{ backgroundColor: 'var(--background-color)', borderBottom: '1px solid var(--border-color)' }}>
                                                        <td colSpan={propertyColumns.length} style={{ padding: 'var(--spacing-md) var(--spacing-xl)' }}>
                                                            <div style={{ marginBottom: 'var(--spacing-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                <h4 style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                    <Home size={16} /> Einheiten
                                                                </h4>
                                                                <Button size="sm" icon={Plus} onClick={() => {
                                                                    if (!checkGlobalAccess()) return;
                                                                    handleOpenUnitModal(propertyOrGroup);
                                                                }}>Neue Einheit</Button>
                                                            </div>

                                                            {loadingUnits[propertyOrGroup.id] ? (
                                                                <div style={{ padding: '10px', color: 'var(--text-secondary)' }}>Lade Einheiten...</div>
                                                            ) : (
                                                                !units[propertyOrGroup.id] || units[propertyOrGroup.id].length === 0 ? (
                                                                    <div style={{ padding: '10px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>Keine Einheiten angelegt.</div>
                                                                ) : (
                                                                    <table style={{ width: '100%', backgroundColor: 'var(--surface-color)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: '0.875rem' }}>
                                                                        <thead style={{ backgroundColor: 'var(--background-color)' }}>
                                                                            <tr>
                                                                                <th style={{ padding: '8px' }}>Name</th>
                                                                                <th style={{ padding: '8px' }}>Etage</th>
                                                                                <th style={{ padding: '8px' }}>Fläche</th>
                                                                                <th style={{ padding: '8px' }}>Zimmer</th>
                                                                                <th style={{ padding: '8px' }}>Status</th>
                                                                                <th style={{ padding: '8px' }}>Istmiete</th>
                                                                                <th style={{ padding: '8px' }}></th>
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody>
                                                                            {units[propertyOrGroup.id].map(unit => (
                                                                                <tr key={unit.id} className="table-row" style={{ borderTop: '1px solid var(--border-color)' }}>
                                                                                    <td style={{ padding: '8px' }}>{unit.unit_name}</td>
                                                                                    <td style={{ padding: '8px' }}>{unit.floor}</td>
                                                                                    <td style={{ padding: '8px' }}>{unit.sqm ? (parseFloat(unit.sqm) || 0).toLocaleString('de-DE', { maximumFractionDigits: 2 }) : '—'} m²</td>
                                                                                    <td style={{ padding: '8px' }}>{unit.rooms}</td>
                                                                                    <td style={{ padding: '8px' }}>
                                                                                        {unit.status === 'vacation_rental' ? (
                                                                                            <span style={{ color: 'var(--primary-color)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', fontWeight: 600, backgroundColor: 'rgba(59, 130, 246, 0.1)', padding: '2px 8px', borderRadius: '12px', width: 'fit-content' }}>
                                                                                                <Home size={12} /> Ferienwohnung
                                                                                            </span>
                                                                                        ) : unit.status === 'rented' ? (
                                                                                            <span style={{ color: 'var(--success-color)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', fontWeight: 600, backgroundColor: 'rgba(16, 185, 129, 0.1)', padding: '2px 8px', borderRadius: '12px', width: 'fit-content' }}>
                                                                                                <Key size={12} /> Vermietet
                                                                                            </span>
                                                                                        ) : (
                                                                                            <span style={{ color: 'var(--danger-color)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', fontWeight: 600, backgroundColor: 'rgba(239, 68, 68, 0.1)', padding: '2px 8px', borderRadius: '12px', width: 'fit-content' }}>
                                                                                                <AlertCircle size={12} /> Leerstand
                                                                                            </span>
                                                                                        )}
                                                                                    </td>
                                                                                    <td style={{ padding: '8px', fontWeight: 600 }}>
                                                                                        {unit.is_vacation_rental 
                                                                                            ? (parseFloat(unit.cold_rent_ist) || parseFloat(unit.target_rent) || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
                                                                                            : (unit.leases?.find(l => l.status === 'active')?.cold_rent || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
                                                                                        }
                                                                                    </td>
                                                                                    <td style={{ padding: '8px', textAlign: 'right' }}>
                                                                                        <div style={{ position: 'relative', display: 'inline-block' }}>
                                                                                            <button
                                                                                                onClick={(e) => {
                                                                                                    e.stopPropagation();
                                                                                                    if (openActionMenuId === unit.id) {
                                                                                                        setOpenActionMenuId(null);
                                                                                                    } else {
                                                                                                        const rect = e.currentTarget.getBoundingClientRect();
                                                                                                        setMenuPos({ top: rect.bottom, left: rect.right });
                                                                                                        setOpenActionMenuId(unit.id);
                                                                                                    }
                                                                                                }}
                                                                                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: '4px', display: 'flex', alignItems: 'center' }}
                                                                                            >
                                                                                                <MoreVertical size={16} color="var(--text-secondary)" />
                                                                                            </button>

                                                                                            {openActionMenuId === unit.id && createPortal(
                                                                                                <>
                                                                                                    <div
                                                                                                        style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9998, cursor: 'default' }}
                                                                                                        onClick={(e) => { e.stopPropagation(); setOpenActionMenuId(null); }}
                                                                                                    />
                                                                                                    <div style={{
                                                                                                        position: 'fixed',
                                                                                                        top: menuPos.top + 5,
                                                                                                        left: menuPos.left,
                                                                                                        transform: 'translateX(-100%)',
                                                                                                        backgroundColor: 'var(--surface-color)',
                                                                                                        border: '1px solid var(--border-color)',
                                                                                                        borderRadius: 'var(--radius-md)',
                                                                                                        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                                                                                                        zIndex: 9999,
                                                                                                        minWidth: '160px',
                                                                                                        display: 'flex',
                                                                                                        flexDirection: 'column',
                                                                                                        padding: '4px'
                                                                                                    }}>
                                                                                                        {unit.status === 'vacant' && (
                                                                                                            <button
                                                                                                                onClick={(e) => { e.stopPropagation(); setOpenActionMenuId(null); navigate(`/tenants?action=create&propertyId=${propertyOrGroup.id}&unitId=${unit.id}`); }}
                                                                                                                style={{ textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', color: 'var(--success-color)' }}
                                                                                                                title="Einheit vermieten"
                                                                                                            >
                                                                                                                <Plus size={14} /> Vermieten
                                                                                                            </button>
                                                                                                        )}
                                                                                                        <button
                                                                                                            onClick={(e) => { e.stopPropagation(); setOpenActionMenuId(null); handleEditUnit(propertyOrGroup, unit); }}
                                                                                                            style={{ textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', color: 'var(--text-primary)' }}
                                                                                                            title="Einheit bearbeiten"
                                                                                                        >
                                                                                                            <Edit size={14} /> Bearbeiten
                                                                                                        </button>
                                                                                                        <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '4px 0' }} />
                                                                                                        <button
                                                                                                            onClick={(e) => { e.stopPropagation(); setOpenActionMenuId(null); handleDeleteUnit(propertyOrGroup.id, unit.id); }}
                                                                                                            style={{ textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', color: 'var(--danger-color)' }}
                                                                                                            title="Einheit löschen"
                                                                                                        >
                                                                                                            <Trash2 size={14} /> Löschen
                                                                                                        </button>
                                                                                                    </div>
                                                                                                </>,
                                                                                                document.body
                                                                                            )}
                                                                                        </div>
                                                                                    </td>
                                                                                </tr>
                                                                            ))}
                                                                        </tbody>
                                                                    </table>
                                                                )
                                                            )}
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? '100%' : '300px'}, 1fr))`, gap: 'var(--spacing-md)' }}>
                                {filteredProperties.map(property => {
                                    const totalSqm = property.units?.reduce((sum, u) => sum + (parseFloat(u.sqm) || 0), 0) || 0;
                                    const unitCount = property.units?.length || 0;
                                    const rentedUnits = property.units?.filter(u => u.status === 'rented').length || 0;

                                    return (
                                        <div key={property.id}
                                            onClick={() => handleEditProperty(property)}
                                            style={{
                                                border: '1px solid var(--border-color)',
                                                borderRadius: 'var(--radius-lg)',
                                                backgroundColor: 'var(--surface-color)',
                                                cursor: 'pointer',
                                                overflow: 'hidden',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                height: '100%',
                                                transition: 'all 0.2s ease-in-out',
                                                boxShadow: 'var(--shadow-sm)'
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.transform = 'translateY(-2px)';
                                                e.currentTarget.style.borderColor = 'var(--primary-color)';
                                                e.currentTarget.style.boxShadow = 'var(--glass-shadow)';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.transform = 'none';
                                                e.currentTarget.style.borderColor = 'var(--border-color)';
                                                e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
                                            }}
                                        >
                                            {/* Cover Image Section */}
                                            <div style={{ position: 'relative', height: '140px', width: '100%', backgroundColor: 'rgba(0,0,0,0.2)' }}>
                                                <CloudImage 
                                                    provider={property.cloud_provider} 
                                                    itemId={property.thumbnail_image} 
                                                    fallbackIcon={Building2} 
                                                    premiumView={true}
                                                />
                                                {/* Property type badge */}
                                                <div style={{
                                                    position: 'absolute',
                                                    top: '12px',
                                                    right: '12px',
                                                    padding: '4px 10px',
                                                    borderRadius: '20px',
                                                    fontSize: '0.7rem',
                                                    fontWeight: 700,
                                                    letterSpacing: '0.05em',
                                                    textTransform: 'uppercase',
                                                    backdropFilter: 'blur(8px)',
                                                    backgroundColor: property.property_type === 'commercial' ? 'rgba(245, 158, 11, 0.85)' : 'rgba(59, 130, 246, 0.85)',
                                                    color: 'white',
                                                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                                                }}>
                                                    {property.property_type === 'commercial' ? 'Gewerbe' : 'Wohnen'}
                                                </div>
                                            </div>

                                            {/* Card Content */}
                                            <div style={{ padding: 'var(--spacing-md)', display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'space-between' }}>
                                                <div>
                                                    <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-primary)', marginBottom: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                        {property.street} {property.house_number}
                                                    </div>
                                                    <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: 'var(--spacing-md)' }}>
                                                        {property.zip} {property.city}
                                                    </div>
                                                    
                                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-sm)', marginBottom: 'var(--spacing-md)' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                                            <Home size={14} style={{ color: 'var(--primary-color)' }} />
                                                            <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{unitCount} {unitCount === 1 ? 'Einheit' : 'Einheiten'}</span>
                                                        </div>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                                            <LayoutGrid size={14} style={{ color: 'var(--primary-color)' }} />
                                                            <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{totalSqm > 0 ? `${totalSqm.toLocaleString('de-DE', { maximumFractionDigits: 2 })} m²` : '—'}</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 'var(--spacing-sm)', display: 'flex', gap: '8px', marginTop: 'auto' }}>
                                                    <Button size="sm" variant="secondary" style={{ flex: 1, minHeight: '36px' }} onClick={(e) => { e.stopPropagation(); handleEditProperty(property); }}>
                                                        <Edit3 size={14} style={{ marginRight: '6px' }} /> Bearbeiten
                                                    </Button>
                                                    <Button size="sm" variant="secondary" style={{ flex: 1, minHeight: '36px' }} onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (!checkGlobalAccess()) return;
                                                        handleOpenUnitModal(property);
                                                    }}>
                                                        <Plus size={14} style={{ marginRight: '6px' }} /> Einheit
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </>
                )}
            </Card>

            {/* Property Modal */}
            <Modal
                isOpen={isPropertyModalOpen}
                onClose={() => setIsPropertyModalOpen(false)}
                title={editingPropertyId ? "Immobilie bearbeiten" : "Neue Immobilie anlegen"}
                footer={<><Button variant="secondary" onClick={() => setIsPropertyModalOpen(false)}>Abbrechen</Button><Button onClick={handleSaveProperty}>Speichern</Button></>}
            >
                {isSaving && <LoadingOverlay message="Speichere Immobilie..." />}
                <div style={{ marginBottom: 'var(--spacing-md)' }}>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Portfolio *</label>
                    <select
                        style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}
                        value={propertyForm.portfolio_id}
                        onChange={async (e) => {
                            const val = e.target.value;
                            setPropertyForm(prev => ({ ...prev, portfolio_id: val }));
                            if (val) {
                                const conn = await resolveCloudConnection(val);
                                if (conn && conn.provider) {
                                    setPropertyProvider(conn.provider);
                                }
                            }
                        }}
                    >
                        <option value="">Bitte wählen...</option>
                        {portfolios.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    {portfolios.length === 0 && (
                        <div style={{ marginTop: '5px', fontSize: '0.875rem', color: 'var(--warning-color)' }}>
                            Kein Portfolio vorhanden. <Link to="/settings" style={{ textDecoration: 'underline' }}>Jetzt anlegen</Link>
                        </div>
                    )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: 'var(--spacing-md)' }}>
                    <Input label="Straße" value={propertyForm.street} onChange={(e) => setPropertyForm({ ...propertyForm, street: e.target.value })} />
                    <Input label="Nr." value={propertyForm.house_number} onChange={(e) => setPropertyForm({ ...propertyForm, house_number: e.target.value })} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 'var(--spacing-md)' }}>
                    <Input label="PLZ" value={propertyForm.zip} onChange={(e) => setPropertyForm({ ...propertyForm, zip: e.target.value })} />
                    <Input label="Ort" value={propertyForm.city} onChange={(e) => setPropertyForm({ ...propertyForm, city: e.target.value })} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                    <Input label="Baujahr" type="number" value={propertyForm.construction_year} onChange={(e) => setPropertyForm({ ...propertyForm, construction_year: e.target.value })} />
                    <div>
                        <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Typ</label>
                        <select
                            style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}
                            value={propertyForm.property_type}
                            onChange={(e) => setPropertyForm({ ...propertyForm, property_type: e.target.value })}
                        >
                            <option value="residential">Wohnen</option>
                            <option value="commercial">Gewerbe</option>
                            <option value="mixed">Gemischt</option>
                        </select>
                    </div>
                </div>
                
                {/* Economic Unit Selection (Checkboxes) */}
                <div style={{ marginTop: 'var(--spacing-md)' }}>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem', color: 'var(--accent-color)' }}>
                        Wirtschaftseinheit bilden mit (Mehrfachauswahl möglich)
                    </label>
                    <div style={{ 
                        border: '1px solid var(--accent-color)', 
                        borderRadius: 'var(--radius-md)', 
                        padding: '12px', 
                        backgroundColor: 'rgba(139, 92, 246, 0.05)',
                        maxHeight: '150px',
                        overflowY: 'auto'
                    }}>
                        {properties.filter(p => p.id !== editingPropertyId && (!propertyForm.portfolio_id || p.portfolio_id === propertyForm.portfolio_id)).length === 0 ? (
                            <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Keine weiteren Immobilien im Portfolio.</span>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {properties
                                    .filter(p => p.id !== editingPropertyId && (!propertyForm.portfolio_id || p.portfolio_id === propertyForm.portfolio_id))
                                    .map(p => (
                                    <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', cursor: 'pointer' }}>
                                        <input 
                                            type="checkbox" 
                                            checked={propertyForm.economic_unit_members?.includes(p.id)}
                                            onChange={(e) => {
                                                const checked = e.target.checked;
                                                setPropertyForm(prev => {
                                                    const members = prev.economic_unit_members || [];
                                                    if (checked) return { ...prev, economic_unit_members: [...members, p.id] };
                                                    return { ...prev, economic_unit_members: members.filter(id => id !== p.id) };
                                                });
                                            }}
                                            style={{ accentColor: 'var(--accent-color)', width: '16px', height: '16px' }}
                                        />
                                        {p.street} {p.house_number} {p.city}
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '6px' }}>
                        Wähle alle Gebäude aus, die zu dieser Wirtschaftseinheit gehören. Sie werden im Dashboard zusammengefasst.
                    </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)', marginTop: 'var(--spacing-md)' }}>
                    <CurrencyInput label="Gesamtinvestition (€)" value={propertyForm.total_investment_cost} onChange={(e) => setPropertyForm({ ...propertyForm, total_investment_cost: e.target.value })} />
                    <CurrencyInput label="Eigenkapital (€)" value={propertyForm.equity_invested} onChange={(e) => setPropertyForm({ ...propertyForm, equity_invested: e.target.value })} />
                </div>
                
                <div style={{ marginTop: 'var(--spacing-md)', borderTop: '1px solid var(--border-color)', paddingTop: 'var(--spacing-md)' }}>
                    <h4 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '2px' }}>Bilder & Titelbild</h4>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 'var(--spacing-sm)' }}>
                        Klicken Sie auf ein Bild, um es als Titelbild festzulegen.
                    </p>
                    <CloudImageManager 
                        provider={propertyProvider}
                        propertyFolderName={editingPropertyId ? getPropertyFolderName(properties.find(p => p.id === editingPropertyId), properties) : ''}
                        relativePath="Bilder"
                        currentThumbnailId={propertyForm.thumbnail_image}
                        onSelectThumbnail={(id) => setPropertyForm(prev => ({ ...prev, thumbnail_image: id }))}
                        isNewEntity={!editingPropertyId}
                        localFiles={newPropertyImages}
                        onLocalFilesChange={setNewPropertyImages}
                        pendingThumbnailIndex={pendingPropertyThumbnailIndex}
                        onSelectPendingThumbnail={setPendingPropertyThumbnailIndex}
                    />
                </div>
            </Modal>

            {/* Unit Modal */}
            <Modal
                isOpen={isUnitModalOpen}
                onClose={() => setIsUnitModalOpen(false)}
                title={editingUnitId ? "Einheit bearbeiten" : `Neue Einheit in ${currentPropertyForUnit?.street} ${currentPropertyForUnit?.house_number}`}
                footer={<><Button variant="secondary" onClick={() => setIsUnitModalOpen(false)}>Abbrechen</Button><Button onClick={handleSaveUnit}>Speichern</Button></>}
            >
                {isSaving && <LoadingOverlay message="Speichere Einheit..." />}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                    <Input label="Name / Nr." placeholder="Whg 1.01" value={unitForm.unit_name} onChange={(e) => setUnitForm({ ...unitForm, unit_name: e.target.value })} />
                    <Input label="Etage" placeholder="1. OG" value={unitForm.floor} onChange={(e) => setUnitForm({ ...unitForm, floor: e.target.value })} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                    <Input label="Fläche (m²)" type="number" value={unitForm.sqm} onChange={(e) => setUnitForm({ ...unitForm, sqm: e.target.value })} />
                    <Input label="Zimmer" type="number" value={unitForm.rooms} onChange={(e) => setUnitForm({ ...unitForm, rooms: e.target.value })} />
                </div>

                <div style={{ marginTop: 'var(--spacing-md)', borderTop: '1px solid var(--border-color)', paddingTop: 'var(--spacing-md)' }}>
                    <h4 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 'var(--spacing-sm)' }}>Finanzielle Daten (Soll/Ist)</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                        <CurrencyInput label="Kaltmiete Soll (€)" allowDecimals value={unitForm.target_rent} onChange={(e) => setUnitForm({ ...unitForm, target_rent: e.target.value })} />
                        <CurrencyInput label="Kaltmiete Ist (€)" allowDecimals value={unitForm.cold_rent_ist} onChange={(e) => setUnitForm({ ...unitForm, cold_rent_ist: e.target.value })} placeholder="Optional" />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)', marginTop: 'var(--spacing-md)' }}>
                        <CurrencyInput label="Nebenkosten Soll (€)" allowDecimals value={unitForm.service_charge_soll} onChange={(e) => setUnitForm({ ...unitForm, service_charge_soll: e.target.value })} />
                        <CurrencyInput label="Heizkosten Soll (€)" allowDecimals value={unitForm.heating_cost_soll} onChange={(e) => setUnitForm({ ...unitForm, heating_cost_soll: e.target.value })} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)', marginTop: 'var(--spacing-md)' }}>
                        <CurrencyInput label="Sonstige Kosten Soll (€)" allowDecimals value={unitForm.other_costs_soll} onChange={(e) => setUnitForm({ ...unitForm, other_costs_soll: e.target.value })} />
                        <CurrencyInput label="Kaution Soll (€)" allowDecimals value={unitForm.deposit_soll} onChange={(e) => setUnitForm({ ...unitForm, deposit_soll: e.target.value })} />
                    </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                    <Input label="Bad" type="number" value={unitForm.bathrooms} onChange={(e) => setUnitForm({ ...unitForm, bathrooms: e.target.value })} />
                    <Input label="Schlafzimmer" type="number" value={unitForm.bedrooms} onChange={(e) => setUnitForm({ ...unitForm, bedrooms: e.target.value })} />
                </div>
                <div style={{ marginTop: 'var(--spacing-md)', display: 'flex', gap: 'var(--spacing-lg)' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input type="checkbox" checked={unitForm.balcony} onChange={(e) => setUnitForm({ ...unitForm, balcony: e.target.checked })} /> Balkon
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input type="checkbox" checked={unitForm.fitted_kitchen} onChange={(e) => setUnitForm({ ...unitForm, fitted_kitchen: e.target.checked })} /> Einbauküche
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input type="checkbox" checked={unitForm.is_vacation_rental} onChange={(e) => setUnitForm({ ...unitForm, is_vacation_rental: e.target.checked })} /> Ferienwohnung
                    </label>
                </div>

                <div style={{ marginTop: 'var(--spacing-md)', borderTop: '1px solid var(--border-color)', paddingTop: 'var(--spacing-md)' }}>
                    <h4 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '2px' }}>Bilder & Titelbild</h4>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 'var(--spacing-sm)' }}>
                        Klicken Sie auf ein Bild, um es als Titelbild festzulegen.
                    </p>
                    <CloudImageManager 
                        provider={unitProvider}
                        propertyFolderName={currentPropertyForUnit ? getPropertyFolderName(currentPropertyForUnit, properties) : ''}
                        relativePath={
                            unitForm.unit_name && currentPropertyForUnit
                                ? (currentPropertyForUnit.economic_unit_id
                                    ? `${currentPropertyForUnit.house_number || 'Ohne Hausnummer'}/Einheiten/${unitForm.unit_name}/Bilder`
                                    : `Einheiten/${unitForm.unit_name}/Bilder`)
                                : ''
                        }
                        currentThumbnailId={unitForm.thumbnail_image}
                        onSelectThumbnail={(id) => setUnitForm(prev => ({ ...prev, thumbnail_image: id }))}
                        isNewEntity={!editingUnitId}
                        localFiles={newUnitImages}
                        onLocalFilesChange={setNewUnitImages}
                        pendingThumbnailIndex={pendingUnitThumbnailIndex}
                        onSelectPendingThumbnail={setPendingUnitThumbnailIndex}
                    />
                </div>
            </Modal>
        </div>
    );
};

export default Properties;
