import React from 'react';
import { motion } from 'framer-motion';
import { Check, PieChart, Users, TrendingUp } from 'lucide-react';
import { LaptopMockup } from '../components/Mockups';
import OptimizedImage from '../components/OptimizedImage';
import FAQ from '../components/sections/FAQ';
import Footer from '../components/Footer';
import Navbar from '../components/Navbar';
import { APP_URL, BRAND_NAME } from '../components/siteConfig';
import { TRIAL_DAYS } from '../lib/plans';

// Kampagnenseite (/landing, /investor): direkt zur Registrierung in der App.
// Ohne Tarifwahl startet die Testphase wie auf /abo-starten mit "professional".
const REGISTER_URL = `${APP_URL}/register?plan=professional`;
const PAGE_TITLE = `Für Investoren: Skalieren ohne Chaos | ${BRAND_NAME}`;
// Angezeigte Bildbreiten (Auswahl der passenden WebP-Größe): Hero halbe Breite ab md, Karten ein Drittel
const HERO_IMAGE_SIZES = '(min-width: 768px) 50vw, 100vw';
const CARD_IMAGE_SIZES = '(min-width: 768px) 30vw, 100vw';

const Landing = () => {
    return (
        <>
            {/* SEO (React-19-Metadaten): Kampagnenseiten werden nur über Anzeigen verlinkt und
                überschneiden sich inhaltlich mit der Startseite – daher nicht indexieren */}
            <title>{PAGE_TITLE}</title>
            <meta name="description" content={`KPI-Dashboard, Mieterportal mit Tickets und Investorportal inkl. Deal-Analyse & Sanierungsrechner. ${TRIAL_DAYS} Tage kostenlos testen – ohne Kreditkarte.`} />
            <meta name="robots" content="noindex, follow" />

            <Navbar isLanding={true} />
            <main>
                {/* HERO LANDING specific */}
                <section className="pt-32 pb-20 bg-gradient-to-b from-blue-50 to-white overflow-hidden">
                    <div className="container max-w-6xl mx-auto">
                        <div className="grid md:grid-cols-2 gap-12 items-center">
                            <motion.div
                                initial={{ opacity: 0, x: -50 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ duration: 0.5 }}
                            >
                                <span className="inline-block py-1 px-3 rounded-full bg-blue-100/50 text-blue-700 text-sm font-semibold mb-6 border border-blue-200/50">
                                    Für Investoren (1–250 Einheiten)
                                </span>
                                <h1 className="text-4xl md:text-5xl font-extrabold mb-6 text-slate-900 leading-tight">
                                    Skalieren ohne Chaos – mit voller Kontrolle.
                                </h1>
                                <p className="text-lg text-slate-600 mb-8 leading-relaxed">
                                    KPI-Dashboard, Mieterportal mit Tickets und Investorportal inkl. Deal-Analyse & Sanierungsrechner.
                                </p>

                                <ul className="space-y-4 mb-8">
                                    <li className="flex items-center gap-3">
                                        <Check className="text-green-500 shrink-0" aria-hidden="true" />
                                        <span>Alle Zahlen & KPIs an einem Ort</span>
                                    </li>
                                    <li className="flex items-center gap-3">
                                        <Check className="text-green-500 shrink-0" aria-hidden="true" />
                                        <span>Automatisierte Mieterkommunikation</span>
                                    </li>
                                    <li className="flex items-center gap-3">
                                        <Check className="text-green-500 shrink-0" aria-hidden="true" />
                                        <span>Gewinnbringende Ankaufsentscheidungen</span>
                                    </li>
                                </ul>

                                <a href={REGISTER_URL} className="btn-primary w-full sm:w-auto text-lg px-8 py-4 shadow-xl shadow-blue-500/20 hover:shadow-blue-500/30 mb-4 inline-flex items-center gap-2">
                                    Jetzt {TRIAL_DAYS} Tage kostenlos testen
                                </a>
                                <p className="text-sm text-slate-500">Keine Kreditkarte erforderlich. Der Test endet automatisch – keine Kündigung nötig.</p>
                            </motion.div>

                            <motion.div
                                initial={{ opacity: 0, x: 50 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ duration: 0.5, delay: 0.2 }}
                            >
                                <LaptopMockup
                                    src="/images/w_Dashboard.png"
                                    alt={`${BRAND_NAME} Dashboard`}
                                    className="shadow-2xl rounded-xl"
                                    loading="eager"
                                    fetchPriority="high"
                                    sizes={HERO_IMAGE_SIZES}
                                />
                            </motion.div>
                        </div>
                    </div>
                </section>

                {/* MINI PAIN */}
                <section className="py-20 bg-white">
                    <div className="container max-w-4xl mx-auto">
                        <h2 className="text-3xl font-bold text-center mb-12">Schluss mit dem Chaos</h2>
                        <div className="grid md:grid-cols-3 gap-8">
                            <div className="p-6 bg-slate-50 rounded-lg border border-slate-100">
                                <h3 className="font-bold mb-2 flex items-center gap-2"><PieChart size={20} className="text-red-500" aria-hidden="true" /> Blindflug</h3>
                                <p className="text-sm text-slate-600">Keine Ahnung, wie hoch der Cashflow wirklich ist? Excel-Listen sind fehleranfällig.</p>
                            </div>
                            <div className="p-6 bg-slate-50 rounded-lg border border-slate-100">
                                <h3 className="font-bold mb-2 flex items-center gap-2"><Users size={20} className="text-orange-500" aria-hidden="true" /> Mieterstress</h3>
                                <p className="text-sm text-slate-600">Ständige Anrufe und WhatsApps? Professionalisiere die Kommunikation.</p>
                            </div>
                            <div className="p-6 bg-slate-50 rounded-lg border border-slate-100">
                                <h3 className="font-bold mb-2 flex items-center gap-2"><TrendingUp size={20} className="text-blue-500" aria-hidden="true" /> Wachstumsbremse</h3>
                                <p className="text-sm text-slate-600">Jedes neue Objekt macht mehr Arbeit statt mehr Freiheit? Du brauchst ein System.</p>
                            </div>
                        </div>
                    </div>
                </section>

                {/* DIFFERENTIATION & FEATURES */}
                <section className="py-20 bg-slate-900 text-white">
                    <div className="container max-w-5xl mx-auto text-center">
                        <h2 className="text-3xl md:text-4xl font-bold mb-16 text-white">Alles was du brauchst in einer Plattform</h2>

                        <div className="grid md:grid-cols-3 gap-8 text-left">
                            <div className="bg-slate-800 p-8 rounded-xl border border-slate-700 hover:border-blue-500 transition-colors">
                                <h3 className="text-xl font-bold mb-4 text-blue-400">01. KPI Dashboard</h3>
                                <p className="text-slate-300 mb-4">Erfasse Mieten, Ausgaben und Kredite an einem Ort. Sieh Cashflow und Rendite auf einen Blick.</p>
                                <OptimizedImage src="/images/w_Dashboard.png" alt="Dashboard (Ausschnitt)" sizes={CARD_IMAGE_SIZES} className="rounded-lg opacity-80 border border-slate-600" loading="lazy" decoding="async" />
                            </div>
                            <div className="bg-slate-800 p-8 rounded-xl border border-slate-700 hover:border-blue-500 transition-colors">
                                <h3 className="text-xl font-bold mb-4 text-blue-400">02. Mieter & Tickets</h3>
                                <p className="text-slate-300 mb-4">Mieter melden Schäden per App. Du hast ein Ticketsystem statt WhatsApp-Chaos.</p>
                                <OptimizedImage src="/images/w-Ticketboard.png" alt="Ticket-Board (Ausschnitt)" sizes={CARD_IMAGE_SIZES} className="rounded-lg opacity-80 border border-slate-600" loading="lazy" decoding="async" />
                            </div>
                            <div className="bg-slate-800 p-8 rounded-xl border border-slate-700 hover:border-blue-500 transition-colors">
                                <h3 className="text-xl font-bold mb-4 text-blue-400">03. Deal & Sanierung</h3>
                                <p className="text-slate-300 mb-4">Prüfe neue Objekte (Hold & Flip). Kalkuliere Sanierungen auf Gewerk-Ebene.</p>
                                <OptimizedImage src="/images/W_BuyandHold.png" alt="Buy-&-Hold-Rechner (Ausschnitt)" sizes={CARD_IMAGE_SIZES} className="rounded-lg opacity-80 border border-slate-600" loading="lazy" decoding="async" />
                            </div>
                        </div>
                    </div>
                </section>

                {/* FAQ: eigene Vollbreiten-Sektion (bringt Überschrift und Hintergrund selbst mit) */}
                <FAQ />

                {/* Abschluss-CTA */}
                <section className="py-20 bg-white">
                    <div className="container max-w-3xl mx-auto text-center">
                        <a href={REGISTER_URL} className="btn-primary px-8 py-4 text-lg shadow-lg">
                            Jetzt {TRIAL_DAYS} Tage risikofrei testen
                        </a>
                    </div>
                </section>
            </main>
            <Footer isLanding={true} />
        </>
    );
};

export default Landing;
