/**
 * Transfer-rumour primitives: composer fields, in-card rendering, and the
 * dedicated TRANSFER ROOM feed page.
 *
 * Rumours are a moan kind — they reuse all of the moan infrastructure
 * (reactions, replies, sharing, moderation) but capture optional structured
 * fields (player, from-team, to-team, fee, source).
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState, type CSSProperties } from 'react';
import { api, type Moan, type Team } from '../lib/api';
import { MoanCard } from './Live';

// ── Composer fields ────────────────────────────────────────────────────────

export function RumourFields({
  teams, player, setPlayer, fromSlug, setFromSlug, toSlug, setToSlug,
  fee, setFee, sourceUrl, setSourceUrl,
}: {
  teams: Team[];
  player: string; setPlayer: (v: string) => void;
  fromSlug: string; setFromSlug: (v: string) => void;
  toSlug: string; setToSlug: (v: string) => void;
  fee: string; setFee: (v: string) => void;
  sourceUrl: string; setSourceUrl: (v: string) => void;
}) {
  const fieldStyle: CSSProperties = {
    flex: 1, minWidth: 120, padding: '6px 10px',
    border: '2px solid var(--ink)', background: 'var(--paper)',
    fontFamily: 'var(--font-mono)', fontSize: 12,
  };
  const labelStyle: CSSProperties = {
    fontFamily: 'var(--font-mono)', fontSize: 10,
    letterSpacing: '0.05em', opacity: 0.6, marginBottom: 2,
  };
  return (
    <div style={{
      background: 'var(--cream-2, #f0ede3)',
      border: '2px solid var(--ink)',
      padding: 10, marginBottom: 10,
      display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
    }}>
      <div style={{ gridColumn: '1 / -1' }}>
        <div style={labelStyle}>👤 PLAYER (e.g. WIRTZ)</div>
        <input type="text" value={player} onChange={e => setPlayer(e.target.value)}
          maxLength={80} placeholder="Florian Wirtz"
          style={{ ...fieldStyle, width: '100%', boxSizing: 'border-box' }} />
      </div>
      <div>
        <div style={labelStyle}>🚪 FROM</div>
        <select value={fromSlug} onChange={e => setFromSlug(e.target.value)}
          style={{ ...fieldStyle, width: '100%' }}>
          <option value="">Anywhere</option>
          {teams.map(t => <option key={t.slug} value={t.slug}>{t.short_name}</option>)}
        </select>
      </div>
      <div>
        <div style={labelStyle}>➡️ TO</div>
        <select value={toSlug} onChange={e => setToSlug(e.target.value)}
          style={{ ...fieldStyle, width: '100%' }}>
          <option value="">Anywhere</option>
          {teams.map(t => <option key={t.slug} value={t.slug}>{t.short_name}</option>)}
        </select>
      </div>
      <div>
        <div style={labelStyle}>💷 FEE</div>
        <input type="text" value={fee} onChange={e => setFee(e.target.value)}
          maxLength={60} placeholder="£75m + add-ons"
          style={{ ...fieldStyle, width: '100%' }} />
      </div>
      <div>
        <div style={labelStyle}>🔗 SOURCE URL</div>
        <input type="url" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)}
          maxLength={300} placeholder="https://x.com/fabrizioromano/..."
          style={{ ...fieldStyle, width: '100%' }} />
      </div>
    </div>
  );
}

// ── In-card transfer banner (rendered inside MoanCard when kind=RUMOUR) ────

export function RumourBanner({ moan }: { moan: Moan }) {
  if (moan.kind !== 'RUMOUR') return null;
  const status = moan.rumour_status; // CONFIRMED | BUSTED | null
  const statusBadge = status === 'CONFIRMED'
    ? { label: '✓ CONFIRMED', bg: 'var(--green, #06a77d)', color: 'var(--cream)' }
    : status === 'BUSTED'
    ? { label: '✗ BUSTED', bg: 'var(--red, #e63946)', color: 'var(--cream)' }
    : { label: '🔮 UNCONFIRMED', bg: 'var(--cream-2, #f0ede3)', color: 'var(--ink)' };
  return (
    <div style={{
      background: 'var(--ink)', color: 'var(--cream)',
      padding: 12, marginBottom: 8,
      display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center',
      fontFamily: 'var(--font-display)', fontSize: 14,
    }}>
      <span style={{
        padding: '3px 8px', background: statusBadge.bg, color: statusBadge.color,
        fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em',
      }}>{statusBadge.label}</span>
      {moan.rumour_player && (
        <span style={{ fontWeight: 700 }}>👤 {moan.rumour_player.toUpperCase()}</span>
      )}
      {(moan.rumour_from || moan.rumour_to) && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6,
                         fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          {moan.rumour_from && (
            <span style={{ color: moan.rumour_from.primary_color ?? 'var(--cream)' }}>
              {moan.rumour_from.short_name}
            </span>
          )}
          {(moan.rumour_from || moan.rumour_to) && <span style={{ opacity: 0.5 }}>→</span>}
          {moan.rumour_to && (
            <span style={{ color: moan.rumour_to.primary_color ?? 'var(--cream)', fontWeight: 700 }}>
              {moan.rumour_to.short_name}
            </span>
          )}
        </span>
      )}
      {moan.rumour_fee && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          💷 {moan.rumour_fee}
        </span>
      )}
      {moan.rumour_source_url && (
        <a href={moan.rumour_source_url} target="_blank" rel="noreferrer"
           style={{ marginLeft: 'auto', color: 'var(--cream)',
                    fontFamily: 'var(--font-mono)', fontSize: 11, opacity: 0.8 }}>
          source ↗
        </a>
      )}
    </div>
  );
}

// ── Transfer Room — filtered feed page ─────────────────────────────────────

export function TransferRoom() {
  const [filter, setFilter] = useState<'all' | 'pending' | 'confirmed' | 'busted'>('all');
  const moans = useQuery({
    queryKey: ['feed', 'rumours'],
    queryFn: () => api.listMoans({ kind: 'RUMOUR', limit: 50 }),
    staleTime: 30_000,
  });
  const filtered = useMemo(() => {
    const data = moans.data ?? [];
    if (filter === 'all') return data;
    if (filter === 'pending') return data.filter(m => !m.rumour_status);
    return data.filter(m => m.rumour_status?.toLowerCase() === filter);
  }, [moans.data, filter]);

  return (
    <div style={{ padding: '8px 0 80px' }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(40px, 8vw, 72px)',
                      lineHeight: 0.95, margin: '0 0 6px', letterSpacing: '-0.02em' }}>
          THE TRANSFER ROOM
        </h1>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, opacity: 0.6, margin: 0 }}>
          EVERY RUMOUR. EVERY FEE. EVERY "HERE WE GO" AND EVERY "BOLLOCKS".
        </p>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
        {[
          { key: 'all', label: 'ALL' },
          { key: 'pending', label: '🔮 UNCONFIRMED' },
          { key: 'confirmed', label: '✓ CONFIRMED' },
          { key: 'busted', label: '✗ BUSTED' },
        ].map(f => (
          <button key={f.key} type="button"
            onClick={() => setFilter(f.key as typeof filter)}
            style={{
              padding: '6px 12px', border: '2px solid var(--ink)',
              background: filter === f.key ? 'var(--ink)' : 'var(--paper)',
              color: filter === f.key ? 'var(--cream)' : 'var(--ink)',
              fontFamily: 'var(--font-display)', fontSize: 12,
              letterSpacing: '0.05em', cursor: 'pointer',
            }}>{f.label}</button>
        ))}
      </div>

      {moans.isLoading && <div style={{ opacity: 0.6 }}>Loading…</div>}
      {!moans.isLoading && filtered.length === 0 && (
        <div style={{ padding: 32, textAlign: 'center', opacity: 0.55,
                       fontFamily: 'var(--font-mono)' }}>
          No rumours yet. Be the first — drop a take.
        </div>
      )}
      {filtered.map(m => <MoanCard key={m.id} moan={m} />)}
    </div>
  );
}
