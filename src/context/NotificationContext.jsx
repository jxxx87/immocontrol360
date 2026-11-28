import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { registerPushNotifications, setupPushListeners, unregisterPushNotifications } from '../lib/pushNotifications';

const NotificationContext = createContext();

export const useNotifications = () => useContext(NotificationContext);

// Debug-Ausgaben nur im Entwicklungsmodus (keine Inhalte im Geräte-Log der Produktion)
const debugLog = (...args) => { if (import.meta.env.DEV) console.log(...args); };

// Push-Typen, die im Vordergrund bereits über die Realtime-Kanäle gemeldet werden
const REALTIME_COVERED_TYPES = new Set(['message', 'ticket_comment', 'ticket', 'announcement', 'document', 'registration']);

// Ab dieser Anzahl werden Fristen-Treffer zu einer Sammelmeldung gebündelt
const BUNDLE_THRESHOLD = 3;

// Nur App-interne Routen aus Push-Daten übernehmen
const isInternalRoute = (route) => typeof route === 'string' && route.startsWith('/') && !route.startsWith('//');

// ── CAPACITOR PUSH PLUGIN ────────────────────────────────────
import { PushNotifications as CapPush } from '@capacitor/push-notifications';

// Detect if running inside Capacitor native app
const IS_NATIVE = (() => {
    try {
        return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    } catch {
        return false;
    }
})();

const loadPushPlugin = async () => (IS_NATIVE ? CapPush : null);

// ── SYSTEM NOTIFICATION (Browser / OS-level) ────────────────────
// Chrome auf Android erlaubt new Notification() nicht (TypeError) – dann über einen
// ggf. vorhandenen Service Worker anzeigen, sonst still überspringen.
const showSystemNotification = (title, body, onClick) => {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    const options = {
        body,
        icon: '/logo.png',
        badge: '/logo.png',
        tag: Date.now().toString(),
        renotify: true,
    };
    try {
        const n = new Notification(title, options);
        if (onClick) n.onclick = onClick;
    } catch {
        try {
            navigator.serviceWorker?.getRegistration?.()
                .then(reg => reg?.showNotification?.(title, options))
                .catch(() => {});
        } catch {
            // Systembenachrichtigung nicht möglich – In-App-Meldung genügt
        }
    }
};

const toDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const storageGet = (key) => {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
};

const storageSet = (key, value) => {
    try {
        localStorage.setItem(key, value);
    } catch {
        // localStorage nicht verfügbar
    }
};

