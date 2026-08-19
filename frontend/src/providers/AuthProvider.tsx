import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@/lib/api';
import type { AuthUser } from '@/lib/types';

interface AuthContextValue {
  user: AuthUser | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  canWrite: boolean;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<AuthUser | null>(null);
  const [status, setStatus] = React.useState<AuthContextValue['status']>('loading');
  const queryClient = useQueryClient();

  // Restores the session from the HttpOnly cookie on first load.
  React.useEffect(() => {
    let cancelled = false;

    api
      .get<AuthUser>('/auth/me')
      .then(({ data }) => {
        if (cancelled) return;
        setUser(data);
        setStatus('authenticated');
      })
      .catch(() => {
        if (cancelled) return;
        setUser(null);
        setStatus('anonymous');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const login = React.useCallback(
    async (email: string, password: string) => {
      const { data } = await api.post<{ user: AuthUser; token: string }>('/auth/login', {
        email,
        password,
      });
      setUser(data.user);
      setStatus('authenticated');
      // A different account must not see the previous one's cached data.
      queryClient.clear();
    },
    [queryClient],
  );

  const logout = React.useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch (error) {
      // A failed logout call should still clear local state.
      if (!(error instanceof ApiError)) throw error;
    }
    setUser(null);
    setStatus('anonymous');
    queryClient.clear();
  }, [queryClient]);

  const value = React.useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      login,
      logout,
      canWrite: user?.role === 'ADMIN' || user?.role === 'MANAGER',
    }),
    [user, status, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = React.useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
}
