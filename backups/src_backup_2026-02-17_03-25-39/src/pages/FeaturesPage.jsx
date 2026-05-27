import React, { useState, useEffect } from 'react';
import { motion, useScroll, useSpring, AnimatePresence } from 'framer-motion';
import {
    CheckCircle2, ArrowRight, Search,
    LayoutDashboard, Building2, Users, FileText,
    Gauge, PenTool, Upload, Calculator, Receipt,
    PiggyBank, Wallet, MessageSquare, Ticket,
    TrendingUp, Hammer, Briefcase, Mail, X, ChevronRight,
    Filter, MoreHorizontal, Download, Plus, Bell, Settings,
    Home, PieChart
} from 'lucide-react';
import MainLayout from '../layouts/MainLayout';
import { LaptopMockup, PhoneMockup } from '../components/Mockups';
import { featureCategories } from '../data/featureData';
import { Link } from 'react-router-dom';
import ContactForm from '../components/sections/ContactForm';

// --- VIRTUAL APP SHELL & COMPONENTS ---
// Simulates the WebApp layout (Sidebar + Header + Content)
const AppShell = ({ title, children, sidebarActive = 'dashboard' }) => (
    <div className="w-full h-full bg-slate-50 flex overflow-hidden text-slate-600 font-sans text-[10px] sm:text-xs select-none">
        {/* Sidebar */}
        <div className="w-16 sm:w-48 bg-white border-r border-slate-200 flex-shrink-0 flex flex-col">
            <div className="h-12 flex items-center px-4 font-bold text-primary border-b border-slate-100">
                <div className="w-6 h-6 bg-primary rounded mr-2 hidden sm:block"></div>
                <span className="hidden sm:inline">ImmoControl</span>
            </div>
            <div className="flex-1 py-4 space-y-1 px-2">
                {[
                    { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
                    { id: 'immobilien', icon: Building2, label: 'Objekte' },
                    { id: 'mieter', icon: Users, label: 'Mieter' },
                    { id: 'finanzen', icon: PiggyBank, label: 'Finanzen' },
                    { id: 'tickets', icon: Ticket, label: 'Tickets' },
                    { id: 'investor', icon: TrendingUp, label: 'Investor' },
                ].map(item => (
                    <div key={item.id} className={`flex items-center gap-3 px-3 py-2 rounded-md ${sidebarActive === item.id || title.toLowerCase().includes(item.label.toLowerCase()) ? 'bg-blue-50 text-primary font-medium' : 'hover:bg-slate-50'}`}>
                        <item.icon size={14} />
                        <span className="hidden sm:inline">{item.label}</span>
                    </div>
                ))}
            </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-w-0">
            {/* Header */}
            <div className="h-12 bg-white border-b border-slate-200 flex items-center justify-between px-6">
                <span className="font-semibold text-slate-800">{title}</span>
                <div className="flex items-center gap-3 text-slate-400">
                    <Search size={14} />
                    <Bell size={14} />
                    <div className="w-6 h-6 rounded-full bg-slate-200" />
                </div>
            </div>
            {/* Page Content */}
            <div className="flex-1 overflow-hidden relative p-4 sm:p-6 bg-slate-50/50 flex flex-col">
                {children}
            </div>
        </div>
    </div>
);

// --- SPECIFIC UI SCREENS ---

// 1. Dashboard UI (Fallback if image missing)
const UI_Dashboard = () => (
    <AppShell title="Cockpit" sidebarActive="dashboard">
        <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                <div className="text-slate-400 text-[10px] uppercase font-bold mb-1">Cashflow</div>
                <div className="text-lg font-bold text-slate-800">4.250 €</div>
            </div>
            <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                <div className="text-slate-400 text-[10px] uppercase font-bold mb-1">Rendite ø</div>
                <div className="text-lg font-bold text-green-600">5.8 %</div>
            </div>
            <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm col-span-2">
                <div className="text-slate-400 text-[10px] uppercase font-bold mb-1">Offene Tickets</div>
                <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-red-100 text-red-600 rounded-full text-[10px] font-bold">2 Dringend</span>
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-600 rounded-full text-[10px] font-bold">5 Offen</span>
                </div>
            </div>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 h-40 flex items-center justify-center text-slate-300 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-t from-white to-transparent bottom-0 z-10" />
            <PieChart size={32} className="opacity-20" />
            <div className="absolute font-medium text-slate-400">Performance Chart</div>
        </div>
    </AppShell>
);

// 2. Immobilien Management
const UI_Immobilien = () => (
    <AppShell title="Objektverwaltung" sidebarActive="immobilien">
        <div className="flex justify-between mb-4">
            <div className="flex gap-2">
                <button className="bg-white border px-3 py-1 rounded text-slate-600 text-[10px]">Filter</button>
            </div>
            <button className="bg-primary text-white px-3 py-1 rounded shadow-sm hover:bg-blue-600 text-[10px]">+ Objekt</button>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-sm flex-1">
            <table className="w-full text-left">
                <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                    <tr><th className="p-3 font-medium">Objekt</th><th className="p-3 font-medium">Einh.</th><th className="p-3 font-medium">Fläche</th><th className="p-3 font-medium">Status</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {[
                        { name: 'MFH Goethestraße 12', units: 8, area: '640 m²', status: 'Vollvermietet' },
                        { name: 'ETW Parkallee 4', units: 1, area: '82 m²', status: 'Vollvermietet' },
                        { name: 'Gewerbehof West', units: 4, area: '1.200 m²', status: '1 Leerstand' },
                    ].map((row, i) => (
                        <tr key={i} className="hover:bg-blue-50/50 transition-colors cursor-default">
                            <td className="p-3 font-medium text-slate-700">{row.name}</td>
                            <td className="p-3 text-slate-600">{row.units}</td>
                            <td className="p-3 text-slate-600">{row.area}</td>
                            <td className="p-3"><span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${row.status.includes('Leer') ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>{row.status}</span></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    </AppShell>
);

// 3. Mietverhältnisse
const UI_Mietvertraege = () => (
    <AppShell title="Mietverträge" sidebarActive="mieter">
        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm mb-4">
            <div className="flex justify-between items-start mb-4">
                <div>
                    <h3 className="font-bold text-slate-900 text-sm">Max Mustermann</h3>
                    <p className="text-slate-500 text-[10px]">Goethestraße 12, EG Links</p>
                </div>
                <span className="bg-green-100 text-green-700 px-2 py-1 rounded-full text-[10px] font-bold">Aktiv</span>
            </div>
            <div className="grid grid-cols-3 gap-4 border-t border-slate-100 pt-3">
                <div><div className="text-slate-400 text-[9px]">Kaltmiete</div><div className="font-medium text-slate-800">850,00 €</div></div>
                <div><div className="text-slate-400 text-[9px]">NK-Vorausz.</div><div className="font-medium text-slate-800">180,00 €</div></div>
                <div><div className="text-slate-400 text-[9px]">Kaution</div><div className="font-medium text-slate-800">2.550 €</div></div>
            </div>
        </div>
        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm opacity-50">
            <div className="flex gap-4">
                <div className="w-8 h-8 rounded bg-slate-200" />
                <div className="flex-1 space-y-2">
                    <div className="h-3 w-1/3 bg-slate-200 rounded" />
                    <div className="h-2 w-1/4 bg-slate-100 rounded" />
                </div>
            </div>
        </div>
    </AppShell>
);

// 4. Zähler
const UI_Zaehler = () => (
    <AppShell title="Zählerstände" sidebarActive="immobilien">
        <div className="bg-white rounded-lg border border-slate-200 p-4 max-w-sm mx-auto shadow-sm mt-4 w-full">
            <h3 className="font-bold text-slate-800 mb-4 border-b border-slate-100 pb-2">Neuen Stand erfassen</h3>
            <div className="space-y-4">
                <div>
                    <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Zähler</label>
                    <div className="w-full bg-slate-50 border border-slate-200 rounded p-2 text-slate-700 flex justify-between items-center">
                        <span>Wasser Hauptzähler (WH-001)</span>
                        <ChevronRight size={12} className="text-slate-400" />
                    </div>
                </div>
                <div>
                    <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Neuer Stand (m³)</label>
                    <div className="flex items-center gap-2 relative">
                        <input type="text" readOnly value="1.245,33" className="w-full border border-primary rounded p-2 text-slate-900 font-mono focus:outline-none focus:ring-2 ring-primary/20" />
                        <span className="absolute right-3 text-slate-400 font-medium text-[10px]">m³</span>
                    </div>
                </div>
                <div className="pt-2">
                    <button className="w-full bg-primary text-white py-2 rounded font-medium hover:bg-blue-600 shadow-sm text-xs">Speichern</button>
                </div>
            </div>
        </div>
    </AppShell>
);

// 6. Dokumente
const UI_Dokumente = () => (
    <AppShell title="Dokumentenablage" sidebarActive="mieter">
        <div className="grid grid-cols-3 gap-3">
            {['Mietvertrag_Muller.pdf', 'Übergabeprotokoll.pdf', 'Ausweis_Scan.jpg', 'Rechnung_Sanierung.pdf', 'Versicherungspolice.pdf'].map((doc, i) => (
                <div key={i} className="bg-white p-3 rounded-lg border border-slate-200 hover:border-primary hover:shadow-md transition-all cursor-pointer flex flex-col items-center text-center gap-2 group">
                    <div className="w-10 h-10 bg-slate-50 rounded flex items-center justify-center text-slate-400 group-hover:bg-blue-50 group-hover:text-primary transition-colors">
                        <FileText size={18} />
                    </div>
                    <span className="text-[9px] text-slate-600 truncate w-full">{doc}</span>
                </div>
            ))}
            <div className="border-2 border-dashed border-slate-300 rounded-lg flex items-center justify-center text-slate-400 bg-slate-50 hover:bg-white transition-colors cursor-pointer group hover:border-primary hover:text-primary">
                <div className="text-center">
                    <Upload size={16} className="mx-auto mb-1 group-hover:scale-110 transition-transform" />
                    <span className="text-[9px]">Upload</span>
                </div>
            </div>
        </div>
    </AppShell>
);

// 7. Finanzen
const UI_Finanzen = () => (
    <AppShell title="Buchhaltung" sidebarActive="finanzen">
        <div className="flex justify-between items-center mb-6 bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
            <div>
                <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Einnahmen Okt</div>
                <div className="text-xl font-bold text-slate-800">12.450,00 €</div>
            </div>
            <div className="text-green-600 bg-green-50 px-2 py-1 rounded text-[10px] font-bold border border-green-100">+4.2%</div>
        </div>

        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden flex-1 shadow-sm">
            <div className="p-2 border-b border-slate-100 font-bold text-slate-500 bg-slate-50 text-[10px]">Letzte Buchungen</div>
            {[
                { tx: 'Miete Müller', cat: 'Mieteinnahme', amount: '+850,00', date: '01.10.' },
                { tx: 'Stadtwerke', cat: 'Nebenkosten', amount: '-120,00', date: '02.10.' },
                { tx: 'Handwerker Sanitär', cat: 'Erhaltung', amount: '-450,00', date: '05.10.' },
                { tx: 'Miete Schmidt', cat: 'Mieteinnahme', amount: '+620,00', date: '01.10.' },
            ].map((tx, i) => (
                <div key={i} className="flex justify-between p-3 border-b border-slate-50 items-center hover:bg-slate-50 transition-colors">
                    <div>
                        <div className="font-medium text-slate-700 text-xs">{tx.tx}</div>
                        <div className="text-[9px] text-slate-400">{tx.cat} • {tx.date}</div>
                    </div>
                    <div className={`font-mono font-medium text-xs ${tx.amount.startsWith('+') ? 'text-green-600' : 'text-slate-600'}`}>{tx.amount} €</div>
                </div>
            ))}
        </div>
    </AppShell>
);

// 8. Rechnungen (FEWO)
const UI_Rechnungen = () => (
    <AppShell title="Rechnung erstellen" sidebarActive="finanzen">
        <div className="bg-white shadow-lg rounded max-w-[95%] mx-auto flex flex-col h-full border border-slate-200 relative mb-4">
            <div className="absolute top-0 right-0 p-2">
                <div className="px-2 py-1 bg-blue-50 text-blue-600 rounded text-[9px] font-bold border border-blue-100">Vorschau</div>
            </div>
            {/* Paper Header */}
            <div className="h-16 border-b border-slate-50 flex justify-between items-center px-6 pt-4">
                <div className="text-sm font-bold text-slate-800">Rechnung #2024-001</div>
            </div>
            {/* Paper Body */}
            <div className="p-6 flex-1 space-y-6">
                <div className="flex justify-between">
                    <div className="space-y-1">
                        <div className="h-2 w-20 bg-slate-200 rounded" />
                        <div className="h-2 w-28 bg-slate-100 rounded" />
                    </div>
                    <div className="text-right space-y-1">
                        <div className="h-2 w-16 bg-slate-200 rounded ml-auto" />
                        <div className="h-2 w-12 bg-slate-100 rounded ml-auto" />
                    </div>
                </div>

                <table className="w-full mt-2">
                    <thead className="bg-slate-50 text-slate-500 text-[9px]"><tr className="text-left"><th className="p-2">Pos</th><th className="p-2">Beschreibung</th><th className="p-2 text-right">Summe</th></tr></thead>
                    <tbody>
                        <tr className="border-b border-slate-50"><td className="p-2 text-xs">1</td><td className="p-2 text-xs">Übernachtung (3 Nächte)</td><td className="p-2 text-right text-xs">240,00 €</td></tr>
                        <tr className="border-b border-slate-50"><td className="p-2 text-xs">2</td><td className="p-2 text-xs">Endreinigung</td><td className="p-2 text-right text-xs">50,00 €</td></tr>
                    </tbody>
                </table>
                <div className="flex justify-end pt-2 border-t border-slate-200">
                    <div className="text-right">
                        <div className="text-[9px] text-slate-500 uppercase font-bold">Zahlbetrag</div>
                        <div className="text-lg font-bold text-primary">290,00 €</div>
                    </div>
                </div>
            </div>
        </div>
    </AppShell>
);

// 9. Nebenkosten
const UI_Nebenkosten = () => (
    <AppShell title="Abrechnung Assistent" sidebarActive="finanzen">
        <div className="max-w-md mx-auto mt-4 w-full">
            <div className="flex justify-between mb-6 px-4">
                <div className="flex flex-col items-center"><div className="w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center font-bold text-[10px]">1</div><span className="text-[9px] mt-1 text-primary font-bold">Daten</span></div>
                <div className="h-[1px] bg-slate-200 flex-1 mx-2 mt-3" />
                <div className="flex flex-col items-center"><div className="w-6 h-6 rounded-full bg-blue-100 text-primary border border-blue-200 flex items-center justify-center font-bold text-[10px]">2</div><span className="text-[9px] mt-1 text-slate-500">Verteilen</span></div>
                <div className="h-[1px] bg-slate-200 flex-1 mx-2 mt-3" />
                <div className="flex flex-col items-center"><div className="w-6 h-6 rounded-full bg-slate-100 text-slate-400 border border-slate-200 flex items-center justify-center font-bold text-[10px]">3</div><span className="text-[9px] mt-1 text-slate-500">Drucken</span></div>
            </div>
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm text-center">
                <Calculator size={32} className="mx-auto text-primary mb-4" strokeWidth={1.5} />
                <h3 className="font-bold text-slate-800 mb-2">Gesamtkosten ermittelt</h3>
                <p className="text-xs text-slate-500 mb-6">Wir haben 12.450 € umlagefähige Kosten für 2023 gefunden.</p>
                <button className="w-full bg-primary text-white py-2 rounded font-bold text-xs shadow-sm hover:bg-blue-600">Verteilschlüssel prüfen</button>
            </div>
        </div>
    </AppShell>
);

// 12. Kontakte (Phone)
const UI_Kontakte = () => (
    <div className="w-full h-full bg-slate-50 flex flex-col font-sans select-none">
        <div className="bg-white p-4 pt-8 border-b border-slate-200 pb-3">
            <h2 className="text-base font-bold text-slate-800">Meine Kontakte</h2>
            <div className="mt-3 relative"><Search className="absolute left-2.5 top-2 text-slate-400" size={14} /><input className="w-full bg-slate-100 rounded-lg py-1.5 pl-9 text-xs focus:bg-white focus:ring-2 ring-primary/20 border-transparent focus:border-primary/20 transition-all outline-none" placeholder="Suchen..." /></div>
        </div>
        <div className="flex-1 overflow-y-hidden p-3 space-y-2.5">
            <div className="text-[9px] font-bold text-slate-400 uppercase ml-1">Favoriten</div>
            {[{ n: 'Sanitär Müller', r: 'Handwerker', t: 'Notfall' }, { n: 'Elektro Schmidt', r: 'Handwerker', t: '' }, { n: 'RA Kanzlei Meyer', r: 'Anwalt', t: '' }].map((c, i) => (
                <div key={i} className="bg-white p-3 rounded-xl border border-slate-200 flex items-center gap-3 shadow-sm">
                    <div className="w-10 h-10 rounded-full bg-blue-50 text-primary border border-blue-100 flex items-center justify-center font-bold text-sm">{c.n.charAt(0)}</div>
                    <div className="flex-1">
                        <div className="font-bold text-slate-800 text-xs">{c.n}</div>
                        <div className="text-slate-500 text-[10px]">{c.r}</div>
                    </div>
                    {c.t && <div className="p-1 px-2 bg-red-50 text-red-600 border border-red-100 rounded-md text-[9px] font-bold tracking-wide">{c.t}</div>}
                </div>
            ))}
        </div>
    </div>
);

// 14. Tickets (Mobile)
const UI_Tickets_Mobile = () => (
    <div className="w-full h-full bg-white flex flex-col font-sans select-none">
        <div className="bg-primary text-white p-4 pt-10 pb-4 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-10 -mt-10 blur-xl pointer-events-none" />
            <h2 className="text-lg font-bold relative z-10">Tickets</h2>
            <div className="flex gap-2 mt-4 text-[10px] relative z-10">
                <span className="bg-white/20 px-3 py-1 rounded-full border border-white/30 backdrop-blur-sm">Alle</span>
                <span className="bg-white text-primary px-3 py-1 rounded-full font-bold shadow-md">Offen (2)</span>
                <span className="bg-white/20 px-3 py-1 rounded-full border border-white/30 backdrop-blur-sm">Erledigt</span>
            </div>
        </div>
        <div className="p-3 space-y-3 bg-slate-50 flex-1">
            <div className="bg-white p-3 rounded-xl shadow-sm border border-slate-100 relative group">
                <div className="absolute left-0 top-4 bottom-4 w-1 bg-yellow-400 rounded-r-full" />
                <div className="flex justify-between mb-1 pl-3"><span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Heizung</span><span className="text-[9px] text-slate-400">vor 2 Std</span></div>
                <h3 className="font-bold text-slate-800 mb-2 pl-3 text-xs">Heizung tropft im Bad</h3>
                <div className="h-20 bg-slate-100 rounded-lg w-full mb-3 ml-3 w-[calc(100%-12px)] flex items-center justify-center text-slate-400 border border-dashed border-slate-200">
                    <div className="text-center"><div className="font-bold text-[10px]">FOTO</div></div>
                </div>
                <div className="flex justify-between items-center pl-3">
                    <span className="bg-yellow-50 text-yellow-700 border border-yellow-100 px-2 py-0.5 rounded text-[9px] font-bold uppercase">In Bearbeitung</span>
                </div>
            </div>
        </div>
        <div className="p-4 border-t border-slate-200 bg-white">
            <button className="w-full bg-primary text-white py-3 rounded-xl font-bold shadow-lg shadow-blue-500/30 text-xs flex items-center justify-center gap-2 hover:bg-blue-600 transition-colors">
                <Plus size={16} /> Ticket erstellen
            </button>
        </div>
    </div>
);

// 15. Investor Cockpit / Pipeline
const UI_Investor = () => (
    <AppShell title="Deal Pipeline" sidebarActive="investor">
        <div className="flex gap-3 overflow-x-auto pb-2 h-full">
            {/* Column 1: Neu */}
            <div className="w-48 flex-shrink-0 flex flex-col bg-slate-100 rounded-lg p-2 h-full border border-slate-200">
                <div className="font-bold text-slate-500 text-[10px] px-2 mb-2 flex justify-between uppercase tracking-wider">NEU <span className="bg-slate-200 text-slate-600 px-1.5 rounded-full text-[9px]">2</span></div>
                <div className="space-y-2">
                    <div className="bg-white p-2 rounded-lg shadow-sm border border-slate-200 cursor-pointer hover:shadow-md transition-all hover:-translate-y-1">
                        <div className="h-24 bg-slate-100 rounded mb-2 -mx-1 -mt-1 overflow-hidden relative">
                            <div className="absolute font-bold text-slate-300 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[10px]">BILD</div>
                        </div>
                        <div className="font-bold text-slate-800 text-[10px] mb-1">MFH Leipzig - Sanierung</div>
                        <div className="flex justify-between mt-2 text-[9px] text-slate-500 border-t border-slate-50 pt-1">
                            <span>850k €</span>
                            <span className="text-green-600 font-bold bg-green-50 px-1 rounded">7.2%</span>
                        </div>
                    </div>
                </div>
            </div>
            {/* Column 2: Prüfung */}
            <div className="w-48 flex-shrink-0 flex flex-col bg-slate-100 rounded-lg p-2 h-full border border-slate-200">
                <div className="font-bold text-slate-500 text-[10px] px-2 mb-2 uppercase tracking-wider">PRÜFUNG</div>
                <div className="bg-white p-2 rounded-lg shadow-sm border border-slate-200 border-l-4 border-l-primary hover:shadow-md transition-all hover:-translate-y-1 cursor-pointer">
                    <div className="font-bold text-slate-800 text-[10px] mb-2">ETW Berlin Mitte</div>
                    <div className="space-y-1.5 bg-slate-50 p-1.5 rounded">
                        <div className="flex justify-between text-[9px] text-slate-500"><span>Kalkulation</span><span className="font-bold text-primary">60%</span></div>
                        <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden"><div className="h-full w-2/3 bg-primary rounded-full" /></div>
                    </div>
                    <div className="mt-2 text-[9px] text-slate-400 flex gap-1"><FileText size={10} /> <span>Exposé.pdf</span></div>
                </div>
            </div>
        </div>
    </AppShell>
);

// 18. Sanierungsrechner
const UI_Sanierung = () => (
    <AppShell title="Sanierungskalkulation: MFH Leipzig" sidebarActive="investor">
        <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm"><div className="text-[9px] text-slate-400 font-bold uppercase mb-1">BUDGET</div><div className="text-base font-bold text-slate-800">125.000 €</div></div>
            <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm"><div className="text-[9px] text-slate-400 font-bold uppercase mb-1">GEPLANT</div><div className="text-base font-bold text-primary">118.450 €</div></div>
            <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm"><div className="text-[9px] text-slate-400 font-bold uppercase mb-1">PUFFER</div><div className="text-base font-bold text-green-600">6.550 €</div></div>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden text-[10px] shadow-sm flex-1">
            <div className="flex bg-slate-50 p-2 font-bold text-slate-500 border-b border-slate-200">
                <div className="w-1/2">Gewerk</div>
                <div className="w-1/4">Menge</div>
                <div className="w-1/4 text-right">Summe</div>
            </div>
            {[
                { g: 'Bodenbeläge (Austausch)', m: '450 m²', p: '18.000 €' },
                { g: 'Malerarbeiten', m: '1.200 m²', p: '14.500 €' },
                { g: 'Elektrik (Teilerneuerung)', m: '8 Einh.', p: '24.000 €' },
                { g: 'Sanitär / Bäder', m: '8 Stk', p: '42.000 €' },
            ].map((r, i) => (
                <div key={i} className="flex p-3 border-b border-slate-50 items-center hover:bg-slate-50">
                    <div className="w-1/2 font-medium text-slate-700 flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-400" /> {r.g}
                    </div>
                    <div className="w-1/4 text-slate-500">{r.m}</div>
                    <div className="w-1/4 text-right font-mono font-medium text-slate-600">{r.p}</div>
                </div>
            ))}
        </div>
    </AppShell>
);

// 11. Finanzierung
const UI_Finanzierung = () => (
    <AppShell title="Darlehensverwaltung" sidebarActive="finanzen">
        <div className="grid grid-cols-2 gap-4">
            {[
                { bank: 'Sparkasse', name: 'Darlehen MFH Leipzig', rate: '1.450 €', rest: '245.000 €', end: '2032' },
                { bank: 'Volksbank', name: 'ETW Berlin', rate: '620 €', rest: '112.500 €', end: '2038' },
            ].map((l, i) => (
                <div key={i} className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-16 h-16 bg-blue-50 rounded-bl-full -mr-8 -mt-8 opacity-50" />
                    <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">{l.bank}</div>
                    <div className="font-bold text-slate-800 text-xs mb-3">{l.name}</div>
                    <div className="space-y-2 mb-3">
                        <div className="flex justify-between text-[10px]"><span className="text-slate-500">Rate</span><span className="font-mono">{l.rate}</span></div>
                        <div className="flex justify-between text-[10px]"><span className="text-slate-500">Restschuld</span><span className="font-mono font-bold text-slate-700">{l.rest}</span></div>
                    </div>
                    <div className="bg-slate-50 rounded p-1.5 text-center text-[9px] text-slate-500 font-medium">
                        Zinsbindung bis {l.end}
                    </div>
                </div>
            ))}
        </div>
        <div className="mt-4 bg-blue-50 border border-blue-100 p-3 rounded-lg flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-white flex items-center justify-center text-primary shadow-sm font-bold">%</div>
            <div className="text-[10px] text-blue-800 font-medium">LTV Portfolio gesamt: 62%</div>
        </div>
    </AppShell>
)
const UI_Aushaenge = () => (
    <AppShell title="Aushänge" sidebarActive="immobilien">
        <div className="flex gap-4 h-full">
            <div className="w-1/3 border-r border-slate-200 pr-4 space-y-2">
                <button className="w-full bg-primary text-white py-1.5 rounded text-xs font-bold mb-2 shadow-sm">+ Neu</button>
                <div className="bg-blue-50 p-2 rounded border border-blue-100 text-primary font-medium text-[10px]">Wasser abgestellt</div>
                <div className="p-2 rounded border border-transparent hover:bg-slate-100 text-slate-600 text-[10px]">Hausordnung</div>
                <div className="p-2 rounded border border-transparent hover:bg-slate-100 text-slate-600 text-[10px]">Mülltrennung</div>
            </div>
            <div className="flex-1 bg-white border border-slate-200 shadow-sm rounded-lg p-4 relative">
                <div className="text-center font-bold text-lg mb-2 text-slate-800">AUSHANG</div>
                <div className="text-center text-xs font-bold text-red-600 mb-4 border-b border-slate-100 pb-2">WICHTIGE MITTEILUNG</div>
                <p className="text-[10px] text-slate-600 leading-relaxed">
                    Sehr geehrte Mieter,<br /><br />
                    am <span className="font-bold">Dienstag, den 14.10.</span> wird das Wasser zwischen 08:00 und 12:00 Uhr abgestellt.
                </p>
                <div className="absolute bottom-4 left-0 right-0 text-center text-[9px] text-slate-400">Hausverwaltung Digital</div>
            </div>
        </div>
    </AppShell>
)

// MAPPING ENGINE
const getVisualContent = (imageString, type) => {
    // Priority: Real Image path (start with /) -> Component Map -> Generic Fallback
    if (imageString.startsWith('/')) return { type: 'image', src: imageString };

    // Fallback UI Map based on featureData IDs or placeholders
    const uiMap = {
        'ui_objekt_detail': <UI_Immobilien />,
        'ui_meter_list': <UI_Zaehler />,
        'ui_contract_detail': <UI_Mietvertraege />,
        'ui_doc_manager': <UI_Dokumente />,
        'ui_notice_board': <UI_Aushaenge />,
        'ui_finance_overview': <UI_Finanzen />,
        'ui_invoice_creator': <UI_Rechnungen />,
        'ui_utility_billing': <UI_Nebenkosten />,
        'ui_loan_manager': <UI_Finanzierung />,
        'ui_contact_list': <UI_Kontakte />,
        'ui_investor_cockpit': <UI_Investor />,
        'ui_renovation_calc': <UI_Sanierung />,
    };

    if (uiMap[imageString]) return { type: 'component', component: uiMap[imageString] };

    // Generic fallback if a key is missing but logic requests a UI
    return { type: 'component', component: <UI_Dashboard /> };
};


const StickySubNav = ({ categories, activeCategory, onSelect }) => {
    return (
        <div className="sticky top-0 lg:top-0 z-40 bg-white/90 backdrop-blur-md border-y border-slate-200 shadow-sm mb-12">
            <div className="container overflow-x-auto hide-scrollbar">
                <div className="flex items-center gap-1 py-3 min-w-max">
                    {categories.map(cat => (
                        <button
                            key={cat.id}
                            onClick={() => onSelect(cat.id)}
                            className={`px-4 py-2 rounded-full text-sm font-semibold transition-all flex items-center gap-2 border ${activeCategory === cat.id
                                ? 'bg-primary text-white border-primary shadow-md shadow-blue-500/20'
                                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                                }`}
                        >
                            {cat.title}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

const FeatureModule = ({ module, index }) => {
    const visual = getVisualContent(module.image);
    const isEven = index % 2 === 0;

    return (
        <div className={`flex flex-col lg:flex-row items-center gap-12 lg:gap-24 py-20 md:py-32 border-b border-slate-100 last:border-0 ${!isEven ? 'lg:flex-row-reverse' : ''}`} id={module.id}>
            {/* TEXT */}
            <motion.div
                className="lg:w-1/2"
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.6 }}
            >
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center text-primary shadow-sm border border-blue-100">
                        <module.icon size={24} />
                    </div>
                    <div>
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">Modul</span>
                        <span className="text-sm font-bold text-primary uppercase tracking-wider">{module.subtitle}</span>
                    </div>
                </div>

                <h3 className="text-4xl font-bold text-slate-900 mb-6 leading-tight">{module.title}</h3>
                <p className="text-xl text-slate-600 mb-10 leading-relaxed font-light">{module.description}</p>

                <div className="bg-white rounded-2xl p-8 border border-slate-100 shadow-sm mb-10 relative overflow-hidden group hover:border-blue-200 transition-colors">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-blue-50 rounded-bl-[100px] -mr-12 -mt-12 transition-transform group-hover:scale-110" />
                    <h4 className="font-bold text-slate-900 mb-6 flex items-center gap-2 relative z-10 text-lg">
                        <CheckCircle2 size={20} className="text-primary" /> Du kannst damit:
                    </h4>
                    <ul className="space-y-4 relative z-10">
                        {module.features.map((feat, i) => (
                            <li key={i} className="flex items-start gap-4 text-slate-600">
                                <div className="w-1.5 h-1.5 rounded-full bg-slate-300 mt-2 shrink-0" />
                                {feat}
                            </li>
                        ))}
                    </ul>
                </div>

                <div className="mb-10 pl-6 border-l-4 border-primary/30">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Warum das zählt</span>
                    <p className="text-slate-800 font-medium italic text-lg leading-relaxed">
                        „{module.whyItMatters}“
                    </p>
                </div>

                {/* FLOW */}
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-medium bg-slate-50 border border-slate-100 rounded-full px-6 py-3 inline-flex">
                    {module.flow.map((step, i) => (
                        <React.Fragment key={i}>
                            {i > 0 && <ArrowRight size={14} className="text-slate-300" />}
                            <span>{step}</span>
                        </React.Fragment>
                    ))}
                </div>
            </motion.div>

            {/* VISUAL */}
            <motion.div
                className="lg:w-1/2 w-full perspective-1000 group relative"
                initial={{ opacity: 0, scale: 0.95, x: isEven ? 50 : -50 }}
                whileInView={{ opacity: 1, scale: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.8 }}
            >
                <div className="relative z-10">
                    {/* Backdrop Glow */}
                    <div className="absolute inset-0 bg-gradient-to-tr from-blue-100 via-indigo-50 to-white rounded-full blur-[100px] opacity-60 -z-10 group-hover:opacity-80 transition-opacity duration-1000" />

                    {/* Device Frame */}
                    {module.type === 'phone' ? (
                        <div className="flex justify-center py-8">
                            <PhoneMockup className="shadow-[0_20px_50px_-12px_rgba(0,0,0,0.3)] group-hover:-translate-y-4 transition-transform duration-700">
                                {visual.type === 'image'
                                    ? <img src={visual.src} alt={module.title} className="w-full h-full object-cover" />
                                    : <div className="w-full h-full bg-slate-50">{visual.component}</div>}
                            </PhoneMockup>
                        </div>
                    ) : (
                        <LaptopMockup className="shadow-[0_30px_60px_-15px_rgba(0,0,0,0.2)] rounded-xl group-hover:scale-[1.02] transition-transform duration-700 bg-white">
                            {visual.type === 'image'
                                ? <img src={visual.src} alt={module.title} className="w-full h-full object-cover" />
                                : <div className="w-full h-full bg-white">{visual.component}</div>}
                        </LaptopMockup>
                    )}

                    {/* Second Visual for 'dual' type */}
                    {module.type === 'dual' && (
                        <div className="hidden md:block absolute -right-8 -bottom-16 w-1/3 z-20 hover:scale-110 transition-transform duration-500">
                            <PhoneMockup className="shadow-[0_20px_50px_-12px_rgba(0,0,0,0.4)] border-slate-900 border-[6px] rounded-[2.5rem]">
                                {module.secondImage && module.secondImage.startsWith('/')
                                    ? <img src={module.secondImage} alt="Mobile" className="w-full h-full object-cover" />
                                    : <UI_Tickets_Mobile />
                                }
                            </PhoneMockup>
                        </div>
                    )}
                </div>
            </motion.div>
        </div>
    );
};

const FeaturesPageV2 = () => {
    const [searchQuery, setSearchQuery] = useState('');
    const [activeCategory, setActiveCategory] = useState(featureCategories[0].id);

    const scrollToCategory = (id) => {
        const element = document.getElementById(id);
        if (element) {
            const offset = 140; // Adjusted for taller sticky nav
            const elementPosition = element.getBoundingClientRect().top;
            const offsetPosition = elementPosition + window.pageYOffset - offset;
            window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
            setActiveCategory(id);
        }
    };

    // Filter Logic
    const filteredCategories = featureCategories.map(cat => ({
        ...cat,
        modules: cat.modules.filter(mod =>
            !searchQuery ||
            mod.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            mod.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
            mod.features.some(f => f.toLowerCase().includes(searchQuery.toLowerCase()))
        )
    })).filter(cat => cat.modules.length > 0);

    return (
        <MainLayout>
            {/* HERO */}
            <section className="pt-32 pb-24 relative overflow-hidden bg-primary rounded-b-[3rem] md:rounded-b-[5rem] shadow-xl shadow-blue-900/20">
                {/* Background Gradients */}
                <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-white/10 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2 pointer-events-none" />
                <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-indigo-600/30 rounded-full blur-[100px] translate-y-1/2 -translate-x-1/4 pointer-events-none" />
                <div className="absolute inset-x-0 bottom-0 h-px bg-white/10" />

                <div className="container relative z-10 text-center max-w-5xl mx-auto text-white">
                    <motion.div
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6 }}
                    >
                        <div className="inline-flex gap-2 mb-8 flex-wrap justify-center">
                            <span className="bg-white/20 px-4 py-1.5 rounded-full text-sm font-medium border border-white/20 backdrop-blur-md shadow-lg flex items-center gap-2"><LayoutDashboard size={14} /> KPI Dashboard</span>
                            <span className="bg-white/20 px-4 py-1.5 rounded-full text-sm font-medium border border-white/20 backdrop-blur-md shadow-lg flex items-center gap-2"><Ticket size={14} /> Ticketsystem</span>
                            <span className="bg-white/20 px-4 py-1.5 rounded-full text-sm font-medium border border-white/20 backdrop-blur-md shadow-lg flex items-center gap-2"><TrendingUp size={14} /> Investorportal</span>
                        </div>
                        <h1 className="text-4xl md:text-7xl font-bold mb-8 leading-tight tracking-tight drop-shadow-sm">
                            Jedes Feature sorgfältig durchdacht um es einfach und effizient zu halten.
                        </h1>
                        <p className="text-lg md:text-2xl text-blue-50 mb-12 font-light max-w-3xl mx-auto leading-relaxed drop-shadow-sm">
                            Vom Anlegen der ersten Einheiten bis zur hundertsten komplexen Dealkalkulation. Hier siehst du genau, was das System für dich leistet.
                        </p>

                        <div className="max-w-xl mx-auto relative mb-12">
                            <div className="absolute inset-y-0 left-5 flex items-center pointer-events-none">
                                <Search className="text-white/70" size={20} />
                            </div>
                            <input
                                type="text"
                                placeholder="Was suchst du? (z.B. ‚Nebenkosten‘, ‚Sanierung‘)"
                                className="w-full pl-14 pr-6 py-5 rounded-2xl bg-white/10 border border-white/30 text-white placeholder-white/60 backdrop-blur-xl focus:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/50 transition-all text-xl shadow-2xl"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>

                        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                            <Link to="/register-trial" className="btn-primary bg-white text-primary hover:bg-blue-50 px-8 py-4 text-lg shadow-xl shadow-black/10 w-full sm:w-auto font-bold border-none transition-transform hover:scale-105">
                                Jetzt kostenlos testen
                            </Link>
                        </div>
                    </motion.div>
                </div>
            </section>

            {/* STICKY NAV */}
            <StickySubNav
                categories={featureCategories}
                activeCategory={activeCategory}
                onSelect={scrollToCategory}
            />

            {/* MAIN CONTENT */}
            <div className="container pb-32">
                {filteredCategories.map((category) => (
                    <section key={category.id} id={category.id} className="mb-40 scroll-mt-48">
                        {/* Category Header */}
                        <div className="mb-20 text-center max-w-3xl mx-auto">
                            <h2 className="text-4xl md:text-5xl font-bold text-slate-900 mb-6">{category.title}</h2>
                            <p className="text-xl text-slate-500 font-light">{category.description}</p>
                            <div className="h-1 w-24 bg-primary mx-auto mt-8 rounded-full" />
                        </div>

                        {/* Modules */}
                        <div className="space-y-4">
                            {category.modules.map((module, idx) => (
                                <FeatureModule key={module.id} module={module} index={idx} />
                            ))}
                        </div>
                    </section>
                ))}
            </div>

            {/* Contact Form Section */}
            <ContactForm />

            {/* SUMMARY CTA */}
            <section className="py-32 bg-primary text-white text-center relative overflow-hidden">
                {/* Background FX */}
                <div className="absolute top-0 left-0 w-full h-full bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 mix-blend-overlay pointer-events-none" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[1000px] bg-white/10 rounded-full blur-[120px] pointer-events-none" />

                <div className="container relative z-10 max-w-4xl mx-auto">
                    <h2 className="text-5xl md:text-6xl font-bold mb-8 drop-shadow-sm">Schluss mit Excel-Chaos.</h2>
                    <p className="text-2xl text-blue-50 mb-12 max-w-3xl mx-auto font-light">
                        Starte jetzt deine 10-tägige Testphase. <br />Völlig unverbindlich, ohne Kreditkarte.
                    </p>

                    <Link to="/register-trial" className="btn-primary bg-white text-primary hover:bg-blue-50 px-12 py-6 text-xl shadow-2xl shadow-black/20 border-none transition-transform hover:scale-105 font-bold inline-block rounded-2xl">
                        Kostenlos starten
                    </Link>
                    <div className="mt-10">
                        <Link to="/preise" className="text-blue-100 hover:text-white transition-colors underline decoration-blue-300/50 hover:decoration-white text-lg">
                            Oder erst Preise vergleichen
                        </Link>
                    </div>
                </div>
            </section>

        </MainLayout>
    );
};

export default FeaturesPageV2;
