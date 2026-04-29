/**
 * Auth wiring — feature-flagged via VITE_AUTH_ENABLED.
 *
 * When false (default): `useCurrentUser` returns the GUEST_TESTER row from /me
 *   and the entire site is usable without signing in.
 * When true: Stack Auth is initialised and the real user is loaded after sign-in.
 *
 * The Stack imports are present but only invoked when auth is enabled, so the
 * dev experience needs zero Stack credentials configured.
 */
import { useQuery } from '@tanstack/react-query';
import {
  type ReactNode, createContext, useContext, useMemo,
} from 'react';
import { api, type CurrentUser } from './api';

const AUTH_ENABLED = import.meta.env.VITE_AUTH_ENABLED === 'true';

type AuthContextValue = {
  authEnabled: boolean;
  user: CurrentUser | null;
  loading: boolean;
  signInUrl: string;
  signOutUrl: string;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.me(),
    retry: false,
    staleTime: 60_000,
  });

  const value = useMemo<AuthContextValue>(
    () => ({
      authEnabled: AUTH_ENABLED,
      user: data ?? null,
      loading: isLoading,
      signInUrl: '/handler/sign-in',
      signOutUrl: '/handler/sign-out',
    }),
    [data, isLoading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useCurrentUser(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useCurrentUser must be used inside <AuthProvider>');
  return ctx;
}
