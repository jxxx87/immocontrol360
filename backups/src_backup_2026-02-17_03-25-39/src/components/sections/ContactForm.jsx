import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Send, Check, Loader2 } from 'lucide-react';

const ContactForm = () => {
    const [formState, setFormState] = useState({ name: '', email: '', subject: '', message: '' });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        // Simulate API call
        await new Promise(resolve => setTimeout(resolve, 1500));
        setIsSubmitting(false);
        setIsSuccess(true);
        setFormState({ name: '', email: '', subject: '', message: '' });

        // Reset success message after 5 seconds
        setTimeout(() => setIsSuccess(false), 5000);
    };

    const handleChange = (e) => {
        setFormState({ ...formState, [e.target.name]: e.target.value });
    };

    return (
        <section id="contact" className="py-24 relative overflow-hidden bg-white">
            <div className="container max-w-6xl mx-auto px-4 relative z-10">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

                    {/* Left: Text Content */}
                    <div>
                        <motion.div
                            initial={{ opacity: 0, x: -20 }}
                            whileInView={{ opacity: 1, x: 0 }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.5 }}
                        >
                            <span className="inline-block py-1 px-3 rounded-full bg-blue-50 text-primary text-sm font-semibold mb-6 border border-blue-100">
                                Kontakt
                            </span>
                            <h2 className="text-3xl md:text-5xl font-bold mb-6 text-slate-900 leading-tight">
                                Noch Fragen? <br />
                                <span className="text-primary">Wir helfen gerne.</span>
                            </h2>
                            <p className="text-xl text-slate-600 mb-8 font-light leading-relaxed">
                                Egal ob du Fragen zu den Funktionen hast, eine individuelle Demo wünschst oder Feedback geben möchtest – unser Team ist für dich da.
                            </p>

                            <div className="space-y-6">
                                <div className="flex items-start gap-4">
                                    <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center flex-shrink-0 text-primary">
                                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-slate-900">E-Mail</h4>
                                        <p className="text-slate-500">support@immocontrolpro360.de</p>
                                        <p className="text-sm text-slate-400 mt-1">Antwort meist innerhalb von 24h</p>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    </div>

                    {/* Right: Premium Blue Form Card */}
                    <motion.div
                        initial={{ opacity: 0, x: 20 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.5, delay: 0.2 }}
                    >
                        <div className="relative rounded-[2.5rem] overflow-hidden shadow-2xl shadow-blue-900/20 bg-primary">
                            {/* Background Gradients inside Card */}
                            <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-white/10 rounded-full blur-[80px] -translate-y-1/2 translate-x-1/2 pointer-events-none" />
                            <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-indigo-600/30 rounded-full blur-[80px] translate-y-1/2 -translate-x-1/4 pointer-events-none" />
                            <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-10 mix-blend-overlay pointer-events-none" />

                            <div className="p-8 md:p-10 relative z-10">
                                {isSuccess ? (
                                    <div className="h-[400px] flex flex-col items-center justify-center text-center text-white">
                                        <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center mb-6 animate-bounce-slow">
                                            <Check size={40} className="text-white" />
                                        </div>
                                        <h3 className="text-2xl font-bold mb-2">Nachricht gesendet!</h3>
                                        <p className="text-blue-100">Wir melden uns schnellstmöglich bei dir.</p>
                                    </div>
                                ) : (
                                    <form onSubmit={handleSubmit} className="space-y-5">
                                        <div>
                                            <label className="block text-blue-100 text-sm font-medium mb-2 ml-1">Name</label>
                                            <input
                                                type="text"
                                                name="name"
                                                value={formState.name}
                                                onChange={handleChange}
                                                required
                                                className="w-full px-5 py-3.5 rounded-xl bg-white/10 border border-white/20 text-white placeholder-blue-200/50 focus:outline-none focus:bg-white/20 focus:border-white/40 transition-all backdrop-blur-sm"
                                                placeholder="Dein Name"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-blue-100 text-sm font-medium mb-2 ml-1">E-Mail</label>
                                            <input
                                                type="email"
                                                name="email"
                                                value={formState.email}
                                                onChange={handleChange}
                                                required
                                                className="w-full px-5 py-3.5 rounded-xl bg-white/10 border border-white/20 text-white placeholder-blue-200/50 focus:outline-none focus:bg-white/20 focus:border-white/40 transition-all backdrop-blur-sm"
                                                placeholder="name@firma.de"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-blue-100 text-sm font-medium mb-2 ml-1">Nachricht</label>
                                            <textarea
                                                name="message"
                                                value={formState.message}
                                                onChange={handleChange}
                                                required
                                                rows="4"
                                                className="w-full px-5 py-3.5 rounded-xl bg-white/10 border border-white/20 text-white placeholder-blue-200/50 focus:outline-none focus:bg-white/20 focus:border-white/40 transition-all backdrop-blur-sm resize-none"
                                                placeholder="Wie können wir helfen?"
                                            ></textarea>
                                        </div>

                                        <button
                                            type="submit"
                                            disabled={isSubmitting}
                                            className="w-full py-4 mt-2 rounded-xl bg-white text-primary font-bold text-lg hover:bg-blue-50 transition-all shadow-lg hover:shadow-xl disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                        >
                                            {isSubmitting ? <Loader2 className="animate-spin" /> : <Send size={18} />}
                                            Nachricht senden
                                        </button>

                                        <p className="text-xs text-blue-200 text-center mt-4">
                                            Deine Daten werden vertraulich behandelt.
                                        </p>
                                    </form>
                                )}
                            </div>
                        </div>
                    </motion.div>
                </div>
            </div>
        </section>
    );
};

export default ContactForm;
