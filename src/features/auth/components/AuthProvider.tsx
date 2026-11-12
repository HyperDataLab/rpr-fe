'use client';

import { createContext, useCallback, useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import type { User } from '@/shared/types';
import { authApi, loadUserProfile } from '../api/authApi';
import { firebaseAuth } from '@/lib/firebase/client';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
  updateUser: (updated: Partial<User>) => void;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  refresh: async () => {},
  updateUser: () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const currentUser = firebaseAuth().currentUser;
      if (!currentUser) {
        setUser(null);
        return;
      }
      const profile = await loadUserProfile(currentUser.uid);
      const token = await currentUser.getIdTokenResult();
      const provider = (token.claims.firebase as { sign_in_provider?: string } | undefined)?.sign_in_provider;
      if (!profile || !profile.isActive || profile.status !== 'APPROVED' || (profile.workspaceEmail && provider !== 'custom')) {
        await signOut(firebaseAuth());
        setUser(null);
        return;
      }
      setUser(profile);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const updateUser = (updated: Partial<User>) => {
    setUser((prev) => (prev ? { ...prev, ...updated } : null));
  };

  const logout = async () => {
    setUser(null);
    await authApi.logout();
  };

  useEffect(() => {
    try {
      return onAuthStateChanged(firebaseAuth(), async (firebaseUser) => {
        if (!firebaseUser) {
          setUser(null);
          setLoading(false);
          return;
        }
        try {
          const profile = await loadUserProfile(firebaseUser.uid);
          const token = await firebaseUser.getIdTokenResult();
          const provider = (token.claims.firebase as { sign_in_provider?: string } | undefined)?.sign_in_provider;
          if (!profile || !profile.isActive || profile.status !== 'APPROVED' || (profile.workspaceEmail && provider !== 'custom')) {
            await signOut(firebaseAuth());
            setUser(null);
            setLoading(false);
            return;
          }
          setUser(profile);
        } catch {
          setUser(null);
        } finally {
          setLoading(false);
        }
      });
    } catch {
      setUser(null);
      setLoading(false);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, refresh, updateUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export default AuthProvider;
