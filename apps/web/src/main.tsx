import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ComingSoon } from './components/ComingSoon';
import { AuthProvider } from './lib/auth';
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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {comingSoon ? (
      <ComingSoon />
    ) : (
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </QueryClientProvider>
    )}
  </StrictMode>,
);
