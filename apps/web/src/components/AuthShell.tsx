/**
 * Auth gate that sits between StackProvider and the main App.
 *
 *  Stack signed-out  → SignIn / SignUp screen
 *  Stack signed-in but no profile in our DB → handle-picker (onboarding)
 *  Stack signed-in + profile exists → render <App />
 *
 * Only mounted when VITE_AUTH_ENABLED=true.
 */
import { SignIn, SignUp, useUser } from '@stackframe/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { api } from '../lib/api';
import { Wordmark } from './Brand';

type Props = { children: ReactNode };

export function AuthShell({ children }: Props) {
  const stackUser = useUser();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');

  // Probe /me — succeeds if Stack token is valid AND a profile exists in our DB.
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api.me(),
    enabled: !!stackUser,
    retry: false,
    staleTime: 30_000,
  });

  if (!stackUser) {
    return (
      <AuthScreen>
        {mode === 'signin' ? <SignIn /> : <SignUp />}
        <div style={toggle}>
          {mode === 'signin' ? (
            <>New here? <button type="button" style={link}
                  onClick={() => setMode('signup')}>Create an account</button></>
          ) : (
            <>Already in? <button type="button" style={link}
                  onClick={() => setMode('signin')}>Sign in</button></>
          )}
        </div>
      </AuthScreen>
    );
  }

  // Profile-not-found from the API (403) → onboarding.
  const needsOnboarding =
    !!me.error && /403/.test((me.error as Error).message);

  if (needsOnboarding) {
    return (
      <AuthScreen>
        <HandlePicker email={stackUser.primaryEmail ?? ''} />
      </AuthScreen>
    );
  }

  if (me.isLoading) {
    return <AuthScreen><div style={{ opacity: 0.6 }}>Loading…</div></AuthScreen>;
  }

  return <>{children}</>;
}

// ── Handle picker ─────────────────────────────────────────────────────────

function HandlePicker({ email }: { email: string }) {
  const qc = useQueryClient();
  const [handle, setHandle] = useState('');
  const [claimOpen, setClaimOpen] = useState(false);
  const debounced = useDebounced(handle, 300);

  const check = useQuery({
    queryKey: ['check-handle', debounced],
    queryFn: () => api.checkHandle(debounced),
    enabled: debounced.length >= 3,
    retry: false,
    staleTime: 5_000,
  });

  const onboard = useMutation({
    mutationFn: () => api.onboard({ handle, email }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });

  const status = useMemo(() => {
    if (handle.length < 3) return { kind: 'idle' as const, msg: '3–20 chars, letters/numbers/_' };
    if (check.isLoading) return { kind: 'check' as const, msg: 'Checking…' };
    if (check.data?.available) return { kind: 'ok' as const, msg: 'Available' };
    if (check.data?.reason) return { kind: 'bad' as const, msg: check.data.reason };
    return { kind: 'idle' as const, msg: '' };
  }, [handle, check.isLoading, check.data]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (status.kind !== 'ok') return;
    onboard.mutate();
  };

  return (
    <form onSubmit={submit} style={{ width: '100%' }}>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 28, margin: '0 0 8px' }}>
        PICK YOUR HANDLE
      </h2>
      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, opacity: 0.7,
                   margin: '0 0 16px' }}>
        This is how you appear in moans, replies, and leaderboards.<br />
        Pick wisely — you can change it later but URLs you've shared will break.
      </p>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 6 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 22 }}>@</span>
        <input
          autoFocus
          value={handle}
          onChange={e => setHandle(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
          maxLength={20}
          style={{
            flex: 1, fontFamily: 'var(--font-mono)', fontSize: 18,
            padding: '8px 10px', border: '2px solid var(--ink)',
            background: 'var(--paper)', textTransform: 'uppercase',
          }}
        />
      </div>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 12, marginBottom: 14,
        color: status.kind === 'bad' ? 'var(--red, #e63946)'
               : status.kind === 'ok' ? 'var(--green, #06a77d)' : 'var(--ink)',
        opacity: status.kind === 'idle' ? 0.6 : 1,
      }}>
        {status.msg}
      </div>
      {check.data?.reason?.includes('reserved') && (
        <div style={{ marginBottom: 14, padding: 10, border: '1px dashed var(--ink)',
                       fontFamily: 'var(--font-mono)', fontSize: 11, opacity: 0.85 }}>
          Are you really @{handle}? <button type="button" onClick={() => setClaimOpen(true)}
            style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer',
                     fontFamily: 'inherit', fontSize: 'inherit', color: 'var(--ink)',
                     textDecoration: 'underline' }}>
            CLAIM THIS NAME →
          </button>
        </div>
      )}
      {claimOpen && (
        <ClaimModal handle={handle} email={email} onClose={() => setClaimOpen(false)} />
      )}
      {onboard.isError && (
        <div style={{ marginBottom: 10, color: 'var(--red, #e63946)',
                       fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          {(onboard.error as Error).message}
        </div>
      )}
      <button type="submit" disabled={status.kind !== 'ok' || onboard.isPending}
              style={{
                width: '100%', padding: '12px',
                background: status.kind === 'ok' ? 'var(--ink)' : '#999',
                color: 'var(--cream)', border: 0,
                fontFamily: 'var(--font-display)', fontSize: 14,
                letterSpacing: '0.05em',
                cursor: status.kind === 'ok' ? 'pointer' : 'not-allowed',
              }}>
        {onboard.isPending ? 'CREATING…' : 'CLAIM HANDLE →'}
      </button>
    </form>
  );
}

