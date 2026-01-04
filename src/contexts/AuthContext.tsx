import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase, Profile } from '../lib/supabase';

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName?: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (userId: string) => {
    try {
      console.log('=== FETCHING PROFILE FOR USER ===', userId);

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.error('!!! Error fetching profile:', error);
        return null;
      }

      if (!data) {
        console.warn('!!! No profile data returned for user:', userId);
        return null;
      }

      console.log('=== PROFILE FETCH DEBUG ===');
      console.log('Fetched profile data:', data);
      console.log('Is Admin:', data?.is_admin);
      console.log('Is Admin Type:', typeof data?.is_admin);
      console.log('Is Admin Strict:', data?.is_admin === true);
      console.log('==========================');

      return data;
    } catch (err) {
      console.error('!!! Exception fetching profile:', err);
      return null;
    }
  };

  const refreshProfile = async () => {
    if (user) {
      const profileData = await fetchProfile(user.id);
      setProfile(profileData);
    }
  };

  useEffect(() => {
    let mounted = true;

    const initializeAuth = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();

        if (error) {
          console.error('Error getting session:', error);
          await supabase.auth.signOut();
          if (mounted) {
            setSession(null);
            setUser(null);
            setProfile(null);
            setLoading(false);
          }
          return;
        }

        console.log('=== INITIAL SESSION CHECK ===', session ? 'Has session' : 'No session');
        console.log('User ID:', session?.user?.id);
        console.log('User Email:', session?.user?.email);

        if (mounted) {
          setSession(session);
          setUser(session?.user ?? null);

          if (session?.user) {
            const profileData = await fetchProfile(session.user.id);
            console.log('Profile set to:', profileData);
            if (mounted) {
              setProfile(profileData);
            }
          }
          setLoading(false);
        }
      } catch (error) {
        console.error('Exception during auth initialization:', error);
        if (mounted) {
          setSession(null);
          setUser(null);
          setProfile(null);
          setLoading(false);
        }
      }
    };

    initializeAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      (async () => {
        try {
          console.log('=== AUTH STATE CHANGE ===', _event, session?.user?.id);

          if (!mounted) return;

          setSession(session);
          setUser(session?.user ?? null);

          if (session?.user) {
            let profileData = await fetchProfile(session.user.id);

            // Profile should be automatically created by database trigger
            // If not found after a short delay, try fetching again
            if (!profileData && _event === 'SIGNED_IN') {
              await new Promise(resolve => setTimeout(resolve, 1500));
              profileData = await fetchProfile(session.user.id);
            }

            if (mounted) {
              setProfile(profileData);
            }
          } else {
            if (mounted) {
              setProfile(null);
            }
          }
        } catch (error) {
          console.error('Error in auth state change:', error);
        }
      })();
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        return { error: error as Error };
      }

      if (data.user) {
        const profileData = await fetchProfile(data.user.id);

        if (profileData) {
          if (profileData.account_status === 'pending') {
            await supabase.auth.signOut();
            return { error: new Error('Your account is pending approval. Please wait for admin activation.') };
          }

          if (profileData.account_status === 'disabled') {
            await supabase.auth.signOut();
            return { error: new Error('Your account has been disabled. Please contact support.') };
          }
        }
      }

      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  };

  const signUp = async (email: string, password: string, fullName?: string) => {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName || null,
          }
        }
      });

      if (error) {
        return { error: error as Error };
      }

      // Profile is automatically created by database trigger (handle_new_user)
      // Trigger reads full_name from raw_user_meta_data

      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  };

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error('Error signing out:', error);
    } finally {
      setSession(null);
      setUser(null);
      setProfile(null);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        session,
        loading,
        signIn,
        signUp,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
