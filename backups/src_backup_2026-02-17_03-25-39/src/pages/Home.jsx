import React from 'react';
import MainLayout from '../layouts/MainLayout';
import Hero from '../components/sections/Hero';
import PainSection from '../components/sections/PainSection';
import Features from '../components/sections/Features';
import Availability from '../components/sections/Availability';
import PricingTeaser from '../components/sections/PricingTeaser';
import FAQ from '../components/sections/FAQ';
import ContactForm from '../components/sections/ContactForm';

const Home = () => {
    return (
        <MainLayout>
            <Hero />
            <PainSection />
            {/* Solution text section */}
            <section className="py-20 md:py-32 bg-white text-center">
                <div className="container max-w-4xl mx-auto">
                    <div className="inline-block py-1 px-3 rounded-full bg-indigo-100 text-indigo-700 text-sm font-semibold mb-6">
                        Skalieren ohne Chaos
                    </div>
                    <h2 className="text-4xl md:text-5xl font-bold mb-6 text-slate-900 leading-tight">
                        Die Plattform, die mitwächst.
                    </h2>
                    <p className="text-xl md:text-2xl text-slate-600 leading-relaxed font-light">
                        ImmoControlPro360 verbindet klassische Verwaltung mit moderner Investoren-Logik.
                        Alle Zahlen, alle Objekte, alle Entscheidungen – an einem Ort.
                    </p>
                </div>
            </section>

            <Features />
            <Availability />
            <PricingTeaser />
            <FAQ />
            <ContactForm />
        </MainLayout>
    );
};

export default Home;
