import React, { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Send, Check, Loader2, AlertCircle } from 'lucide-react';
import { CONTACT_FORM_ENDPOINT, SUPABASE_ANON_KEY, SUPPORT_EMAIL } from '../siteConfig';

// Spam-Schutz: Mindest-Ausfüllzeit (die Edge Function prüft sie zusätzlich) + Honeypot-Feld "website"
const MIN_FILL_MS = 3000;
// Großzügig, weil die Function erst speichert und dann per SMTP benachrichtigt (SMTP-Timeouts dort 15 s + 15 s):
// ein zu frühes Abbrechen würde "nicht übermittelt" anzeigen, obwohl die Anfrage schon gespeichert ist.
const REQUEST_TIMEOUT_MS = 45000;
const EMPTY_FORM = { name: '', email: '', message: '', website: '' };

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Schickt die Anfrage an die Edge Function "contact-form".
// Ergebnis: { ok: true } | { ok: false, error?: string } – ohne error = Dienst nicht erreichbar
// (z. B. Function noch nicht deployt, Netzwerkfehler, Zeitüberschreitung).
async function submitContactRequest(payload) {
    if (!SUPABASE_ANON_KEY) return { ok: false };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(CONTACT_FORM_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });
        const data = await res.json().catch(() => null);
        if (data && data.success === true) return { ok: true };
        if (data && data.success === false && typeof data.error === 'string' && data.code !== 'unavailable') {
            return { ok: false, error: data.error };
        }
        return { ok: false };
    } catch {
        return { ok: false };
    } finally {
        clearTimeout(timer);
    }
}

const inputClass = "w-full px-5 py-3.5 rounded-xl bg-white/10 border border-white/20 text-white placeholder-blue-200/50 focus:outline-none focus:bg-white/20 focus:border-white/40 focus-visible:ring-2 focus-visible:ring-white/60 transition-all backdrop-blur-sm";

