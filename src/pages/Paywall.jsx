import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
    Check, X, Crown, Shield, Zap, ArrowRight,
    Building2, Users, Calculator, TrendingUp,
    LogIn, Star, Clock, Lock
} from 'lucide-react';
import MainLayout from '../layouts/MainLayout';
import { APP_URL } from '../components/siteConfig';
import {
    PLANS, DEFAULT_PLAN_ID, getPlan, getPriceInfo, VAT_NOTE,
    ENTERPRISE_CONTACT_EMAIL, TRIAL_DAYS, PLAN_UNIT_LIMITS
} from '../lib/plans';

// Wer schon ein Konto hat (abgelaufene Testphase), schließt das Abo in der App ab
// (nach der Anmeldung: Einstellungen → Abrechnung & Abo) – nicht über eine Neuregistrierung.
const APP_LOGIN_URL = `${APP_URL}/login`;

const PlanCard = ({ plan, isYearly, isSelected, onSelect }) => {
    const { perMonth, yearlyTotal } = getPriceInfo(plan, isYearly);

    return (
        <motion.div
            whileHover={{ y: -4 }}
            className={`relative flex flex-col p-8 rounded-2xl border-2 transition-all duration-300 cursor-pointer ${isSelected
                    ? 'border-primary bg-white shadow-2xl shadow-primary/10 scale-[1.02]'
                    : 'border-slate-200 bg-white hover:border-primary/40 hover:shadow-lg'
                }`}
            onClick={onSelect}
            // Tastatur: Fokus auf dem Button der Karte wählt den Tarif ebenfalls aus
            onFocus={onSelect}
        >
            {plan.highlighted && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-primary to-indigo-600 text-white text-xs font-bold px-4 py-1.5 rounded-full shadow-lg shadow-primary/30 whitespace-nowrap flex items-center gap-1.5">
                    <Crown size={12} /> Beliebteste Wahl
                </div>
            )}

            <div className="mb-6">
                <h3 className="text-xl font-bold text-slate-900 mb-1">{plan.title}</h3>
                <p className="text-slate-500 text-sm">{plan.description}</p>
            </div>

            <div className="mb-8">
                <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-extrabold text-slate-900">{perMonth} €</span>
                    <span className="text-slate-500 text-sm">/ Monat</span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                    {isYearly
                        ? `jährliche Zahlung: ${yearlyTotal} € pro Jahr im Voraus`
                        : 'monatliche Zahlung, monatlich kündbar'}
                </p>
                <p className="text-xs text-slate-500">{VAT_NOTE}</p>
            </div>

            <ul className="space-y-3 mb-8 flex-1">
                {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm">
                        {feature.included ? (
                            <Check size={16} className="text-green-500 shrink-0 mt-0.5" />
                        ) : (
                            <X size={16} className="text-slate-300 shrink-0 mt-0.5" />
                        )}
                        <span className={feature.included ? 'text-slate-700' : 'text-slate-500'}>
                            {feature.text}
                        </span>
                    </li>
                ))}
            </ul>

            <a
                href={APP_LOGIN_URL}
                onClick={(e) => e.stopPropagation()}
                className={`w-full py-4 rounded-xl font-bold text-center transition-all flex items-center justify-center gap-2 ${isSelected
                        ? 'bg-gradient-to-r from-primary to-indigo-600 text-white shadow-lg shadow-primary/30 hover:shadow-primary/40 hover:scale-[1.02]'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
                    }`}
            >
                <LogIn size={18} />
                Anmelden & Abo abschließen
            </a>
        </motion.div>
    );
};

