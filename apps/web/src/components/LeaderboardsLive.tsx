/**
 * Live leaderboards — real DB-backed. Three periods × multiple categories.
 *
 * Layout:
 *   - Period toggle (WEEK / MONTH / ALL TIME) at the top
 *   - Hero card: MOAN OF THE [PERIOD] — single biggest moan
 *   - Grid of category cards (Funniest Moaner, Top Hot Taker, Saltiest, etc.)
 *     Each card shows top 5 with score bar; click → expanded view (later).
 */
import { useQuery } from '@tanstack/react-query';
import { useState, type CSSProperties } from 'react';
import {
  api, type LbPeriod, type LbUserMetric,
  type TopMoan, type TopUser,
} from '../lib/api';

const PERIODS: { id: LbPeriod; label: string }[] = [
  { id: 'week', label: 'THIS WEEK' },
  { id: 'month', label: 'THIS MONTH' },
  { id: 'all', label: 'ALL TIME' },
];

type UserCategory = {
  metric: LbUserMetric;
  emoji: string;
  title: string;
  subtitle: string;
  accent: string;
};

const USER_CATEGORIES: UserCategory[] = [
  { metric: 'laughs_received',  emoji: '😂', title: 'FUNNIEST MOANER',
    subtitle: 'Most HA reactions earned', accent: 'var(--yellow, #ffd60a)' },
  { metric: 'agrees_received',  emoji: '💯', title: 'TOP HOT TAKER',
    subtitle: 'Most TRUE reactions earned', accent: 'var(--green, #06a77d)' },
  { metric: 'ratio_received',   emoji: '🧂', title: 'SALTIEST MOANER',
    subtitle: 'Most SEETHE reactions earned', accent: 'var(--red, #e63946)' },
  { metric: 'cope_received',    emoji: '🤡', title: 'CHIEF CLOWN',
    subtitle: 'Most CLOWN reactions earned', accent: 'var(--blue, #3a86ff)' },
  { metric: 'moan_count',       emoji: '🔥', title: 'MOST PROLIFIC',
    subtitle: 'Most moans posted', accent: 'var(--ink)' },
  { metric: 'total_reactions',  emoji: '⚡', title: 'OVERALL CHAMPION',
    subtitle: 'Most reactions, all kinds combined', accent: 'var(--orange, #ff6b1a)' },
];

