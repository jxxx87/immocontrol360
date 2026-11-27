// Unit-Tests für den Undo/Redo-Stapel des Grundriss-Editors.
// Geprüft wird das fachlich gewollte Verhalten: LIFO-Reihenfolge, Verwerfen der
// Redo-Kette nach einem neuen Befehl, Obergrenze (älteste Schritte fallen weg),
// Fehlerrobustheit (ein fehlgeschlagener Schritt geht nicht verloren) und
// Benachrichtigung der Abonnenten (der Editor rendert daraufhin neu).
import { describe, it, expect, vi } from 'vitest';
import { createCommandStack, MAX_UNDO_STEPS } from './commandStack.js';

// Kleines Modell: ein Zähler, Befehle addieren einen Betrag (umkehrbar).
const makeModel = () => {
    const state = { value: 0, log: [] };
    const add = (amount) => ({
        label: `+${amount}`,
        do: () => { state.value += amount; state.log.push(`do +${amount}`); },
        undo: () => { state.value -= amount; state.log.push(`undo +${amount}`); },
    });
    return { state, add };
};

describe('createCommandStack – Grundverhalten', () => {
    it('leerer Stapel: nichts rückgängig/wiederholbar, undo/redo sind No-Ops', () => {
        const stack = createCommandStack();
        expect(stack.canUndo()).toBe(false);
        expect(stack.canRedo()).toBe(false);
        expect(() => stack.undo()).not.toThrow();
        expect(() => stack.redo()).not.toThrow();
        expect(stack.getUndoCount()).toBe(0);
        expect(stack.getRedoCount()).toBe(0);
    });

    it('execute führt den Befehl genau einmal aus und legt ihn auf den Undo-Stapel', () => {
        const stack = createCommandStack();
        const doFn = vi.fn();
        const undoFn = vi.fn();
        stack.execute({ label: 'x', do: doFn, undo: undoFn });
        expect(doFn).toHaveBeenCalledTimes(1);
        expect(undoFn).not.toHaveBeenCalled();
        expect(stack.canUndo()).toBe(true);
        expect(stack.canRedo()).toBe(false);
        expect(stack.getUndoCount()).toBe(1);
    });

    it('undo nimmt in umgekehrter Reihenfolge zurück (LIFO), redo stellt in Originalreihenfolge wieder her', () => {
        const { state, add } = makeModel();
        const stack = createCommandStack();
        stack.execute(add(5));   // 0 + 5 = 5
        stack.execute(add(3));   // 5 + 3 = 8
        stack.execute(add(10));  // 8 + 10 = 18
        expect(state.value).toBe(18);

        stack.undo();            // 18 − 10 = 8
        expect(state.value).toBe(8);
        stack.undo();            // 8 − 3 = 5
        expect(state.value).toBe(5);
        expect(stack.getUndoCount()).toBe(1);
        expect(stack.getRedoCount()).toBe(2);

        stack.redo();            // zuerst der zuletzt zurückgenommene: 5 + 3 = 8
        expect(state.value).toBe(8);
        stack.redo();            // dann 8 + 10 = 18
        expect(state.value).toBe(18);
        expect(stack.canRedo()).toBe(false);

        expect(state.log).toEqual([
            'do +5', 'do +3', 'do +10',
            'undo +10', 'undo +3',
            'do +3', 'do +10',
        ]);
    });

    it('vollständiges Zurücknehmen endet beim Ausgangszustand; weiteres undo ändert nichts', () => {
        const { state, add } = makeModel();
        const stack = createCommandStack();
        stack.execute(add(7));
        stack.execute(add(-2)); // auch negative Beträge: 7 − 2 = 5
        expect(state.value).toBe(5);
        stack.undo();
        stack.undo();
        expect(state.value).toBe(0);
        stack.undo(); // leer → kein Effekt
        expect(state.value).toBe(0);
        expect(state.log.filter(l => l.startsWith('undo'))).toHaveLength(2);
    });

    it('ein neuer Befehl nach undo verwirft die Redo-Kette', () => {
        const { state, add } = makeModel();
        const stack = createCommandStack();
        stack.execute(add(5));   // 5
        stack.execute(add(3));   // 8
        stack.undo();            // 5, Redo: [+3]
        expect(stack.canRedo()).toBe(true);

        stack.execute(add(10));  // 5 + 10 = 15 → Redo-Kette (+3) verworfen
        expect(state.value).toBe(15);
        expect(stack.canRedo()).toBe(false);
        stack.redo();            // No-Op: +3 darf nicht mehr auftauchen
        expect(state.value).toBe(15);

        stack.undo();            // 15 − 10 = 5
        stack.undo();            // 5 − 5 = 0
        expect(state.value).toBe(0);
        expect(state.log.filter(l => l === 'do +3')).toHaveLength(1); // nur die ursprüngliche Ausführung
    });

    it('clear leert Undo- und Redo-Stapel, ohne Befehle auszuführen', () => {
        const { state, add } = makeModel();
        const stack = createCommandStack();
        stack.execute(add(1));
        stack.execute(add(2));
        stack.undo(); // Redo: [+2]
        const logLen = state.log.length;
        stack.clear();
        expect(stack.canUndo()).toBe(false);
        expect(stack.canRedo()).toBe(false);
        expect(state.log).toHaveLength(logLen);
        expect(state.value).toBe(1); // Modellzustand bleibt unberührt
    });
});

