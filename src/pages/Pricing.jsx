import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Check, X } from 'lucide-react';
import MainLayout from '../layouts/MainLayout';
import FAQ from '../components/sections/FAQ';

const PricingCard = ({ title, priceMonthly, priceYearly, isYearly, description, features, highlighted = false }) => {
    const price = isYearly ? priceYearly : priceMonthly;
    const period = isYearly ? 'Jahr' : 'Monat';
    const billingText = isYearly ? 'jährlich abgerechnet' : 'monatlich kündbar';

    return (
        <div className={`relative flex flex-col p-8 rounded-2xl border transition-all duration-300 ${highlighted ? 'border-primary bg-white shadow-xl scale-105 z-10' : 'border-neutral-200 bg-white hover:border-primary/50 hover:shadow-lg'}`}>
            {highlighted && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-primary text-white text-sm font-bold px-4 py-1 rounded-full shadow-md whitespace-nowrap">
                    Beliebteste Wahl
                </div>
            )}

            <div className="mb-6">
                <h3 className="text-xl font-bold text-neutral-900 mb-2">{title}</h3>
                <p className="text-neutral-500 text-sm h-10">{description}</p>
            </div>

            <div className="mb-8">
                <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold text-neutral-900">{price} €</span>
                    <span className="text-neutral-500">/ {isYearly ? 'Monat*' : 'Monat'}</span>
                </div>
                <p className="text-xs text-neutral-400 mt-2">*{billingText}</p>
            </div>

            <ul className="space-y-4 mb-8 flex-1">
                {features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-3 text-sm">
                        {feature.included ? (
                            <Check size={18} className="text-success shrink-0 mt-0.5" />
                        ) : (
                            <X size={18} className="text-neutral-300 shrink-0 mt-0.5" />
                        )}
                        <span className={feature.included ? 'text-neutral-700' : 'text-neutral-400'}>{feature.text}</span>
                    </li>
                ))}
            </ul>

            <Link
                to={`/abo-starten?plan=${title.toLowerCase()}&cycle=${isYearly ? 'yearly' : 'monthly'}`}
                className={`w-full py-4 rounded-lg font-semibold text-center transition-all ${highlighted ? 'bg-primary text-white hover:bg-primary-hover shadow-lg hover:shadow-primary/30' : 'bg-neutral-50 text-neutral-900 hover:bg-neutral-100 border border-neutral-200'}`}
            >
                {highlighted ? '10 Tage kostenlos testen' : 'Jetzt starten'}
            </Link>
        </div>
    );
};

const Pricing = () => {
    const [isYearly, setIsYearly] = useState(true);

    const plans = [
        {
            title: "Starter",
            priceMonthly: "9,99",
            priceYearly: "8,99",
            description: "Für Einsteiger mit ersten Objekten.",
            features: [
                { text: "Bis zu 5 Einheiten", included: true },
                { text: "Immobilien & Mieterverwaltung", included: true },
                { text: "Finanzen", included: true },
                { text: "Nebenkostenabrechnung", included: true },
                { text: "Zählermanagement", included: true },
                { text: "Kein Mieterportal", included: false },
                { text: "Kein Investorportal", included: false },
            ]
        },
        {
            title: "Professional",
            priceMonthly: "32,99",
            priceYearly: "29,99",
            description: "Für wachsende Portfolios. Volle Kontrolle.",
            highlighted: true,
            features: [
                { text: "Bis zu 50 Einheiten", included: true },
                { text: "Alles aus dem Starter inbegriffen", included: true },
                { text: "Mieterportal", included: true },
                { text: "Investorportal", included: true },
            ]
        },
        {
            title: "Business",
            priceMonthly: "59,99",
            priceYearly: "53,99",
            description: "Für semi-professionelle Investoren.",
            features: [
                { text: "Bis zu 250 Einheiten", included: true },
                { text: "Alles aus Professional inbegriffen", included: true },
                { text: "Multi-User Zugriff", included: true },
                { text: "Priorisierter Support", included: true },
            ]
        }
    ];

    return (
        <MainLayout>
            {/* Premium Blue Hero Section */}
            <section className="relative pt-32 pb-40 overflow-hidden bg-primary rounded-b-[3rem] md:rounded-b-[5rem] shadow-xl shadow-blue-900/20">
                {/* Background decoration */}
                <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-white/10 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2 pointer-events-none" />
                <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-indigo-600/30 rounded-full blur-[100px] translate-y-1/2 -translate-x-1/4 pointer-events-none" />
                <div className="absolute inset-x-0 bottom-0 h-px bg-white/10" />

                <div className="container relative z-10 text-center max-w-4xl mx-auto">
                    <span className="inline-block py-1.5 px-4 rounded-full bg-white/10 text-white text-sm font-semibold mb-6 border border-white/20 backdrop-blur-md shadow-sm">
                        Transparent & Fair
                    </span>
                    <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-6 text-white leading-tight drop-shadow-sm">
                        Wähle den Plan, der zu <br />deinem Portfolio passt.
                    </h1>
                    <p className="text-xl text-blue-50 mb-12 max-w-2xl mx-auto font-light leading-relaxed drop-shadow-sm">
                        Professionalisiere deine Verwaltung und Skalierung. <br />Keine versteckten Kosten, jederzeit kündbar.
                    </p>

                    {/* Toggle */}
                    <div className="flex items-center justify-center gap-6 bg-white/10 backdrop-blur-md p-2 rounded-full inline-flex border border-white/20">
                        <span className={`text-sm font-bold cursor-pointer transition-colors px-3 ${!isYearly ? 'text-white' : 'text-blue-200 hover:text-white'}`} onClick={() => setIsYearly(false)}>Monatlich</span>

                        <button
                            onClick={() => setIsYearly(!isYearly)}
                            className="relative w-14 h-7 bg-primary rounded-full transition-colors duration-300 border border-white/30 shadow-inner"
                            aria-label="Toggle billing period"
                        >
                            <motion.div
                                className="absolute top-1 w-5 h-5 bg-white rounded-full shadow-md"
                                initial={false}
                                animate={{ left: isYearly ? 'calc(100% - 1.5rem)' : '0.25rem' }}
                                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                            />
                        </button>

                        <span className={`text-sm font-bold cursor-pointer transition-colors px-3 flex items-center gap-2 ${isYearly ? 'text-white' : 'text-blue-200 hover:text-white'}`} onClick={() => setIsYearly(true)}>
                            Jährlich <span className="bg-green-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm">-10%</span>
                        </span>
                    </div>
                </div>
            </section>

            {/* Pricing Cards Section (Overlapping) */}
            <section className="pb-32 -mt-20 relative z-20 px-4">
                <div className="container">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto mb-20">
                        {plans.map((plan, index) => (
                            <PricingCard key={index} {...plan} isYearly={isYearly} />
                        ))}
                    </div>

                    <div className="text-center">
                        <p className="text-slate-500 mb-4 font-medium">Du hast mehr als 250 Einheiten?</p>
                        <a href="mailto:sales@immocontrolpro360.de" className="text-primary font-bold hover:underline">Kontaktiere uns für Enterprise-Konditionen</a>
                    </div>
                </div>
            </section>

            <FAQ />
        </MainLayout>
    );
};

export default Pricing;
