import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, ChevronDown, ChevronUp, Link as LinkIcon, Check } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import MainLayout from '../layouts/MainLayout';
import { faqCategories, TRIAL_DAYS } from '../data/faqData';
import { SITE_URL } from '../components/siteConfig';
import ContactForm from '../components/sections/ContactForm';

// Früherer Anker (aus dem Fragetext, Umlaute ersatzlos entfernt) – bereits geteilte Links funktionieren weiter;
// für umformulierte Fragen stehen die alten Anker zusätzlich in faqData (legacyAnchors)
const legacySlug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const slugify = (text) => text.toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// Kategorien ohne Fragen ausblenden; jede Frage bekommt einen eindeutigen Anker,
// der weder mit einer Kategorie noch mit anderen IDs der Seite kollidiert.
const visibleCategories = (() => {
    const cats = faqCategories.filter(cat => cat.items.length > 0);
    const used = new Set(['contact', ...cats.map(cat => cat.id)]);
    return cats.map(cat => ({
        ...cat,
        items: cat.items.map(item => {
            const base = item.id || slugify(item.q) || 'frage';
            let anchor = base;
            for (let n = 2; used.has(anchor); n++) anchor = `${base}-${n}`;
            used.add(anchor);
            // Frühere Anker: aus dem aktuellen Fragetext plus (bei umformulierten Fragen) die in faqData hinterlegten
            return { ...item, anchor, legacyAnchors: [legacySlug(item.q), ...(item.legacyAnchors || [])] };
        })
    }));
})();

