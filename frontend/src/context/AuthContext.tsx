import React, { createContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { User } from '../types/api';
import api from '../services/api';

export interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (userData: User) => void;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * The session JWT lives in an httpOnly cookie, so JS cannot read it or check its
 * expiry. `auth_user` stays in localStorage as a display cache only — it holds
 * nothing secret, and the server remains the single source of truth on whether
 * the session is still valid.
 */
export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;

    const restoreSession = async () => {
      try {
        const res = await api.get('/auth/me');
        if (cancelled) return;

        // Onboarding flags (isFirstTime / hasPassword) are decided at login time
        // and are not part of the session, so they are kept from the cache.
        const storedUser = localStorage.getItem('auth_user');
        const cached = storedUser ? JSON.parse(storedUser) : {};
        const merged = { ...cached, ...res.user };

        localStorage.setItem('auth_user', JSON.stringify(merged));
        setUser(merged);
      } catch {
        if (cancelled) return;
        localStorage.removeItem('auth_user');
        setUser(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    restoreSession();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleUnauthorized = () => {
      setUser(null);
      localStorage.removeItem('auth_user');
    };
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, []);

  const login = (userData: User) => {
    localStorage.setItem('auth_user', JSON.stringify(userData));
    setUser(userData);
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // The cookie may already be gone; the local state still has to be cleared.
    }
    localStorage.removeItem('auth_user');
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
