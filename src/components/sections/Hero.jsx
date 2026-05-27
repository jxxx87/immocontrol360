import React from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import { LaptopMockup } from '../Mockups';

const Hero = ({ isLanding = false }) => {
    return (
        <section className="relative pt-32 pb-20 md:pt-40 md:pb-28 overflow-hidden bg-primary rounded-b-[3rem] md:rounded-b-[5rem] shadow-xl shadow-blue-900/20">
            {/* Background decoration */}
            <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-white/10 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-indigo-600/30 rounded-full blur-[100px] translate-y-1/2 -translate-x-1/4 pointer-events-none" />
            <div className="absolute inset-x-0 bottom-0 h-px bg-white/10" />

            <div className="container">
                <div className="flex flex-col items-center text-center max-w-4xl mx-auto mb-16 relative z-10">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5 }}
                    >
                        <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-6 text-white leading-tight drop-shadow-sm">
                            Dein Portfolio. <span className="text-blue-200 relative inline-block">
                                Deine Kontrolle.
                                <svg className="absolute w-full h-3 -bottom-1 left-0 text-blue-400/50 -z-10" viewBox="0 0 100 10" preserveAspectRatio="none">
                                    <path d="M0 5 Q 50 10 100 5" stroke="currentColor" strokeWidth="8" fill="none" />
                                </svg>
                            </span>
                        </h1>
                        <p className="text-lg md:text-xl text-blue-50 mb-10 max-w-2xl mx-auto leading-relaxed font-light drop-shadow-sm">
                            Struktur, Kontrolle und Wachstum – in einer Plattform.<br className="hidden md:block" />
                            {isLanding ? 'KPI-Dashboard, Mieterportal mit Tickets und Investorportal inkl. Deal-Analyse & Sanierungsrechner.' : 'Verwalte Objekte und Mieter, reduziere Stress und triff bessere Entscheidungen.'}
                        </p>

                        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
                            <Link to="/register-trial" className="btn-primary w-full sm:w-auto text-lg px-8 py-4 bg-white text-primary hover:bg-blue-50 border-none shadow-xl shadow-black/20 hover:shadow-black/30 hover:scale-105 transition-transform">
                                Jetzt starten – 10 Tage kostenlos testen
                            </Link>
                            {!isLanding && (
                                <Link to="/preise" className="px-8 py-4 w-full sm:w-auto text-lg rounded-lg font-semibold bg-white/10 hover:bg-white/20 border border-white/20 transition-all text-white backdrop-blur-sm">
                                    Preise ansehen
                                </Link>
                            )}
                        </div>

                        <p className="text-sm text-blue-200 flex items-center justify-center gap-2 font-medium">
                            <Check size={16} className="text-white" /> Auf Desktop, Tablet und Smartphone verfügbar
                        </p>
                    </motion.div>
                </div>

                {/* Hero Image & Dashboard */}
                <motion.div
                    initial={{ opacity: 0, y: 40 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.7, delay: 0.2 }}
                    className="relative max-w-5xl mx-auto"
                >
                    {/* Floating Chips */}
                    <div className="absolute -left-8 top-10 md:top-20 z-20 animate-float-slow hidden lg:block">
                        <div className="bg-white/90 backdrop-blur-md shadow-2xl rounded-xl p-3 border border-white/50 flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center text-green-600 font-bold">€</div>
                            <div>
                                <div className="text-[10px] text-slate-500 uppercase font-bold">Cashflow</div>
                                <div className="text-sm font-bold text-slate-900">+ 1.250 €</div>
                            </div>
                        </div>
                    </div>

                    <div className="absolute -right-12 top-16 md:top-32 z-20 animate-float-delayed hidden lg:block">
                        <div className="bg-white/90 backdrop-blur-md shadow-2xl rounded-xl p-3 border border-white/50 flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold">%</div>
                            <div>
                                <div className="text-[10px] text-slate-500 uppercase font-bold">Rendite</div>
                                <div className="text-sm font-bold text-slate-900">6,5 %</div>
                            </div>
                        </div>
                    </div>

                    <div className="absolute left-0 bottom-20 z-20 animate-float hidden lg:block">
                        <div className="bg-white/90 backdrop-blur-md shadow-2xl rounded-xl p-3 border border-white/50 flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 font-bold">!</div>
                            <div>
                                <div className="text-[10px] text-slate-500 uppercase font-bold">Leerstand</div>
                                <div className="text-sm font-bold text-slate-900">0 / 12</div>
                            </div>
                        </div>
                    </div>

                    <LaptopMockup
                        src="/images/w_Dashboard.png"
                        alt="ImmoControlPro360 Dashboard"
                        className="w-full shadow-2xl shadow-blue-900/50 rounded-xl"
                    />
                </motion.div>
            </div>
        </section>
    );
};

export default Hero;
