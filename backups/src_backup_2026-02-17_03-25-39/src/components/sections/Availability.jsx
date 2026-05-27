import React from 'react';
import { motion } from 'framer-motion';
import { PhoneMockup } from '../Mockups';

const Availability = () => {
    return (
        <section className="py-20 bg-gradient-to-br from-slate-50 to-white overflow-hidden">
            <div className="container">
                <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-24">
                    <div className="lg:w-1/2 text-center lg:text-left">
                        <motion.h2
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            className="text-3xl md:text-4xl font-bold mb-6 text-slate-900"
                        >
                            Von überall verfügbar.
                        </motion.h2>
                        <p className="text-lg text-slate-600 mb-8 leading-relaxed">
                            Ob am Schreibtisch, auf der Baustelle oder im Urlaub: Du hast deine Zahlen immer dabei.
                            Die WebApp passt sich perfekt an jedes Gerät an.
                        </p>
                        <div className="flex flex-wrap justify-center lg:justify-start gap-4">
                            <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-lg shadow-sm border border-slate-100">
                                <span className="w-2 h-2 rounded-full bg-green-500"></span>
                                <span className="text-sm font-medium text-slate-700">Desktop (Browser)</span>
                            </div>
                            <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-lg shadow-sm border border-slate-100">
                                <span className="w-2 h-2 rounded-full bg-green-500"></span>
                                <span className="text-sm font-medium text-slate-700">Tablet (iPad/Android)</span>
                            </div>
                            <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-lg shadow-sm border border-slate-100">
                                <span className="w-2 h-2 rounded-full bg-green-500"></span>
                                <span className="text-sm font-medium text-slate-700">Smartphone</span>
                            </div>
                        </div>
                    </div>

                    <div className="lg:w-1/2 relative flex justify-center items-end h-[400px]">
                        {/* Phone 1: Tenant Dashboard */}
                        <motion.div
                            initial={{ opacity: 0, y: 50, rotate: -5 }}
                            whileInView={{ opacity: 1, y: 0, rotate: -5 }}
                            viewport={{ once: true }}
                            transition={{ delay: 0.2 }}
                            className="absolute left-1/2 -translate-x-[60%] z-10 w-64"
                        >
                            <PhoneMockup src="/images/w-MieterDashboard.png" alt="Mieter Dashboard Mobile" className="shadow-2xl" />
                        </motion.div>

                        {/* Phone 2: Messages */}
                        <motion.div
                            initial={{ opacity: 0, y: 80, rotate: 10 }}
                            whileInView={{ opacity: 1, y: 40, rotate: 10 }}
                            viewport={{ once: true }}
                            transition={{ delay: 0.4 }}
                            className="absolute left-1/2 translate-x-[10%] z-20 w-64"
                        >
                            <PhoneMockup src="/images/w_Nachrichten.png" alt="Nachrichten Mobile" className="shadow-2xl border-slate-800" />
                        </motion.div>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default Availability;
