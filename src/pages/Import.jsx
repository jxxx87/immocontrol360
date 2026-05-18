import React, { useState } from 'react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { Upload, FileSpreadsheet, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

const Import = () => {
    const { user } = useAuth();
    const [file, setFile] = useState(null);
    const [dragging, setDragging] = useState(false);
    const [importing, setImporting] = useState(false);
    const [progress, setProgress] = useState('');
    const [logs, setLogs] = useState([]);
    const [importResult, setImportResult] = useState(null);

    const handleFileSelect = (e) => {
        const selected = e.target.files[0];
        validateAndSetFile(selected);
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setDragging(false);
        const selected = e.dataTransfer.files[0];
        validateAndSetFile(selected);
    };

    const validateAndSetFile = (selected) => {
        setLogs([]);
        setImportResult(null);
        setProgress('');

        if (!selected) return;

        if (!selected.name.endsWith('.xlsx')) {
            addLog('Fehler: Nur .xlsx Dateien sind erlaubt.', 'error');
            return;
        }

        setFile(selected);
        addLog(`Datei ausgewählt: ${selected.name} (${(selected.size / 1024).toFixed(2)} KB)`, 'info');
    };

    const addLog = (message, type = 'info') => {
        setLogs(prev => [...prev, { message, type, timestamp: new Date() }]);
    };

    const handleImport = async () => {
        if (!file) return;

        setImporting(true);
        addLog('Lese Excel-Datei...', 'info');

        const fixDate = (val) => {
            if (!val) return null;
            const d = val instanceof Date ? new Date(val) : new Date(val);
            // Add 12 hours to prevent date slipping to previous day due to timezone differences
            // e.g. 01.07.2019 00:00 -> 30.06.2019 22:00 UTC. With +12h it stays 01.07.
            d.setHours(d.getHours() + 12);
            return d.toISOString();
        };

        try {
            const data = await parseExcel(file);
            if (!data) {
                setImporting(false);
                return;
            }

            addLog(`${data.length} Datensätze gefunden. Starte Import...`, 'info');

            // Stats
            let stats = { properties: 0, units: 0, tenants: 0, contacts: 0, errors: [] };
            const propertiesMap = new Map(); // Key: strc-addr, Value: ID

            // Fetch Portfolios for mapping
            // Fetch Portfolios for mapping
            const { data: portfolios, error: portError } = await supabase.from('portfolios').select('id, name');
            if (portError) addLog('Warnung: Portfolios konnten nicht geladen werden.', 'error');

            const findPortfolioId = (name) => {
                if (!name || !portfolios) return null;
                const normalizedSearch = name.trim().toLowerCase();
                return portfolios.find(p => p.name.trim().toLowerCase() === normalizedSearch)?.id || null;
            };

            // 1. Properties
            setProgress('Schritt 1/3: Immobilien prüfen und anlegen...');
            const uniqueProps = [];
            data.forEach(row => {
                if (row.street && row.zip) {
                    const key = `${row.street}-${row.house_number}-${row.zip}-${row.city}`.toLowerCase();
                    if (!uniqueProps.find(p => p.key === key)) {
                        uniqueProps.push({ key, ...row });
                    }
                }
            });

            for (const prop of uniqueProps) {
                // Check if property exists
                const { data: existing } = await supabase
                    .from('properties')
                    .select('id')
                    .eq('street', prop.street)
                    .match({ house_number: prop.house_number, zip: prop.zip, city: prop.city })
                    .maybeSingle();

                if (existing) {
                    propertiesMap.set(prop.key, existing.id);
                } else {
                    const { data: newProp, error } = await supabase
                        .from('properties')
                        .insert({
                            user_id: user.id,
                            portfolio_id: findPortfolioId(prop.portfolio),
                            street: prop.street,
                            house_number: prop.house_number,
                            zip: prop.zip,
                            city: prop.city,
                            construction_year: prop.construction_year,
                            property_type: prop.property_type || 'residential'
                        })
                        .select()
                        .single();

                    if (error) {
                        addLog(`Fehler bei Immobilie ${prop.street}: ${error.message}`, 'error');
                    } else {
                        propertiesMap.set(prop.key, newProp.id);
                        stats.properties++;
                    }
                }
            }

            // 2. Units
            setProgress(`Schritt 2/3: ${data.length} Einheiten verarbeiten...`);
            for (const row of data) {
                // Yield to UI
                await new Promise(r => setTimeout(r, 0));

                const propKey = `${row.street}-${row.house_number}-${row.zip}-${row.city}`.toLowerCase();
                const propertyId = propertiesMap.get(propKey);

                if (!propertyId) {
                    if (row.street) addLog(`Überspringe Einheit ${row.unit_name}: Immobilie nicht gefunden.`, 'error');
                    continue;
                }

                if (!row.unit_name) continue;

                const { data: existingUnit } = await supabase
                    .from('units')
                    .select('id')
                    .eq('property_id', propertyId)
                    .eq('unit_name', row.unit_name)
                    .maybeSingle();

                let unitId = existingUnit?.id;

                if (!unitId) {
                    const { data: newUnit, error } = await supabase
                        .from('units')
                        .insert({
                            user_id: user.id,
                            property_id: propertyId,
                            unit_name: row.unit_name,
                            floor: row.floor,
                            sqm: parseFloat(row.sqm) || 0,
                            rooms: parseFloat(row.rooms) || 0,
                            bathrooms: parseFloat(row.bathrooms) || 1,
                            bedrooms: parseFloat(row.bedrooms) || 1,
                            balcony: !!row.balcony,
                            fitted_kitchen: !!row.fitted_kitchen,
                            is_vacation_rental: !!row.is_vacation_rental,
                            cold_rent_ist: parseFloat(row.cold_rent_ist) || null,
                            target_rent: parseFloat(row.target_rent) || 0
                        })
                        .select()
                        .single();

                    if (error) {
                        addLog(`Fehler bei Einheit ${row.unit_name}: ${error.message}`, 'error');
                        continue;
                    }
                    unitId = newUnit.id;
                    stats.units++;
                }

                // 3. Tenants & Leases
                if (unitId && row.t_lastname) {
                    let query = supabase.from('tenants').select('id');
                    if (row.t_email) {
                        query = query.eq('email', row.t_email);
                    } else {
                        query = query.eq('last_name', row.t_lastname).eq('first_name', row.t_firstname);
                    }

                    const { data: existingTenant } = await query.maybeSingle();
                    let tenantId = existingTenant?.id;

                    if (!tenantId) {
                        const { data: newTenant, error: tErr } = await supabase
                            .from('tenants')
                            .insert({
                                user_id: user.id,
                                first_name: row.t_firstname,
                                last_name: row.t_lastname,
                                email: row.t_email,
                                phone: row.t_phone,
                                occupants: parseInt(row.t_occupants) || 1
                            })
                            .select()
                            .single();

                        if (!tErr) {
                            tenantId = newTenant.id;
                            stats.tenants++;
                        } else {
                            addLog(`Fehler bei Mieter ${row.t_lastname}: ${tErr.message}`, 'error');
                        }
                    }

                    if (tenantId) {
                        const { data: activeLease } = await supabase
                            .from('leases')
                            .select('id')
                            .eq('unit_id', unitId)
                            .eq('status', 'active')
                            .maybeSingle();

                        if (!activeLease) {
                            const { error: lErr } = await supabase.from('leases').insert({
                                user_id: user.id,
                                tenant_id: tenantId,
                                unit_id: unitId,
                                start_date: fixDate(row.t_start_date) || new Date().toISOString(),
                                cold_rent: parseFloat(row.t_cold_rent) || 0,
                                service_charge: parseFloat(row.t_service_charge) || 0,
                                heating_cost: parseFloat(row.t_heating_cost) || 0,
                                other_costs: parseFloat(row.t_other_costs) || 0,
                                deposit: parseFloat(row.t_deposit) || 0,
                                status: 'active',
                                last_rent_increase: fixDate(row.t_last_increase)
                            });

                            if (lErr) addLog(`Fehler bei Mietvertrag: ${lErr.message}`, 'error');
                        }
                    }

                    // 4. Contacts (Check/Insert)
                    if (row.t_lastname) {
                        try {
                            const fullName = `${row.t_firstname || ''} ${row.t_lastname || ''}`.trim();
                            const { data: existingContact } = await supabase
                                .from('contacts')
                                .select('id')
                                .eq('name', fullName)
                                .maybeSingle();

                            if (!existingContact && fullName) {
                                const { error: cErr } = await supabase.from('contacts').insert({
                                    user_id: user.id,
                                    name: fullName,
                                    email: row.t_email,
                                    phone: row.t_phone,
                                    unit_name: row.unit_name,
                                    contact_type: 'tenant'
                                });
                                if (!cErr) stats.contacts++;
                            }
                        } catch (contactError) {
                            console.error('Contact import error:', contactError);
                        }
                    }
                }
            }

            setImportResult(stats);
            addLog(`Import abgeschlossen. Ergebnisse: ${stats.properties} Immobilien, ${stats.units} Einheiten, ${stats.tenants} Mieter, ${stats.contacts} Kontakte.`, 'success');
            setImporting(false); // Hide overlay

        } catch (error) {
            console.error('Import Error:', error);
            addLog(`Import fehlgeschlagen: ${error.message || 'Unbekannter Fehler'}`, 'error');
            setProgress('');
            setImporting(false);
        }
    };

    const parseExcel = (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const workbook = XLSX.read(e.target.result, { type: 'array', cellDates: true });
                    const sheetName = workbook.SheetNames[0];
                    const sheet = workbook.Sheets[sheetName];

                    // Validate A1
                    const cellA1 = sheet['A1'] ? sheet['A1'].v : '';
                    if (cellA1 !== 'ImmoControlpro360') {
                        addLog(`Warnung: Zelle A1 enthält "${cellA1}" statt "ImmoControlpro360".`, 'warning');
                        // resolve(null); return; 
                    } else {
                        addLog('Info: Zelle A1 korrekt.', 'success');
                    }

                    // Parse data from row 6 (index 5)
                    // range: s: {r: 5, c: 0}
                    const jsonData = XLSX.utils.sheet_to_json(sheet, { range: 5, header: 'A' });
                    addLog(`Info: ${jsonData.length} Zeilen ab Zeile 6 gefunden.`, 'info');
                    if (jsonData.length > 0) {
                        // Success parsing
                    }

                    if (jsonData.length === 0) {
                        addLog('Fehler: Keine Daten ab Zeile 6 gefunden.', 'error');
                        resolve(null);
                        return;
                    }

                    // Map columns
                    const mappedData = jsonData.map((row, index) => {
                        // Logik für Ja/Nein
                        const parseBool = (val) => {
                            if (!val) return false;
                            const s = String(val).toLowerCase().trim();
                            return s === 'ja' || s === 'true' || s === '1';
                        };

                        return {
                            rowNumber: index + 6,
                            portfolio: row['A'],
                            street: row['B'],
                            house_number: row['C'],
                            zip: row['D'],
                            city: row['E'],
                            construction_year: row['F'],
                            property_type: row['G'],
                            unit_name: row['H'],
                            floor: row['I'],
                            sqm: row['J'],
                            rooms: row['K'],
                            bathrooms: row['L'],
                            bedrooms: row['M'],
                            balcony: parseBool(row['N']),
                            fitted_kitchen: parseBool(row['O']),
                            is_vacation_rental: parseBool(row['P']),
                            cold_rent_ist: row['Q'],
                            target_rent: row['R'], // Kaltmiete Soll (Immobilie)

                            // Tenant
                            t_firstname: row['S'],
                            t_lastname: row['T'],
                            t_phone: row['U'],
                            t_email: row['V'],
                            t_start_date: row['W'],
                            t_occupants: row['X'],
                            t_cold_rent: row['Y'], // Kaltmiete Ist Mieter
                            t_service_charge: row['Z'],
                            t_heating_cost: row['AA'],
                            t_other_costs: row['AB'],
                            t_deposit: row['AC'],
                            t_last_increase: row['AD']
                        };
                    });

                    resolve(mappedData);
                } catch (err) {
                    addLog('Fehler beim Lesen der Excel-Datei: ' + err.message, 'error');
                    resolve(null);
                }
            };
            reader.readAsArrayBuffer(file);
        });
    };

    return (
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
            {importing && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 9999,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'white'
                }}>
                    <Loader2 size={64} className="animate-spin" style={{ marginBottom: '20px' }} />
                    <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '10px' }}>Import läuft...</h2>
                    <p style={{ fontSize: '1.1rem', marginBottom: '20px' }}>Es kann einen Augenblick dauern, bis alle Objekte angelegt sind.</p>
                    <div style={{ fontSize: '1rem', opacity: 0.8 }}>{progress}</div>
                    {importResult && (
                        <div style={{ marginTop: '20px', padding: '15px', backgroundColor: 'rgba(16, 185, 129, 0.2)', borderRadius: '8px', border: '1px solid var(--success-color)' }}>
                            Import erfolgreich abgeschlossen! Seite wird neu geladen...
                        </div>
                    )}
                </div>
            )}

            <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: 'var(--spacing-xs)' }}>Import (XLSX)</h1>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--spacing-xl)' }}>
                Hier kannst du Immobilien, Einheiten und Mieter aus der offiziellen ImmoControlpro360-Excelvorlage importieren.
            </p>

            <Card style={{ padding: 'var(--spacing-xl)' }}>
                <div
                    style={{
                        border: `2px dashed ${dragging ? 'var(--primary-color)' : 'var(--border-color)'}`,
                        borderRadius: 'var(--radius-lg)',
                        padding: '40px',
                        textAlign: 'center',
                        backgroundColor: dragging ? '#E0F2FE' : 'transparent',
                        transition: 'all 0.2s'
                    }}
                    onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={handleDrop}
                >
                    <FileSpreadsheet size={48} style={{ color: 'var(--text-secondary)', marginBottom: 'var(--spacing-md)' }} />
                    <div style={{ marginBottom: 'var(--spacing-lg)' }}>
                        <p style={{ fontWeight: 500, marginBottom: '5px' }}>Ziehe deine XLSX-Datei hierher</p>
                        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>oder klicke auf den Button</p>
                    </div>

                    <input
                        type="file"
                        accept=".xlsx"
                        onChange={handleFileSelect}
                        style={{ display: 'none' }}
                        id="file-upload"
                    />
                    <label htmlFor="file-upload">
                        <Button as="span" icon={Upload}>XLSX-Datei auswählen</Button>
                    </label>

                    {file && (
                        <div style={{ marginTop: 'var(--spacing-lg)', padding: '10px', backgroundColor: 'var(--background-color)', borderRadius: 'var(--radius-md)', display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
                            <FileSpreadsheet size={16} />
                            <span style={{ fontWeight: 500 }}>{file.name}</span>
                            <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>({(file.size / 1024).toFixed(1)} KB)</span>
                        </div>
                    )}
                </div>

                {file && (
                    <div style={{ marginTop: 'var(--spacing-xl)', textAlign: 'center' }}>
                        <Button size="lg" onClick={handleImport} disabled={importing}>Import starten</Button>
                    </div>
                )}
            </Card>

            <div style={{ marginTop: 'var(--spacing-xl)' }}>
                {importResult && (
                    <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: 'var(--surface-color)', borderRadius: '8px', border: '1px solid #10B981', color: '#065F46' }}>
                        <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '5px' }}>Import abgeschlossen</h3>
                        <p>Erfolgreich importiert:</p>
                        <ul style={{ listStyle: 'disc', paddingLeft: '20px', marginTop: '5px' }}>
                            <li>Einheiten: {importResult.units}</li>
                            <li>Mieter: {importResult.tenants}</li>
                            <li>Kontakte: {importResult.contacts}</li>
                        </ul>
                        {importResult.errors && importResult.errors.length > 0 && (
                            <div style={{ marginTop: '10px', color: '#B91C1C' }}>
                                <p style={{ fontWeight: 600 }}>Fehler aufgetreten:</p>
                                <ul style={{ listStyle: 'disc', paddingLeft: '20px' }}>
                                    {importResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                                </ul>
                            </div>
                        )}
                        <div style={{ marginTop: '15px' }}>
                            <Button size="sm" onClick={() => window.location.reload()}>Seite neu laden (Daten aktualisieren)</Button>
                        </div>
                    </div>
                )}

                <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: 'var(--spacing-md)' }}>Import-Log</h3>
                <Card style={{ padding: '0', maxHeight: '300px', overflowY: 'auto', backgroundColor: '#111827', color: '#E5E7EB' }}>
                    {logs.length === 0 ? (
                        <div style={{ padding: '20px', color: '#6B7280', fontStyle: 'italic' }}>Warte auf Import...</div>
                    ) : (
                        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '5px', fontFamily: 'monospace', fontSize: '0.875rem' }}>
                            {logs.map((log, idx) => (
                                <div key={idx} style={{ display: 'flex', gap: '10px', color: log.type === 'error' ? '#EF4444' : log.type === 'success' ? '#10B981' : '#E5E7EB' }}>
                                    <span style={{ opacity: 0.5 }}>[{log.timestamp.toLocaleTimeString()}]</span>
                                    <span>{log.message}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>
            </div>
        </div>
    );
};

export default Import;
