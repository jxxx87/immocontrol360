import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { useViewMode } from '../../context/ViewModeContext';

// Geöffnete Modals als Stapel: ESC und Tab-Falle wirken nur auf das oberste.
const openModalStack = [];

// Hintergrund-Scrollsperre (gezählt, damit verschachtelte Modals sich nicht gegenseitig aufheben)
let scrollLockCount = 0;
let savedBodyStyle = null;

const lockBodyScroll = () => {
    if (scrollLockCount === 0) {
        const { body, documentElement } = document;
        savedBodyStyle = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
        // Breite der wegfallenden Scrollleiste ausgleichen, damit der Inhalt nicht springt
        const scrollbarWidth = window.innerWidth - documentElement.clientWidth;
        if (scrollbarWidth > 0) {
            const currentPadding = parseFloat(window.getComputedStyle(body).paddingRight) || 0;
            body.style.paddingRight = `${currentPadding + scrollbarWidth}px`;
        }
        body.style.overflow = 'hidden';
    }
    scrollLockCount += 1;
};

const unlockBodyScroll = () => {
    scrollLockCount = Math.max(0, scrollLockCount - 1);
    if (scrollLockCount === 0 && savedBodyStyle) {
        document.body.style.overflow = savedBodyStyle.overflow;
        document.body.style.paddingRight = savedBodyStyle.paddingRight;
        savedBodyStyle = null;
    }
};

const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable="true"]'
].join(',');

const getFocusableElements = (container) =>
    Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR))
        .filter(el => el.getClientRects().length > 0 && el.getAttribute('aria-hidden') !== 'true');

const Modal = ({ isOpen, onClose, title, children, footer, maxWidth = '500px' }) => {
    // Gleiche Mobil-Erkennung wie Card/Layout (reagiert auf Größenänderung und native App)
    const viewMode = useViewMode();
    const isMobileView = viewMode
        ? viewMode.isMobile
        : (typeof window !== 'undefined' && window.innerWidth < 768);

    const dialogRef = useRef(null);
    const stackTokenRef = useRef(null);
    const onCloseRef = useRef(onClose);
    const titleId = useId();

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        if (!isOpen) return undefined;

        const token = {};
        stackTokenRef.current = token;
        openModalStack.push(token);
        lockBodyScroll();

        // Fokus ins Modal holen, außer ein Feld darin hat ihn schon (autoFocus)
        const dialogEl = dialogRef.current;
        const previouslyFocused = dialogEl && dialogEl.contains(document.activeElement) ? null : document.activeElement;
        if (dialogEl && !dialogEl.contains(document.activeElement)) {
            dialogEl.focus({ preventScroll: true });
        }

        const handleKeyDown = (e) => {
            if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
            if (openModalStack[openModalStack.length - 1] !== token) return;
            if (typeof onCloseRef.current === 'function') onCloseRef.current();
        };
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            const index = openModalStack.indexOf(token);
            if (index !== -1) openModalStack.splice(index, 1);
            if (stackTokenRef.current === token) stackTokenRef.current = null;
            unlockBodyScroll();
            // Fokus an das auslösende Element zurückgeben
            if (previouslyFocused && previouslyFocused !== document.body
                && typeof previouslyFocused.focus === 'function' && document.contains(previouslyFocused)) {
                previouslyFocused.focus({ preventScroll: true });
            }
        };
    }, [isOpen]);

    // Tab-Taste bleibt innerhalb des Dialogs (nur wenn der Fokus im Dialog selbst liegt)
    const handleDialogKeyDown = (e) => {
        if (e.key !== 'Tab' || e.defaultPrevented) return;
        const dialogEl = dialogRef.current;
        if (!dialogEl || openModalStack[openModalStack.length - 1] !== stackTokenRef.current) return;
        const active = document.activeElement;
        if (!dialogEl.contains(active)) return; // z.B. Fokus in einem Dropdown-Portal
        const focusable = getFocusableElements(dialogEl);
        if (focusable.length === 0) {
            e.preventDefault();
            dialogEl.focus({ preventScroll: true });
            return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && (active === first || active === dialogEl)) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && active === last) {
            e.preventDefault();
            first.focus();
        }
    };

    if (!isOpen) return null;

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: isMobileView ? 'var(--surface-color-solid, #ffffff)' : 'rgba(15, 23, 42, 0.75)',
            display: 'flex',
            alignItems: isMobileView ? 'stretch' : 'center',
            justifyContent: 'center',
            zIndex: 110,
            backdropFilter: isMobileView ? 'none' : 'blur(4px)'
        }}>
            <div
                ref={dialogRef}
                className="ui-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby={title ? titleId : undefined}
                tabIndex={-1}
                onKeyDown={handleDialogKeyDown}
                style={{
                    backgroundColor: 'var(--surface-color-solid, #ffffff)',
                    borderRadius: isMobileView ? 0 : 'var(--radius-lg)',
                    width: '100%',
                    maxWidth: isMobileView ? '100%' : maxWidth,
                    height: isMobileView ? '100%' : 'auto',
                    maxHeight: isMobileView ? '100%' : '90vh',
                    display: 'flex',
                    flexDirection: 'column',
                    boxShadow: isMobileView ? 'none' : 'var(--shadow-lg)',
                    margin: isMobileView ? 0 : 'var(--spacing-md)',
                    paddingTop: isMobileView ? 'env(safe-area-inset-top)' : 0,
                    paddingBottom: isMobileView ? 'calc(60px + env(safe-area-inset-bottom))' : 0,
                    outline: 'none'
                }}
            >
                {/* Header */}
                <div style={{
                    padding: isMobileView ? '14px 16px' : 'var(--spacing-lg)',
                    borderBottom: '1px solid var(--border-color)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexShrink: 0
                }}>
                    <h3 id={titleId} style={{ fontSize: isMobileView ? '1.05rem' : '1.25rem', fontWeight: 600 }}>{title}</h3>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Schließen"
                        title="Schließen"
                        style={{
                            color: 'var(--text-secondary)',
                            padding: '8px',
                            borderRadius: 'var(--radius-md)',
                            cursor: 'pointer',
                            display: 'flex',
                            minHeight: '44px',
                            minWidth: '44px',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}
                    >
                        <X size={22} aria-hidden="true" />
                    </button>
                </div>

                {/* Content */}
                <div style={{
                    padding: isMobileView ? '14px 16px' : 'var(--spacing-lg)',
                    overflowY: 'auto',
                    flex: 1,
                    WebkitOverflowScrolling: 'touch',
                    minHeight: 0
                }}>
                    {children}
                </div>

                {/* Footer */}
                {footer && (
                    <div style={{
                        padding: isMobileView ? '12px 16px' : 'var(--spacing-lg)',
                        paddingBottom: isMobileView ? 'calc(12px + env(safe-area-inset-bottom))' : 'var(--spacing-lg)',
                        borderTop: '1px solid var(--border-color)',
                        display: 'flex',
                        justifyContent: 'flex-end',
                        gap: 'var(--spacing-md)',
                        backgroundColor: 'var(--background-color)',
                        borderBottomLeftRadius: isMobileView ? 0 : 'var(--radius-lg)',
                        borderBottomRightRadius: isMobileView ? 0 : 'var(--radius-lg)',
                        flexShrink: 0,
                        flexWrap: 'wrap'
                    }}>
                        {footer}
                    </div>
                )}
            </div>
        </div>
    );
};

export default Modal;
