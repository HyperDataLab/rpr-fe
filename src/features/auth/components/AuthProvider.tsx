'use client';

import { createContext, useCallback, useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
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
      setUser(currentUser ? await loadUserProfile(currentUser.uid) : null);
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
          setUser(await loadUserProfile(firebaseUser.uid));
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
