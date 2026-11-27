import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Minus, ArrowRight } from 'lucide-react';
import { faqCategories } from '../../data/faqData';

// Auswahl für Startseite/Preise/Landingpage – die Texte kommen aus EINER Quelle (data/faqData.js),
// damit sie der ausführlichen FAQ-Seite nicht widersprechen (W1b-08).
const HIGHLIGHT_IDS = ['fuer-wen', 'test-umfang', 'test-zahlungsdaten', 'test-ende', 'geraete', 'verschluesselung'];
const MAX_ITEMS = 6;

const pickHighlights = () => {
    const allItems = faqCategories.flatMap(cat => cat.items || []);
    const byId = new Map(allItems.filter(item => item.id).map(item => [item.id, item]));
    const selected = HIGHLIGHT_IDS.map(id => byId.get(id)).filter(Boolean);
    // Rückfall, falls die ids in faqData.js geändert wurden: die ersten Fragen der Liste
    return (selected.length > 0 ? selected : allItems).slice(0, MAX_ITEMS);
};

const FAQItem = ({ question, answer, id }) => {
    const [isOpen, setIsOpen] = useState(false);
    const panelId = `faq-panel-${id}`;

    return (
        <div className="border-b border-white/10">
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="w-full py-6 flex items-center justify-between text-left rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 transition-colors group"
                aria-expanded={isOpen}
                aria-controls={panelId}
            >
                <span className="text-lg font-semibold text-white group-hover:text-blue-200 transition-colors pr-8">{question}</span>
                {isOpen ?
                    <Minus className="flex-shrink-0 text-white" aria-hidden="true" /> :
                    <Plus className="flex-shrink-0 text-blue-300 group-hover:text-white transition-colors" aria-hidden="true" />
                }
            </button>
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        id={panelId}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                    >
                        <div className="pb-6 text-blue-100 leading-relaxed font-light">
                            {answer}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

const FAQ = () => {
    const faqs = pickHighlights();

    return (
        <section id="faq" className="py-20 md:py-32 bg-primary relative overflow-hidden">
            {/* Background decoration matching other blue sections */}
            <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-white/10 rounded-full blur-[80px] -translate-y-1/2 translate-x-1/2 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-indigo-600/30 rounded-full blur-[80px] translate-y-1/2 -translate-x-1/4 pointer-events-none" />
            <div className="absolute inset-0 bg-noise opacity-20 mix-blend-overlay pointer-events-none" />

            <div className="container max-w-4xl mx-auto relative z-10">
                <div className="text-center mb-16">
                    <span className="inline-block py-1 px-3 rounded-full bg-white/10 text-blue-100 text-sm font-semibold mb-4 border border-white/20 backdrop-blur-md">
                        Hilfe & Support
                    </span>
                    <h2 className="text-3xl md:text-5xl font-bold mb-6 text-white drop-shadow-sm">
                        Häufig gestellte Fragen
                    </h2>
                    <p className="text-lg text-blue-50 max-w-2xl mx-auto font-light">
                        Alles, was du über ImmoControlPro360 wissen musst.
                    </p>
                </div>

                <div className="divide-y divide-white/10 bg-white/5 backdrop-blur-sm rounded-3xl p-8 border border-white/10 shadow-xl shadow-blue-900/20">
                    {faqs.map((faq, index) => (
                        <FAQItem key={faq.id || index} id={faq.id || index} question={faq.q} answer={faq.a} />
                    ))}
                </div>

                <div className="mt-10 text-center">
                    <Link to="/faq" className="inline-flex items-center gap-2 text-white font-semibold underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 rounded">
                        Alle Fragen ansehen <ArrowRight size={16} aria-hidden="true" />
                    </Link>
                </div>
            </div>
        </section>
    );
};

export default FAQ;
