import React from 'react';
import { Link } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { APP_URL, BRAND_NAME, SUPPORT_EMAIL } from './siteConfig';
import OptimizedImage from './OptimizedImage';

const Footer = ({ isLanding = false }) => {
    const year = new Date().getFullYear();

    if (isLanding) {
        return (
            <footer className="bg-neutral-50 py-8 border-t border-neutral-200">
                <div className="container flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-neutral-500">
                    <p>&copy; {year} {BRAND_NAME}. Alle Rechte vorbehalten.</p>
                    <div className="flex gap-6">
                        <Link to="/impressum" className="hover:text-blue-600">Impressum</Link>
                        <Link to="/datenschutz" className="hover:text-blue-600">Datenschutz</Link>
                        <Link to="/agb" className="hover:text-blue-600">AGB</Link>
                    </div>
                </div>
            </footer>
        );
    }

    return (
        <footer className="bg-neutral-50 pt-16 pb-8 border-t border-neutral-200">
            <div className="container">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-16">
                    <div className="md:col-span-1">
                        <Link to="/" className="flex items-center gap-2 mb-6">
                            <OptimizedImage src="/images/logo.png" alt={BRAND_NAME} className="h-10 w-auto" loading="lazy" decoding="async" />
                        </Link>
                        <p className="text-neutral-500 mb-6">
                            Die Premium-Plattform für private und semi-professionelle Immobilieninvestoren. Skalieren ohne Chaos.
                        </p>
                    </div>

                    <div>
                        <h4 className="font-semibold mb-6">Produkt</h4>
                        <ul className="space-y-4 text-neutral-500">
                            <li><Link to="/funktionen" className="hover:text-blue-600 transition-colors">Funktionen</Link></li>
                            <li><Link to="/preise" className="hover:text-blue-600 transition-colors">Preise</Link></li>
                            <li><Link to="/faq" className="hover:text-blue-600 transition-colors">FAQ</Link></li>
                            <li><Link to="/register-trial" className="hover:text-blue-600 transition-colors">Kostenlos testen</Link></li>
                            <li><a href={`${APP_URL}/login`} className="hover:text-blue-600 transition-colors">Login</a></li>
                        </ul>
                    </div>

                    <div>
                        <h4 className="font-semibold mb-6">Rechtliches</h4>
                        <ul className="space-y-4 text-neutral-500">
                            <li><Link to="/impressum" className="hover:text-blue-600 transition-colors">Impressum</Link></li>
                            <li><Link to="/datenschutz" className="hover:text-blue-600 transition-colors">Datenschutz</Link></li>
                            <li><Link to="/agb" className="hover:text-blue-600 transition-colors">AGB</Link></li>
                        </ul>
                    </div>

                    <div>
                        <h4 className="font-semibold mb-6">Kontakt</h4>
                        <ul className="space-y-4 text-neutral-500">
                            <li>
                                <a href={`mailto:${SUPPORT_EMAIL}`} className="flex items-center gap-3 hover:text-blue-600 transition-colors break-all">
                                    <Mail size={18} className="flex-shrink-0" aria-hidden="true" /> {SUPPORT_EMAIL}
                                </a>
                            </li>
                        </ul>
                    </div>
                </div>

                <div className="border-t border-neutral-200 pt-8 flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-neutral-400">
                    <p>&copy; {year} {BRAND_NAME}. Alle Rechte vorbehalten.</p>
                </div>
            </div>
        </footer>
    );
};

export default Footer;
