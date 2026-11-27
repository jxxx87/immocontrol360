// ─── Command Stack (Undo/Redo) ──────────────────────────────────────
// Generic command-pattern undo/redo system for the floor plan editor.

// Maximale Anzahl Undo-Schritte. Der Editor legt pro Befehl eine Tiefkopie des
// Geschosses ab (ggf. inkl. Hintergrundbild) – ohne Obergrenze wächst der
// Speicher in langen Sitzungen unbegrenzt. Die ältesten Schritte werden verworfen.
export const MAX_UNDO_STEPS = 100;

/**
 * Create a new command stack instance.
 * @param {{ maxSteps?: number }} [options]
 * @returns {{ execute, undo, redo, canUndo, canRedo, clear }}
 */
export const createCommandStack = (options = {}) => {
    const maxSteps = Math.max(1, Number(options.maxSteps) || MAX_UNDO_STEPS);
    let undoStack = [];
    let redoStack = [];
    let listeners = [];

    const notify = () => listeners.forEach(fn => fn());
    const trim = (stack) => {
        if (stack.length > maxSteps) stack.splice(0, stack.length - maxSteps);
    };

    return {
        /**
         * Execute a command and push to undo stack.
         * Command shape: { do: fn, undo: fn, label: string }
         */
        execute(command) {
            command.do();
            undoStack.push(command);
            trim(undoStack);
            redoStack = []; // clear redo on new action
            notify();
        },

        undo() {
            if (undoStack.length === 0) return;
            const cmd = undoStack.pop();
            try {
                cmd.undo();
                redoStack.push(cmd);
                trim(redoStack);
            } catch (err) {
                // Befehl nicht verlieren: zurück auf den Undo-Stapel
                undoStack.push(cmd);
                throw err;
            } finally {
                notify();
            }
        },

        redo() {
            if (redoStack.length === 0) return;
            const cmd = redoStack.pop();
            try {
                cmd.do();
                undoStack.push(cmd);
                trim(undoStack);
            } catch (err) {
                redoStack.push(cmd);
                throw err;
            } finally {
                notify();
            }
        },

        canUndo() { return undoStack.length > 0; },
        canRedo() { return redoStack.length > 0; },

        clear() {
            undoStack = [];
            redoStack = [];
            notify();
        },

        /** Subscribe to stack changes */
        subscribe(fn) {
            listeners.push(fn);
            return () => { listeners = listeners.filter(l => l !== fn); };
        },

        getUndoCount() { return undoStack.length; },
        getRedoCount() { return redoStack.length; },
    };
};