const ContactForm = () => {
    const fieldId = useId();
    const [formState, setFormState] = useState(EMPTY_FORM);
    const [status, setStatus] = useState('idle'); // idle | submitting | success | error
    const [errorMessage, setErrorMessage] = useState('');
    const startedAtRef = useRef(0);

    // Zeitpunkt, ab dem das Formular sichtbar ist (für die Mindest-Ausfüllzeit)
    useEffect(() => {
        startedAtRef.current = Date.now();
    }, []);

    const isSubmitting = status === 'submitting';

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (isSubmitting) return;
        setStatus('submitting');
        setErrorMessage('');

        const elapsed = Date.now() - startedAtRef.current;
        if (elapsed < MIN_FILL_MS) await wait(MIN_FILL_MS - elapsed);

        const result = await submitContactRequest({
            name: formState.name.trim(),
            email: formState.email.trim(),
            message: formState.message.trim(),
            website: formState.website,
            elapsed_ms: Date.now() - startedAtRef.current,
            page: window.location.pathname,
        });

        if (result.ok) {
            setFormState(EMPTY_FORM);
            setStatus('success');
            return;
        }
        // Eingaben bleiben erhalten, damit nichts verloren geht
        setErrorMessage(result.error || '');
        setStatus('error');
    };

    const handleChange = (e) => {
        setFormState({ ...formState, [e.target.name]: e.target.value });
    };

    const resetForm = () => {
        startedAtRef.current = Date.now();
        setStatus('idle');
        setErrorMessage('');
    };

    const supportMailLink = (
        <a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold text-white underline underline-offset-2 hover:text-blue-100">
            {SUPPORT_EMAIL}
        </a>
    );

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
                                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-slate-900">E-Mail</h3>
                                        <a href={`mailto:${SUPPORT_EMAIL}`} className="text-slate-500 hover:text-primary transition-colors">{SUPPORT_EMAIL}</a>
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
                            <div className="absolute inset-0 bg-noise opacity-10 mix-blend-overlay pointer-events-none" />

                            <div className="p-8 md:p-10 relative z-10">
                                {status === 'success' ? (
                                    <div className="min-h-[400px] flex flex-col items-center justify-center text-center text-white" role="status">
                                        <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center mb-6 animate-bounce-slow">
                                            <Check size={40} className="text-white" />
                                        </div>
                                        <h3 className="text-2xl font-bold mb-2 text-white">Nachricht gesendet!</h3>
                                        <p className="text-blue-100">Vielen Dank – deine Nachricht ist bei uns eingegangen. Wir melden uns schnellstmöglich bei dir.</p>
                                        <button
                                            type="button"
                                            onClick={resetForm}
                                            className="mt-8 text-sm font-semibold text-white underline underline-offset-4 hover:text-blue-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 rounded"
                                        >
                                            Weitere Nachricht schreiben
                                        </button>
                                    </div>
                                ) : (
                                    <form onSubmit={handleSubmit} className="space-y-5">
                                        <div>
                                            <label htmlFor={`${fieldId}-name`} className="block text-blue-100 text-sm font-medium mb-2 ml-1">Name</label>
                                            <input
                                                id={`${fieldId}-name`}
                                                type="text"
                                                name="name"
                                                autoComplete="name"
                                                maxLength={200}
                                                value={formState.name}
                                                onChange={handleChange}
                                                required
                                                className={inputClass}
                                                placeholder="Dein Name"
                                            />
                                        </div>
                                        <div>
                                            <label htmlFor={`${fieldId}-email`} className="block text-blue-100 text-sm font-medium mb-2 ml-1">E-Mail</label>
                                            <input
                                                id={`${fieldId}-email`}
                                                type="email"
                                                name="email"
                                                autoComplete="email"
                                                maxLength={254}
                                                value={formState.email}
                                                onChange={handleChange}
                                                required
                                                className={inputClass}
                                                placeholder="name@firma.de"
                                            />
                                        </div>
                                        <div>
                                            <label htmlFor={`${fieldId}-message`} className="block text-blue-100 text-sm font-medium mb-2 ml-1">Nachricht</label>
                                            <textarea
                                                id={`${fieldId}-message`}
                                                name="message"
                                                maxLength={5000}
                                                value={formState.message}
                                                onChange={handleChange}
                                                required
                                                rows="4"
                                                className={`${inputClass} resize-none`}
                                                placeholder="Wie können wir helfen?"
                                            ></textarea>
                                        </div>

                                        {/* Honeypot gegen Spam-Bots: für Menschen unsichtbar, muss leer bleiben */}
                                        <div aria-hidden="true" className="absolute -left-[10000px] top-0 w-px h-px overflow-hidden">
                                            <label htmlFor={`${fieldId}-website`}>Website (bitte leer lassen)</label>
                                            <input
                                                id={`${fieldId}-website`}
                                                type="text"
                                                name="website"
                                                tabIndex={-1}
                                                autoComplete="off"
                                                value={formState.website}
                                                onChange={handleChange}
                                            />
                                        </div>

                                        <button
                                            type="submit"
                                            disabled={isSubmitting}
                                            className="w-full py-4 mt-2 rounded-xl bg-white text-primary font-bold text-lg hover:bg-blue-50 transition-all shadow-lg hover:shadow-xl disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-primary"
                                        >
                                            {isSubmitting ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send size={18} aria-hidden="true" />}
                                            {isSubmitting ? 'Wird gesendet …' : 'Nachricht senden'}
                                        </button>

                                        {status === 'error' && (
                                            <div role="alert" className="flex items-start gap-3 rounded-xl bg-white/15 border border-white/30 p-4 text-sm text-white">
                                                <AlertCircle size={18} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
                                                <p>
                                                    {errorMessage
                                                        ? <>{errorMessage} Alternativ erreichst du uns per E-Mail an {supportMailLink}.</>
                                                        : <>Deine Nachricht konnte gerade nicht übermittelt werden. Bitte schreibe uns direkt an {supportMailLink} – deine Eingaben bleiben hier erhalten.</>}
                                                </p>
                                            </div>
                                        )}

                                        <p className="text-xs text-blue-100 text-center mt-4 leading-relaxed">
                                            Mit dem Absenden werden deine Angaben zur Bearbeitung deiner Anfrage gespeichert und an unser Team übermittelt.
                                            Mehr dazu in unserer{' '}
                                            <Link to="/datenschutz" className="underline underline-offset-2 hover:text-white">Datenschutzerklärung</Link>.
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
