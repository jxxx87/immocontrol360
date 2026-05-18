import { supabase } from './supabase';
import { PushNotifications as CapPushNotifications } from '@capacitor/push-notifications';

/**
 * Push Notification Manager
 * 
 * Handles FCM token registration via Capacitor Push Notifications plugin.
 */

let PushNotifications = null;

// Load Capacitor Push plugin (only works in native app)
const loadCapacitorPush = async () => {
    try {
        // Check if Capacitor native bridge is available
        if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
            PushNotifications = CapPushNotifications;
            return true;
        }
        return false;
    } catch (err) {
        console.log('Capacitor Push check failed:', err);
        return false;
    }
};

/**
 * Register for push notifications and store FCM token in Supabase
 * Returns { success: true, token } or { success: false, step, error }
 */
export const registerPushNotifications = async (userId) => {
    // Step 1: Load Capacitor plugin
    const hasCapacitor = await loadCapacitorPush();
    if (!hasCapacitor || !PushNotifications) {
        return { success: false, step: 'plugin', error: 'Capacitor Push Plugin nicht verfügbar (Browser?)' };
    }

    try {
        // Step 2: Check permission
        let permStatus = await PushNotifications.checkPermissions();

        if (permStatus.receive === 'prompt') {
            permStatus = await PushNotifications.requestPermissions();
        }

        if (permStatus.receive !== 'granted') {
            return { success: false, step: 'permission', error: `Permission: ${permStatus.receive}` };
        }

        // Remove any old listeners first
        await PushNotifications.removeAllListeners();

        // Step 3: Set up listeners FIRST (before register!)
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                resolve({ success: false, step: 'timeout', error: 'FCM Token Timeout (15s) - kein Token von Google erhalten' });
            }, 15000);

            PushNotifications.addListener('registration', async (token) => {
                clearTimeout(timeout);
                console.log('FCM Token:', token.value);

                // Step 5: Store in Supabase
                const storeResult = await storeFcmToken(userId, token.value);
                if (storeResult.error) {
                    resolve({ success: false, step: 'store', error: `DB: ${storeResult.error}`, token: token.value });
                } else {
                    resolve({ success: true, token: token.value });
                }
            });

            PushNotifications.addListener('registrationError', (err) => {
                clearTimeout(timeout);
                console.error('Push registration error:', err);
                resolve({ success: false, step: 'fcm', error: `FCM Error: ${JSON.stringify(err)}` });
            });

            // Step 4: NOW register (listeners are already set up)
            PushNotifications.register();
        });
    } catch (err) {
        return { success: false, step: 'exception', error: err.message || String(err) };
    }
};

/**
 * Store FCM token in Supabase push_subscriptions table
 */
const storeFcmToken = async (userId, fcmToken) => {
    // Retry up to 3 times
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            // Delete existing tokens for this user first
            await supabase
                .from('push_subscriptions')
                .delete()
                .eq('user_id', userId);

            // Insert new token
            const { error } = await supabase
                .from('push_subscriptions')
                .insert({
                    user_id: userId,
                    fcm_token: fcmToken,
                    device_info: getDeviceInfo(),
                    updated_at: new Date().toISOString(),
                });

            if (error) {
                console.error(`Attempt ${attempt} - Error storing FCM token:`, error);
                if (attempt === 3) return { error: error.message };
                await new Promise(r => setTimeout(r, 1000));
                continue;
            }
            console.log('FCM token stored successfully');
            return { error: null };
        } catch (err) {
            console.error(`Attempt ${attempt} - Error storing FCM token:`, err);
            if (attempt === 3) return { error: err.message };
            await new Promise(r => setTimeout(r, 1000));
        }
    }
    return { error: 'Max retries reached' };
};

/**
 * Remove FCM token from Supabase (e.g., on logout)
 */
export const unregisterPushNotifications = async (userId) => {
    try {
        await supabase
            .from('push_subscriptions')
            .delete()
            .eq('user_id', userId);

        if (PushNotifications) {
            await PushNotifications.removeAllListeners();
        }
        console.log('Push notifications unregistered');
    } catch (err) {
        console.error('Error unregistering push:', err);
    }
};

/**
 * Set up listeners for incoming push notifications
 */
export const setupPushListeners = (onNotification) => {
    if (!PushNotifications) return;

    PushNotifications.addListener('pushNotificationReceived', (notification) => {
        console.log('Push received (foreground):', notification);
        if (onNotification) {
            onNotification({
                title: notification.title,
                body: notification.body,
                data: notification.data,
                foreground: true,
            });
        }
    });

    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        console.log('Push tapped:', action);
        if (onNotification) {
            onNotification({
                title: action.notification.title,
                body: action.notification.body,
                data: action.notification.data,
                tapped: true,
            });
        }
    });
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
