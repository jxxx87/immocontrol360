// Unit-Tests der Server-/Portprüfung der E-Mail-Einrichtung (EmailSettings.jsx).
// Dieselben Regeln gelten in der Edge Function send-letting-email (Test und Versand).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ALLOWED_SMTP_PORTS, isAllowedSmtpPort, isAllowedSmtpHost } from './smtpServerCheck';

describe('isAllowedSmtpHost', () => {
    it('erlaubt öffentliche Servernamen und öffentliche IPv4-Adressen', () => {
        expect(isAllowedSmtpHost('smtp.example.com')).toBe(true);
        expect(isAllowedSmtpHost('mail.ihredomain.de')).toBe(true);
        expect(isAllowedSmtpHost('smtp-relay.sendinblue.com')).toBe(true);
        expect(isAllowedSmtpHost('8.8.8.8')).toBe(true);
        expect(isAllowedSmtpHost('172.32.0.1')).toBe(true);
        expect(isAllowedSmtpHost('100.128.0.1')).toBe(true);
    });

    it('lehnt localhost und interne Namen ab', () => {
        expect(isAllowedSmtpHost('localhost')).toBe(false);
        expect(isAllowedSmtpHost('mail.localhost')).toBe(false);
        expect(isAllowedSmtpHost('db.internal')).toBe(false);
        expect(isAllowedSmtpHost('nas.local')).toBe(false);
        expect(isAllowedSmtpHost('router.lan')).toBe(false);
        expect(isAllowedSmtpHost('fritz.home')).toBe(false);
        expect(isAllowedSmtpHost('srv.intranet')).toBe(false);
        expect(isAllowedSmtpHost('mailserver')).toBe(false);
    });

    it('lehnt private, reservierte und ungültige IPv4-Adressen ab', () => {
        expect(isAllowedSmtpHost('10.0.0.5')).toBe(false);
        expect(isAllowedSmtpHost('127.0.0.1')).toBe(false);
        expect(isAllowedSmtpHost('0.0.0.0')).toBe(false);
        expect(isAllowedSmtpHost('169.254.169.254')).toBe(false);
        expect(isAllowedSmtpHost('172.16.0.1')).toBe(false);
        expect(isAllowedSmtpHost('172.31.255.255')).toBe(false);
        expect(isAllowedSmtpHost('192.168.1.10')).toBe(false);
        expect(isAllowedSmtpHost('100.64.0.1')).toBe(false);
        expect(isAllowedSmtpHost('224.0.0.1')).toBe(false);
        expect(isAllowedSmtpHost('300.1.1.1')).toBe(false);
    });

    it('lehnt Kurz-, Oktal- und Hex-Schreibweisen von IP-Adressen ab', () => {
        expect(isAllowedSmtpHost('127.1')).toBe(false);
        expect(isAllowedSmtpHost('10.1')).toBe(false);
        expect(isAllowedSmtpHost('192.168.1')).toBe(false);
        expect(isAllowedSmtpHost('10.0x1')).toBe(false);
        expect(isAllowedSmtpHost('0x7f.0.0.1')).toBe(false);
        expect(isAllowedSmtpHost('012.0.0.1')).toBe(false);
        expect(isAllowedSmtpHost('8.8.8.08')).toBe(false);
        expect(isAllowedSmtpHost('127.0.0.1.')).toBe(false);
        expect(isAllowedSmtpHost('smtp..example.com')).toBe(false);
        expect(isAllowedSmtpHost('.example.com')).toBe(false);
        expect(isAllowedSmtpHost('mail.123')).toBe(false);
        expect(isAllowedSmtpHost('1und1.de')).toBe(true);
        expect(isAllowedSmtpHost('smtp.0x.de')).toBe(true);
    });

    it('lehnt IPv6, Sonderzeichen, Leerzeichen und Großschreibung ab (Aufrufer normalisiert)', () => {
        expect(isAllowedSmtpHost('[::1]')).toBe(false);
        expect(isAllowedSmtpHost('::1')).toBe(false);
        expect(isAllowedSmtpHost('smtp.example.com:25')).toBe(false);
        expect(isAllowedSmtpHost(' smtp.example.com')).toBe(false);
        expect(isAllowedSmtpHost('SMTP.EXAMPLE.COM')).toBe(false);
        expect(isAllowedSmtpHost('')).toBe(false);
        expect(isAllowedSmtpHost(null)).toBe(false);
        expect(isAllowedSmtpHost(`${'a'.repeat(250)}.com`)).toBe(false);
    });
});

describe('isAllowedSmtpPort', () => {
    it('erlaubt nur 25, 465, 587 und 2525', () => {
        expect(ALLOWED_SMTP_PORTS).toEqual([25, 465, 587, 2525]);
        ['25', '465', '587', '2525', 587].forEach((p) => expect(isAllowedSmtpPort(p)).toBe(true));
        ['', '0', '22', '6379', '2526', '587.5', 'abc', null].forEach((p) => expect(isAllowedSmtpPort(p)).toBe(false));
    });

    it('stimmt mit der Edge Function send-letting-email überein', () => {
        const source = readFileSync(
            fileURLToPath(new URL('../../supabase/functions/send-letting-email/index.ts', import.meta.url)),
            'utf8'
        );
        const match = source.match(/const ALLOWED_SMTP_PORTS = new Set\(\[([^\]]*)\]\)/);
        expect(match).not.toBeNull();
        const edgePorts = match[1].split(',').map((p) => Number(p.trim()));
        expect(edgePorts).toEqual(ALLOWED_SMTP_PORTS);
    });

    it('Server-Prüfung der Edge Function entscheidet wie die der Seite', () => {
        const source = readFileSync(
            fileURLToPath(new URL('../../supabase/functions/send-letting-email/index.ts', import.meta.url)),
            'utf8'
        );
        const match = source.match(/function isAllowedSmtpHost\(host: string\): boolean \{[\s\S]*?\r?\n\}\r?\n/);
        expect(match).not.toBeNull();
        const js = match[0].replace('(host: string): boolean', '(host)');
        const edgeCheck = new Function(`${js}; return isAllowedSmtpHost;`)();
        [
            'smtp.example.com', '8.8.8.8', '172.32.0.1', '1und1.de', 'localhost', 'nas.local',
            '10.0.0.5', '127.0.0.1', '169.254.169.254', '192.168.1.10', '100.64.0.1', '300.1.1.1',
            '127.1', '10.0x1', '012.0.0.1', '127.0.0.1.', 'smtp..example.com', 'mail.123', '[::1]', '',
        ].forEach((host) => expect(edgeCheck(host)).toBe(isAllowedSmtpHost(host)));
    });
});
