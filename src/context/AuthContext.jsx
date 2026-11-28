import React, { createContext, useState, useEffect, useContext, useRef, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { unregisterPushNotifications } from '../lib/pushNotifications';

const AuthContext = createContext();

// Abmelden: zuerst das Push-Token dieses Geräts entfernen, solange die Sitzung noch gilt
// (danach scheitert das Löschen in push_subscriptions an RLS). Fehler oder ein hängendes
// Netz verhindern das Abmelden nicht (höchstens PUSH_CLEANUP_TIMEOUT_MS Wartezeit).
const PUSH_CLEANUP_TIMEOUT_MS = 4000;
const signOutWithPushCleanup = async (userId) => {
    let timer = null;
    try {
        await Promise.race([
            unregisterPushNotifications(userId),
            new Promise(resolve => { timer = setTimeout(resolve, PUSH_CLEANUP_TIMEOUT_MS); }),
        ]);
    } catch {
        // Push-Abmeldung ist nachrangig
    } finally {
        clearTimeout(timer);
    }
    return supabase.auth.signOut();
};

// PostgREST meldet eine (noch) nicht eingespielte Datenbank-Funktion mit PGRST202 bzw. HTTP 404.
const isMissingFunction = (error, status) =>
    !!error && (error.code === 'PGRST202' || error.code === '42883' || status === 404);

const toRoleData = (row) => ({
    unit_id: row?.unit_id ?? null,
    property_id: row?.property_id ?? null,
    tenant_id: row?.tenant_id ?? null,
    id: row?.id ?? null
});

// ?code= auf diesen Pfaden stammt nicht von Supabase Auth (OAuth-Rückkehr der Cloud-Anbindung)
const FOREIGN_CODE_PATHS = ['/settings/cloud/callback'];
const isForeignCodePath = () => FOREIGN_CODE_PATHS.some(p => window.location.pathname.startsWith(p));

// Bisheriger Weg (solange die Datenbank-Funktion accept_tenant_invitation noch nicht
// eingespielt ist): offene Einladung suchen und Mieterrolle selbst anlegen.
// Vermieter-Konten (eigene Portfolios) werden dabei nie in Mieter-Konten umgewandelt.
const acceptInvitationLegacy = async (userId, email) => {
    const userEmail = (email || (await supabase.auth.getUser())?.data?.user?.email || '').trim().toLowerCase();
    if (!userEmail) return null;

    // Einladungen werden kleingeschrieben gespeichert; eq statt ilike (keine Platzhalter)
    const { data: invitations, error: invError } = await supabase
        .from('tenant_invitations')
        .select('*')
        .eq('email', userEmail)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1);
    if (invError) throw invError;

    const invitation = invitations?.[0];
    if (!invitation?.tenant_id) return null;

    const { count: portfolioCount, error: portfolioError } = await supabase
        .from('portfolios')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);
    if (portfolioError) throw portfolioError;
    if ((portfolioCount || 0) > 0) return null;

    const { data: newRole, error: roleError } = await supabase
        .from('user_roles')
        .insert({
            user_id: userId,
            role: 'tenant',
            tenant_id: invitation.tenant_id,
            unit_id: invitation.unit_id,
            property_id: invitation.property_id
        })
        .select()
        .single();

    if (roleError) {
        // Parallel bereits angelegt (UNIQUE user_id) → vorhandene Zeile verwenden
        if (roleError.code === '23505') {
            const { data: existing } = await supabase
                .from('user_roles')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: true })
                .limit(1);
            return existing?.[0] || null;
        }
        console.warn('Mieterrolle konnte nicht angelegt werden:', roleError.message);
        return null;
    }

    // Einladung als angenommen markieren (neue DB erledigt das per Trigger)
    await supabase
        .from('tenant_invitations')
        .update({ status: 'accepted' })
        .eq('id', invitation.id);

    return newRole;
};

