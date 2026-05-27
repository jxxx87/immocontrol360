import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, ArrowRight } from 'lucide-react';
import { LaptopMockup, PhoneMockup } from '../Mockups';

const Features = () => {
    const [activeTab, setActiveTab] = useState('buyhold');

    return (
        <section id="features" className="py-20 md:py-32 overflow-hidden">
            <div className="container space-y-32">

                {/* Feature 1: Dashboard */}
                <div className="grid md:grid-cols-2 gap-12 items-center">
                    <motion.div
                        initial={{ opacity: 0, x: -50 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }}
                        className="order-2 md:order-1"
                    >
                        <div className="inline-block py-1 px-3 rounded-full bg-blue-100 text-blue-700 text-sm font-semibold mb-6">
                            KPI Dashboard
                        </div>
                        <h2 className="text-3xl md:text-4xl font-bold mb-6 text-slate-900">
                            Portfolio-Dashboard mit klaren KPIs.
                        </h2>
                        <p className="text-lg text-slate-600 mb-8 leading-relaxed">
                            Verliere nie wieder den Überblick. ImmoControlPro360 aggregiert alle Daten deiner Objekte in Echtzeit.
                        </p>
                        <ul className="space-y-4 mb-8">
                            {[
                                'Cashflow, Rendite und Leerstand auf einen Blick',
                                'Performance je Objekt und Einheit',
                                'Entscheidungen datenbasiert statt Bauchgefühl'
                            ].map((item, i) => (
                                <li key={i} className="flex items-start gap-3">
                                    <div className="mt-1 bg-green-100 p-1 rounded-full">
                                        <Check size={14} className="text-green-600" />
                                    </div>
                                    <span className="text-slate-700 font-medium">{item}</span>
                                </li>
                            ))}
                        </ul>
                    </motion.div>
                    <motion.div
                        initial={{ opacity: 0, x: 50 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }}
                        className="order-1 md:order-2"
                    >
                        <LaptopMockup src="/images/w_Dashboard.png" alt="Dashboard" className="shadow-2xl rounded-xl" />
                    </motion.div>
                </div>

                {/* Feature 2: Tenant Management */}
                <div className="grid md:grid-cols-2 gap-12 items-center">
                    <motion.div
                        initial={{ opacity: 0, x: -50 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }}
                        className="relative"
                    >
                        {/* Background blob */}
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120%] h-[120%] bg-blue-50 rounded-full blur-3xl -z-10" />

                        <LaptopMockup src="/images/w-Ticketboard.png" alt="Ticket Board" className="shadow-2xl rounded-xl relative z-10" />
                        {/* Floating Phone */}
                        <div className="hidden lg:block absolute -right-12 -bottom-12 w-48 z-20">
                            <PhoneMockup src="/images/w_Ticketerstellen.png" alt="Ticket App" className="shadow-2xl" />
                        </div>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, x: 50 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }}
                    >
                        <div className="inline-block py-1 px-3 rounded-full bg-indigo-100 text-indigo-700 text-sm font-semibold mb-6">
                            Mieter & Tickets
                        </div>
                        <h2 className="text-3xl md:text-4xl font-bold mb-6 text-slate-900">
                            Eigene Hausverwaltung – ohne Mieterstress.
                        </h2>
                        <p className="text-lg text-slate-600 mb-8 leading-relaxed">
                            Professionalisiere deine Kommunikation. Mieter melden Probleme per App, du behältst den Status im Blick.
                        </p>
                        <ul className="space-y-4 mb-8">
                            {[
                                'Objekte & Einheiten strukturiert abbilden',
                                'Mieterportal für Anfragen und Status',
                                'Ticketsystem: Störung → Ticket → Bearbeitung → erledigt',
                                'Kommunikationshistorie zentral und nachvollziehbar'
                            ].map((item, i) => (
                                <li key={i} className="flex items-start gap-3">
                                    <div className="mt-1 bg-green-100 p-1 rounded-full">
                                        <Check size={14} className="text-green-600" />
                                    </div>
                                    <span className="text-slate-700 font-medium">{item}</span>
                                </li>
                            ))}
                        </ul>
                    </motion.div>
                </div>

                {/* Feature 3: Investor Portal */}
                <div className="bg-primary rounded-3xl p-8 md:p-16 text-white overflow-hidden relative shadow-2xl shadow-blue-900/20">
                    {/* Background decoration */}
                    <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-white/10 rounded-full blur-[100px] pointer-events-none" />
                    <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-indigo-600/30 rounded-full blur-[100px] pointer-events-none" />
                    <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 mix-blend-overlay pointer-events-none" />

                    <div className="relative z-10 max-w-3xl mx-auto text-center mb-12">
                        <h2 className="text-3xl md:text-4xl font-bold mb-6 drop-shadow-sm">
                            Investorportal: Alle Kennzahlen im Überblick, Deals prüfen, Risiken kalkulieren, Wachstum planen.
                        </h2>
                        <p className="text-blue-50 text-lg mb-8 drop-shadow-sm">
                            Das Herzstück für dein Wachstum. Behalte dein Portfolio im Blick und analysiere neue Objekte in Sekunden – egal ob langfristig oder kurzfristig.
                        </p>
                        <div className="flex flex-wrap justify-center gap-4 text-sm font-medium text-white">
                            <span className="bg-white/10 px-3 py-1 rounded-full border border-white/20 backdrop-blur-md shadow-sm">Buy & Hold Analyse</span>
                            <span className="bg-white/10 px-3 py-1 rounded-full border border-white/20 backdrop-blur-md shadow-sm">Fix & Flip Kalkulation</span>
                            <span className="bg-white/10 px-3 py-1 rounded-full border border-white/20 backdrop-blur-md shadow-sm">Sanierungsrechner (Gewerke)</span>
                            <span className="bg-white/10 px-3 py-1 rounded-full border border-white/20 backdrop-blur-md shadow-sm">Deal-Vergleich</span>
                        </div>
                    </div>

                    <div className="relative z-10 max-w-5xl mx-auto">
                        {/* Tabs */}
                        <div className="flex justify-center mb-8">
                            <div className="bg-white/10 p-1 rounded-xl inline-flex backdrop-blur-md border border-white/20 shadow-lg">
                                <button
                                    onClick={() => setActiveTab('buyhold')}
                                    className={`px-6 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === 'buyhold' ? 'bg-white text-primary shadow-md' : 'text-blue-100 hover:text-white hover:bg-white/10'}`}
                                >
                                    Buy & Hold
                                </button>
                                <button
                                    onClick={() => setActiveTab('fixflip')}
                                    className={`px-6 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === 'fixflip' ? 'bg-white text-primary shadow-md' : 'text-blue-100 hover:text-white hover:bg-white/10'}`}
                                >
                                    Fix & Flip
                                </button>
                            </div>
                        </div>

                        <motion.div
                            key={activeTab}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.3 }}
                        >
                            <LaptopMockup
                                src={activeTab === 'buyhold' ? "/images/W_BuyandHold.png" : "/images/w_FixandFlip.png"}
                                alt={activeTab === 'buyhold' ? "Buy and Hold Calculator" : "Fix and Flip Calculator"}
                                className="w-full shadow-2xl rounded-xl border border-white/20 bg-white/5 backdrop-blur-sm"
                            />
                        </motion.div>
                    </div>
                </div>

            </div>
        </section>
    );
};

export default Features;
