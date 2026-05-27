import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
    Check, X, Crown, Shield, Zap, ArrowRight,
    Building2, Users, Calculator, TrendingUp,
    CreditCard, Star, Clock, Lock
} from 'lucide-react';
import MainLayout from '../layouts/MainLayout';

const PlanCard = ({ plan, isYearly, isSelected, onSelect, onCheckout }) => {
    const price = isYearly ? plan.priceYearly : plan.priceMonthly;

    return (
        <motion.div
            whileHover={{ y: -4 }}
            className={`relative flex flex-col p-8 rounded-2xl border-2 transition-all duration-300 cursor-pointer ${isSelected
                    ? 'border-primary bg-white shadow-2xl shadow-primary/10 scale-[1.02]'
                    : 'border-slate-200 bg-white hover:border-primary/40 hover:shadow-lg'
                }`}
            onClick={onSelect}
        >
            {plan.popular && (
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
                    <span className="text-4xl font-extrabold text-slate-900">{price} €</span>
                    <span className="text-slate-400 text-sm">/ Monat</span>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                    {isYearly ? 'jährlich abgerechnet' : 'monatlich kündbar'}
                </p>
            </div>

            <ul className="space-y-3 mb-8 flex-1">
                {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm">
                        {feature.included ? (
                            <Check size={16} className="text-green-500 shrink-0 mt-0.5" />
                        ) : (
                            <X size={16} className="text-slate-300 shrink-0 mt-0.5" />
                        )}
                        <span className={feature.included ? 'text-slate-700' : 'text-slate-400'}>
                            {feature.text}
                        </span>
                    </li>
                ))}
            </ul>

            <button
                onClick={(e) => { e.stopPropagation(); onCheckout(); }}
                className={`w-full py-4 rounded-xl font-bold text-center transition-all flex items-center justify-center gap-2 ${isSelected
                        ? 'bg-gradient-to-r from-primary to-indigo-600 text-white shadow-lg shadow-primary/30 hover:shadow-primary/40 hover:scale-[1.02]'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
                    }`}
            >
                <CreditCard size={18} />
                {isSelected ? 'Jetzt starten' : 'Plan wählen'}
            </button>
        </motion.div>
    );
};

const Paywall = () => {
    const navigate = useNavigate();
    const [isYearly, setIsYearly] = useState(true);
    const [selectedPlan, setSelectedPlan] = useState('professional');

    const plans = [
        {
            id: 'starter',
            title: 'Starter',
            priceMonthly: '9,99',
            priceYearly: '8,99',
            description: 'Für Einsteiger mit ersten Objekten.',
            popular: false,
            features: [
                { text: 'Bis zu 5 Einheiten', included: true },
                { text: 'Immobilien & Mieterverwaltung', included: true },
                { text: 'Finanzen', included: true },
                { text: 'Nebenkostenabrechnung', included: true },
                { text: 'Zählermanagement', included: true },
                { text: 'Kein Mieterportal', included: false },
                { text: 'Kein Investorportal', included: false },
            ],
        },
        {
            id: 'professional',
            title: 'Professional',
            priceMonthly: '32,99',
            priceYearly: '29,99',
            description: 'Für wachsende Portfolios. Volle Kontrolle.',
            popular: true,
            features: [
                { text: 'Bis zu 50 Einheiten', included: true },
                { text: 'Alles aus dem Starter inbegriffen', included: true },
                { text: 'Mieterportal', included: true },
                { text: 'Investorportal', included: true },
            ],
        },
        {
            id: 'business',
            title: 'Business',
            priceMonthly: '59,99',
            priceYearly: '53,99',
            description: 'Für semi-professionelle Investoren.',
            popular: false,
            features: [
                { text: 'Bis zu 250 Einheiten', included: true },
                { text: 'Alles aus Professional inbegriffen', included: true },
                { text: 'Multi-User Zugriff', included: true },
                { text: 'Priorisierter Support', included: true },
            ],
        },
    ];

    const handleCheckout = (planId) => {
        const cycle = isYearly ? 'yearly' : 'monthly';
        navigate(`/abo-starten?plan=${planId}&cycle=${cycle}&source=paywall`);
    };

    return (
        <MainLayout>
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
                            Dein 10-Tage-Testzeitraum ist abgelaufen
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
                            Wähle den Plan, der zu deinem Portfolio passt und behalte die volle Kontrolle über deine Immobilien.
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
                            <div className="bg-slate-100 p-1.5 rounded-full inline-flex border border-slate-200">
                                <button
                                    onClick={() => setIsYearly(false)}
                                    className={`px-5 py-2 rounded-full text-sm font-bold transition-all ${!isYearly
                                            ? 'bg-white text-slate-900 shadow-sm'
                                            : 'text-slate-500 hover:text-slate-700'
                                        }`}
                                >
                                    Monatlich
                                </button>
                                <button
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
                            {plans.map((plan) => (
                                <PlanCard
                                    key={plan.id}
                                    plan={plan}
                                    isYearly={isYearly}
                                    isSelected={selectedPlan === plan.id}
                                    onSelect={() => setSelectedPlan(plan.id)}
                                    onCheckout={() => handleCheckout(plan.id)}
                                />
                            ))}
                        </div>

                        {/* Enterprise link */}
                        <div className="text-center mt-10">
                            <p className="text-slate-400 mb-2 text-sm">Mehr als 250 Einheiten?</p>
                            <a
                                href="mailto:sales@immocontrolpro360.de"
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
                                    title: 'DSGVO-konform',
                                    desc: 'Deutsche Server, verschlüsselte Daten, Row Level Security – deine Daten gehören nur dir.',
                                },
                                {
                                    icon: Zap,
                                    title: 'Sofort startklar',
                                    desc: 'Keine Installation, kein Setup. Registriere dich, lege dein erstes Objekt an und los geht\'s.',
                                },
                                {
                                    icon: Star,
                                    title: 'Monatlich kündbar',
                                    desc: 'Keine versteckten Kosten, keine Vertragsbindung. Bei jährlicher Zahlung sparst du 10%.',
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
                            <button
                                onClick={() => handleCheckout(selectedPlan)}
                                className="bg-gradient-to-r from-primary to-indigo-600 text-white font-bold px-10 py-4 rounded-xl text-lg shadow-xl shadow-primary/20 hover:shadow-primary/30 hover:scale-[1.02] transition-all inline-flex items-center gap-2"
                            >
                                Jetzt mit {plans.find(p => p.id === selectedPlan)?.title} starten
                                <ArrowRight size={20} />
                            </button>
                            <p className="mt-4 text-sm text-slate-400 flex items-center justify-center gap-2">
                                <Shield size={14} /> Sichere Zahlung via Stripe · Jederzeit kündbar
                            </p>
                        </div>
                    </div>
                </section>
            </div>
        </MainLayout>
    );
};

export default Paywall;
