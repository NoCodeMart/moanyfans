/**
 * Poll primitives: composer fields + in-card poll renderer with voting.
 *
 * Polls reuse the moan kind system. Single-choice (radio-style); users can
 * change their vote until the poll closes. Closed polls show final tallies.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type CSSProperties } from 'react';
import { api, type Moan } from '../lib/api';

// ── Composer fields ────────────────────────────────────────────────────────

const DURATIONS: { hours: number; label: string }[] = [
  { hours: 6, label: '6 HOURS' },
  { hours: 24, label: '1 DAY' },
  { hours: 72, label: '3 DAYS' },
  { hours: 168, label: '1 WEEK' },
];

export function PollFields({
  options, setOptions, durationHours, setDurationHours,
}: {
  options: string[]; setOptions: (v: string[]) => void;
  durationHours: number; setDurationHours: (h: number) => void;
}) {
  const setAt = (i: number, v: string) => {
    const next = [...options];
    next[i] = v;
    setOptions(next);
  };
  const add = () => { if (options.length < 4) setOptions([...options, '']); };
  const remove = (i: number) => {
    if (options.length <= 2) return;
    setOptions(options.filter((_, idx) => idx !== i));
  };
  const fieldStyle: CSSProperties = {
    flex: 1, padding: '6px 10px',
    border: '2px solid var(--ink)', background: 'var(--paper)',
    fontFamily: 'var(--font-mono)', fontSize: 13, minWidth: 0,
  };
  return (
    <div style={{
      background: 'var(--cream-2, #f0ede3)',
      border: '2px solid var(--ink)',
      padding: 10, marginBottom: 10,
    }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10,
                     letterSpacing: '0.05em', opacity: 0.6, marginBottom: 6 }}>
        🗳️ POLL OPTIONS (2–4)
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {options.map((opt, i) => (
          <div key={i} style={{ display: 'flex', gap: 6 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12,
                            opacity: 0.5, alignSelf: 'center', width: 18 }}>
              {String.fromCharCode(65 + i)}.
            </span>
            <input type="text" value={opt} onChange={e => setAt(i, e.target.value)}
              maxLength={60} placeholder={`Option ${i + 1}`} style={fieldStyle} />
            {options.length > 2 && (
              <button type="button" onClick={() => remove(i)}
                style={{ padding: '0 8px', background: 'var(--paper)',
                         border: '2px solid var(--ink)', cursor: 'pointer',
                         fontFamily: 'var(--font-mono)', fontSize: 14 }}
                aria-label="Remove option">×</button>
            )}
          </div>
        ))}
      </div>
      {options.length < 4 && (
        <button type="button" onClick={add}
          style={{ marginTop: 8, padding: '4px 10px',
                   background: 'transparent', border: '2px dashed var(--ink)',
                   cursor: 'pointer', fontFamily: 'var(--font-mono)',
                   fontSize: 11, letterSpacing: '0.05em' }}>
          + ADD OPTION
        </button>
      )}
      <div style={{ marginTop: 10 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10,
                       letterSpacing: '0.05em', opacity: 0.6, marginBottom: 4 }}>
          ⏱ POLL CLOSES IN
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {DURATIONS.map(d => (
            <button key={d.hours} type="button"
              onClick={() => setDurationHours(d.hours)}
              style={{
                padding: '4px 10px', border: '2px solid var(--ink)',
                background: durationHours === d.hours ? 'var(--ink)' : 'var(--paper)',
                color: durationHours === d.hours ? 'var(--cream)' : 'var(--ink)',
                fontFamily: 'var(--font-mono)', fontSize: 10,
                letterSpacing: '0.05em', cursor: 'pointer',
              }}>{d.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Poll renderer (inside MoanCard when kind=POLL) ─────────────────────────

export function PollWidget({ moan }: { moan: Moan }) {
  if (moan.kind !== 'POLL' || !moan.poll_options) return null;
  const qc = useQueryClient();
  const [pending, setPending] = useState<number | null>(null);
  const closed = moan.poll_closes_at ? new Date(moan.poll_closes_at) < new Date() : false;
  const total = moan.poll_total_votes ?? 0;
  const yourChoice = moan.poll_your_choice;

  const vote = useMutation({
    mutationFn: (idx: number) => api.votePoll(moan.id, idx),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['feed', 'rumours'] });
      qc.invalidateQueries({ queryKey: ['moan', moan.id] });
      setPending(null);
    },
    onError: () => setPending(null),
  });

  const handleClick = (idx: number) => {
    if (closed || vote.isPending) return;
    setPending(idx);
    vote.mutate(idx);
  };

  const statusLabel = closed
    ? `🔒 CLOSED · ${total} vote${total === 1 ? '' : 's'}`
    : moan.poll_closes_at
    ? `⏱ ${humanCloses(moan.poll_closes_at)} · ${total} vote${total === 1 ? '' : 's'}`
    : `${total} vote${total === 1 ? '' : 's'}`;

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {moan.poll_options.map((opt, i) => {
          const pct = total ? Math.round((opt.votes / total) * 100) : 0;
          const selected = yourChoice === i;
          const showResults = yourChoice !== null && yourChoice !== undefined || closed;
          return (
            <button key={i} type="button"
              onClick={() => handleClick(i)}
              disabled={closed || vote.isPending}
              style={{
                position: 'relative', textAlign: 'left',
                padding: '10px 12px',
                border: `2px solid ${selected ? 'var(--red, #e63946)' : 'var(--ink)'}`,
                background: 'var(--paper)',
                cursor: closed ? 'default' : 'pointer',
                overflow: 'hidden', display: 'block', width: '100%',
                fontFamily: 'var(--font-display)', fontSize: 14,
                opacity: pending === i ? 0.6 : 1,
              }}>
              {showResults && (
                <span style={{
                  position: 'absolute', inset: 0, width: `${pct}%`,
                  background: selected ? 'rgba(230,57,70,0.18)' : 'rgba(0,0,0,0.07)',
                  pointerEvents: 'none',
                }} />
              )}
              <span style={{ position: 'relative', display: 'flex',
                              alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                <span>
                  {selected && '✓ '}
                  {String.fromCharCode(65 + i)}. {opt.label}
                </span>
                {showResults && (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12,
                                  opacity: 0.7 }}>
                    {pct}% · {opt.votes}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <div style={{ marginTop: 6, fontFamily: 'var(--font-mono)', fontSize: 11,
                     opacity: 0.65 }}>
        {statusLabel}
      </div>
    </div>
  );
}

function humanCloses(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms < 0) return 'closed';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h >= 24) return `${Math.floor(h / 24)}d left`;
  if (h >= 1) return `${h}h left`;
  return `${m}m left`;
}