describe('createCommandStack – Obergrenze (Speicherschutz)', () => {
    it('Standardgrenze ist MAX_UNDO_STEPS = 100', () => {
        expect(MAX_UNDO_STEPS).toBe(100);
        const { add } = makeModel();
        const stack = createCommandStack();
        for (let i = 0; i < 150; i++) stack.execute(add(1));
        expect(stack.getUndoCount()).toBe(100); // 150 − 50 älteste verworfen
    });

    it('bei maxSteps = 3 werden die ÄLTESTEN Schritte verworfen, die neuesten bleiben rücknehmbar', () => {
        const { state, add } = makeModel();
        const stack = createCommandStack({ maxSteps: 3 });
        [1, 2, 3, 4, 5].forEach(n => stack.execute(add(n))); // Summe 15
        expect(state.value).toBe(15);
        expect(stack.getUndoCount()).toBe(3);

        stack.undo(); stack.undo(); stack.undo(); // 15 − 5 − 4 − 3 = 3
        expect(state.value).toBe(3);              // +1 und +2 sind nicht mehr rücknehmbar
        expect(stack.canUndo()).toBe(false);
        stack.undo();                             // No-Op
        expect(state.value).toBe(3);
        expect(state.log.slice(-3)).toEqual(['undo +5', 'undo +4', 'undo +3']);

        // Alle drei lassen sich wiederholen: 3 + 3 + 4 + 5 = 15
        stack.redo(); stack.redo(); stack.redo();
        expect(state.value).toBe(15);
        expect(stack.getUndoCount()).toBe(3);
    });

    it('auch der Redo-Stapel ist begrenzt', () => {
        const { add } = makeModel();
        const stack = createCommandStack({ maxSteps: 2 });
        [1, 2].forEach(n => stack.execute(add(n)));
        stack.undo(); stack.undo();
        expect(stack.getRedoCount()).toBe(2);
        expect(stack.getUndoCount()).toBe(0);
    });

    it('ungültige maxSteps fallen auf den Standard zurück, negative werden auf mindestens 1 angehoben', () => {
        const { add } = makeModel();
        const fill = (stack) => { for (let i = 0; i < 120; i++) stack.execute(add(1)); return stack.getUndoCount(); };
        expect(fill(createCommandStack({ maxSteps: 'abc' }))).toBe(100); // NaN → Standard
        expect(fill(createCommandStack({}))).toBe(100);
        expect(fill(createCommandStack())).toBe(100);
        expect(fill(createCommandStack({ maxSteps: -5 }))).toBe(1);      // max(1, −5) = 1
        expect(fill(createCommandStack({ maxSteps: '7' }))).toBe(7);     // Zahl als Text
    });
});

