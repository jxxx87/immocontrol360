import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { FileText, Download, AlertTriangle, Loader2, Shield, X, Palette } from 'lucide-react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { REPORT_CONFIGS, getColumnsForPreset, generateFilename } from '../lib/reportConfigs';
import { generateClientPdf } from '../lib/pdfGenerator';
import { usePortfolio } from '../context/PortfolioContext';
import { useAuth } from '../context/AuthContext';
import { usePdfTemplate, fetchPdfTemplate } from '../lib/usePdfTemplate';

// ─── Export Modal ────────────────────────────────────────────────────
const ExportModal = ({
    isOpen,
    onClose,
    reportType,
    data = [],              // Actual row data from the page
    unitData = null,        // Optional unit details keyed by property_id
    properties = [],        // Available properties for "only property" filter
    currentFilters = {},
    currentSearch = '',
    currentSort = null,
    totalRows = 0,
}) => {
    const { user } = useAuth();
    const { selectedPortfolioID, portfolios } = usePortfolio();
    const navigate = useNavigate();
    const location = useLocation();
    const config = REPORT_CONFIGS[reportType];
    const portfolio = portfolios?.find(p => p.id === selectedPortfolioID);
    const pdfTemplate = usePdfTemplate(reportType);

    // ─── State ──────────────────────────────────
    const [scope, setScope] = useState('current');
    const [selectedPropertyId, setSelectedPropertyId] = useState('');
    const [selectedColumns, setSelectedColumns] = useState(() => getColumnsForPreset(reportType, 'compact'));
    const [showSums, setShowSums] = useState(config?.sumsEnabled ?? false);
    const [groupByProperty, setGroupByProperty] = useState(false);
    const [dsgvoAnonymize, setDsgvoAnonymize] = useState(false);
    const [extraOptions, setExtraOptions] = useState(() => {
        const opts = {};
        (config?.extraOptions || []).forEach(o => { opts[o.key] = o.default ?? false; });
        return opts;
    });
    const [generating, setGenerating] = useState(false);
    const [error, setError] = useState(null);

    if (!config) return null;

    const getPropertyLabel = (p) => p?.label || `${p?.street || ''} ${p?.house_number || ''}`.trim() || '–';
    const selectedProperty = properties.find(p => p.id === selectedPropertyId);
    const propertyLabel = selectedProperty ? getPropertyLabel(selectedProperty) : null;
    const filename = generateFilename(reportType, portfolio?.name, propertyLabel);
    const rowCount = data.length || totalRows;
    const isLargeExport = rowCount > 300;

    // ─── Toggle column ──────────────────────────
    const toggleColumn = (key) => {
        const col = config.columns.find(c => c.key === key);
        if (col?.always) return;
        setSelectedColumns(prev =>
            prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
        );
    };

    // ─── Apply preset ────────────────────────────
    const applyPreset = (preset) => {
        setSelectedColumns(getColumnsForPreset(reportType, preset));
    };

    // ─── Generate PDF (Client-Side) ─────────────
    const handleGenerate = async () => {
        setGenerating(true);
        setError(null);
        try {
            // Filter data based on scope
            let filteredData = [...data];

            if (scope === 'property' && selectedPropertyId) {
                filteredData = filteredData.filter(row =>
                    row.property_id === selectedPropertyId ||
                    row.propertyId === selectedPropertyId
                );
            }

            if (filteredData.length === 0) {
                throw new Error('Keine Daten zum Exportieren vorhanden');
            }

            // Resolve template: if filtering by property, use that property's portfolio template
            let effectiveTemplate = pdfTemplate;
            if (scope === 'property' && selectedPropertyId) {
                const prop = properties.find(p => p.id === selectedPropertyId);
                if (prop?.portfolio_id && prop.portfolio_id !== selectedPortfolioID) {
                    effectiveTemplate = await fetchPdfTemplate(prop.portfolio_id, reportType);
                }
            }

            generateClientPdf({
                reportType,
                data: filteredData,
                selectedColumns,
                orientation: null, // taken from template
                showSums,
                groupByProperty,
                dsgvoAnonymize,
                portfolioName: portfolio?.name || '',
                propertyName: propertyLabel,
                template: effectiveTemplate,
                extraOptions,
                unitData,
            });

            onClose();
        } catch (err) {
            console.error('PDF generation error:', err);
            setError(err.message || 'PDF konnte nicht erstellt werden');
        } finally {
            setGenerating(false);
        }
    };

    // ─── Styles ─────────────────────────────────
    const sectionStyle = { marginBottom: '20px' };
    const sectionTitleStyle = { fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '10px', letterSpacing: '0.01em' };
    const radioStyle = { display: 'flex', flexDirection: 'column', gap: '8px' };
    const radioLabelStyle = { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', cursor: 'pointer', padding: '6px 10px', borderRadius: '8px', transition: 'background 0.15s' };
    const chipContainerStyle = { display: 'flex', flexWrap: 'wrap', gap: '6px' };
    const chipStyle = (active, disabled) => ({
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        padding: '5px 12px', borderRadius: '16px', fontSize: '0.78rem', fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        border: `1px solid ${active ? 'var(--primary-color)' : 'var(--border-color)'}`,
        background: active ? 'rgba(14,165,233,0.08)' : 'transparent',
        color: active ? 'var(--primary-color)' : 'var(--text-secondary)',
        opacity: disabled ? 0.5 : 1,
        transition: 'all 0.15s',
    });
    const toggleRowStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid var(--border-color)' };
    const toggleLabelStyle = { fontSize: '0.84rem', color: 'var(--text-primary)' };
    const toggleSwitchStyle = (on) => ({
        width: '36px', height: '20px', borderRadius: '10px', position: 'relative', cursor: 'pointer',
        background: on ? 'var(--primary-color)' : 'var(--border-color)', transition: 'background 0.2s',
        border: 'none', padding: 0,
    });
    const toggleKnobStyle = (on) => ({
        width: '16px', height: '16px', borderRadius: '50%', background: '#fff',
        position: 'absolute', top: '2px', left: on ? '18px' : '2px', transition: 'left 0.2s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
    });

    const Toggle = ({ value, onChange, label }) => (
        <div style={toggleRowStyle}>
            <span style={toggleLabelStyle}>{label}</span>
            <button type="button" style={toggleSwitchStyle(value)} onClick={() => onChange(!value)}>
                <div style={toggleKnobStyle(value)} />
            </button>
        </div>
    );

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <FileText size={20} color="var(--primary-color)" />
                    PDF Export – {config.label}
                </div>
            }
            footer={
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', width: '100%' }}>
                    <Button variant="secondary" onClick={onClose} disabled={generating}>Abbrechen</Button>
                    <Button
                        icon={generating ? Loader2 : Download}
                        onClick={handleGenerate}
                        disabled={generating || selectedColumns.length === 0}
                    >
                        {generating ? 'Wird erstellt…' : 'PDF erstellen'}
                    </Button>
                </div>
            }
        >
            <div style={{ maxHeight: '60vh', overflowY: 'auto', padding: '0 4px' }}>

                {/* ─── Section A: Scope ─────────── */}
                <div style={sectionStyle}>
                    <div style={sectionTitleStyle}>Umfang</div>
                    <div style={radioStyle}>
                        <label style={{ ...radioLabelStyle, background: scope === 'current' ? 'rgba(14,165,233,0.06)' : 'transparent' }}>
                            <input type="radio" name="scope" value="current" checked={scope === 'current'} onChange={() => setScope('current')} />
                            Aktuelle Ansicht ({rowCount} Einträge)
                        </label>
                        <label style={{ ...radioLabelStyle, background: scope === 'all' ? 'rgba(14,165,233,0.06)' : 'transparent' }}>
                            <input type="radio" name="scope" value="all" checked={scope === 'all'} onChange={() => setScope('all')} />
                            Gesamte Liste (ohne Filter)
                        </label>
                        {properties.length > 0 && (
                            <label style={{ ...radioLabelStyle, background: scope === 'property' ? 'rgba(14,165,233,0.06)' : 'transparent' }}>
                                <input type="radio" name="scope" value="property" checked={scope === 'property'} onChange={() => setScope('property')} />
                                Nur Immobilie:
                                {scope === 'property' && (
                                    <select
                                        value={selectedPropertyId}
                                        onChange={e => setSelectedPropertyId(e.target.value)}
                                        style={{ marginLeft: '8px', padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.82rem' }}
                                        onClick={e => e.stopPropagation()}
                                    >
                                        <option value="">Auswählen…</option>
                                        {properties.map(p => (
                                            <option key={p.id} value={p.id}>{getPropertyLabel(p)}</option>
                                        ))}
                                    </select>
                                )}
                            </label>
                        )}
                    </div>
                </div>

                {/* ─── Section B: Content ─────────── */}
                <div style={sectionStyle}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                        <div style={sectionTitleStyle}>Spalten</div>
                        <div style={{ display: 'flex', gap: '6px' }}>
                            <button onClick={() => applyPreset('compact')} style={{ ...chipStyle(false, false), fontSize: '0.7rem', padding: '3px 8px' }}>Kompakt</button>
                            <button onClick={() => applyPreset('detail')} style={{ ...chipStyle(false, false), fontSize: '0.7rem', padding: '3px 8px' }}>Detailliert</button>
                        </div>
                    </div>
                    <div style={chipContainerStyle}>
                        {config.columns.filter(c => !c.isChart || selectedColumns.includes(c.key)).map(col => (
                            <button
                                key={col.key}
                                style={chipStyle(selectedColumns.includes(col.key), col.always)}
                                onClick={() => toggleColumn(col.key)}
                            >
                                {col.always && '✓ '}{col.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* ─── Toggles ─────────── */}
                <div style={sectionStyle}>
                    {config.sumsEnabled && (
                        <Toggle value={showSums} onChange={setShowSums} label="Summen anzeigen" />
                    )}
                    {config.groupByProperty && (
                        <Toggle value={groupByProperty} onChange={setGroupByProperty} label="Gruppieren nach Immobilie" />
                    )}
                    {config.dsgvoRelevant && (
                        <div style={{ ...toggleRowStyle, borderTop: '1px solid var(--border-color)' }}>
                            <span style={{ ...toggleLabelStyle, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Shield size={14} color="var(--primary-color)" /> DSGVO anonymisieren
                            </span>
                            <button type="button" style={toggleSwitchStyle(dsgvoAnonymize)} onClick={() => setDsgvoAnonymize(!dsgvoAnonymize)}>
                                <div style={toggleKnobStyle(dsgvoAnonymize)} />
                            </button>
                        </div>
                    )}
                    {(config.extraOptions || []).map(opt => (
                        <Toggle
                            key={opt.key}
                            value={extraOptions[opt.key]}
                            onChange={v => setExtraOptions(prev => ({ ...prev, [opt.key]: v }))}
                            label={opt.label}
                        />
                    ))}
                </div>

                {/* ─── Section C: Options ─────────── */}
                <div style={sectionStyle}>
                    <div style={sectionTitleStyle}>Report Optionen</div>
                    <div style={{ padding: '10px 12px', borderRadius: '8px', background: 'var(--background-color)', fontSize: '0.8rem' }}>
                        <div style={{ display: 'flex', gap: '6px', marginBottom: '4px', color: 'var(--text-secondary)' }}>
                            <FileText size={13} /> Dateiname:
                        </div>
                        <div style={{ fontWeight: 500, fontFamily: 'monospace', fontSize: '0.78rem', wordBreak: 'break-all' }}>{filename}</div>
                    </div>

                    {isLargeExport && (
                        <div style={{
                            marginTop: '10px', padding: '10px 12px', borderRadius: '8px',
                            background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)',
                            display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: '#d97706',
                        }}>
                            <AlertTriangle size={16} />
                            Großer Export ({rowCount} Zeilen)
                        </div>
                    )}

                    {error && (
                        <div style={{
                            marginTop: '10px', padding: '10px 12px', borderRadius: '8px',
                            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.8rem', color: '#dc2626',
                        }}>
                            <span>{error}</span>
                            <button
                                onClick={handleGenerate}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontWeight: 600, fontSize: '0.78rem', textDecoration: 'underline' }}
                            >
                                Erneut versuchen
                            </button>
                        </div>
                    )}
                </div>

                {/* Link to template editor */}
                <div style={{ marginTop: '12px', textAlign: 'center' }}>
                    <button
                        onClick={() => { onClose(); navigate('/portfolio/settings/pdf-template', { state: { from: location.pathname } }); }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--primary-color)', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                    >
                        <Palette size={13} /> PDF-Vorlage bearbeiten (Logo, Layout, Farben)
                    </button>
                </div>
            </div>
        </Modal>
    );
};

export default ExportModal;
