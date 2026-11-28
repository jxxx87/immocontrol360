import { useState, useEffect, useMemo } from 'react';
import { supabase } from './supabase';
import { useAuth } from '../context/AuthContext';
import { usePortfolio } from '../context/PortfolioContext';
import { sanitizeLogoUrl, normalizeHexColor } from './pdfGenerator';
import { DEFAULT_ACCENT, DEFAULT_MARGIN, HEADER_H, FOOTER_H } from '../pages/pdf-template/constants';

/**
 * Default template shape (used when no data found).
 * isDefault: keine gespeicherte Vorlage – der Generator druckt dann das Standard-Layout des
 * Vorlagen-Editors (eine gespeicherte Vorlage mit 0 Elementen bleibt dagegen leer).
 * loadError: Meldung, wenn die Vorlage nicht geladen werden konnte (es gilt dann der Standard).
 */
const DEFAULT_TEMPLATE = {
    accentColor: DEFAULT_ACCENT,
    logoUrl: null,
    subtitle: '',
    elements: [],
    margin: DEFAULT_MARGIN,
    headerHeight: HEADER_H,
    footerHeight: FOOTER_H,
    orientationByReport: {},
    isDefault: true,
    loadError: null,
    loading: false,
};

/** Wird zurückgegeben, solange die Vorlage für die aktuelle Auswahl noch lädt (Export bis dahin sperren). */
const LOADING_TEMPLATE = { ...DEFAULT_TEMPLATE, loading: true };

const positiveNumber = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

const asObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

/**
 * Parse raw Supabase pdf_templates row into the app-level template object.
 * Werte aus der Datenbank werden dabei geprüft (Logo nur aus dem eigenen
 * Storage, Farbe nur als Hex-Wert), weil sie u. a. in Druckfenster gelangen.
 */
const parseRow = (data, reportType) => {
    if (!data) return null;
    const subtitles = asObject(data.subtitles_by_report_type);
    const orientByReport = asObject(data.orientation_by_report_type);
    const subtitle = subtitles['global'] || subtitles[reportType] || '';

    return {
        accentColor: normalizeHexColor(data.accent_color) || DEFAULT_ACCENT,
        logoUrl: sanitizeLogoUrl(data.logo_url),
        subtitle: typeof subtitle === 'string' ? subtitle : '',
        elements: Array.isArray(data.elements) ? data.elements : [],
        margin: positiveNumber(data.margin_mm, DEFAULT_MARGIN),
        headerHeight: positiveNumber(data.header_height_mm, HEADER_H),
        footerHeight: positiveNumber(data.footer_height_mm, FOOTER_H),
        orientationByReport: orientByReport,
        isDefault: false,
        loadError: null,
        loading: false,
    };
};

/** Lädt die Vorlage genau eines Portfolios (pdf_templates.portfolio_id ist eindeutig). */
const loadPortfolioTemplateRow = async (portfolioId) => {
    if (!portfolioId) return null;
    const { data, error } = await supabase
        .from('pdf_templates')
        .select('*')
        .eq('portfolio_id', portfolioId)
        .maybeSingle();
    if (error) throw error;
    return data || null;
};

/**
 * Nur wenn KEIN Portfolio gewählt ist („Alle Portfolios"): älteste Vorlage
 * eines EIGENEN Portfolios (fest sortiert). Nie die Vorlage eines nur
 * freigegebenen, fremden Portfolios.
 */
const loadOwnFallbackRow = async (ownPortfolioIds) => {
    if (!ownPortfolioIds.length) return null;
    const { data, error } = await supabase
        .from('pdf_templates')
        .select('*')
        .in('portfolio_id', ownPortfolioIds)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    return data || null;
};

/** Rückfall bei einem Ladefehler: Standard-Layout, aber mit sichtbarer Meldung für den Export. */
const failedTemplate = (err) => {
    console.warn('PDF-Vorlage konnte nicht geladen werden – Standard wird verwendet:', err?.message || err);
    return { ...DEFAULT_TEMPLATE, loadError: err?.message || 'Unbekannter Fehler' };
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
 *   orientationByReport, isDefault, loadError, loading
 *
 * Hat das gewählte Portfolio keine eigene Vorlage, gilt der Standard (wie im
 * Vorlagen-Editor angezeigt) – es wird keine Vorlage eines anderen Portfolios
 * übernommen.
 */
export const usePdfTemplate = (reportType, overridePortfolioId) => {
    const { user } = useAuth();
    const { selectedPortfolioID, portfolios } = usePortfolio();
    const portfolioId = overridePortfolioId || selectedPortfolioID || '';
    const userId = user?.id || null;

    const ownPortfolioKey = useMemo(() => {
        if (portfolioId || !userId) return '';
        return (portfolios || [])
            .filter(p => p && p.user_id === userId)
            .map(p => p.id)
            .join(',');
    }, [portfolioId, userId, portfolios]);

    const requestKey = userId ? `${userId}|${portfolioId}|${ownPortfolioKey}|${reportType || ''}` : null;
    const [result, setResult] = useState({ key: null, template: null });

    useEffect(() => {
        if (!requestKey) return undefined;
        let cancelled = false;
        const load = async () => {
            try {
                const row = portfolioId
                    ? await loadPortfolioTemplateRow(portfolioId)
                    : await loadOwnFallbackRow(ownPortfolioKey ? ownPortfolioKey.split(',') : []);
                return parseRow(row, reportType) || { ...DEFAULT_TEMPLATE };
            } catch (err) {
                return failedTemplate(err);
            }
        };
        load().then(template => {
            // Veraltete Antworten (Portfolio-/Typwechsel) verwerfen
            if (!cancelled) setResult({ key: requestKey, template });
        });
        return () => { cancelled = true; };
    }, [requestKey, portfolioId, ownPortfolioKey, reportType]);

    if (!requestKey) return DEFAULT_TEMPLATE;
    // Während des Ladens für die AKTUELLE Auswahl nie die Vorlage der vorherigen liefern
    if (result.key !== requestKey) return LOADING_TEMPLATE;
    return result.template;
};

/**
 * Standalone async function to fetch the PDF template for a specific portfolio.
 * Use this when you need to dynamically resolve the template at export time
 * (e.g. property → portfolio_id → template) without a React hook.
 *
 * @param {string} portfolioId
 * @param {string} [reportType]
 * @returns {Promise<object>} template object (same shape as usePdfTemplate); wirft nie –
 *   bei einem Ladefehler Standard mit loadError
 */
export const fetchPdfTemplate = async (portfolioId, reportType = '') => {
    try {
        // Kein portfolio-übergreifender Rückfall: ohne eigene Vorlage gilt der Standard.
        const row = await loadPortfolioTemplateRow(portfolioId);
        return parseRow(row, reportType) || { ...DEFAULT_TEMPLATE };
    } catch (err) {
        return failedTemplate(err);
    }
};
