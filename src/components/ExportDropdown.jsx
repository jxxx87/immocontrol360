import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ChevronDown, FileText, Settings2, Palette } from 'lucide-react';
import ExportModal from './ExportModal';
import { getColumnsForPreset } from '../lib/reportConfigs';
import { generateClientPdf } from '../lib/pdfGenerator';
import { usePortfolio } from '../context/PortfolioContext';
import { usePdfTemplate } from '../lib/usePdfTemplate';

// ─── Export Dropdown ─────────────────────────────────────────────────
const ExportDropdown = ({
    reportType,
    data = [],
    unitData = null,
    properties = [],
    currentFilters = {},
    currentSearch = '',
    currentSort = null,
    totalRows = 0,
    label = 'Export',
}) => {
    const [open, setOpen] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const ref = useRef(null);
    const navigate = useNavigate();
    const location = useLocation();
    const { selectedPortfolioID, portfolios } = usePortfolio();
    const portfolio = portfolios?.find(p => p.id === selectedPortfolioID);
    const pdfTemplate = usePdfTemplate(reportType);

    // Close on outside click
    useEffect(() => {
        const handler = (e) => {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false);
        };
        if (open) document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    // Quick export handlers
    const handleQuickExport = (preset) => {
        setOpen(false);
        const columns = getColumnsForPreset(reportType, preset);
        generateClientPdf({
            reportType,
            data,
            selectedColumns: columns,
            showSums: true,
            portfolioName: portfolio?.name || '',
            template: pdfTemplate,
        });
    };

    const btnStyle = {
        display: 'flex', alignItems: 'center', gap: '6px',
        padding: '8px 14px', borderRadius: '8px', border: '1px solid var(--border-color)',
        background: 'var(--surface-color)', cursor: 'pointer', fontSize: '0.85rem',
        fontWeight: 500, color: 'var(--text-primary)', transition: 'all 0.15s',
    };
    const dropdownStyle = {
        position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 100,
        background: 'var(--surface-color)', border: '1px solid var(--border-color)',
        borderRadius: '10px', boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
        minWidth: '220px', overflow: 'hidden',
    };
    const itemStyle = {
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '10px 14px', border: 'none', background: 'none', width: '100%',
        cursor: 'pointer', fontSize: '0.84rem', color: 'var(--text-primary)',
        textAlign: 'left', transition: 'background 0.1s',
    };
    const dividerStyle = { height: '1px', background: 'var(--border-color)', margin: '2px 0' };

    return (
        <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
            <button style={btnStyle} onClick={() => setOpen(!open)}>
                <FileText size={15} />
                {label}
                <ChevronDown size={14} style={{ opacity: 0.5, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            </button>

            {open && (
                <div style={dropdownStyle}>
                    <button
                        style={itemStyle}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--background-color)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'none'}
                        onClick={() => handleQuickExport('compact')}
                    >
                        <FileText size={15} color="var(--primary-color)" />
                        <div>
                            <div style={{ fontWeight: 500 }}>PDF (Kompakt)</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Wesentliche Spalten</div>
                        </div>
                    </button>
                    <button
                        style={itemStyle}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--background-color)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'none'}
                        onClick={() => handleQuickExport('detail')}
                    >
                        <FileText size={15} color="var(--text-secondary)" />
                        <div>
                            <div style={{ fontWeight: 500 }}>PDF (Detailliert)</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Alle verfügbaren Spalten</div>
                        </div>
                    </button>
                    <div style={dividerStyle} />
                    <button
                        style={itemStyle}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--background-color)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'none'}
                        onClick={() => { setOpen(false); setModalOpen(true); }}
                    >
                        <Settings2 size={15} color="var(--text-secondary)" />
                        <div>
                            <div style={{ fontWeight: 500 }}>PDF (Benutzerdefiniert…)</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Spalten & Optionen wählen</div>
                        </div>
                    </button>
                    <div style={dividerStyle} />
                    <button
                        style={itemStyle}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--background-color)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'none'}
                        onClick={() => {
                            setOpen(false);
                            navigate('/portfolio/settings/pdf-template', { state: { from: location.pathname } });
                        }}
                    >
                        <Palette size={15} color="var(--text-secondary)" />
                        <div>
                            <div style={{ fontWeight: 500 }}>PDF-Vorlage bearbeiten</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Logo, Layout & Farben anpassen</div>
                        </div>
                    </button>
                </div>
            )}

            <ExportModal
                isOpen={modalOpen}
                onClose={() => setModalOpen(false)}
                reportType={reportType}
                data={data}
                unitData={unitData}
                properties={properties}
                currentFilters={currentFilters}
                currentSearch={currentSearch}
                currentSort={currentSort}
                totalRows={totalRows}
            />
        </div>
    );
};

export default ExportDropdown;
