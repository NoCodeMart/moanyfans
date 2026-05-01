import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StackHandler, StackProvider, StackTheme } from '@stackframe/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AuthShell } from './components/AuthShell';
import { ComingSoon } from './components/ComingSoon';
import { AuthProvider } from './lib/auth';
import { getStackApp, isStackConfigured } from './lib/stack';
import './moanyfans.css';

const PREVIEW_KEY = 'moanyfans:preview-pass';
const PREVIEW_TOKEN = 'moanyfans2026';
const params = new URLSearchParams(window.location.search);
if (params.get('preview') === PREVIEW_TOKEN) {
  localStorage.setItem(PREVIEW_KEY, '1');
  params.delete('preview');
  const qs = params.toString();
  window.history.replaceState({}, '', window.location.pathname + (qs ? '?' + qs : ''));
}
if (params.get('preview') === 'off') {
  localStorage.removeItem(PREVIEW_KEY);
}
const comingSoon =
  import.meta.env.VITE_COMING_SOON === 'true' &&
  localStorage.getItem(PREVIEW_KEY) !== '1';

const authEnabled = import.meta.env.VITE_AUTH_ENABLED === 'true' && isStackConfigured;
const isHandlerRoute = window.location.pathname.startsWith('/handler');

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
  },
});

function Root() {
  if (comingSoon) return <ComingSoon />;

  // Stack Auth's built-in routes (sign-in, sign-up, password reset, oauth
  // callbacks). Mount it directly when the path matches so we don't need a
  // router for the rest of the app.
  if (isHandlerRoute && isStackConfigured) {
    const app = getStackApp();
    return (
      <StackProvider app={app}>
        <StackTheme>
          <StackHandler app={app} location={window.location.pathname} fullPage />
        </StackTheme>
      </StackProvider>
    );
  }

  const inner = (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </QueryClientProvider>
  );

  if (!authEnabled) return inner;

  const app = getStackApp();
  return (
    <StackProvider app={app}>
      <StackTheme>
        <QueryClientProvider client={queryClient}>
          <AuthShell>
            <AuthProvider>
              <App />
            </AuthProvider>
          </AuthShell>
        </QueryClientProvider>
      </StackTheme>
    </StackProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
