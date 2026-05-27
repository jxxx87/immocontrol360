import React from 'react';
import { motion } from 'framer-motion';
import { Ghost, PieChart, Users, TrendingUp, FileSpreadsheet } from 'lucide-react';

const PainSection = () => {
    const pains = [
        {
            icon: <FileSpreadsheet size={48} className="text-emerald-600 mb-4" />,
            title: "Excel-Listen ohne klare Struktur",
            desc: "Daten verstreut, Formeln kaputt, keine Historie. Excel reicht für den Anfang, aber nicht für Wachstum."
        },
        {
            icon: <PieChart size={48} className="text-red-500 mb-4" />,
            title: "Keine vollständige Übersicht",
            desc: "Wie hoch ist dein Cashflow wirklich? Rendite pro Objekt? Blindflug bei wichtigen Entscheidungen."
        },
        {
            icon: <Users size={48} className="text-orange-500 mb-4" />,
            title: "Mieterkommunikation: Stress & Chaos",
            desc: "Anrufe am Wochenende, WhatsApp-Nachrichten, E-Mails. Nichts ist dokumentiert, alles ist dringend."
        },
        {
            icon: <TrendingUp size={48} className="text-slate-400 mb-4" />,
            title: "Wachstum wird komplizierter",
            desc: "Jedes neue Objekt bedeutet mehr Verwaltungsaufwand statt mehr Freiheit. Das System skaliert nicht."
        }
    ];

    return (
        <section className="py-20 bg-slate-50 relative overflow-hidden">
            <div className="container">
                <div className="text-center max-w-3xl mx-auto mb-16">
                    <motion.h2
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        className="text-3xl md:text-4xl font-bold mb-4"
                    >
                        Kommt dir das bekannt vor?
                    </motion.h2>
                    <p className="text-slate-600 text-lg">
                        Immobilienverwaltung kann schnell chaotisch werden.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                    {pains.map((pain, index) => (
                        <motion.div
                            key={index}
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ delay: index * 0.1 }}
                            className="bg-white p-8 rounded-xl shadow-sm border border-slate-100 hover:shadow-md transition-shadow"
                        >
                            <div className="flex justify-center md:justify-start">
                                {/* Use Lucide icons mostly for consistency, image placeholder if needed */}
                                {pain.icon}
                            </div>
                            <h3 className="text-xl font-bold mb-3 text-slate-800">{pain.title}</h3>
                            <p className="text-slate-600 leading-relaxed text-sm">
                                {pain.desc}
                            </p>
                        </motion.div>
                    ))}
                </div>

                <motion.div
                    initial={{ opacity: 0 }}
                    whileInView={{ opacity: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.4 }}
                    className="mt-12 text-center max-w-2xl mx-auto bg-blue-50/50 p-6 rounded-lg border border-blue-100"
                >
                    <p className="text-blue-800 font-medium text-lg">
                        „Je mehr Einheiten du aufbaust, desto mehr brauchst du ein System – kein Sammelsurium.“
                    </p>
                </motion.div>
            </div>
        </section>
    );
};

export default PainSection;
