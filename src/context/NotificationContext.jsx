import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { registerPushNotifications, setupPushListeners, unregisterPushNotifications } from '../lib/pushNotifications';

const NotificationContext = createContext();

export const useNotifications = () => useContext(NotificationContext);

// ── CAPACITOR PUSH PLUGIN ────────────────────────────────────
import { PushNotifications as CapPush } from '@capacitor/push-notifications';
const loadPushPlugin = async () => {
    try {
        if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
            return CapPush;
        }
        return null;
    } catch {
        return null;
    }
};

// ── SYSTEM NOTIFICATION (Browser / OS-level) ────────────────────
const showSystemNotification = (title, body, onClick) => {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
        const n = new Notification(title, {
            body,
            icon: '/logo.png',
            badge: '/logo.png',
            tag: Date.now().toString(),
            renotify: true,
        });
        if (onClick) n.onclick = onClick;
    }
};

export const NotificationProvider = ({ children }) => {
    const { user, userRole } = useAuth();
    const [notifications, setNotifications] = useState([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [toasts, setToasts] = useState([]);
    const [permissionGranted, setPermissionGranted] = useState(false);
    const channelsRef = useRef([]);

    // ── HELPERS ───────────────────────────────────────────────────
    // Detect if running inside Capacitor native app
    const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

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
        if (isNative) {
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
    }, [isNative]);

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
            if (isNative) {
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

        const setupChannels = () => {
            if (aborted) {
                console.log('[Notifications] Setup aborted (StrictMode cleanup)');
                return;
            }

            console.log('[Notifications] Setting up realtime channels for user:', user.id, 'role:', userRole);

            // 1️⃣ NEW MESSAGES
            const msgChannel = supabase
                .channel('notif-messages-' + Date.now())
                .on('postgres_changes', {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'messages',
                    filter: `receiver_id=eq.${user.id}`
                }, (payload) => {
                    console.log('[Notifications] New message received:', payload);
                    const msg = payload.new;
                    if (msg.sender_id === user.id) return;
                    // Skip ticket messages — handled by notif-ticket-msgs channel
                    if (msg.ticket_id) return;
                    addNotification({
                        type: 'message',
                        title: '💬 Neue Nachricht',
                        body: msg.text?.substring(0, 100) || 'Sie haben eine neue Nachricht erhalten.',
                        route: userRole === 'tenant' ? '/tenant/messages' : '/investor-messages',
                        data: msg,
                    });
                })
                .subscribe((status, err) => {
                    console.log('[Notifications] messages channel:', status, err || '');
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
                    console.log('[Notifications] New ticket received:', payload);
                    const ticket = payload.new;
                    if (userRole !== 'tenant') {
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
                    console.log('[Notifications] tickets channel:', status, err || '');
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
                        route: userRole === 'tenant' ? '/tenant/tickets' : '/ticket-board',
                        data: msg,
                    });
                })
                .subscribe((status, err) => {
                    console.log('[Notifications] ticket-msgs channel:', status, err || '');
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
                    addNotification({
                        type: 'announcement',
                        title: '📢 Neuer Aushang',
                        body: ann.title || 'Ein neuer Aushang wurde erstellt.',
                        route: userRole === 'tenant' ? '/tenant/announcements' : '/announcements',
                        data: ann,
                    });
                })
                .subscribe((status, err) => {
                    console.log('[Notifications] announcements channel:', status, err || '');
                });
            channels.push(announcementChannel);

            // 5️⃣ NEW DOCUMENTS (only for tenants — investor uploads them)
            if (userRole === 'tenant') {
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
                        console.log('[Notifications] documents channel:', status, err || '');
                    });
                channels.push(docChannel);
            }

            // 6️⃣ TENANT REGISTRATION (for investors)
            if (userRole !== 'tenant') {
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
                        console.log('[Notifications] registrations channel:', status, err || '');
                    });
                channels.push(regChannel);
            }

            channelsRef.current = channels;

            // ── 🔔 RENOVATION DEADLINE CHECK (once per day, if enabled) ──────
            const localToday = new Date();
            const todayStr = `${localToday.getFullYear()}-${String(localToday.getMonth() + 1).padStart(2, '0')}-${String(localToday.getDate()).padStart(2, '0')}`;
            const sessionKey = `renovation_deadline_check_${user.id}_${todayStr}`;
            const pushEnabled = localStorage.getItem('pushNotificationsEnabled') !== 'false';

            // Clean up old renovation check keys
            try {
                Object.keys(localStorage).forEach(k => {
                    if (k.startsWith(`renovation_deadline_check_${user.id}_`) && k !== sessionKey) {
                        localStorage.removeItem(k);
                    }
                });
            } catch (e) { /* ignore */ }

            if (pushEnabled && !localStorage.getItem(sessionKey)) {
                (async () => {
                    try {
                        console.log('[Notifications] Checking renovation deadlines for', todayStr);

                        // 1. Tasks with due_date <= today, not completed
                        const { data: dueTasks, error: taskErr } = await supabase
                            .from('renovation_tasks')
                            .select('id, title, due_date, project:renovation_projects(name)')
                            .eq('user_id', user.id)
                            .eq('is_completed', false)
                            .lte('due_date', todayStr);

                        if (taskErr) console.warn('[Notifications] Task query error:', taskErr);
                        console.log('[Notifications] Due tasks found:', dueTasks?.length || 0);

                        (dueTasks || []).forEach(t => {
                            const isOverdue = t.due_date < todayStr;
                            addNotification({
                                type: 'renovation_task_due',
                                title: isOverdue ? '🔴 Aufgabe überfällig' : '⚠️ Aufgabe fällig',
                                body: `„${t.title}"${t.project?.name ? ` (${t.project.name})` : ''} ${isOverdue ? 'war am ' + new Date(t.due_date).toLocaleDateString('de-DE') + ' fällig' : 'ist heute fällig'} und noch nicht abgeschlossen.`,
                                route: '/renovation?tab=tasks',
                            });
                        });

                        // 2. Projects with target_end_date <= today, not completed
                        const { data: dueProjects, error: projErr } = await supabase
                            .from('renovation_projects')
                            .select('id, name, target_end_date')
                            .eq('user_id', user.id)
                            .neq('status', 'completed')
                            .lte('target_end_date', todayStr);

                        if (projErr) console.warn('[Notifications] Project query error:', projErr);
                        console.log('[Notifications] Due projects found:', dueProjects?.length || 0);

                        (dueProjects || []).forEach(p => {
                            const isOverdue = p.target_end_date < todayStr;
                            addNotification({
                                type: 'renovation_project_due',
                                title: isOverdue ? '🔴 Projekt überfällig' : '⚠️ Projekt-Zieldatum erreicht',
                                body: `Das Sanierungsprojekt „${p.name}" ${isOverdue ? 'war am ' + new Date(p.target_end_date).toLocaleDateString('de-DE') + ' fällig' : 'hat heute sein Ziel-Enddatum erreicht'} und ist noch nicht abgeschlossen.`,
                                route: '/renovation',
                            });
                        });

                        localStorage.setItem(sessionKey, '1');
                    } catch (e) {
                        console.warn('[Notifications] Renovation deadline check failed:', e);
                    }
                })();
            }

            // ── 🗓️ OBJEKTKALENDER DAILY CHECK ──────────────────────
            const okSessionKey = `ok_daily_check_${user.id}_${todayStr}`;
            // Clean up old daily check keys from previous days
            try {
                Object.keys(localStorage).forEach(k => {
                    if (k.startsWith(`ok_daily_check_${user.id}_`) && k !== okSessionKey) {
                        localStorage.removeItem(k);
                    }
                });
            } catch (e) { /* ignore */ }

            if (pushEnabled && !localStorage.getItem(okSessionKey)) {
                (async () => {
                    try {
                        console.log('[Notifications] Checking Objektkalender tasks for', todayStr);
                        // Events due today
                        const { data: todayEvents } = await supabase
                            .from('objektkalender_events')
                            .select('id, title, event_date, event_type, assigned_unit_name, push_enabled')
                            .eq('status', 'pending')
                            .eq('event_date', todayStr)
                            .eq('push_enabled', true);

                        (todayEvents || []).forEach(ev => {
                            const icon = ev.event_type === 'cleaning' ? '🧹' : ev.event_type === 'waste' ? '🗑️' : '📋';
                            addNotification({
                                type: 'ok_event_due',
                                title: `${icon} ${ev.title} – heute fällig`,
                                body: ev.assigned_unit_name ? `Zuständig: ${ev.assigned_unit_name}` : 'Heute zu erledigen.',
                                route: '/object-calendar',
                            });
                        });

                        // Overdue events — only check last 2 days to avoid notification flood
                        const twoDaysAgo = new Date(localToday);
                        twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
                        const twoDaysAgoStr = `${twoDaysAgo.getFullYear()}-${String(twoDaysAgo.getMonth() + 1).padStart(2, '0')}-${String(twoDaysAgo.getDate()).padStart(2, '0')}`;
                        const yesterday = new Date(localToday);
                        yesterday.setDate(yesterday.getDate() - 1);
                        const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
                        const { data: overdueEvents } = await supabase
                            .from('objektkalender_events')
                            .select('id, title, event_date, event_type, assigned_unit_name')
                            .eq('status', 'pending')
                            .gte('event_date', twoDaysAgoStr)
                            .lte('event_date', yesterdayStr);

                        (overdueEvents || []).forEach(ev => {
                            addNotification({
                                type: 'ok_event_overdue',
                                title: `🔴 ${ev.title} – überfällig`,
                                body: `War am ${new Date(ev.event_date).toLocaleDateString('de-DE')} fällig.${ev.assigned_unit_name ? ` Zuständig: ${ev.assigned_unit_name}` : ''}`,
                                route: '/object-calendar',
                            });
                        });

                        localStorage.setItem(okSessionKey, '1');
                    } catch (e) {
                        console.warn('[Notifications] Objektkalender check failed:', e);
                    }
                })();
            }

            if (!pushEnabled) {
                console.log('[Notifications] Push notifications disabled by user setting.');
            }
        };

        // Delay setup to survive React StrictMode double-mount cleanup
        const timer = setTimeout(setupChannels, 150);

        // ── REGISTER FCM PUSH (Capacitor) ───────────────────────
        registerPushNotifications(user.id).then(result => {
            if (result && result.success) {
                console.log('FCM registered:', result.token?.substring(0, 20) + '...');
                setPermissionGranted(true);
            } else if (result) {
                console.warn('FCM registration failed:', result.step, result.error);
            }
        }).catch(err => {
            console.error('FCM registration error:', err);
        });

        // Handle push received in foreground
        setupPushListeners((notification) => {
            if (notification.foreground) {
                addNotification({
                    type: notification.data?.type || 'message',
                    title: notification.title || 'Neue Benachrichtigung',
                    body: notification.body || '',
                    route: notification.data?.route,
                });
            }
        });

        return () => {
            aborted = true;
            clearTimeout(timer);
            channels.forEach(ch => supabase.removeChannel(ch));
        };
    }, [user, userRole, addNotification]);

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
