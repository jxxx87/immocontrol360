import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Check, ShieldCheck } from 'lucide-react';

const PricingTeaser = () => {
    return (
        <section className="py-20 md:py-32 bg-sky-50 overflow-hidden relative">
            {/* Background decoration */}
            <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-blue-100 rounded-full blur-[80px] -z-10" />
            <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-blue-200 rounded-full blur-[80px] -z-10" />

            <div className="container max-w-5xl mx-auto text-center">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.5 }}
                >
                    <div className="inline-block py-1 px-3 rounded-full bg-blue-100 text-blue-700 text-sm font-semibold mb-6">
                        Flexibel & Transparent
                    </div>
                    <h2 className="text-4xl md:text-5xl font-bold mb-6 text-slate-900 leading-tight">
                        Klare Preise.<br />Keine Überraschungen.
                    </h2>
                    <p className="text-xl text-slate-600 mb-10 max-w-2xl mx-auto leading-relaxed">
                        Wähle den Plan, der zu deinem Portfolio passt. Egal wieviele Einheiten – wir haben die passende Lösung.
                    </p>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-6 mb-12">
                        <Link to="/preise" className="btn-primary text-lg px-8 py-4 shadow-xl shadow-blue-500/20 hover:shadow-blue-500/30 w-full sm:w-auto">
                            Preise & Pläne ansehen
                        </Link>
                        <div className="flex items-center gap-2 text-slate-600 font-medium">
                            <ShieldCheck className="text-green-500" size={20} />
                            <span>10 Tage kostenlos testen</span>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-3xl mx-auto text-slate-700 font-medium">
                        <div className="flex items-center justify-center gap-2">
                            <Check size={18} className="text-green-500" /> Monatlich kündbar
                        </div>
                        <div className="flex items-center justify-center gap-2">
                            <Check size={18} className="text-green-500" /> Keine Einrichtungsgebühr
                        </div>
                        <div className="flex items-center justify-center gap-2">
                            <Check size={18} className="text-green-500" /> Kostenlose Updates
                        </div>
                    </div>
                </motion.div>
            </div>
        </section>
    );
};

export default PricingTeaser;
