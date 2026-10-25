import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { User } from '../types/index.js';
import { api } from '../api/client.js';

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
  isOwner: boolean;
  isInCharge: boolean;
  isMD: boolean;
  isSiteInCharge: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('sitetrack_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem('sitetrack_token');
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const login = useCallback((newToken: string, newUser: User) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem('sitetrack_token', newToken);
    localStorage.setItem('sitetrack_user', JSON.stringify(newUser));
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('sitetrack_token');
    localStorage.removeItem('sitetrack_user');
    window.location.href = '/login';
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      if (!localStorage.getItem('sitetrack_token')) {
        setIsLoading(false);
        return;
      }
      const res = await api.get<{ success: boolean; user: User }>('/auth/me');
      if (res.success && res.user) {
        setUser(res.user);
        localStorage.setItem('sitetrack_user', JSON.stringify(res.user));
      }
    } catch (err) {
      console.warn('Failed to refresh user profile:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const isOwner = user?.role === 'MD' || user?.role === 'OWNER';
  const isInCharge = user?.role === 'SITE_INCHARGE' || user?.role === 'IN_CHARGE';
  const isMD = isOwner;
  const isSiteInCharge = isInCharge;

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        login,
        logout,
        refreshUser,
        isOwner,
        isInCharge,
        isMD,
        isSiteInCharge,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
