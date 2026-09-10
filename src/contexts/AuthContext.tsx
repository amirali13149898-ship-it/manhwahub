import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import supabase from '../lib/supabase';

type AuthValue = { user: User | null; session: Session | null; loading: boolean; isAdmin: boolean; isOwner: boolean; permissions: string[] };
const AuthContext = createContext<AuthValue>({ user: null, session: null, loading: true, isAdmin: false, isOwner: false, permissions: [] });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [access, setAccess] = useState({ isAdmin: false, isOwner: false, permissions: [] as string[] });

  useEffect(() => {
    const syncAccess = async (next: Session | null) => {
      if (!next) { setAccess({ isAdmin: false, isOwner: false, permissions: [] }); setLoading(false); return; }
      try {
        const response = await fetch('/api/admin-session', { cache: 'no-store', headers: { Authorization: `Bearer ${next.access_token}` } });
        const data = await response.json();
        setAccess(response.ok ? { isAdmin: Boolean(data.isAdmin), isOwner: Boolean(data.isOwner), permissions: data.permissions || [] } : { isAdmin: false, isOwner: false, permissions: [] });
      } catch { setAccess({ isAdmin: false, isOwner: false, permissions: [] }); }
      finally { setLoading(false); }
    };
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      syncAccess(data.session);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setUser(next?.user ?? null);
      setLoading(true);
      setTimeout(() => syncAccess(next), 0);
    });
    const refreshAccess = () => supabase.auth.getSession().then(({ data }) => syncAccess(data.session));
    const interval = window.setInterval(refreshAccess, 30000);
    window.addEventListener('focus', refreshAccess);
    return () => { subscription.unsubscribe(); window.clearInterval(interval); window.removeEventListener('focus', refreshAccess); };
  }, []);

  const value = useMemo(() => ({ user, session, loading, isAdmin: access.isAdmin, isOwner: access.isOwner, permissions: access.permissions }), [user, session, loading, access]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
