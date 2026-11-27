import { supabase } from './supabase';
import { PushNotifications as CapPushNotifications } from '@capacitor/push-notifications';

/**
 * Push Notification Manager
 *
 * Handles FCM token registration via Capacitor Push Notifications plugin.
 *
 * - Listener werden gezielt über ihre Handles verwaltet (kein removeAllListeners
 *   während der Registrierung, sonst gehen die Empfangs-/Tipp-Listener verloren).
 * - Pro Gerät ein Eintrag in push_subscriptions (Upsert auf user_id + fcm_token),
 *   damit mehrere Geräte eines Nutzers Pushes erhalten.
 * - Beim Abmelden wird das Token dieses Geräts entfernt und das FCM-Token gelöscht.
 */

const TOKEN_STORAGE_KEY = 'immo_fcm_token';
const ANDROID_CHANNEL_ID = 'immocontrol_notifications';
const isDev = !!import.meta.env.DEV;
const debugLog = (...args) => { if (isDev) console.log(...args); };

let PushNotifications = null;
let registrationHandles = [];
let notificationHandles = [];
let currentToken = null;
let pendingRegistration = null;

const isNativePlatform = () => {
    try {
        return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    } catch {
        return false;
    }
};

// Load Capacitor Push plugin (only works in native app)
const loadCapacitorPush = () => {
    if (isNativePlatform()) {
        PushNotifications = CapPushNotifications;
        return true;
    }
    return false;
};

const readStoredToken = () => {
    try {
        return localStorage.getItem(TOKEN_STORAGE_KEY);
    } catch {
        return null;
    }
};

const writeStoredToken = (token) => {
    try {
        if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
        else localStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
        // localStorage nicht verfügbar
    }
};

const removeHandles = async (handles) => {
    const list = handles.splice(0, handles.length);
    await Promise.all(list.map(async (handlePromise) => {
        try {
            const handle = await handlePromise;
            await handle?.remove?.();
        } catch {
            // Listener bereits entfernt
        }
    }));
};

// Android 8+: Kanal anlegen, den die Edge Function in der Nachricht angibt
const ensureAndroidChannel = async () => {
    try {
        if (window.Capacitor?.getPlatform?.() !== 'android') return;
        await PushNotifications.createChannel({
            id: ANDROID_CHANNEL_ID,
            name: 'ImmoControl Benachrichtigungen',
            importance: 4,
            visibility: 1,
        });
    } catch (err) {
        debugLog('Push channel could not be created:', err);
    }
};

/**
 * Register for push notifications and store FCM token in Supabase
 * Returns { success: true, token } or { success: false, step, error }
 */
export const registerPushNotifications = async (userId) => {
    // Step 1: Load Capacitor plugin
    const hasCapacitor = loadCapacitorPush();
    if (!hasCapacitor || !PushNotifications) {
        return { success: false, step: 'plugin', error: 'Capacitor Push Plugin nicht verfügbar (Browser?)' };
    }
    if (!userId) {
        return { success: false, step: 'user', error: 'Kein angemeldeter Nutzer' };
    }

    // Doppelte Registrierung (z. B. React StrictMode) zusammenführen
    if (pendingRegistration) return pendingRegistration;

    pendingRegistration = (async () => {
        try {
            // Step 2: Check permission
            let permStatus = await PushNotifications.checkPermissions();

            if (permStatus.receive === 'prompt' || permStatus.receive === 'prompt-with-rationale') {
                permStatus = await PushNotifications.requestPermissions();
            }

            if (permStatus.receive !== 'granted') {
                return { success: false, step: 'permission', error: `Permission: ${permStatus.receive}` };
            }

            await ensureAndroidChannel();

            // Nur die eigenen Registrierungs-Listener einer früheren Runde entfernen
            await removeHandles(registrationHandles);

            // Step 3: Set up listeners FIRST (before register!)
            return await new Promise((resolve) => {
                let settled = false;
                const finish = (result) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeout);
                    removeHandles(registrationHandles);
                    resolve(result);
                };
                const timeout = setTimeout(() => {
                    finish({ success: false, step: 'timeout', error: 'FCM Token Timeout (15s) - kein Token von Google erhalten' });
                }, 15000);

                const regHandle = PushNotifications.addListener('registration', async (token) => {
                    debugLog('FCM token received');
                    const storeResult = await storeFcmToken(userId, token.value);
                    if (storeResult.error) {
                        finish({ success: false, step: 'store', error: `DB: ${storeResult.error}`, token: token.value });
                    } else {
                        finish({ success: true, token: token.value });
                    }
                });

                const errHandle = PushNotifications.addListener('registrationError', (err) => {
                    console.error('Push registration error:', err?.error || err);
                    finish({ success: false, step: 'fcm', error: `FCM Error: ${JSON.stringify(err)}` });
                });

                registrationHandles.push(regHandle, errHandle);

                // Step 4: NOW register (listeners are already set up)
                Promise.all([regHandle, errHandle])
                    .then(() => PushNotifications.register())
                    .catch((err) => finish({ success: false, step: 'register', error: err?.message || String(err) }));
            });
        } catch (err) {
            return { success: false, step: 'exception', error: err?.message || String(err) };
        }
    })();

    try {
        return await pendingRegistration;
    } finally {
        pendingRegistration = null;
    }
};