const Paywall = () => {
    const [isYearly, setIsYearly] = useState(true);
    const [selectedPlan, setSelectedPlan] = useState(DEFAULT_PLAN_ID);
    const cycle = isYearly ? 'yearly' : 'monthly';

    return (
        <MainLayout>
            <title>Abo abschließen | ImmoControlPro360</title>
            <meta name="robots" content="noindex" />

            {/* Full-screen Paywall Overlay */}
            <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50">

                {/* Header Section with urgency */}
                <section className="relative pt-28 pb-20 overflow-hidden">
                    {/* Background decorations */}
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1200px] h-[600px] bg-gradient-to-b from-primary/5 to-transparent rounded-full blur-[80px] pointer-events-none" />
                    <div className="absolute top-20 right-0 w-[400px] h-[400px] bg-amber-400/5 rounded-full blur-[80px] pointer-events-none" />

                    <div className="container max-w-4xl mx-auto text-center relative z-10 px-4">
                        {/* Trial expired badge */}
                        <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="inline-flex items-center gap-2 bg-amber-50 text-amber-700 text-sm font-semibold px-5 py-2 rounded-full border border-amber-200 shadow-sm mb-8"
                        >
                            <Clock size={16} />
                            Dein {TRIAL_DAYS}-Tage-Testzeitraum ist abgelaufen
                        </motion.div>

                        <motion.h1
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.1 }}
                            className="text-4xl md:text-6xl font-extrabold text-slate-900 mb-6 leading-tight tracking-tight"
                        >
                            Dein Portfolio verdient<br />
                            <span className="bg-gradient-to-r from-primary to-indigo-600 bg-clip-text text-transparent">
                                professionelles Management.
                            </span>
                        </motion.h1>

                        <motion.p
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.2 }}
                            className="text-xl text-slate-500 mb-10 max-w-2xl mx-auto leading-relaxed"
                        >
                            Wähle den Plan, der zu deinem Portfolio passt, und arbeite direkt mit deinen bisherigen Daten weiter.
                            Melde dich dazu mit deinem bestehenden Konto in der App an.
                        </motion.p>

                        {/* What you're missing section */}
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.3 }}
                            className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-2xl mx-auto mb-12"
                        >
                            {[
                                { icon: Building2, label: 'Immobilien' },
                                { icon: Users, label: 'Mieterportal' },
                                { icon: Calculator, label: 'Rechner' },
                                { icon: TrendingUp, label: 'KPI Dashboard' },
                            ].map(({ icon: Icon, label }, i) => (
                                <div key={i} className="flex flex-col items-center gap-2 p-4 bg-white rounded-xl border border-slate-100 shadow-sm">
                                    <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                                        <Icon size={20} className="text-primary" />
                                    </div>
                                    <span className="text-sm font-medium text-slate-700">{label}</span>
                                    <Lock size={12} className="text-amber-500" />
                                </div>
                            ))}
                        </motion.div>

                        {/* Toggle */}
                        <div className="flex items-center justify-center gap-4 mb-4">
                            <div className="bg-slate-100 p-1.5 rounded-full inline-flex border border-slate-200" role="group" aria-label="Zahlweise">
                                <button
                                    type="button"
                                    aria-pressed={!isYearly}
                                    onClick={() => setIsYearly(false)}
                                    className={`px-5 py-2 rounded-full text-sm font-bold transition-all ${!isYearly
                                            ? 'bg-white text-slate-900 shadow-sm'
                                            : 'text-slate-500 hover:text-slate-700'
                                        }`}
                                >
                                    Monatlich
                                </button>
                                <button
                                    type="button"
                                    aria-pressed={isYearly}
                                    onClick={() => setIsYearly(true)}
                                    className={`px-5 py-2 rounded-full text-sm font-bold transition-all flex items-center gap-2 ${isYearly
                                            ? 'bg-white text-slate-900 shadow-sm'
                                            : 'text-slate-500 hover:text-slate-700'
                                        }`}
                                >
                                    Jährlich
                                    <span className="bg-green-100 text-green-700 text-[10px] font-bold px-2 py-0.5 rounded-full">
                                        -10%
                                    </span>
                                </button>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Plans Grid */}
                <section className="pb-20 px-4 -mt-4">
                    <div className="container max-w-6xl mx-auto">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
                            {PLANS.map((plan) => (
                                <PlanCard
                                    key={plan.id}
                                    plan={plan}
                                    isYearly={isYearly}
                                    isSelected={selectedPlan === plan.id}
                                    onSelect={() => setSelectedPlan(plan.id)}
                                />
                            ))}
                        </div>

                        <p className="text-center text-sm text-slate-500 max-w-3xl mx-auto mt-10 leading-relaxed">
                            Tarif und Zahlweise wählst du nach der Anmeldung in der App unter „Einstellungen → Abrechnung & Abo“; die Zahlung läuft über Stripe.
                            Alle Preise inkl. gesetzlicher MwSt. Der verbindliche Gesamtbetrag wird dir vor der Zahlung im Stripe-Checkout angezeigt.
                        </p>
                        <p className="text-center text-sm text-slate-500 mt-2">
                            Noch kein Konto?{' '}
                            <Link to={`/abo-starten?plan=${selectedPlan}&cycle=${cycle}`} className="text-primary font-semibold hover:underline">
                                {TRIAL_DAYS} Tage kostenlos testen
                            </Link>
                        </p>

                        {/* Enterprise link */}
                        <div className="text-center mt-10">
                            <p className="text-slate-500 mb-2 text-sm">Mehr als {PLAN_UNIT_LIMITS.business} Einheiten?</p>
                            <a
                                href={`mailto:${ENTERPRISE_CONTACT_EMAIL}`}
                                className="text-primary font-bold hover:underline text-sm"
                            >
                                Kontaktiere uns für Enterprise-Konditionen →
                            </a>
                        </div>
                    </div>
                </section>

                {/* Trust / Benefits Section */}
                <section className="py-20 bg-slate-50 border-t border-slate-100">
                    <div className="container max-w-5xl mx-auto px-4">
                        <h2 className="text-2xl md:text-3xl font-bold text-center text-slate-900 mb-12">
                            Warum Investoren auf ImmoControlPro360 setzen
                        </h2>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                            {[
                                {
                                    icon: Shield,
                                    title: 'Datenschutz & Sicherheit',
                                    // Belegt: Supabase-Projekt in Region eu-west-1 (Irland); keine Aussage zu „deutschen Servern“
                                    desc: 'Datenbank auf Servern in der EU (Irland), verschlüsselte Übertragung und Zugriffsschutz auf Datenbankebene (Row Level Security).',
                                },
                                {
                                    icon: Zap,
                                    title: 'Sofort startklar',
                                    desc: 'Keine Installation, kein Setup. Melde dich an und arbeite direkt mit deinen Objekten weiter.',
                                },
                                {
                                    icon: Star,
                                    title: 'Flexible Zahlweise',
                                    desc: 'Monatlich oder jährlich zahlen – bei jährlicher Zahlung sparst du rund 10 %. Kündigung jeweils zum Ende des Abrechnungszeitraums (Fristen siehe AGB).',
                                },
                            ].map(({ icon: Icon, title, desc }, i) => (
                                <div key={i} className="text-center p-6">
                                    <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                                        <Icon size={24} className="text-primary" />
                                    </div>
                                    <h3 className="font-bold text-slate-900 mb-2">{title}</h3>
                                    <p className="text-slate-500 text-sm leading-relaxed">{desc}</p>
                                </div>
                            ))}
                        </div>

                        {/* CTA at bottom */}
                        <div className="mt-16 text-center">
                            <a
                                href={APP_LOGIN_URL}
                                className="bg-gradient-to-r from-primary to-indigo-600 text-white font-bold px-10 py-4 rounded-xl text-lg shadow-xl shadow-primary/20 hover:shadow-primary/30 hover:scale-[1.02] transition-all inline-flex items-center gap-2"
                            >
                                Anmelden und mit {getPlan(selectedPlan)?.title} weitermachen
                                <ArrowRight size={20} />
                            </a>
                            <p className="mt-4 text-sm text-slate-500 flex items-center justify-center gap-2">
                                <Shield size={14} /> Sichere Zahlung via Stripe · Alle Preise inkl. MwSt.
                            </p>
                        </div>
                    </div>
                </section>
            </div>
        </MainLayout>
    );
};

export default Paywall;