describe('createCommandStack – Fehlerrobustheit', () => {
    it('wirft undo, bleibt der Befehl auf dem Undo-Stapel und landet nicht im Redo-Stapel', () => {
        const stack = createCommandStack();
        let fail = true;
        const cmd = {
            label: 'heikel',
            do: () => {},
            undo: () => { if (fail) throw new Error('undo kaputt'); },
        };
        stack.execute(cmd);
        expect(() => stack.undo()).toThrow('undo kaputt');
        expect(stack.getUndoCount()).toBe(1);
        expect(stack.getRedoCount()).toBe(0);

        fail = false; // zweiter Versuch gelingt
        stack.undo();
        expect(stack.getUndoCount()).toBe(0);
        expect(stack.getRedoCount()).toBe(1);
    });

    it('wirft redo, bleibt der Befehl auf dem Redo-Stapel', () => {
        const stack = createCommandStack();
        let calls = 0;
        const cmd = {
            label: 'heikel',
            do: () => { calls++; if (calls === 2) throw new Error('redo kaputt'); },
            undo: () => {},
        };
        stack.execute(cmd);   // calls = 1
        stack.undo();
        expect(() => stack.redo()).toThrow('redo kaputt'); // calls = 2
        expect(stack.getRedoCount()).toBe(1);
        expect(stack.getUndoCount()).toBe(0);
        stack.redo();         // calls = 3 → gelingt
        expect(stack.getUndoCount()).toBe(1);
        expect(stack.getRedoCount()).toBe(0);
    });

    it('wirft do bei execute, wird nichts aufgezeichnet und die Redo-Kette bleibt erhalten', () => {
        const { state, add } = makeModel();
        const stack = createCommandStack();
        stack.execute(add(4));
        stack.undo(); // Redo: [+4]
        expect(() => stack.execute({ label: 'fail', do: () => { throw new Error('x'); }, undo: () => {} })).toThrow('x');
        expect(stack.getUndoCount()).toBe(0);
        expect(stack.canRedo()).toBe(true);
        stack.redo();
        expect(state.value).toBe(4);
    });
});

describe('createCommandStack – Abonnenten', () => {
    it('benachrichtigt bei execute, undo, redo und clear; nicht bei undo/redo auf leerem Stapel', () => {
        const { add } = makeModel();
        const stack = createCommandStack();
        const listener = vi.fn();
        stack.subscribe(listener);

        stack.undo(); stack.redo();           // leer → keine Benachrichtigung
        expect(listener).toHaveBeenCalledTimes(0);
        stack.execute(add(1));                // 1
        stack.undo();                         // 2
        stack.redo();                         // 3
        stack.clear();                        // 4
        expect(listener).toHaveBeenCalledTimes(4);
    });

    it('benachrichtigt auch, wenn undo fehlschlägt (Oberfläche bleibt konsistent)', () => {
        const stack = createCommandStack();
        const listener = vi.fn();
        stack.execute({ label: 'x', do: () => {}, undo: () => { throw new Error('nein'); } });
        stack.subscribe(listener);
        expect(() => stack.undo()).toThrow('nein');
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('Abmelden beendet die Benachrichtigungen nur für diesen Abonnenten', () => {
        const { add } = makeModel();
        const stack = createCommandStack();
        const a = vi.fn();
        const b = vi.fn();
        const unsubA = stack.subscribe(a);
        stack.subscribe(b);
        stack.execute(add(1));
        unsubA();
        stack.execute(add(1));
        expect(a).toHaveBeenCalledTimes(1);
        expect(b).toHaveBeenCalledTimes(2);
    });
});

describe('createCommandStack – Snapshot-Muster des Editors (pushHistory)', () => {
    // Der Editor führt die Änderung selbst aus und übergibt einen Befehl, dessen
    // erster do()-Aufruf übersprungen wird (firstRun). undo/redo spielen dann
    // Vorher-/Nachher-Snapshots ein.
    it('erster do()-Aufruf wird übersprungen, undo/redo spielen die Snapshots korrekt ein', () => {
        const stack = createCommandStack();
        const doc = { json: '{"walls":0}' };
        const history = (before, after) => {
            let firstRun = true;
            stack.execute({
                label: 'Wand',
                do: () => { if (firstRun) { firstRun = false; return; } doc.json = after; },
                undo: () => { doc.json = before; },
            });
        };
        // Änderung 1: 0 → 1 Wand (bereits ausgeführt)
        doc.json = '{"walls":1}';
        history('{"walls":0}', '{"walls":1}');
        // Änderung 2: 1 → 2 Wände
        doc.json = '{"walls":2}';
        history('{"walls":1}', '{"walls":2}');

        expect(doc.json).toBe('{"walls":2}'); // execute hat nichts überschrieben
        stack.undo();
        expect(doc.json).toBe('{"walls":1}');
        stack.undo();
        expect(doc.json).toBe('{"walls":0}');
        stack.redo();
        expect(doc.json).toBe('{"walls":1}');
        stack.redo();
        expect(doc.json).toBe('{"walls":2}');
    });
});