/**
 * Store FCM token in Supabase push_subscriptions table
 * (ein Eintrag pro Gerät; andere Geräte des Nutzers bleiben erhalten)
 */
const storeFcmToken = async (userId, fcmToken) => {
    const previousToken = readStoredToken();

    // Retry up to 3 times
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const { error } = await supabase
                .from('push_subscriptions')
                .upsert({
                    user_id: userId,
                    fcm_token: fcmToken,
                    device_info: getDeviceInfo(),
                    updated_at: new Date().toISOString(),
                }, { onConflict: 'user_id,fcm_token' });

            if (error) {
                console.error(`Attempt ${attempt} - Error storing FCM token:`, error.message);
                if (attempt === 3) return { error: error.message };
                await new Promise(r => setTimeout(r, 1000));
                continue;
            }

            currentToken = fcmToken;
            writeStoredToken(fcmToken);

            // Altes Token dieses Geräts (Token-Wechsel) entfernen
            if (previousToken && previousToken !== fcmToken) {
                const { error: deleteError } = await supabase
                    .from('push_subscriptions')
                    .delete()
                    .eq('user_id', userId)
                    .eq('fcm_token', previousToken);
                if (deleteError) console.warn('Old FCM token could not be removed:', deleteError.message);
            }

            debugLog('FCM token stored successfully');
            return { error: null };
        } catch (err) {
            console.error(`Attempt ${attempt} - Error storing FCM token:`, err?.message || err);
            if (attempt === 3) return { error: err?.message || String(err) };
            await new Promise(r => setTimeout(r, 1000));
        }
    }
    return { error: 'Max retries reached' };
};

/**
 * Remove FCM token from Supabase (e.g., on logout)
 * Sollte VOR supabase.auth.signOut() aufgerufen werden, solange die Sitzung noch gilt.
 * Danach wird zusätzlich das FCM-Token auf dem Gerät gelöscht, sodass das Gerät auch
 * dann keine Pushes des abgemeldeten Kontos mehr erhält, wenn der DB-Eintrag nicht
 * mehr gelöscht werden konnte (die Edge Function räumt ungültige Tokens selbst auf).
 */
export const unregisterPushNotifications = async (userId) => {
    const token = currentToken || readStoredToken();
    let dbError = null;

    try {
        if (userId && token) {
            const { error } = await supabase
                .from('push_subscriptions')
                .delete()
                .eq('user_id', userId)
                .eq('fcm_token', token);
            if (error) dbError = error.message;
        }
    } catch (err) {
        dbError = err?.message || String(err);
    }

    try {
        if (loadCapacitorPush() && PushNotifications) {
            await removeHandles(registrationHandles);
            await removeHandles(notificationHandles);
            await PushNotifications.unregister();
        }
    } catch (err) {
        console.warn('Push unregister failed:', err?.message || err);
    }

    currentToken = null;
    writeStoredToken(null);
    if (dbError) console.warn('Push subscription could not be removed:', dbError);
    debugLog('Push notifications unregistered');
    return { success: !dbError, error: dbError };
};

/**
 * Set up listeners for incoming push notifications
 * Gibt eine Aufräumfunktion zurück.
 */
export const setupPushListeners = (onNotification) => {
    if (!loadCapacitorPush() || !PushNotifications) return () => {};

    // Vorherige Empfangs-Listener ersetzen (keine Doppelregistrierung)
    removeHandles(notificationHandles);

    const handles = [
        PushNotifications.addListener('pushNotificationReceived', (notification) => {
            debugLog('Push received (foreground)');
            if (onNotification) {
                onNotification({
                    title: notification.title,
                    body: notification.body,
                    data: notification.data,
                    foreground: true,
                });
            }
        }),
        PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
            debugLog('Push tapped');
            if (onNotification) {
                onNotification({
                    title: action.notification?.title,
                    body: action.notification?.body,
                    data: action.notification?.data,
                    tapped: true,
                });
            }
        }),
    ];
    notificationHandles.push(...handles);

    return () => {
        handles.forEach((handlePromise) => {
            const idx = notificationHandles.indexOf(handlePromise);
            if (idx !== -1) notificationHandles.splice(idx, 1);
        });
        removeHandles(handles);
    };
};

const getDeviceInfo = () => {
    const ua = navigator.userAgent;
    if (ua.includes('Android')) {
        const match = ua.match(/Android\s+([\d.]+)/);
        return `Android ${match ? match[1] : 'unknown'}`;
    }
    if (ua.includes('iPhone') || ua.includes('iPad')) {
        return 'iOS';
    }
    return 'Web Browser';
};