export const NotificationProvider = ({ children }) => {
    const { user, userRole, roleData } = useAuth();
    // Einheit eines Mieter-Kontos (Kalender-Erinnerungen nur für die eigene Einheit bzw. das ganze Haus)
    const tenantUnitId = roleData?.unit_id || null;
    const navigate = useNavigate();
    const navigateRef = useRef(navigate);
    const [notifications, setNotifications] = useState([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [toasts, setToasts] = useState([]);
    const [permissionGranted, setPermissionGranted] = useState(false);
    const channelsRef = useRef([]);
    const lastUserIdRef = useRef(null);

    useEffect(() => {
        navigateRef.current = navigate;
    }, [navigate]);

    // ── REQUEST PERMISSION ──────────────────────────────────────
    const requestPermission = useCallback(async () => {
        // ── BROWSER (Desktop / Mobile Chrome) ──
        if ('Notification' in window) {
            if (Notification.permission === 'granted') {
                setPermissionGranted(true);
                return true;
            }
            if (Notification.permission === 'denied') {
                setPermissionGranted(false);
                return false;
            }
            try {
                const result = await Notification.requestPermission();
                const granted = result === 'granted';
                setPermissionGranted(granted);
                return granted;
            } catch (err) {
                console.warn('Browser notification permission error:', err);
            }
        }

        // ── NATIVE APP (Capacitor) ──
        if (IS_NATIVE) {
            try {
                const plugin = await loadPushPlugin();
                if (plugin) {
                    let status = await plugin.checkPermissions();
                    if (status.receive === 'granted') {
                        setPermissionGranted(true);
                        return true;
                    }
                    status = await plugin.requestPermissions();
                    const granted = status.receive === 'granted';
                    setPermissionGranted(granted);
                    return granted;
                }
            } catch (err) {
                console.warn('Capacitor push permission error:', err);
            }
        }

        // No notification API available — hide the banner
        setPermissionGranted(true);
        return true;
    }, []);

    // ── ADD NOTIFICATION ────────────────────────────────────────
    const addNotification = useCallback((notification) => {
        const entry = {
            id: Date.now() + Math.random(),
            timestamp: new Date(),
            read: false,
            ...notification,
        };

        setNotifications(prev => [entry, ...prev].slice(0, 100)); // max 100
        setUnreadCount(prev => prev + 1);

        // Show toast
        setToasts(prev => [...prev, { ...entry, toastId: Date.now() + Math.random() }]);

        // Show system notification
        showSystemNotification(entry.title, entry.body);

        return entry;
    }, []);

    // Mehrere gleichartige Treffer bündeln (statt einer Meldungsflut)
    const notifyBundled = useCallback((items, toSingle, toSummary) => {
        if (!items || items.length === 0) return;
        if (items.length <= BUNDLE_THRESHOLD) {
            items.forEach(item => addNotification(toSingle(item)));
        } else {
            addNotification(toSummary(items));
        }
    }, [addNotification]);

    // ── REMOVE TOAST ────────────────────────────────────────────
    const removeToast = useCallback((toastId) => {
        setToasts(prev => prev.filter(t => t.toastId !== toastId));
    }, []);

    // Auto-remove toasts after 5s
    useEffect(() => {
        if (toasts.length === 0) return;
        const timer = setTimeout(() => {
            setToasts(prev => prev.slice(1));
        }, 5000);
        return () => clearTimeout(timer);
    }, [toasts]);

    // ── MARK AS READ / REMOVE ─────────────────────────────────
    const markAllRead = useCallback(() => {
        setNotifications([]);
        setUnreadCount(0);
    }, []);

    const markRead = useCallback((id) => {
        setNotifications(prev => prev.filter(n => n.id !== id));
        setUnreadCount(prev => Math.max(0, prev - 1));
    }, []);

    const clearByType = useCallback((type) => {
        setNotifications(prev => {
            const remaining = prev.filter(n => n.type !== type);
            setUnreadCount(remaining.length);
            return remaining;
        });
    }, []);

    // ── ABMELDUNG: Push-Token dieses Geräts entfernen ───────────
    // Nach dem Logout darf das Gerät keine Pushes des abgemeldeten Kontos mehr erhalten.
    useEffect(() => {
        const previousUserId = lastUserIdRef.current;
        lastUserIdRef.current = user?.id || null;
        if (previousUserId && !user) {
            unregisterPushNotifications(previousUserId).catch(() => {});
        }
    }, [user]);

    // ── SUBSCRIBE TO REALTIME EVENTS ────────────────────────────
    useEffect(() => {
        if (!user) return;

        // Check permission status on mount
        const checkPermissionStatus = async () => {
            // Browser
            if ('Notification' in window) {
                setPermissionGranted(Notification.permission === 'granted');
                return;
            }
            // Native (Capacitor)
            if (IS_NATIVE) {
                try {
                    const plugin = await loadPushPlugin();
                    if (plugin) {
                        const status = await plugin.checkPermissions();
                        setPermissionGranted(status.receive === 'granted');
                        return;
                    }
                } catch {
                    // Plugin not available
                }
            }
            // No API — hide banner
            setPermissionGranted(true);
        };
        checkPermissionStatus();

        // ── REALTIME CHANNELS ─────────────────────────────────────
        // Use aborted flag + delay to survive React StrictMode double-mount.
        // StrictMode mounts → unmounts → remounts. Without delay, the first
        // unmount kills the WebSocket before the second mount can subscribe.
        let aborted = false;
        let channels = [];
        const isTenant = userRole === 'tenant';

        const setupChannels = () => {
            if (aborted) {
                debugLog('[Notifications] Setup aborted (StrictMode cleanup)');
                return;
            }

            debugLog('[Notifications] Setting up realtime channels, role:', userRole);

            // 1️⃣ NEW MESSAGES
            const msgChannel = supabase
                .channel('notif-messages-' + Date.now())
                .on('postgres_changes', {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'messages',
                    filter: `receiver_id=eq.${user.id}`
                }, (payload) => {
                    const msg = payload.new;
                    if (msg.sender_id === user.id) return;
                    // Skip ticket messages — handled by notif-ticket-msgs channel
                    if (msg.ticket_id) return;
                    addNotification({
                        type: 'message',
                        title: '💬 Neue Nachricht',
                        body: msg.text?.substring(0, 100) || 'Sie haben eine neue Nachricht erhalten.',
                        route: isTenant ? '/tenant/messages' : '/investor-messages',
                        data: msg,
                    });
                })
                .subscribe((status, err) => {
                    debugLog('[Notifications] messages channel:', status, err?.message || '');
                });
            channels.push(msgChannel);

            // 2️⃣ NEW TICKETS
            const ticketChannel = supabase
                .channel('notif-tickets-' + Date.now())
                .on('postgres_changes', {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'tickets',
                }, (payload) => {
                    const ticket = payload.new;
                    if (!isTenant) {
                        addNotification({
                            type: 'ticket',
                            title: '🎫 Neues Ticket',
                            body: `"${ticket.title}" wurde erstellt.`,
                            route: '/ticket-board',
                            data: ticket,
                        });
                    }
                })
                .subscribe((status, err) => {
                    debugLog('[Notifications] tickets channel:', status, err?.message || '');
                });
            channels.push(ticketChannel);

            // 3️⃣ TICKET COMMENTS (any message with ticket_id)
            const ticketMsgChannel = supabase
                .channel('notif-ticket-msgs-' + Date.now())
                .on('postgres_changes', {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'messages',
                }, (payload) => {
                    const msg = payload.new;
                    // Only notify if this message is for me and I didn't send it
                    if (msg.sender_id === user.id) return;
                    if (msg.receiver_id !== user.id) return;
                    // Only ticket-related messages
                    if (!msg.ticket_id) return;
                    addNotification({
                        type: 'ticket_comment',
                        title: '💬 Neuer Ticket-Kommentar',
                        body: msg.text?.substring(0, 100) || 'Neuer Kommentar zu einem Ticket.',
                        route: isTenant ? '/tenant/tickets' : '/ticket-board',
                        data: msg,
                    });
                })
                .subscribe((status, err) => {
                    debugLog('[Notifications] ticket-msgs channel:', status, err?.message || '');
                });
            channels.push(ticketMsgChannel);

            // 4️⃣ NEW ANNOUNCEMENTS
            const announcementChannel = supabase
                .channel('notif-announcements-' + Date.now())
                .on('postgres_changes', {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'announcements',
                }, (payload) => {
                    const ann = payload.new;
                    // Eigene Aushänge nicht als "neu" melden
                    if (ann.created_by && ann.created_by === user.id) return;
                    addNotification({
                        type: 'announcement',
                        title: '📢 Neuer Aushang',
                        body: ann.title || 'Ein neuer Aushang wurde erstellt.',
                        route: isTenant ? '/tenant/announcements' : '/announcements',
                        data: ann,
                    });
                })
                .subscribe((status, err) => {
                    debugLog('[Notifications] announcements channel:', status, err?.message || '');
                });
            channels.push(announcementChannel);

            // 5️⃣ NEW DOCUMENTS (only for tenants — investor uploads them)
            if (isTenant) {
                const docChannel = supabase
                    .channel('notif-documents-' + Date.now())
                    .on('postgres_changes', {
                        event: 'INSERT',
                        schema: 'public',
                        table: 'documents',
                    }, (payload) => {
                        const doc = payload.new;
                        addNotification({
                            type: 'document',
                            title: '📄 Neues Dokument',
                            body: doc.name || 'Ein neues Dokument wurde hochgeladen.',
                            route: '/tenant/documents',
                            data: doc,
                        });
                    })
                    .subscribe((status, err) => {
                        debugLog('[Notifications] documents channel:', status, err?.message || '');
                    });
                channels.push(docChannel);
            }

            // 6️⃣ TENANT REGISTRATION (for investors)
            if (!isTenant) {
                const regChannel = supabase
                    .channel('notif-registrations-' + Date.now())
                    .on('postgres_changes', {
                        event: 'INSERT',
                        schema: 'public',
                        table: 'user_roles',
                        filter: 'role=eq.tenant'
                    }, (payload) => {
                        addNotification({
                            type: 'registration',
                            title: '✅ Mieter registriert',
                            body: 'Ein Mieter hat sich erfolgreich im Portal registriert.',
                            route: '/tenant-management',
                            data: payload.new,
                        });
                    })
                    .subscribe((status, err) => {
                        debugLog('[Notifications] registrations channel:', status, err?.message || '');
                    });
                channels.push(regChannel);
            }

            channelsRef.current = channels;

            // ── 🔔 RENOVATION DEADLINE CHECK (once per day, if enabled) ──────
            const localToday = new Date();
            const todayStr = toDateStr(localToday);
            const sessionKey = `renovation_deadline_check_${user.id}_${todayStr}`;
            const pushEnabled = storageGet('pushNotificationsEnabled') !== 'false';

            // Clean up old renovation check keys
            try {
                Object.keys(localStorage).forEach(k => {
                    if (k.startsWith(`renovation_deadline_check_${user.id}_`) && k !== sessionKey) {
                        localStorage.removeItem(k);
                    }
                });
            } catch { /* ignore */ }

            // Sanierungsfristen betreffen nur Vermieter (Mieter haben keine Projekte)
            if (pushEnabled && !isTenant && !storageGet(sessionKey)) {
                (async () => {
                    try {
                        debugLog('[Notifications] Checking renovation deadlines for', todayStr);

                        // 1. Tasks with due_date <= today, not completed
                        // Ohne user_id-Filter: neue Aufgaben gehören dem Portfolio-Eigentümer, nicht dem
                        // anlegenden Mitnutzer – gezählt wird wie im Sanierungsmanager alles Sichtbare (RLS)
                        const { data: dueTasks, error: taskErr } = await supabase
                            .from('renovation_tasks')
                            .select('id, title, due_date, project:renovation_projects(name)')
                            .eq('is_completed', false)
                            .lte('due_date', todayStr);

                        if (taskErr) console.warn('[Notifications] Task query error:', taskErr.message);

                        notifyBundled(
                            dueTasks || [],
                            (t) => {
                                const isOverdue = t.due_date < todayStr;
                                return {
                                    type: 'renovation_task_due',
                                    title: isOverdue ? '🔴 Aufgabe überfällig' : '⚠️ Aufgabe fällig',
                                    body: `„${t.title}"${t.project?.name ? ` (${t.project.name})` : ''} ${isOverdue ? 'war am ' + new Date(t.due_date).toLocaleDateString('de-DE') + ' fällig' : 'ist heute fällig'} und noch nicht abgeschlossen.`,
                                    route: '/renovation?tab=tasks',
                                };
                            },
                            (list) => ({
                                type: 'renovation_task_due',
                                title: `⚠️ ${list.length} Sanierungsaufgaben fällig`,
                                body: `${list.slice(0, BUNDLE_THRESHOLD).map(t => `„${t.title}"`).join(', ')} und weitere sind fällig oder überfällig.`,
                                route: '/renovation?tab=tasks',
                            }),
                        );

                        // 2. Projects with target_end_date <= today, not completed
                        const { data: dueProjects, error: projErr } = await supabase
                            .from('renovation_projects')
                            .select('id, name, target_end_date')
                            .neq('status', 'completed')
                            .lte('target_end_date', todayStr);

                        if (projErr) console.warn('[Notifications] Project query error:', projErr.message);

                        notifyBundled(
                            dueProjects || [],
                            (p) => {
                                const isOverdue = p.target_end_date < todayStr;
                                return {
                                    type: 'renovation_project_due',
                                    title: isOverdue ? '🔴 Projekt überfällig' : '⚠️ Projekt-Zieldatum erreicht',
                                    body: `Das Sanierungsprojekt „${p.name}" ${isOverdue ? 'war am ' + new Date(p.target_end_date).toLocaleDateString('de-DE') + ' fällig' : 'hat heute sein Ziel-Enddatum erreicht'} und ist noch nicht abgeschlossen.`,
                                    route: '/renovation',
                                };
                            },
                            (list) => ({
                                type: 'renovation_project_due',
                                title: `⚠️ ${list.length} Sanierungsprojekte über dem Zieldatum`,
                                body: `${list.slice(0, BUNDLE_THRESHOLD).map(p => `„${p.name}"`).join(', ')} und weitere sind noch nicht abgeschlossen.`,
                                route: '/renovation',
                            }),
                        );

                        storageSet(sessionKey, '1');
                    } catch (e) {
                        console.warn('[Notifications] Renovation deadline check failed:', e?.message || e);
                    }
                })();
            }

            // ── 🗓️ OBJEKTKALENDER DAILY CHECK ──────────────────────
            const okSessionKey = `ok_daily_check_${user.id}_${todayStr}`;
            // Der Objektkalender ist auch für Mieter freigegeben (Route allowTenant, Mieter-Menü)
            const okRoute = '/object-calendar';
            // Clean up old daily check keys from previous days
            try {
                Object.keys(localStorage).forEach(k => {
                    if (k.startsWith(`ok_daily_check_${user.id}_`) && k !== okSessionKey) {
                        localStorage.removeItem(k);
                    }
                });
            } catch { /* ignore */ }

            if (pushEnabled && !storageGet(okSessionKey)) {
                (async () => {
                    try {
                        debugLog('[Notifications] Checking Objektkalender tasks for', todayStr);
                        // Mieter: nur Termine der eigenen Einheit und solche ohne Einheit (ganzes Haus) –
                        // die RLS gibt Mietern alle Termine ihres Objekts frei (z. B. Reinigung anderer Einheiten)
                        const forTenantUnit = (q) => {
                            if (!isTenant) return q;
                            return tenantUnitId
                                ? q.or(`assigned_unit_id.is.null,assigned_unit_id.eq.${tenantUnitId}`)
                                : q.is('assigned_unit_id', null);
                        };
                        // Events due today
                        const { data: todayEvents, error: todayErr } = await forTenantUnit(supabase
                            .from('objektkalender_events')
                            .select('id, title, event_date, event_type, assigned_unit_name, push_enabled')
                            .eq('status', 'pending')
                            .eq('event_date', todayStr)
                            .eq('push_enabled', true));
                        if (todayErr) console.warn('[Notifications] Objektkalender query error:', todayErr.message);

                        notifyBundled(
                            todayEvents || [],
                            (ev) => {
                                const icon = ev.event_type === 'cleaning' ? '🧹' : ev.event_type === 'waste' ? '🗑️' : '📋';
                                return {
                                    type: 'ok_event_due',
                                    title: `${icon} ${ev.title} – heute fällig`,
                                    body: ev.assigned_unit_name ? `Zuständig: ${ev.assigned_unit_name}` : 'Heute zu erledigen.',
                                    route: okRoute,
                                };
                            },
                            (list) => ({
                                type: 'ok_event_due',
                                title: `📋 ${list.length} Objektkalender-Aufgaben heute fällig`,
                                body: `${list.slice(0, BUNDLE_THRESHOLD).map(ev => ev.title).join(', ')} und weitere.`,
                                route: okRoute,
                            }),
                        );

                        // Überfällige Termine – Regel wie im Kalender (isOverdue in ObjectCalendar.jsx): überfällig
                        // ab dem zweiten Tag nach dem Termin; nur zwei Tage zurück, um eine Meldungsflut zu vermeiden.
                        // Der Schalter „Push-Erinnerung“ gilt auch hier.
                        const threeDaysAgo = new Date(localToday);
                        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
                        const twoDaysAgo = new Date(localToday);
                        twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
                        const { data: overdueEvents, error: overdueErr } = await forTenantUnit(supabase
                            .from('objektkalender_events')
                            .select('id, title, event_date, event_type, assigned_unit_name')
                            .eq('status', 'pending')
                            .eq('push_enabled', true)
                            .gte('event_date', toDateStr(threeDaysAgo))
                            .lte('event_date', toDateStr(twoDaysAgo)));
                        if (overdueErr) console.warn('[Notifications] Objektkalender query error:', overdueErr.message);

                        notifyBundled(
                            overdueEvents || [],
                            (ev) => ({
                                type: 'ok_event_overdue',
                                title: `🔴 ${ev.title} – überfällig`,
                                body: `War am ${new Date(ev.event_date).toLocaleDateString('de-DE')} fällig.${ev.assigned_unit_name ? ` Zuständig: ${ev.assigned_unit_name}` : ''}`,
                                route: okRoute,
                            }),
                            (list) => ({
                                type: 'ok_event_overdue',
                                title: `🔴 ${list.length} Objektkalender-Aufgaben überfällig`,
                                body: `${list.slice(0, BUNDLE_THRESHOLD).map(ev => ev.title).join(', ')} und weitere sind noch offen.`,
                                route: okRoute,
                            }),
                        );

                        storageSet(okSessionKey, '1');
                    } catch (e) {
                        console.warn('[Notifications] Objektkalender check failed:', e?.message || e);
                    }
                })();
            }

            if (!pushEnabled) {
                debugLog('[Notifications] Push notifications disabled by user setting.');
            }
        };

        // Delay setup to survive React StrictMode double-mount cleanup
        const timer = setTimeout(setupChannels, 150);

        // Handle push received in foreground / tapped (Listener vor der Registrierung setzen)
        const removePushListeners = setupPushListeners((notification) => {
            const route = isInternalRoute(notification.data?.route) ? notification.data.route : undefined;
            if (notification.tapped) {
                // Antippen einer Benachrichtigung: direkt zur passenden Seite
                if (route) navigateRef.current?.(route);
                return;
            }
            if (notification.foreground) {
                const type = notification.data?.type || 'message';
                // Diese Ereignisse meldet bereits der Realtime-Kanal – keine Doppelmeldung
                if (REALTIME_COVERED_TYPES.has(type)) return;
                addNotification({
                    type,
                    title: notification.title || 'Neue Benachrichtigung',
                    body: notification.body || '',
                    route,
                });
            }
        });

        // ── REGISTER FCM PUSH (Capacitor) ───────────────────────
        registerPushNotifications(user.id).then(result => {
            if (result && result.success) {
                debugLog('FCM registered');
                setPermissionGranted(true);
            } else if (result && result.step !== 'plugin') {
                console.warn('FCM registration failed:', result.step, result.error);
            }
        }).catch(err => {
            console.error('FCM registration error:', err?.message || err);
        });

        return () => {
            aborted = true;
            clearTimeout(timer);
            removePushListeners();
            channels.forEach(ch => supabase.removeChannel(ch));
        };
    }, [user, userRole, tenantUnitId, addNotification, notifyBundled]);

    const value = {
        notifications,
        unreadCount,
        toasts,
        permissionGranted,
        addNotification,
        removeToast,
        markAllRead,
        markRead,
        clearByType,
        requestPermission,
    };

    return (
        <NotificationContext.Provider value={value}>
            {children}
        </NotificationContext.Provider>
    );
};

export default NotificationContext;