// Konto ist über eine Mieter-Einladung entstanden (user_metadata.role = 'tenant'), hat aber weder
// eine Rolle noch eine offene Einladung (Einladung storniert bzw. Portalzugang entzogen) und keine
// eigenen Vermieterdaten → kein stilles Vermieter-Konto daraus machen.
const isEndedTenantAccount = async (userId, meta) => {
    if (meta?.role !== 'tenant') return false;
    const { count, error } = await supabase
        .from('portfolios')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);
    if (error) throw error;
    return (count || 0) === 0;
};

const ENDED_TENANT_RESULT = { role: null, data: null, tenantAccessEnded: true };

// Ermittelt die Rolle eines Kontos. Wirft bei Fehlern, statt eine Rolle zu raten.
const resolveRole = async (userId, email, meta) => {
    const { data: rows, error } = await supabase
        .from('user_roles')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .limit(1);
    if (error) throw error;

    const row = rows?.[0];
    if (row) return { role: row.role, data: toRoleData(row) };

    // Keine Rolle → offene Mieter-Einladung serverseitig annehmen
    const { data: accepted, error: rpcError, status } = await supabase.rpc('accept_tenant_invitation');
    if (!rpcError) {
        if (accepted?.role) return { role: accepted.role, data: toRoleData(accepted) };
        if (await isEndedTenantAccount(userId, meta)) return ENDED_TENANT_RESULT;
        return { role: 'investor', data: null };
    }
    if (!isMissingFunction(rpcError, status)) throw rpcError;

    const legacyRole = await acceptInvitationLegacy(userId, email);
    if (legacyRole) return { role: legacyRole.role || 'tenant', data: toRoleData(legacyRole) };
    if (await isEndedTenantAccount(userId, meta)) return ENDED_TENANT_RESULT;

    // Keine Einladung → bestehendes Konto → Vermieter
    return { role: 'investor', data: null };
};

const TenantAccessEnded = ({ onContinue }) => (
    <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px', boxSizing: 'border-box', fontFamily: 'Inter, sans-serif', background: '#f8fafc'
    }}>
        <div style={{
            maxWidth: '440px', width: '100%', textAlign: 'center', backgroundColor: '#fff',
            border: '1px solid #e2e8f0', borderRadius: '16px', padding: '32px'
        }}>
            <h1 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1e293b', marginBottom: '12px' }}>
                Kein Zugang zum Mieterportal
            </h1>
            <p style={{ color: '#64748b', fontSize: '0.92rem', lineHeight: 1.5, marginBottom: '20px' }}>
                Die Einladung zum Mieterportal wurde zurückgezogen oder Ihr Zugang wurde vom Vermieter beendet.
                Sie wurden abgemeldet. Bitte wenden Sie sich bei Fragen an Ihren Vermieter.
            </p>
            <button type="button" className="btn btn-primary btn-md" onClick={onContinue}>
                Zur Anmeldung
            </button>
        </div>
    </div>
);

