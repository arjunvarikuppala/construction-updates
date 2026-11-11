import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { disablePush } from '../utils/push.js';
import { User } from '../types/index.js';
import { api } from '../api/client.js';
import { clearOfflineData } from '../utils/offlineChat.js';

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
  activeRole: string | undefined;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function parseJwtPayload(token: string | null): { userId?: string; role?: string; email?: string; name?: string } | null {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      window
        .atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const saved = localStorage.getItem('sitetrack_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem('sitetrack_token');
  });
  const [isLoading, setIsLoading] = useState<boolean>(() => {
    return Boolean(localStorage.getItem('sitetrack_token'));
  });

  const login = useCallback((newToken: string, newUser: User) => {
    setToken(newToken);
    setUser(newUser);
    setIsLoading(false);
    localStorage.setItem('sitetrack_token', newToken);
    localStorage.setItem('sitetrack_user', JSON.stringify(newUser));
  }, []);

  const logout = useCallback(() => {
    const previousToken = localStorage.getItem('sitetrack_token');
    setToken(null);
    setUser(null);
    setIsLoading(false);
    localStorage.removeItem('sitetrack_token');
    localStorage.removeItem('sitetrack_user');
    // Saved chats and unsent messages belong to this user only
    clearOfflineData();
    // Stop this device getting the signed-out user's notifications, then leave
    Promise.race([disablePush(previousToken), new Promise((r) => setTimeout(r, 1500))]).finally(() => {
      window.location.href = '/login';
    });
  }, []);

  const refreshUser = useCallback(async () => {
    const storedToken = localStorage.getItem('sitetrack_token');
    if (!storedToken) {
      setUser(null);
      setToken(null);
      setIsLoading(false);
      return;
    }

    try {
      const res = await api.get<{ success: boolean; user: User }>('/auth/me');
      if (res.success && res.user) {
        setUser(res.user);
        setToken(storedToken);
        localStorage.setItem('sitetrack_user', JSON.stringify(res.user));
      }
    } catch (err: any) {
      console.warn('Failed to refresh user profile:', err);
      if (err?.status === 401) {
        setUser(null);
        setToken(null);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  // Synchronize authentication state across browser tabs in real time
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'sitetrack_token' || e.key === 'sitetrack_user') {
        const latestToken = localStorage.getItem('sitetrack_token');
        const latestUserStr = localStorage.getItem('sitetrack_user');
        setToken(latestToken);
        if (latestUserStr) {
          try {
            setUser(JSON.parse(latestUserStr));
          } catch {
            setUser(null);
          }
        } else {
          setUser(null);
        }
        if (!latestToken) {
          setIsLoading(false);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // Derive authority directly from verified token header credential and current user profile
  const tokenPayload = useMemo(() => parseJwtPayload(token), [token]);
  const activeRole = tokenPayload?.role || user?.role;

  // Auto-refresh profile if localStorage user object drifts from active token
  useEffect(() => {
    if (tokenPayload && user) {
      const currentUserId = user.id || (user as any)._id;
      if (tokenPayload.userId !== currentUserId || tokenPayload.role !== user.role) {
        refreshUser();
      }
    }
  }, [tokenPayload, user, refreshUser]);

  const isOwner = activeRole === 'MD' || activeRole === 'OWNER';
  const isInCharge = activeRole === 'SITE_INCHARGE' || activeRole === 'IN_CHARGE';
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
        activeRole,
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