function ClaimModal({ handle, email, onClose }: { handle: string; email: string; onClose: () => void }) {
  const [name, setName] = useState('');
  const [emailVal, setEmailVal] = useState(email);
  const [proof, setProof] = useState('');
  const [msg, setMsg] = useState('');
  const submit = useMutation({
    mutationFn: () => api.submitHandleClaim({
      handle, claimant_name: name, email: emailVal, social_proof: proof, message: msg || undefined,
    }),
  });
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
      display: 'grid', placeItems: 'center', padding: 16, zIndex: 9999,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--paper)', border: '3px solid var(--ink)',
        boxShadow: '6px 6px 0 var(--ink)', maxWidth: 480, width: '100%',
        padding: 22, maxHeight: '90vh', overflow: 'auto',
      }}>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 22, margin: '0 0 8px' }}>
          CLAIM @{handle}
        </h3>
        {submit.isSuccess ? (
          <>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>
              Claim submitted. We'll verify within 48h and email you when the handle is yours.
            </p>
            <button type="button" onClick={onClose} style={{
              marginTop: 10, padding: '10px 16px', background: 'var(--ink)',
              color: 'var(--cream)', border: 0, fontFamily: 'var(--font-display)',
              fontSize: 13, cursor: 'pointer',
            }}>OK</button>
          </>
        ) : (
          <form onSubmit={e => { e.preventDefault(); submit.mutate(); }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, opacity: 0.7, margin: '0 0 14px' }}>
              Reserved for the real owner of this name. Provide proof and we'll verify.
            </p>
            <Field label="Your full name" value={name} onChange={setName} required />
            <Field label="Contact email" value={emailVal} onChange={setEmailVal} type="email" required />
            <Field label="Proof URLs (verified socials, official site)"
                   value={proof} onChange={setProof} required multiline
                   placeholder="https://x.com/realklopp&#10;https://liverpoolfc.com/team/manager" />
            <Field label="Anything else? (optional)" value={msg} onChange={setMsg} multiline />
            {submit.isError && (
              <div style={{ marginBottom: 10, color: 'var(--red, #e63946)',
                             fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                {(submit.error as Error).message}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" disabled={submit.isPending} style={{
                flex: 1, padding: '10px', background: 'var(--ink)', color: 'var(--cream)',
                border: 0, fontFamily: 'var(--font-display)', fontSize: 13, cursor: 'pointer',
              }}>{submit.isPending ? 'SENDING…' : 'SUBMIT CLAIM'}</button>
              <button type="button" onClick={onClose} style={{
                padding: '10px 14px', background: 'var(--paper)', color: 'var(--ink)',
                border: '2px solid var(--ink)', fontFamily: 'var(--font-display)',
                fontSize: 13, cursor: 'pointer',
              }}>CANCEL</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', required = false,
                 multiline = false, placeholder }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; required?: boolean; multiline?: boolean; placeholder?: string;
}) {
  const common: CSSProperties = {
    width: '100%', padding: '8px 10px', border: '2px solid var(--ink)',
    background: 'var(--paper)', fontFamily: 'var(--font-mono)', fontSize: 13,
    boxSizing: 'border-box',
  };
  return (
    <label style={{ display: 'block', marginBottom: 12,
                     fontFamily: 'var(--font-mono)', fontSize: 11,
                     letterSpacing: '0.05em', opacity: 0.8 }}>
      {label.toUpperCase()}
      {multiline ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} required={required}
          rows={3} placeholder={placeholder}
          style={{ ...common, marginTop: 4, fontFamily: 'var(--font-mono)' }} />
      ) : (
        <input type={type} value={value} onChange={e => onChange(e.target.value)} required={required}
          placeholder={placeholder} style={{ ...common, marginTop: 4 }} />
      )}
    </label>
  );
}

function useDebounced<T>(value: T, delay: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

// ── Layout ────────────────────────────────────────────────────────────────

function AuthScreen({ children }: { children: ReactNode }) {
  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ marginBottom: 18 }}><Wordmark /></div>
        {children}
      </div>
    </div>
  );
}

const wrap: CSSProperties = {
  minHeight: '100vh',
  background: 'var(--cream)',
  display: 'grid', placeItems: 'center',
  padding: 24,
};

const card: CSSProperties = {
  width: '100%', maxWidth: 440,
  background: 'var(--paper)',
  border: '3px solid var(--ink)',
  boxShadow: '6px 6px 0 var(--ink)',
  padding: 28,
};

const toggle: CSSProperties = {
  marginTop: 16, fontFamily: 'var(--font-mono)', fontSize: 12,
  textAlign: 'center', opacity: 0.8,
};

const link: CSSProperties = {
  background: 'none', border: 0, padding: 0, cursor: 'pointer',
  fontFamily: 'inherit', fontSize: 'inherit', color: 'var(--ink)',
  textDecoration: 'underline',
};