const RoleLoadError = ({ message, onRetry, onSignOut }) => (
    <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px', boxSizing: 'border-box', fontFamily: 'Inter, sans-serif', background: '#f8fafc'
    }}>
        <div style={{
            maxWidth: '440px', width: '100%', textAlign: 'center', backgroundColor: '#fff',
            border: '1px solid #e2e8f0', borderRadius: '16px', padding: '32px'
        }}>
            <h1 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1e293b', marginBottom: '12px' }}>
                Anmeldung konnte nicht abgeschlossen werden
            </h1>
            <p style={{ color: '#64748b', fontSize: '0.92rem', lineHeight: 1.5, marginBottom: '8px' }}>
                Ihre Zugangsrolle (Vermieter oder Mieter) konnte nicht geladen werden.
                Bitte prüfen Sie Ihre Internetverbindung und versuchen Sie es erneut.
            </p>
            {message && (
                <p style={{ color: '#94a3b8', fontSize: '0.78rem', marginBottom: '20px', wordBreak: 'break-word' }}>
                    Technischer Hinweis: {message}
                </p>
            )}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-primary btn-md" onClick={onRetry}>
                    Erneut versuchen
                </button>
                <button type="button" className="btn btn-secondary btn-md" onClick={onSignOut}>
                    Abmelden
                </button>
            </div>
        </div>
    </div>
);

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [session, setSession] = useState(null);
    const [loading, setLoading] = useState(true);
    const [userRole, setUserRole] = useState(null); // 'investor' | 'tenant'
    const [roleData, setRoleData] = useState(null); // { unit_id, property_id, tenant_id }
    const [roleLoading, setRoleLoading] = useState(true);
    const [roleError, setRoleError] = useState(null);
    const [tenantAccessEnded, setTenantAccessEnded] = useState(false);

    const currentUserIdRef = useRef(null);       // aktuell angemeldetes Konto
    const currentUserMetaRef = useRef(null);     // user_metadata des angemeldeten Kontos
    const loadedRoleUserRef = useRef(null);      // Konto, für das die Rolle geladen ist
    const roleRequestRef = useRef({ userId: null, promise: null });

    // Session immer übernehmen (frisches Token); das user-Objekt nur ersetzen, wenn es sich
    // inhaltlich geändert hat – sonst laden alle Kontexte mit [user] bei jedem Token-Refresh neu.
    const applySession = useCallback((nextSession) => {
        const nextUser = nextSession?.user ?? null;
        currentUserIdRef.current = nextUser?.id ?? null;
        currentUserMetaRef.current = nextUser?.user_metadata ?? null;
        setSession(nextSession);
        setUser(prev => {
            if (prev && nextUser && prev.id === nextUser.id && JSON.stringify(prev) === JSON.stringify(nextUser)) {
                return prev;
            }
            return nextUser;
        });
    }, []);

    const resetRole = useCallback(() => {
        loadedRoleUserRef.current = null;
        setUserRole(null);
        setRoleData(null);
        setRoleError(null);
        setRoleLoading(false);
    }, []);

    // Rolle laden: je Konto nur einmal (parallele Aufrufe werden zusammengelegt),
    // erneut nur mit force (refetchRole / „Erneut versuchen").
    const fetchUserRole = useCallback((userId, email = null, { force = false } = {}) => {
        if (!userId) {
            resetRole();
            return Promise.resolve();
        }
        if (!force && loadedRoleUserRef.current === userId) return Promise.resolve();
        if (roleRequestRef.current.userId === userId && roleRequestRef.current.promise) {
            return roleRequestRef.current.promise;
        }

        // Neues Konto: bis zur Rolle nichts rendern (sonst sieht ein Mieter kurz die Vermieter-Ansicht)
        if (loadedRoleUserRef.current !== userId) {
            setRoleLoading(true);
            setTenantAccessEnded(false);
        }

        const promise = (async () => {
            let lastError = null;
            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    const result = await resolveRole(userId, email, currentUserMetaRef.current);
                    if (currentUserIdRef.current !== userId) return; // inzwischen abgemeldet/gewechselt
                    if (result.tenantAccessEnded) {
                        // Hinweis zeigen und abmelden (kein Vermieter-Zugang für ein beendetes Mieterkonto)
                        setTenantAccessEnded(true);
                        setUserRole(null);
                        setRoleData(null);
                        setRoleError(null);
                        loadedRoleUserRef.current = userId;
                        try {
                            await signOutWithPushCleanup(userId);
                        } catch {
                            // Lokale Sitzung wird auch bei Netzwerkfehlern entfernt
                        }
                        return;
                    }
                    setUserRole(result.role);
                    setRoleData(result.data);
                    setRoleError(null);
                    loadedRoleUserRef.current = userId;
                    return;
                } catch (err) {
                    lastError = err;
                    if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 1200));
                }
            }
            console.warn('Could not fetch user role:', lastError);
            if (currentUserIdRef.current !== userId) return;
            // Bereits bekannte Rolle behalten; ohne Rolle nicht raten (kein stilles 'investor')
            if (loadedRoleUserRef.current !== userId) {
                setUserRole(null);
                setRoleData(null);
                setRoleError(lastError?.message || 'Unbekannter Fehler');
            }
        })().finally(() => {
            if (roleRequestRef.current.promise === promise) {
                roleRequestRef.current = { userId: null, promise: null };
            }
            if (currentUserIdRef.current === userId) setRoleLoading(false);
        });

        roleRequestRef.current = { userId, promise };
        return promise;
    }, [resetRole]);

    useEffect(() => {
        let cancelled = false;

        // ── Handle Magic Link PKCE callback ──
        // Supabase magic links redirect with ?code=... which must be exchanged
        const handleAuthCallback = async () => {
            const params = new URLSearchParams(window.location.search);
            const code = params.get('code');

            if (code && !isForeignCodePath()) {
                // PKCE flow: exchange code for session
                try {
                    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
                    if (error) {
                        console.error('Error exchanging code for session:', error);
                    } else if (data.session) {
                        if (cancelled) return;
                        applySession(data.session);
                        setLoading(false);
                        fetchUserRole(data.session.user.id, data.session.user.email);
                        // Clean up URL
                        window.history.replaceState({}, '', window.location.pathname);
                        return; // Session established, don't run getSession below
                    }
                } catch (err) {
                    console.error('Auth callback error:', err);
                }
            }

            // Check active sessions (liest auch einen access_token aus dem URL-Hash)
            const { data: { session: activeSession } } = await supabase.auth.getSession();
            if (cancelled) return;
            applySession(activeSession);
            setLoading(false);
            if (activeSession?.user) {
                fetchUserRole(activeSession.user.id, activeSession.user.email);
            } else {
                setRoleLoading(false);
            }
        };

        handleAuthCallback();

        // Listen for changes on auth state (sign in, sign out, etc.)
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
            applySession(nextSession);
            setLoading(false);
            if (nextSession?.user) {
                // lädt nur bei neuem Konto (Token-Refresh/Tab-Fokus lösen keinen Neuabruf aus)
                fetchUserRole(nextSession.user.id, nextSession.user.email);
                // Clean up URL parameters (code or access token hash) if present, after session is active
                const params = new URLSearchParams(window.location.search);
                if ((params.get('code') && !isForeignCodePath()) || window.location.hash.includes('access_token')) {
                    window.history.replaceState({}, '', window.location.pathname);
                }
            } else {
                resetRole();
            }
        });

        return () => {
            cancelled = true;
            subscription.unsubscribe();
        };
    }, [applySession, fetchUserRole, resetRole]);

    const isInvestor = userRole === 'investor';
    const isTenant = userRole === 'tenant';

    const value = useMemo(() => ({
        signUp: (data) => supabase.auth.signUp(data),
        signIn: (data) => supabase.auth.signInWithPassword(data),
        signInWithGoogle: () => supabase.auth.signInWithOAuth({ provider: 'google' }),
        signOut: () => signOutWithPushCleanup(currentUserIdRef.current),
        resetPassword: (email) => supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/reset-password`,
        }),
        user,
        session,
        loading,
        userRole,
        roleData,
        roleLoading,
        roleError,
        isInvestor,
        isTenant,
        refetchRole: () => user && fetchUserRole(user.id, user.email, { force: true })
    }), [user, session, loading, userRole, roleData, roleLoading, roleError, isInvestor, isTenant, fetchUserRole]);

    const showRoleError = !!roleError && !!user;

    return (
        <AuthContext.Provider value={value}>
            {tenantAccessEnded ? (
                <TenantAccessEnded onContinue={() => setTenantAccessEnded(false)} />
            ) : !loading && !roleLoading && (showRoleError ? (
                <RoleLoadError
                    message={roleError}
                    onRetry={() => fetchUserRole(user.id, user.email, { force: true })}
                    onSignOut={() => signOutWithPushCleanup(user.id)}
                />
            ) : children)}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    return useContext(AuthContext);
};