export function LeaderboardsLive() {
  const [period, setPeriod] = useState<LbPeriod>('week');

  const heroQ = useQuery({
    queryKey: ['lb', 'top-moans', period, 'overall'],
    queryFn: () => api.topMoans(period, 'overall', 1),
    staleTime: 60_000,
  });
  const hero = heroQ.data?.[0];

  return (
    <div style={{ padding: '8px 0 80px' }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(40px, 8vw, 72px)',
                      lineHeight: 0.95, margin: '0 0 6px', letterSpacing: '-0.02em' }}>
          THE WALL OF FAME
        </h1>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, opacity: 0.6, margin: 0 }}>
          …AND THE WALL OF SHAME, THERE'S NO DIFFERENCE.
        </p>
      </div>

      {/* Period toggle */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
        {PERIODS.map(p => (
          <button key={p.id} type="button" onClick={() => setPeriod(p.id)}
            style={{
              padding: '8px 16px', border: '2px solid var(--ink)',
              background: period === p.id ? 'var(--ink)' : 'var(--paper)',
              color: period === p.id ? 'var(--cream)' : 'var(--ink)',
              fontFamily: 'var(--font-display)', fontSize: 13,
              letterSpacing: '0.05em', cursor: 'pointer',
            }}>{p.label}</button>
        ))}
      </div>

      {/* Hero — MOAN OF THE [PERIOD] */}
      <div style={{
        background: 'var(--ink)', color: 'var(--cream)',
        padding: 24, marginBottom: 24,
        boxShadow: '6px 6px 0 var(--red, #e63946)',
      }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11,
                       letterSpacing: '0.2em', opacity: 0.65, marginBottom: 6 }}>
          🏆 MOAN OF THE {period === 'week' ? 'WEEK' : period === 'month' ? 'MONTH' : 'ERA'}
        </div>
        {heroQ.isLoading && <div style={{ opacity: 0.6 }}>Loading…</div>}
        {!heroQ.isLoading && !hero && (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, opacity: 0.6 }}>
            No moans with reactions yet — be the first.
          </div>
        )}
        {hero && <HeroMoan moan={hero} />}
      </div>

      {/* Category grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16,
      }}>
        {USER_CATEGORIES.map(c => (
          <UserBoard key={c.metric} category={c} period={period} />
        ))}
      </div>
    </div>
  );
}

function HeroMoan({ moan }: { moan: TopMoan }) {
  return (
    <>
      <div style={{
        fontFamily: 'var(--font-display)', fontSize: 'clamp(20px, 3vw, 28px)',
        lineHeight: 1.25, margin: '4px 0 14px',
      }}>
        "{moan.text}"
      </div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <SmallAvatar user={moan} size={36} />
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16 }}>
            @{moan.user_handle}
          </div>
          {moan.team_short && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10,
                           opacity: 0.7, color: moan.team_primary ?? undefined }}>
              {moan.team_short}
            </div>
          )}
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 12, fontFamily: 'var(--font-mono)', fontSize: 13 }}>
          <span>😂 {moan.laughs}</span>
          <span>💯 {moan.agrees}</span>
          <span>🤡 {moan.cope}</span>
          <span>🧂 {moan.ratio}</span>
        </div>
      </div>
    </>
  );
}

function UserBoard({ category, period }: { category: UserCategory; period: LbPeriod }) {
  const q = useQuery({
    queryKey: ['lb', 'top-users', period, category.metric],
    queryFn: () => api.topUsers(period, category.metric, 5),
    staleTime: 60_000,
  });
  const data = q.data ?? [];
  const max = data[0]?.score ?? 1;

  return (
    <div style={{
      background: 'var(--paper)', border: '2px solid var(--ink)',
      boxShadow: '3px 3px 0 var(--ink)', padding: 16,
    }}>
      <div style={{ borderLeft: `4px solid ${category.accent}`, paddingLeft: 10, marginBottom: 12 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 16,
                       letterSpacing: '0.02em' }}>
          {category.emoji} {category.title}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10,
                       opacity: 0.65, marginTop: 2 }}>
          {category.subtitle}
        </div>
      </div>
      {q.isLoading && <div style={{ opacity: 0.5, fontFamily: 'var(--font-mono)', fontSize: 12 }}>Loading…</div>}
      {!q.isLoading && data.length === 0 && (
        <div style={{ opacity: 0.5, fontFamily: 'var(--font-mono)', fontSize: 12, padding: '12px 0' }}>
          Nobody yet.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {data.map((u, i) => <UserRow key={u.handle} user={u} rank={i + 1}
                                       max={max} accent={category.accent} />)}
      </div>
    </div>
  );
}

function UserRow({ user, rank, max, accent }: {
  user: TopUser; rank: number; max: number; accent: string;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '4px 0',
    }}>
      <div style={{
        width: 22, fontFamily: 'var(--font-display)', fontSize: 14,
        opacity: rank <= 3 ? 1 : 0.5,
        color: rank === 1 ? accent : 'var(--ink)',
      }}>{rank}</div>
      <SmallAvatar user={user} size={28} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 13,
                       overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          @{user.handle}
        </div>
        <div style={{ position: 'relative', height: 4, background: 'var(--cream-2, #f0ede3)',
                       borderRadius: 2, marginTop: 2 }}>
          <div style={{
            position: 'absolute', inset: 0, width: `${(user.score / max) * 100}%`,
            background: accent, borderRadius: 2,
          }} />
        </div>
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, minWidth: 36, textAlign: 'right' }}>
        {user.score.toLocaleString()}
      </div>
    </div>
  );
}

type AvatarUser = {
  user_handle?: string; handle?: string;
  user_avatar_seed?: string | null; avatar_seed?: string | null;
  user_avatar_style?: string | null; avatar_style?: string | null;
  team_primary?: string | null;
};

function SmallAvatar({ user, size }: { user: AvatarUser; size: number }) {
  const handle = user.user_handle ?? user.handle ?? '';
  const seed = (user.user_avatar_seed ?? user.avatar_seed) || handle;
  const style = user.user_avatar_style ?? user.avatar_style;
  const wrap: CSSProperties = {
    width: size, height: size, display: 'inline-block',
    borderRadius: '50%', overflow: 'hidden',
    border: '2px solid var(--ink)',
    background: user.team_primary ?? 'var(--ink)', flexShrink: 0,
  };
  if (style) {
    const url = `https://api.dicebear.com/9.x/${encodeURIComponent(style)}/svg?seed=${encodeURIComponent(seed)}`;
    return <span style={wrap}><img src={url} alt="" width={size} height={size}
      style={{ display: 'block', width: '100%', height: '100%' }} /></span>;
  }
  const initials = (seed || handle).slice(0, 2).toUpperCase();
  return <span style={{
    ...wrap, display: 'inline-grid', placeItems: 'center',
    color: 'var(--cream)', fontFamily: 'var(--font-display)',
    fontSize: size * 0.42,
  }}>{initials}</span>;
}
