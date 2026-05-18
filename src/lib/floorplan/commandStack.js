// ─── Command Stack (Undo/Redo) ──────────────────────────────────────
// Generic command-pattern undo/redo system for the floor plan editor.

/**
 * Create a new command stack instance.
 * @returns {{ execute, undo, redo, canUndo, canRedo, clear }}
 */
export const createCommandStack = () => {
    let undoStack = [];
    let redoStack = [];
    let listeners = [];

    const notify = () => listeners.forEach(fn => fn());

    return {
        /**
         * Execute a command and push to undo stack.
         * Command shape: { do: fn, undo: fn, label: string }
         */
        execute(command) {
            command.do();
            undoStack.push(command);
            redoStack = []; // clear redo on new action
            notify();
        },

        undo() {
            if (undoStack.length === 0) return;
            const cmd = undoStack.pop();
            cmd.undo();
            redoStack.push(cmd);
            notify();
        },

        redo() {
            if (redoStack.length === 0) return;
            const cmd = redoStack.pop();
            cmd.do();
            undoStack.push(cmd);
            notify();
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
