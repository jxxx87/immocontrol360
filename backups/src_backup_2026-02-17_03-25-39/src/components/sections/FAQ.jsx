import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Minus } from 'lucide-react';

const FAQItem = ({ question, answer }) => {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div className="border-b border-white/10">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full py-6 flex items-center justify-between text-left focus:outline-none transition-colors group"
                aria-expanded={isOpen}
            >
                <span className="text-lg font-semibold text-white group-hover:text-blue-200 transition-colors pr-8">{question}</span>
                {isOpen ?
                    <Minus className="flex-shrink-0 text-white" /> :
                    <Plus className="flex-shrink-0 text-blue-300 group-hover:text-white transition-colors" />
                }
            </button>
            <AnimatePresence>
                {isOpen && (
                    <motion.div
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
    const faqs = [
        {
            question: "Für wen ist ImmoControlPro360 gemacht?",
            answer: "Ideal für private und semi-professionelle Immobilieninvestoren mit 1 bis 250 Einheiten, die ihr Portfolio effizient verwalten und skalieren möchten."
        },
        {
            question: "Was ist im 10-Tage-Test enthalten?",
            answer: "Du erhältst vollen Zugriff auf alle Funktionen des von dir gewählten Plans (Starter, Professional oder Business). Es entstehen keine Kosten, wenn du innerhalb der Testphase kündigst."
        },
        {
            question: "Brauche ich eine App?",
            answer: "Nein, ImmoControlPro360 ist eine moderne WebApp. Du kannst sie einfach im Browser auf deinem Laptop, Tablet oder Smartphone nutzen – ohne Installation und immer aktuell."
        },
        {
            question: "Kann ich jederzeit upgraden?",
            answer: "Ja, du kannst flexibel zwischen den Plänen wechseln. Ein Upgrade ist sofort aktiv, ein Downgrade zum Ende des Abrechnungszeitraums."
        },
        {
            question: "Wie sicher sind meine Daten?",
            answer: "Datenschutz hat höchste Priorität. Wir nutzen verschlüsselte Verbindungen (SSL), moderne Authentifizierung und hosten DSGVO-konform auf sicheren Servern."
        }
    ];

    return (
        <section id="faq" className="py-20 md:py-32 bg-primary relative overflow-hidden">
            {/* Background decoration matching other blue sections */}
            <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-white/10 rounded-full blur-[80px] -translate-y-1/2 translate-x-1/2 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-indigo-600/30 rounded-full blur-[80px] translate-y-1/2 -translate-x-1/4 pointer-events-none" />
            <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 mix-blend-overlay pointer-events-none" />

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
                        <FAQItem key={index} question={faq.question} answer={faq.answer} />
                    ))}
                </div>
            </div>
        </section>
    );
};

export default FAQ;
