/**
 * Stack Auth client. Single shared instance — initialised once at module load.
 *
 * The instance is created even when auth is disabled (so React doesn't choke
 * on conditional providers) but `useUser()` will simply never return a user
 * unless someone signs in via the Stack Auth flow.
 */
import { StackClientApp } from '@stackframe/react';

const projectId = import.meta.env.VITE_STACK_PROJECT_ID ?? '';
const publishableClientKey = import.meta.env.VITE_STACK_PUBLISHABLE_CLIENT_KEY ?? '';

export const stackApp = new StackClientApp({
  projectId,
  publishableClientKey,
  tokenStore: 'cookie',
  // All sign-in / sign-up routes are mounted at /handler/* (see main.tsx).
  urls: {
    home: '/',
    afterSignIn: '/',
    afterSignUp: '/',
    afterSignOut: '/',
  },
});
