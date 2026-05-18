import { useState, useEffect } from 'react';
import { supabase } from './supabase';
import { useAuth } from '../context/AuthContext';
import { usePortfolio } from '../context/PortfolioContext';

/** Default template shape (used when no data found) */
const DEFAULT_TEMPLATE = {
    accentColor: '#0ea5e9',
    logoUrl: null,
    subtitle: '',
    elements: [],
    margin: 15,
    headerHeight: 50,
    footerHeight: 20,
    orientationByReport: {},
    elementsByReportOrientation: {},
    loading: false,
};

/**
 * Parse raw Supabase pdf_templates row into the app-level template object.
 */
const parseRow = (data, reportType) => {
    if (!data) return null;
    const subtitles = data.subtitles_by_report_type || {};
    const orientByReport = data.orientation_by_report_type || {};
    const elsByReportOri = data.elements_by_report_orientation || {};

    return {
        accentColor: data.accent_color || '#0ea5e9',
        logoUrl: data.logo_url || null,
        subtitle: subtitles['global'] || subtitles[reportType] || '',
        elements: data.elements || [],
        margin: data.margin_mm || 15,
        headerHeight: data.header_height_mm || 50,
        footerHeight: data.footer_height_mm || 20,
        orientationByReport: orientByReport,
        elementsByReportOrientation: elsByReportOri,
        loading: false,
    };
};

/**
 * Hook to load the full PDF template settings from Supabase.
 * 
 * @param {string} reportType - The report type (e.g. 'nebenkostenabrechnung')
 * @param {string} [overridePortfolioId] - Optional: use this portfolio ID instead of the
 *   globally selected one. Useful when you know which property/portfolio the export belongs to.
 * 
 * Returns all fields needed for pixel-perfect rendering:
 *   accentColor, logoUrl, subtitle, elements, margin, headerHeight, footerHeight,
 *   orientationByReport, elementsByReportOrientation, loading
 */
export const usePdfTemplate = (reportType, overridePortfolioId) => {
    const { user } = useAuth();
    const { selectedPortfolioID } = usePortfolio();
    const portfolioId = overridePortfolioId || selectedPortfolioID;

    const [template, setTemplate] = useState({ ...DEFAULT_TEMPLATE, loading: true });

    useEffect(() => {
        if (!user) {
            setTemplate(prev => ({ ...prev, loading: false }));
            return;
        }

        const load = async () => {
            try {
                let data = null;
                if (portfolioId) {
                    // Try specific portfolio template first
                    const res = await supabase
                        .from('pdf_templates')
                        .select('*')
                        .eq('portfolio_id', portfolioId)
                        .single();
                    data = res.data;
                }
                // Fallback: load first available template for the user
                if (!data) {
                    const res = await supabase
                        .from('pdf_templates')
                        .select('*')
                        .limit(1)
                        .maybeSingle();
                    data = res.data;
                }

                const parsed = parseRow(data, reportType);
                setTemplate(parsed || { ...DEFAULT_TEMPLATE, loading: false });
            } catch {
                setTemplate({ ...DEFAULT_TEMPLATE, loading: false });
            }
        };

        load();
    }, [user, portfolioId, reportType]);

    return template;
};

/**
 * Standalone async function to fetch the PDF template for a specific portfolio.
 * Use this when you need to dynamically resolve the template at export time
 * (e.g. property → portfolio_id → template) without a React hook.
 *
 * @param {string} portfolioId
 * @param {string} [reportType]
 * @returns {Promise<object>} template object (same shape as usePdfTemplate)
 */
export const fetchPdfTemplate = async (portfolioId, reportType = '') => {
    try {
        let data = null;
        if (portfolioId) {
            const res = await supabase
                .from('pdf_templates')
                .select('*')
                .eq('portfolio_id', portfolioId)
                .single();
            data = res.data;
        }
        // Fallback: load first available template
        if (!data) {
            const res = await supabase
                .from('pdf_templates')
                .select('*')
                .limit(1)
                .maybeSingle();
            data = res.data;
        }
        return parseRow(data, reportType) || { ...DEFAULT_TEMPLATE };
    } catch {
        return { ...DEFAULT_TEMPLATE };
    }
};
