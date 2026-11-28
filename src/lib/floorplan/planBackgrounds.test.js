import { describe, it, expect } from 'vitest';
import {
    FLOORPLAN_BG_BUCKET, MAX_BG_UPLOAD_BYTES,
    isStoredBackground, isInlineBackground, extForMime, parseDataUrl, dataUrlByteLength, dataUrlToBlob,
    buildBackgroundPath, retargetBackgroundPath, collectBackgroundPaths, toStoredBackground,
    uploadBackgroundBlob, removeBackgroundObjects, listPlanBackgroundPaths, copyBackgroundObject, downloadBackgroundBlob,
} from './planBackgrounds';

const PLAN = '5e570000-0000-4000-8000-00000000f001';

// Minimaler Ersatz für supabase.storage (zeichnet Aufrufe auf)
const fakeStorage = (result = {}) => {
    const calls = [];
    const api = {
        upload: async (...a) => { calls.push(['upload', ...a]); return { error: result.error || null }; },
        download: async (...a) => { calls.push(['download', ...a]); return { data: result.data ?? null, error: result.error || null }; },
        remove: async (...a) => { calls.push(['remove', ...a]); return { error: result.error || null }; },
        list: async (...a) => { calls.push(['list', ...a]); return { data: result.list || [], error: result.error || null }; },
        copy: async (...a) => { calls.push(['copy', ...a]); return { error: result.error || null }; },
    };
    return { calls, storage: { from: (b) => { calls.push(['from', b]); return api; } } };
};

describe('planBackgrounds – reine Hilfsfunktionen', () => {
    it('erkennt gespeicherte und eingebettete Hintergründe', () => {
        expect(isStoredBackground({ path: `${PLAN}/a.jpg` })).toBe(true);
        expect(isStoredBackground({ path: '' })).toBe(false);
        expect(isInlineBackground({ dataUrl: 'data:image/png;base64,AAAA' })).toBe(true);
        expect(isInlineBackground({ dataUrl: 'https://x' })).toBe(false);
        expect(isInlineBackground(null)).toBe(false);
    });

    it('zerlegt data-URLs und wandelt sie in einen Blob', async () => {
        const url = 'data:image/png;base64,iVBORw0KGgo=';
        expect(parseDataUrl(url)).toEqual({ mime: 'image/png', base64: true, data: 'iVBORw0KGgo=' });
        expect(parseDataUrl('kein-data-url')).toBeNull();
        expect(dataUrlByteLength(url)).toBe(8);
        const blob = dataUrlToBlob(url);
        expect(blob.type).toBe('image/png');
        expect(blob.size).toBe(8);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        expect(Array.from(bytes)).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        expect(dataUrlToBlob('data:text/plain,Hallo%20Welt').size).toBe(10);
        expect(dataUrlToBlob('')).toBeNull();
    });

    it('baut sichere Pfade mit der Plan-ID als erstem Ordner', () => {
        expect(buildBackgroundPath(PLAN, 'fp_abc_1_x9', 'jpg', 'u-1')).toBe(`${PLAN}/fp_abc_1_x9-u-1.jpg`);
        expect(buildBackgroundPath(PLAN, '../böse/id', 'png', 'a/b')).toBe(`${PLAN}/_b_se_id-ab.png`);
        expect(buildBackgroundPath(PLAN, '', 'png', 'z')).toBe(`${PLAN}/geschoss-z.png`);
        expect(retargetBackgroundPath(`${PLAN}/s1-a.jpg`, 'neu')).toBe('neu/s1-a.jpg');
        expect(extForMime('IMAGE/JPEG')).toBe('jpg');
        expect(extForMime('image/webp')).toBeNull();
    });

    it('sammelt Pfade und ersetzt die data-URL durch den Pfad', () => {
        const plan = [
            { id: 's1', bgImage: { path: `${PLAN}/s1-a.jpg` } },
            { id: 's2', bgImage: { dataUrl: 'data:image/png;base64,AA' } },
            { id: 's3' }, null,
        ];
        expect(collectBackgroundPaths(plan)).toEqual([`${PLAN}/s1-a.jpg`]);
        const stored = toStoredBackground({ dataUrl: 'data:x', scale: 2, opacity: 0.3 }, `${PLAN}/s2-b.png`, { scale: 1 });
        expect(stored).toEqual({ scale: 1, opacity: 0.3, path: `${PLAN}/s2-b.png` });
    });
});

describe('planBackgrounds – Storage-Aufrufe', () => {
    it('lädt hoch (ohne Überschreiben) und prüft Größe/Typ vorab', async () => {
        const { storage, calls } = fakeStorage();
        const blob = new Blob([new Uint8Array(10)], { type: 'image/jpeg' });
        await uploadBackgroundBlob(storage, `${PLAN}/s1-a.jpg`, blob);
        expect(calls[0]).toEqual(['from', FLOORPLAN_BG_BUCKET]);
        expect(calls[1][0]).toBe('upload');
        expect(calls[1][3]).toMatchObject({ contentType: 'image/jpeg', upsert: false });

        await expect(uploadBackgroundBlob(storage, 'x', new Blob([new Uint8Array(4)], { type: 'image/webp' }))).rejects.toThrow(/PNG/);
        await expect(uploadBackgroundBlob(storage, 'x', new Blob([], { type: 'image/png' }))).rejects.toThrow(/leer/);
        const big = { size: MAX_BG_UPLOAD_BYTES + 1, type: 'image/png' };
        await expect(uploadBackgroundBlob(storage, 'x', big)).rejects.toThrow(/zu groß/);
    });

    it('gibt Storage-Fehler weiter', async () => {
        const { storage } = fakeStorage({ error: new Error('Bucket not found') });
        await expect(uploadBackgroundBlob(storage, 'x', new Blob([new Uint8Array(3)], { type: 'image/png' }))).rejects.toThrow('Bucket not found');
        await expect(downloadBackgroundBlob(storage, 'x')).rejects.toThrow('Bucket not found');
        await expect(copyBackgroundObject(storage, 'a', 'b')).rejects.toThrow('Bucket not found');
    });

    it('löscht eindeutige Pfade und listet den Plan-Ordner', async () => {
        const { storage, calls } = fakeStorage({ list: [{ name: 's1-a.jpg', id: '1' }, { name: 'ordner', id: null }] });
        expect(await removeBackgroundObjects(storage, ['a', 'a', '', null, 'b'])).toBe(2);
        expect(calls.find(c => c[0] === 'remove')[1]).toEqual(['a', 'b']);
        expect(await removeBackgroundObjects(storage, [])).toBe(0);
        expect(await listPlanBackgroundPaths(storage, PLAN)).toEqual([`${PLAN}/s1-a.jpg`]);
    });
});
