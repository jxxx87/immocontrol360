#!/usr/bin/env node
// Schreibt baseline_public.sql und seed_system_defaults.sql aus dem Ergebnis von generate_baseline.sql.
//
// Aufruf:  node supabase/baseline/extract_baseline.cjs <ergebnis.json|ergebnis.txt>
//   Eingabe: das gespeicherte Ergebnis des Supabase-MCP-Werkzeugs execute_sql ({"result": "..."} mit
//   eingebettetem JSON-Array) oder ein reines JSON-Array [{ddl, seed, report}] (z. B. SQL-Editor-Export).
//
// Prüft vor dem Schreiben:
//   - md5-Prüfsumme in der letzten Zeile von ddl (Übertragung vollständig und unverändert)
//   - kein JWT-artiges Literal (eyJ…) in ddl/seed (der Schlüssel aus notify_push darf nie ins Repo)
//   - Prüfbericht: jede Zeile "OK" außer den bekannten Abweichungen (notify_push, contact_requests_email_len)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const src = process.argv[2];
if (!src) {
    console.error('Aufruf: node extract_baseline.cjs <ergebnis.json>');
    process.exit(2);
}

let txt = fs.readFileSync(src, 'utf8');
try {
    const outer = JSON.parse(txt);
    if (outer && typeof outer.result === 'string') txt = outer.result;
} catch {
    // kein äußeres JSON – direkt weiter
}
const start = txt.indexOf('[{');
const end = txt.lastIndexOf('}]');
if (start < 0 || end < 0) {
    console.error('Kein Ergebnis-Array gefunden.');
    process.exit(1);
}
const rows = JSON.parse(txt.slice(start, end + 2));
const { ddl, seed, report } = rows[0] || {};
if (typeof ddl !== 'string' || typeof seed !== 'string') {
    console.error('Spalten ddl/seed fehlen.');
    process.exit(1);
}

// 1. Prüfsumme
const m = ddl.match(/\n-- Prüfsumme \(md5 des Inhalts vor dieser Zeile\): ([0-9a-f]{32})\n$/);
if (!m) {
    console.error('Prüfsummen-Zeile fehlt.');
    process.exit(1);
}
// Die Prüfsumme gilt für den Inhalt bis einschließlich des letzten Zeilenumbruchs vor der Leerzeile.
const body = ddl.slice(0, m.index);
const md5 = crypto.createHash('md5').update(body, 'utf8').digest('hex');
if (md5 !== m[1]) {
    console.error(`Prüfsumme stimmt nicht (erwartet ${m[1]}, berechnet ${md5}).`);
    process.exit(1);
}

// 2. Keine Schlüssel
const jwt = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/;
if (jwt.test(ddl) || jwt.test(seed)) {
    console.error('JWT-artiges Literal gefunden – nichts geschrieben.');
    process.exit(1);
}

// 3. Prüfbericht
const known = ['notify_push(p_table text, p_record jsonb)', 'contact_requests.contact_requests_email_len'];
const bad = String(report || '')
    .split('\n')
    .filter((l) => l.trim() && !/\bOK$/.test(l))
    .filter((l) => {
        // Schlüssel können selbst ", " enthalten (Funktionsargumente) – bekannte Schlüssel herausnehmen
        let rest = l.split('-> ')[1] || '';
        if (!rest.trim()) return true;
        for (const k of known) rest = rest.split(k).join('');
        return rest.replace(/[,\s]/g, '') !== '';
    });
console.log(String(report || '(kein Prüfbericht)').trim());
if (bad.length) {
    console.error('\nUnerwartete Abweichungen im Prüfbericht – nichts geschrieben.');
    process.exit(1);
}

const dir = __dirname;
fs.writeFileSync(path.join(dir, 'baseline_public.sql'), ddl, 'utf8');
fs.writeFileSync(path.join(dir, 'seed_system_defaults.sql'), seed, 'utf8');
console.log(`\nbaseline_public.sql: ${Buffer.byteLength(ddl, 'utf8')} Bytes, md5 ${md5}`);
console.log(`seed_system_defaults.sql: ${Buffer.byteLength(seed, 'utf8')} Bytes`);
