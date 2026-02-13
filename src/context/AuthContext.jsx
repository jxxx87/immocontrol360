import React, { createContext, useState, useEffect, useContext } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [session, setSession] = useState(null);
    const [loading, setLoading] = useState(true);
    const [userRole, setUserRole] = useState(null); // 'investor' | 'tenant'
    const [roleData, setRoleData] = useState(null); // { unit_id, property_id, tenant_id }
    const [roleLoading, setRoleLoading] = useState(true);

    // Fetch user role from user_roles table
    const fetchUserRole = async (userId) => {
        if (!userId) {
            setUserRole('investor'); // Default
            setRoleData(null);
            setRoleLoading(false);
            return;
        }

        try {
            const { data, error } = await supabase
                .from('user_roles')
                .select('*')
                .eq('user_id', userId)
                .maybeSingle();

            if (error) {
                console.warn('Could not fetch user role (table may not exist yet):', error.message);
                setUserRole('investor');
                setRoleData(null);
            } else if (data) {
                setUserRole(data.role);
                setRoleData({
                    unit_id: data.unit_id,
                    property_id: data.property_id,
                    tenant_id: data.tenant_id,
                    id: data.id
                });
            } else {
                // No role entry → check if this is a new tenant from an invitation
                const userEmail = (await supabase.auth.getUser())?.data?.user?.email;

                if (userEmail) {
                    const { data: invitation } = await supabase
                        .from('tenant_invitations')
                        .select('*')
                        .eq('email', userEmail)
                        .eq('status', 'pending')
                        .maybeSingle();

                    if (invitation) {
                        // Auto-create tenant role from invitation
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

                        if (!roleError && newRole) {
                            // Mark invitation as accepted
                            await supabase
                                .from('tenant_invitations')
                                .update({ status: 'accepted' })
                                .eq('id', invitation.id);

                            setUserRole('tenant');
                            setRoleData({
                                unit_id: newRole.unit_id,
                                property_id: newRole.property_id,
                                tenant_id: newRole.tenant_id,
                                id: newRole.id
                            });
                            return; // Exit early, role is set
                        }
                    }
                }

                // No invitation found → existing user → default to investor
                setUserRole('investor');
                setRoleData(null);
            }
        } catch (err) {
            console.warn('Error fetching user role:', err);
            setUserRole('investor');
            setRoleData(null);
        } finally {
            setRoleLoading(false);
        }
    };

    useEffect(() => {
        // ── Handle Magic Link PKCE callback ──
        // Supabase magic links redirect with ?code=... which must be exchanged
        const handleAuthCallback = async () => {
            const params = new URLSearchParams(window.location.search);
            const code = params.get('code');
            const hashParams = new URLSearchParams(window.location.hash.substring(1));
            const accessToken = hashParams.get('access_token');

            if (code) {
                // PKCE flow: exchange code for session
                try {
                    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
                    if (error) {
                        console.error('Error exchanging code for session:', error);
                    } else if (data.session) {
                        setSession(data.session);
                        setUser(data.session.user);
                        setLoading(false);
                        fetchUserRole(data.session.user.id);
                        // Clean up URL
                        window.history.replaceState({}, '', window.location.pathname);
                        return; // Session established, don't run getSession below
                    }
                } catch (err) {
                    console.error('Auth callback error:', err);
                }
            }

            if (accessToken) {
                // Implicit flow (older): tokens are in the hash
                // Supabase client handles this automatically via getSession
                window.history.replaceState({}, '', window.location.pathname);
            }

            // Check active sessions
            supabase.auth.getSession().then(({ data: { session } }) => {
                setSession(session);
                setUser(session?.user ?? null);
                setLoading(false);
                if (session?.user) {
                    fetchUserRole(session.user.id);
                } else {
                    setRoleLoading(false);
                }
            });
        };

        handleAuthCallback();

        // Listen for changes on auth state (sign in, sign out, etc.)
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
            setUser(session?.user ?? null);
            setLoading(false);
            if (session?.user) {
                fetchUserRole(session.user.id);
            } else {
                setUserRole(null);
                setRoleData(null);
                setRoleLoading(false);
            }
        });

        return () => subscription.unsubscribe();
    }, []);

    const isInvestor = userRole === 'investor';
    const isTenant = userRole === 'tenant';

    const value = {
        signUp: (data) => supabase.auth.signUp(data),
        signIn: (data) => supabase.auth.signInWithPassword(data),
        signInWithGoogle: () => supabase.auth.signInWithOAuth({ provider: 'google' }),
        signOut: () => supabase.auth.signOut(),
        resetPassword: (email) => supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/reset-password`,
        }),
        updatePassword: (password) => supabase.auth.updateUser({ password }),
        user,
        session,
        loading,
        userRole,
        roleData,
        roleLoading,
        isInvestor,
        isTenant,
        refetchRole: () => user && fetchUserRole(user.id)
    };

    return (
        <AuthContext.Provider value={value}>
            {!loading && !roleLoading && children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    return useContext(AuthContext);
};
