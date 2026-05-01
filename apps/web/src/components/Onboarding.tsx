import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useCurrentUser } from '../lib/auth';
import { useCreateMoan, useSetTeam, useTeams } from '../lib/hooks';

type Step = 'account' | 'team' | 'firstMoan' | 'done';
const STEPS: Step[] = ['account', 'team', 'firstMoan', 'done'];

export function OnboardingWizard({ onClose }: { onClose: () => void }) {
  const { user, authEnabled } = useCurrentUser();
  // Stack Auth + AuthShell already handled account creation when authEnabled,
  // so jump straight to team-pick. Demo mode keeps the legacy account step.
  const [step, setStep] = useState<Step>(authEnabled ? 'team' : 'account');

  // step 1
  const [email, setEmail] = useState('');
  const [handle, setHandle] = useState('');

  // step 2
  const [teamSlug, setTeamSlug] = useState<string | null>(user?.team_slug ?? null);

  // step 3
  const [firstMoan, setFirstMoan] = useState('');

  const setTeam = useSetTeam();
  const createMoan = useCreateMoan();

  const stepIdx = STEPS.indexOf(step);
  const handleValid = /^[A-Z0-9_]{3,20}$/.test(handle.toUpperCase());
  const emailValid = /.+@.+\..+/.test(email);

  const next = async () => {
    if (step === 'account') setStep('team');
    else if (step === 'team') {
      if (teamSlug && user) {
        try { await setTeam.mutateAsync(teamSlug); } catch {/* ignore in dev */}
      }
      setStep('firstMoan');
    } else if (step === 'firstMoan') {
      if (firstMoan.trim()) {
        try { await createMoan.mutateAsync({
          kind: 'MOAN', text: firstMoan.trim(),
          team_slug: teamSlug ?? undefined,
        }); } catch {/* ignore */}
      }
      setStep('done');
    } else if (step === 'done') {
      onClose();
    }
  };

  const back = () => {
    const i = STEPS.indexOf(step);
    if (i > 0) setStep(STEPS[i - 1]);
  };

  const canContinue =
    step === 'account' ? handleValid && emailValid :
    step === 'team' ? !!teamSlug :
    true;

  return (
    <div className="ob-scrim">
      <div className="ob-card" role="dialog" aria-modal="true">
        {/* Step indicator */}
        <div className="ob-progress">
          {(authEnabled ? STEPS.slice(1, 3) : STEPS.slice(0, 3)).map((s, i) => {
            const visibleIdx = authEnabled ? stepIdx - 1 : stepIdx;
            return <div key={s} className={'ob-progress-bar ' + (visibleIdx >= i ? 'on' : '')} />;
          })}
        </div>

        <div className="ob-header">
          <div className="ob-step-no">
            {step === 'done' ? '✓' :
             `STEP ${authEnabled ? stepIdx : stepIdx + 1} / ${authEnabled ? 2 : 3}`}
          </div>
          <button type="button" onClick={onClose} className="ob-skip"
                   aria-label="Skip onboarding">SKIP →</button>
        </div>

        {step === 'account' && (
          <StepAccount
            email={email} setEmail={setEmail}
            handle={handle} setHandle={setHandle}
            authEnabled={authEnabled}
            handleValid={handleValid} emailValid={emailValid}
          />
        )}
        {step === 'team' && (
          <StepTeam selectedSlug={teamSlug} onPick={setTeamSlug} />
        )}
        {step === 'firstMoan' && (
          <StepFirstMoan text={firstMoan} setText={setFirstMoan} handle={handle || user?.handle || 'fan'} />
        )}
        {step === 'done' && (
          <StepDone handle={handle || user?.handle || 'fan'} />
        )}

        <div className="ob-footer">
          {step !== 'account' && step !== 'done' && !(authEnabled && step === 'team') && (
            <button type="button" onClick={back} className="ob-back">← BACK</button>
          )}
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={next}
            disabled={!canContinue}
            className="ob-next"
          >
            {step === 'firstMoan' && !firstMoan.trim() ? 'SKIP MOAN →'
              : step === 'done' ? 'ENTER THE STADIUM →'
              : 'CONTINUE →'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Step 1 — Account ────────────────────────────────────────────────────────

function StepAccount({
  email, setEmail, handle, setHandle, authEnabled, handleValid, emailValid,
}: {
  email: string; setEmail: (v: string) => void;
  handle: string; setHandle: (v: string) => void;
  authEnabled: boolean;
  handleValid: boolean; emailValid: boolean;
}) {
  return (
    <Body>
      <Headline>PICK A MOANER NAME.</Headline>
      <Subhead>You stay anonymous. The lads back at work never need to know.</Subhead>

      <Field
        label="Your moaner handle"
        hint="3-20 characters · letters, numbers, underscore only"
        ok={handle.length > 0 && handleValid}
        bad={handle.length > 0 && !handleValid}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 22, opacity: 0.6 }}>@</span>
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
            placeholder="MOAN_KING_99"
            maxLength={20}
            className="ob-input"
            style={{ fontFamily: 'var(--font-display)', letterSpacing: '0.04em' }}
            autoFocus
          />
        </div>
      </Field>

      <Field
        label="Email"
        hint={authEnabled ? 'Used for sign-in and important notices only.'
                          : 'Email step is visual in dev — Stack Auth handles real sign-up in prod.'}
        ok={emailValid}
        bad={email.length > 0 && !emailValid}
      >
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="ob-input"
        />
      </Field>

      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink)',
                    opacity: 0.6, marginTop: 16 }}>
        By continuing you confirm you're 13+ and accept our Terms &amp;
        Community Standards.
      </p>
    </Body>
  );
}

