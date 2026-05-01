/**
 * Stack Auth client. Lazily constructed on first use so the SPA doesn't crash
 * at module-load time when env vars are missing (e.g. AUTH_ENABLED=false, or
 * a Vite build that didn't pick up the env). Caller must check `isStackConfigured`
 * before calling `getStackApp`.
 */
import { StackClientApp } from '@stackframe/react';

const projectId = import.meta.env.VITE_STACK_PROJECT_ID ?? '';
const publishableClientKey = import.meta.env.VITE_STACK_PUBLISHABLE_CLIENT_KEY ?? '';

export const isStackConfigured = !!(projectId && publishableClientKey);

let _stackApp: StackClientApp | null = null;

export function getStackApp(): StackClientApp {
  if (!isStackConfigured) {
    throw new Error('Stack Auth is not configured (missing VITE_STACK_PROJECT_ID / VITE_STACK_PUBLISHABLE_CLIENT_KEY)');
  }
  if (!_stackApp) {
    _stackApp = new StackClientApp({
      projectId,
      publishableClientKey,
      tokenStore: 'cookie',
      urls: {
        home: '/',
        afterSignIn: '/',
        afterSignUp: '/',
        afterSignOut: '/',
      },
    });
  }
  return _stackApp;
}