// #hash → { anchor, isItem } (Frage, auch über den früheren Anker) oder Kategorie
const resolveHash = (hash) => {
    let target = (hash || '').replace(/^#/, '');
    try { target = decodeURIComponent(target); } catch { /* ungültige Kodierung: unverändert lassen */ }
    if (!target) return null;
    for (const cat of visibleCategories) {
        if (cat.id === target) return { anchor: cat.id, isItem: false };
        const item = cat.items.find(it => it.anchor === target || it.legacyAnchors.includes(target));
        if (item) return { anchor: item.anchor, isItem: true };
    }
    return null;
};

// In die Zwischenablage kopieren – mit Rückfall für ältere Browser/unsichere Kontexte
const copyToClipboard = async (text) => {
    try {
        if (window.isSecureContext && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch { /* Rückfall unten */ }
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
    } catch {
        return false;
    }
};

const FAQItem = ({ anchor, question, answer, isOpen, onToggle }) => {
    const [copyState, setCopyState] = useState(null); // null | 'copied' | 'failed'
    const resetTimer = useRef(null);

    useEffect(() => () => clearTimeout(resetTimer.current), []);

    const copyLink = async (e) => {
        e.stopPropagation();
        const url = `${window.location.origin}${window.location.pathname}#${anchor}`;
        const ok = await copyToClipboard(url);
        if (!ok) {
            // Link wenigstens in die Adresszeile schreiben, damit er von dort kopiert werden kann
            try { window.history.replaceState(window.history.state, '', `#${anchor}`); } catch { /* ignorieren */ }
        }
        setCopyState(ok ? 'copied' : 'failed');
        clearTimeout(resetTimer.current);
        resetTimer.current = setTimeout(() => setCopyState(null), ok ? 2000 : 5000);
    };

    return (
        <div id={anchor} className="border-b border-slate-200 last:border-0 scroll-mt-24">
            <button
                onClick={onToggle}
                aria-expanded={isOpen}
                aria-controls={`${anchor}-antwort`}
                className="w-full py-6 flex items-start justify-between text-left group hover:bg-slate-50/50 transition-colors px-4 -mx-4 rounded-lg"
            >
                <h3 className="text-lg font-semibold text-slate-900 pr-8 group-hover:text-primary transition-colors">
                    {question}
                </h3>
                <span className={`flex-shrink-0 ml-4 p-1 rounded-full ${isOpen ? 'bg-primary/10 text-primary' : 'text-slate-400 group-hover:text-primary/70'}`}>
                    {isOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                </span>
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        id={`${anchor}-antwort`}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                    >
                        <div className="pb-6 text-slate-600 leading-relaxed max-w-3xl">
                            {answer}
                            <div className="mt-4 pt-4 border-t border-slate-100 flex items-center gap-2">
                                <button
                                    onClick={copyLink}
                                    className="text-xs font-medium text-slate-400 hover:text-primary flex items-center gap-1.5 transition-colors"
                                >
                                    {copyState === 'copied' ? <Check size={14} className="text-green-500" /> : <LinkIcon size={14} />}
                                    {copyState === 'copied'
                                        ? 'Link kopiert!'
                                        : copyState === 'failed'
                                            ? 'Kopieren nicht möglich – bitte den Link aus der Adresszeile kopieren'
                                            : 'Link kopieren'}
                                </button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

const FAQPage = () => {
    const location = useLocation();
    const [searchQuery, setSearchQuery] = useState('');
    const [activeCategory, setActiveCategory] = useState(visibleCategories[0]?.id);
    // Geöffnete Fragen; eine per Link (#anker) aufgerufene Frage ist direkt aufgeklappt
    const [openAnchors, setOpenAnchors] = useState(() => {
        const target = resolveHash(location.hash);
        return new Set(target?.isItem ? [target.anchor] : []);
    });

    const toggleItem = (anchor) => {
        setOpenAnchors(prev => {
            const next = new Set(prev);
            if (next.has(anchor)) next.delete(anchor);
            else next.add(anchor);
            return next;
        });
    };

    // Scroll spy effect for sticky nav
    useEffect(() => {
        const handleScroll = () => {
            const sections = visibleCategories.map(cat => document.getElementById(cat.id));
            const scrollPosition = window.scrollY + 150; // Offset

            for (const section of sections) {
                if (section && section.offsetTop <= scrollPosition && (section.offsetTop + section.offsetHeight) > scrollPosition) {
                    setActiveCategory(section.id);
                }
            }
        };

        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    // Hash-Links (beim Laden und bei späteren Hash-Wechseln): Frage aufklappen und hinscrollen
    useEffect(() => {
        const target = resolveHash(location.hash);
        if (!target) return;
        const timer = setTimeout(() => {
            if (target.isItem) {
                setOpenAnchors(prev => (prev.has(target.anchor) ? prev : new Set(prev).add(target.anchor)));
            }
            document.getElementById(target.anchor)?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
        return () => clearTimeout(timer);
    }, [location]);

    // JSON-LD Schema (alle Fragen)
    useEffect(() => {
        const schema = {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": visibleCategories.flatMap(cat => cat.items.map(item => ({
                "@type": "Question",
                "name": item.q,
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": item.a
                }
            })))
        };

        const script = document.createElement('script');
        script.type = 'application/ld+json';
        script.text = JSON.stringify(schema);
        document.head.appendChild(script);

        return () => {
            document.head.removeChild(script);
        };
    }, []);

    const filteredCategories = searchQuery
        ? visibleCategories.map(cat => ({
            ...cat,
            items: cat.items.filter(item =>
                item.q.toLowerCase().includes(searchQuery.toLowerCase()) ||
                item.a.toLowerCase().includes(searchQuery.toLowerCase())
            )
        })).filter(cat => cat.items.length > 0)
        : visibleCategories;

    const scrollToCategory = (id) => {
        const element = document.getElementById(id);
        if (element) {
            const offset = 120; // sticky header height
            const elementPosition = element.getBoundingClientRect().top;
            const offsetPosition = elementPosition + window.pageYOffset - offset;
            window.scrollTo({
                top: offsetPosition,
                behavior: "smooth"
            });
            setActiveCategory(id);
        }
    };

    return (
        <MainLayout>
            {/* SEO Meta Tags */}
            <title>FAQ | ImmoControlPro360 – Antworten für Investoren</title>
            <meta name="description" content={`Antworten zu Preisen, Funktionen, Testphase, Sicherheit, Mieterportal, Ticketsystem und Datenimport. ImmoControlPro360 – ${TRIAL_DAYS} Tage kostenlos testen.`} />
            <link rel="canonical" href={`${SITE_URL}/faq`} />

            {/* Premium Blue Hero */}
            <section className="bg-primary pt-32 pb-24 border-b border-white/10 relative overflow-hidden rounded-b-[3rem] md:rounded-b-[5rem] shadow-xl shadow-blue-900/20">
                {/* Background Gradients */}
                <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-white/10 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2 pointer-events-none" />
                <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-indigo-600/30 rounded-full blur-[100px] translate-y-1/2 -translate-x-1/4 pointer-events-none" />
                <div className="absolute inset-x-0 bottom-0 h-px bg-white/10" />

                <div className="container max-w-4xl mx-auto text-center px-4 relative z-10">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5 }}
                    >
                        <h1 className="text-4xl md:text-5xl font-bold text-white mb-6 drop-shadow-sm">Häufige Fragen</h1>
                        <p className="text-xl text-blue-50 mb-10 max-w-2xl mx-auto font-light leading-relaxed drop-shadow-sm">
                            Alles Wichtige zu Funktionen, Plänen, Testphase und Sicherheit – klar und schnell beantwortet.
                        </p>

                        <div className="relative max-w-2xl mx-auto">
                            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                <Search className="text-slate-400" size={20} />
                            </div>
                            <input
                                type="text"
                                placeholder="Suche nach Themen wie ‚Tickets‘, ‚Sanierungsrechner‘, ‚Preise‘ …"
                                className="w-full pl-12 pr-4 py-4 rounded-xl border border-white/20 shadow-lg focus:border-white focus:ring-2 focus:ring-white/30 transition-all text-lg outline-none bg-white/95 text-slate-900 placeholder:text-slate-400 backdrop-blur"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>

                        <p className="mt-6 text-sm text-blue-200 font-medium">
                            Du findest keine Antwort? Schreib uns über <a href="#contact" className="text-white underline hover:text-blue-100 decoration-blue-300 underline-offset-4">das Kontaktformular</a>.
                        </p>
                    </motion.div>
                </div>
            </section>

            <div className="container max-w-7xl mx-auto flex flex-col lg:flex-row gap-12 py-12 relative">
                {/* Sticky Sidebar */}
                <aside className="lg:w-64 flex-shrink-0">
                    <div className="sticky top-24 z-30 bg-white lg:bg-transparent py-2 lg:py-0 -mx-4 px-4 lg:mx-0 lg:px-0 border-b lg:border-0 border-slate-100 overflow-x-auto">
                        <nav className="flex lg:flex-col gap-2 min-w-max lg:min-w-0">
                            {filteredCategories.map((cat) => (
                                <button
                                    key={cat.id}
                                    onClick={() => scrollToCategory(cat.id)}
                                    className={`px-4 py-2.5 rounded-lg text-sm font-medium text-left transition-all whitespace-nowrap lg:whitespace-normal
                    ${activeCategory === cat.id
                                            ? 'bg-primary text-white shadow-md shadow-primary/20'
                                            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                                        }`}
                                >
                                    {cat.label}
                                </button>
                            ))}
                        </nav>
                    </div>
                </aside>

                {/* Content */}
                <main className="flex-1 min-w-0">
                    {filteredCategories.length > 0 ? (
                        <div className="space-y-16">
                            {filteredCategories.map((cat) => (
                                <section key={cat.id} id={cat.id} className="scroll-mt-32">
                                    <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-3">
                                        {cat.label}
                                        <span className="text-sm font-normal text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                                            {cat.items.length}
                                        </span>
                                    </h2>
                                    <div className="">
                                        {cat.items.map((item) => (
                                            <FAQItem
                                                key={item.anchor}
                                                anchor={item.anchor}
                                                question={item.q}
                                                answer={item.a}
                                                isOpen={openAnchors.has(item.anchor)}
                                                onToggle={() => toggleItem(item.anchor)}
                                            />
                                        ))}
                                    </div>
                                </section>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-20 bg-slate-50 rounded-2xl border border-slate-100 border-dashed">
                            <p className="text-slate-500 text-lg">Keine Ergebnisse für "{searchQuery}" gefunden.</p>
                            <button
                                onClick={() => setSearchQuery('')}
                                className="mt-4 text-primary font-medium hover:underline"
                            >
                                Suche zurücksetzen
                            </button>
                        </div>
                    )}
                </main>
            </div>

            {/* Contact Form Section */}
            <ContactForm />

            {/* Premium Blue CTA Section */}
            <section className="bg-primary py-24 relative overflow-hidden rounded-t-[3rem] md:rounded-t-[5rem] shadow-[0_-20px_60px_-15px_rgba(14,165,233,0.15)] -mt-12 pt-32">
                {/* Background Gradients */}
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-white/10 rounded-full blur-[100px] pointer-events-none -translate-y-1/2 translate-x-1/2" />
                <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-indigo-600/30 rounded-full blur-[100px] pointer-events-none translate-y-1/2 -translate-x-1/4" />
                <div className="absolute inset-x-0 top-0 h-px bg-white/10" />

                <div className="container relative z-10 text-center text-white max-w-3xl mx-auto">
                    <h2 className="text-3xl md:text-5xl font-bold mb-8 drop-shadow-sm">Bereit für mehr Kontrolle?</h2>
                    <p className="text-xl text-blue-50 mb-10 leading-relaxed font-light drop-shadow-sm">
                        Teste ImmoControlPro360 {TRIAL_DAYS} Tage kostenlos und bring Struktur in dein Portfolio.
                    </p>
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                        <Link
                            to="/register-trial"
                            className="bg-white text-primary hover:bg-blue-50 px-8 py-4 rounded-lg font-bold text-lg w-full sm:w-auto shadow-xl shadow-black/20 hover:shadow-black/30 hover:scale-105 transition-transform border-none"
                        >
                            {TRIAL_DAYS} Tage kostenlos testen
                        </Link>
                        <Link
                            to="/preise"
                            className="px-8 py-4 rounded-lg font-semibold bg-white/10 text-white hover:bg-white/20 border border-white/20 transition-all w-full sm:w-auto backdrop-blur-sm"
                        >
                            Preise ansehen
                        </Link>
                    </div>
                    <p className="mt-10 text-sm text-blue-200 flex items-center justify-center gap-2 font-medium">
                        <Check size={16} className="text-white" /> Keine Kreditkarte erforderlich
                    </p>
                </div>
            </section>
        </MainLayout>
    );
};

export default FAQPage;