// ── Step 2 — Team ───────────────────────────────────────────────────────────

function StepTeam({ selectedSlug, onPick }:
  { selectedSlug: string | null; onPick: (slug: string | null) => void }) {
  const { data: teams = [] } = useTeams();
  const [query, setQuery] = useState('');
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? teams.filter(t =>
          t.name.toLowerCase().includes(q)
          || t.short_name.toLowerCase().includes(q)
          || t.city.toLowerCase().includes(q))
      : teams;
    return list.slice(0, 60);
  }, [teams, query]);
  const selected = selectedSlug ? teams.find(t => t.slug === selectedSlug) ?? null : null;

  return (
    <Body>
      <Headline>WHO DO YOU SUFFER FOR?</Headline>
      <Subhead>Pick the club that ruins your weekends. You can change later but not often.</Subhead>

      {selected && (
        <div className="ob-selected" style={{ background: selected.primary_color }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10,
                          letterSpacing: '0.15em', opacity: 0.85 }}>SELECTED</span>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 30, lineHeight: 1.05 }}>
            {selected.name}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11,
                          letterSpacing: '0.1em', opacity: 0.85 }}>
            {selected.league.toUpperCase()} · {selected.city.toUpperCase()}
          </div>
        </div>
      )}

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Type a team or city…"
        className="ob-input"
        style={{ marginTop: 12 }}
      />

      <div className="ob-team-grid">
        {matches.map(t => {
          const active = selectedSlug === t.slug;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onPick(active ? null : t.slug)}
              className={'ob-team-chip' + (active ? ' active' : '')}
              style={{ ['--tc' as string]: t.primary_color } as CSSProperties}
            >
              <span className="ob-team-dot" style={{ background: t.primary_color }} />
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 14,
                                letterSpacing: '0.02em' }}>{t.name}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9,
                                opacity: 0.6, letterSpacing: '0.05em' }}>
                  {leagueShort(t.league)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </Body>
  );
}

function leagueShort(l: string): string {
  if (l === 'Premier League') return 'PL';
  if (l === 'Championship') return 'CHAMP';
  if (l === 'League One') return 'L1';
  if (l === 'League Two') return 'L2';
  if (l === 'Scottish Premiership') return 'SPL';
  return l;
}

// ── Step 3 — First moan ────────────────────────────────────────────────────

function StepFirstMoan({ text, setText, handle }:
  { text: string; setText: (v: string) => void; handle: string }) {
  const max = 280;
  const remaining = max - text.length;
  const placeholder = `What's ruining your day, @${handle.toUpperCase()}?`;
  return (
    <Body>
      <Headline>FIRST MOAN.</Headline>
      <Subhead>Get one off your chest. (Or skip — you can moan any time.)</Subhead>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        maxLength={max}
        rows={5}
        className="ob-input"
        style={{ fontSize: 18, lineHeight: 1.35, resize: 'vertical', marginTop: 8 }}
      />
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, marginTop: 6,
                      textAlign: 'right',
                      color: remaining < 20 ? 'var(--red)' : 'var(--ink)',
                      opacity: 0.7 }}>{remaining} / {max}</div>
    </Body>
  );
}

// ── Step 4 — Done ──────────────────────────────────────────────────────────

function StepDone({ handle }: { handle: string }) {
  return (
    <Body>
      <div style={{ background: 'var(--red)', color: 'var(--cream)',
                      padding: '4px 10px', display: 'inline-block',
                      fontFamily: 'var(--font-display)', fontSize: 13,
                      letterSpacing: '0.1em', marginBottom: 16,
                      transform: 'rotate(-1deg)' }}>WELCOME TO THE TERRACES</div>
      <Headline>YOU'RE IN, @{handle.toUpperCase()}.</Headline>
      <Subhead>
        The feed is updating every few seconds. Hot takes after every fulltime,
        live threads when your team kicks off, and a brutal weekly leaderboard
        every Sunday.
      </Subhead>
      <ul style={{ paddingLeft: 18, lineHeight: 1.6,
                     fontFamily: 'var(--font-body)', fontSize: 15 }}>
        <li>Tap a fixture under <b>LIVE MOAN-ALONG</b> to join the live thread.</li>
        <li>Roast a rival from any moan card.</li>
        <li>Reactions: 😂 HA / 💯 TRUE / 🤡 CLOWN / 🧂 SEETHE. Use them aggressively.</li>
      </ul>
    </Body>
  );
}

// ── Shared bits ────────────────────────────────────────────────────────────

function Body({ children }: { children: ReactNode }) {
  return <div className="ob-body">{children}</div>;
}
function Headline({ children }: { children: ReactNode }) {
  return <h2 className="ob-headline">{children}</h2>;
}
function Subhead({ children }: { children: ReactNode }) {
  return <p className="ob-subhead">{children}</p>;
}
function Field({ label, hint, ok, bad, children }:
  { label: string; hint?: string; ok?: boolean; bad?: boolean; children: ReactNode }) {
  return (
    <div className="ob-field">
      <div className="ob-field-label">
        {label}
        {ok && <span className="ob-tick">✓</span>}
        {bad && <span className="ob-cross">·</span>}
      </div>
      {children}
      {hint && <div className="ob-field-hint">{hint}</div>}
    </div>
  );
}

