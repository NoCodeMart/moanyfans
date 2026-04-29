/**
 * API-backed components: feed, composer, moan card, teams browser, team picker.
 * The demo-only ones (Battle, Rivalry, Leaderboards, LiveThread) still live in Screens.tsx
 * with dummy data until those features ship in v1.1.
 */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Moan, type ReactionKind, type Team, type UserRef } from '../lib/api';
import { useCurrentUser } from '../lib/auth';
import {
  useCreateMoan, useFeed, useReact, useSetTeam, useTeams, useTrendingTags,
} from '../lib/hooks';

// ── Avatar / Crest helpers (API-shape) ──────────────────────────────────────

function UserAvatar({ user, size = 44, fallbackColor = '#0a0908' }: {
  user: UserRef | { handle: string; team_id?: string | null; avatar_seed?: string | null };
  size?: number;
  fallbackColor?: string;
}) {
  const teams = useTeams().data ?? [];
  const team = user.team_id ? teams.find(t => t.id === user.team_id) : undefined;
  const initials = user.avatar_seed?.slice(0, 2).toUpperCase()
    || user.handle.slice(0, 2).toUpperCase();
  return (
    <span className="avatar" style={{
      width: size, height: size, background: team?.primary_color || fallbackColor,
    }}>
      <span className="avatar-grain" />
      <span className="avatar-init" style={{ fontSize: size * 0.42 }}>{initials}</span>
    </span>
  );
}

function TeamCrest({ team, size = 48 }: { team?: Team | null; size?: number }) {
  if (!team) return null;
  const hash = [...team.id].reduce((a, c) => a + c.charCodeAt(0), 0);
  const shape = hash % 4;
  const stripes = (hash % 3) + 2;
  const stripeColors = [team.primary_color, team.secondary_color];
  const initials = team.name.split(' ').map(w => w[0]).join('').slice(0, 3);
  const cpId = `cp-${team.id}`;
  return (
    <span className="crest" style={{ width: size, height: size }}>
      <svg viewBox="0 0 48 48" width={size} height={size}>
        <defs>
          <clipPath id={cpId}>
            {shape === 0 && <path d="M4 4 H44 V28 Q44 44 24 46 Q4 44 4 28 Z" />}
            {shape === 1 && <circle cx="24" cy="24" r="22" />}
            {shape === 2 && <path d="M24 2 L46 24 L24 46 L2 24 Z" />}
            {shape === 3 && <path d="M24 2 L44 14 L44 34 L24 46 L4 34 L4 14 Z" />}
          </clipPath>
        </defs>
        <g clipPath={`url(#${cpId})`}>
          <rect width="48" height="48" fill={stripeColors[0]} />
          {Array.from({ length: stripes }).map((_, i) => (
            <rect key={i}
              x={(i * 48) / stripes} y="0" width={48 / stripes / 2} height="48"
              fill={stripeColors[1]} opacity="0.85" />
          ))}
          <text x="24" y="30" textAnchor="middle"
            fontFamily="var(--font-display)" fontSize="18" fontWeight="900"
            fill={stripeColors[1]} stroke={stripeColors[0]} strokeWidth="0.5">{initials}</text>
        </g>
        <g fill="none" stroke="var(--ink)" strokeWidth="1.5">
          {shape === 0 && <path d="M4 4 H44 V28 Q44 44 24 46 Q4 44 4 28 Z" />}
          {shape === 1 && <circle cx="24" cy="24" r="22" />}
          {shape === 2 && <path d="M24 2 L46 24 L24 46 L2 24 Z" />}
          {shape === 3 && <path d="M24 2 L44 14 L44 34 L24 46 L4 34 L4 14 Z" />}
        </g>
      </svg>
    </span>
  );
}

// ── Time formatting ─────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  const ms = Date.now() - t;
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'JUST NOW';
  if (m < 60) return `${m}M AGO`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}H AGO`;
  const d = Math.floor(h / 24);
  return `${d}D AGO`;
}

// ── Reaction Bar ────────────────────────────────────────────────────────────

const REACTIONS: { key: ReactionKind; label: string; emoji: string; color: string }[] = [
  { key: 'laughs', label: 'LAUGHS', emoji: 'HA', color: 'var(--yellow)' },
  { key: 'agrees', label: 'AGREES', emoji: '✓', color: 'var(--green, #06a77d)' },
  { key: 'cope',   label: 'COPE',   emoji: '😭', color: 'var(--blue)' },
  { key: 'ratio',  label: 'RATIO',  emoji: 'X', color: 'var(--red)' },
];

function ReactionBar({ moan }: { moan: Moan }) {
  const react = useReact(moan.id);
  return (
    <div className="reactions">
      {REACTIONS.map(r => {
        const active = moan.your_reaction === r.key;
        return (
          <button key={r.key} type="button"
            className={'reaction' + (active ? ' reaction-active' : '')}
            disabled={react.isPending}
            onClick={() => react.mutate(active ? null : r.key)}
            style={{ ['--rc' as string]: r.color } as CSSProperties}>
            <span className="reaction-emoji">{r.emoji}</span>
            <span className="reaction-label">{r.label}</span>
            <span className="reaction-count">{moan[r.key].toLocaleString()}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Share buttons ───────────────────────────────────────────────────────────

function ShareBar({ moan }: { moan: Moan }) {
  const url = `${window.location.origin}/m/${moan.id}`;
  const text = `"${moan.text.slice(0, 140)}${moan.text.length > 140 ? '…' : ''}" — @${moan.user.handle} on Moanyfans`;
  const enc = encodeURIComponent;
  const links: { label: string; href: string; bg: string }[] = [
    { label: 'WHATSAPP',  href: `https://api.whatsapp.com/send?text=${enc(text + ' ' + url)}`, bg: '#25D366' },
    { label: 'X / TWITTER', href: `https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(url)}`, bg: '#000' },
    { label: 'FACEBOOK',  href: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`, bg: '#1877F2' },
    { label: 'REDDIT',    href: `https://www.reddit.com/submit?url=${enc(url)}&title=${enc(text)}`, bg: '#FF4500' },
  ];
  const copy = () => {
    navigator.clipboard.writeText(url).catch(() => {});
  };
  return (
    <div style={{
      display: 'flex', gap: 4, padding: '8px 12px',
      borderTop: '1px dashed var(--rule, #c7bfa9)',
      fontFamily: 'var(--font-display)', fontSize: 11, letterSpacing: '0.05em',
    }}>
      <span style={{ alignSelf: 'center', opacity: 0.6, marginRight: 4 }}>SHARE →</span>
      {links.map(l => (
        <a key={l.label}
           href={l.href} target="_blank" rel="noopener noreferrer"
           style={{
             padding: '4px 8px', background: l.bg, color: '#fff',
             textDecoration: 'none',
           }}>{l.label}</a>
      ))}
      <button type="button" onClick={copy} style={{
        padding: '4px 8px', background: 'var(--ink)', color: 'var(--cream)',
        border: 0, fontFamily: 'inherit', fontSize: 'inherit', letterSpacing: 'inherit', cursor: 'pointer',
      }}>COPY LINK</button>
    </div>
  );
}

// ── MoanCard ────────────────────────────────────────────────────────────────

export function MoanCard({ moan, onOpen }: { moan: Moan; onOpen?: (id: string) => void }) {
  const kindColor =
    moan.kind === 'ROAST' ? 'var(--red)' :
    moan.kind === 'COPE' ? 'var(--blue)' : 'var(--ink)';

  const openSelf = () => {
    if (onOpen) onOpen(moan.id);
    else window.location.assign(`/m/${moan.id}`);
  };

  return (
    <article className="moan-card" data-kind={moan.kind}>
      <div className="moan-tape" />
      <header className="moan-head">
        <div className="moan-head-l">
          <UserAvatar user={moan.user} size={44} />
          <div className="moan-meta">
            <div className="moan-handle">
              @{moan.user.handle}
              {moan.team && (
                <span className="moan-team-pill"
                  style={{ background: moan.team.primary_color, color: moan.team.secondary_color }}>
                  {moan.team.name}
                </span>
              )}
            </div>
            <div className="moan-sub">
              <span>{timeAgo(moan.created_at)}</span>
              <span>·</span>
              <span>VIA TERRACE</span>
              {moan.target_user && (
                <>
                  <span>·</span>
                  <span style={{ color: 'var(--red)' }}>RE: @{moan.target_user.handle}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="moan-kind-stamp" style={{ background: kindColor }}>{moan.kind}</div>
      </header>

      <div className="moan-body">
        <p className="moan-text"
           onClick={openSelf}
           style={{
             fontSize: moan.rage_level > 7 ? 26 : moan.rage_level > 4 ? 22 : 18,
             fontWeight: moan.rage_level > 6 ? 800 : 600,
             cursor: 'pointer',
           }}>
          {moan.text}
        </p>
        {moan.tags.length > 0 && (
          <div className="moan-tags">
            {moan.tags.map(t => (
              <button key={t} className="tag" type="button">{t}</button>
            ))}
          </div>
        )}
      </div>

      <ReactionBar moan={moan} />
      <ShareBar moan={moan} />
    </article>
  );
}

// ── Composer Inline (button on top of feed) ─────────────────────────────────

export function ComposerInline({ onCompose }: { onCompose: () => void }) {
  const { user } = useCurrentUser();
  const placeholder = user ? `WHAT'S RUINING YOUR DAY, @${user.handle}?` : "WHAT'S RUINING YOUR DAY, FAN?";
  return (
    <button className="composer-inline" onClick={onCompose} type="button">
      {user && <UserAvatar user={user as unknown as UserRef} size={44} />}
      <span className="composer-inline-text">{placeholder}</span>
      <span className="composer-inline-cta">START MOANING →</span>
    </button>
  );
}

// ── Single moan permalink view ──────────────────────────────────────────────

export function MoanDetail({ moanId, onBack }: { moanId: string; onBack: () => void }) {
  const { data: moan, isLoading, isError } = useQuery({
    queryKey: ['moan', moanId],
    queryFn: () => api.getMoan(moanId),
  });
  const { data: replies = [] } = useQuery({
    queryKey: ['moan', moanId, 'replies'],
    queryFn: () => api.listReplies(moanId),
    enabled: !!moan,
  });
  return (
    <div className="moan-detail">
      <button type="button" onClick={onBack}
        style={{
          padding: '6px 12px', marginBottom: 16,
          fontFamily: 'var(--font-display)', fontSize: 14,
          background: 'var(--ink)', color: 'var(--cream)', border: 0, cursor: 'pointer',
        }}>← BACK TO FEED</button>
      {isLoading && <div style={{ fontFamily: 'var(--font-mono)' }}>LOADING…</div>}
      {isError && <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--red)' }}>MOAN NOT FOUND</div>}
      {moan && <MoanCard moan={moan} />}
      {replies.length > 0 && (
        <>
          <div className="feed-divider"><span>━━━ REPLIES ({replies.length}) ━━━</span></div>
          {replies.map(r => <MoanCard key={r.id} moan={r} />)}
        </>
      )}
    </div>
  );
}

// ── Feed ────────────────────────────────────────────────────────────────────

type FeedFilter = 'ALL' | 'MOAN' | 'ROAST' | 'COPE' | 'BANTER';
const SPORTS_AVAILABLE = ['football'] as const;

export function Feed({
  filter, onCompose, onOpenMoan,
}: {
  filter: string;
  onCompose: () => void;
  onOpenMoan?: (id: string) => void;
}) {
  const upperFilter = filter.toUpperCase() as FeedFilter;
  const isKindFilter = ['MOAN', 'ROAST', 'COPE', 'BANTER'].includes(upperFilter);
  const isSportFilter = (SPORTS_AVAILABLE as readonly string[]).includes(filter);

  const { data: moans, isLoading, isError, error } = useFeed({
    kind: isKindFilter ? (upperFilter as 'MOAN' | 'ROAST' | 'COPE' | 'BANTER') : undefined,
    sport: isSportFilter ? filter : undefined,
  });

  return (
    <div className="feed">
      <ComposerInline onCompose={onCompose} />
      <div className="feed-divider">
        <span>━━━ FRESH MOANS · UPDATED EVERY 14 SECONDS ━━━</span>
      </div>

      {isLoading && (
        <div style={{
          padding: 32, textAlign: 'center',
          fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink)', opacity: 0.6,
        }}>
          LOADING MOANS…
        </div>
      )}
      {isError && (
        <div style={{
          padding: 32, textAlign: 'center',
          fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--red)',
        }}>
          COULDN'T LOAD FEED — {String((error as Error).message ?? 'unknown')}
        </div>
      )}
      {moans && moans.length === 0 && (
        <div style={{
          padding: 48, textAlign: 'center',
          fontFamily: 'var(--font-display)', fontSize: 24, color: 'var(--ink)',
        }}>
          NO MOANS HERE YET. BE THE FIRST TO MOAN.
        </div>
      )}
      {moans?.map(m => <MoanCard key={m.id} moan={m} onOpen={onOpenMoan} />)}

      {moans && moans.length > 0 && (
        <div className="feed-end">
          <span className="stamp" style={{
            transform: 'rotate(-3deg)', borderColor: 'var(--red)', color: 'var(--red)',
          }}>YOU'VE HIT THE BOTTOM, GO MOAN ELSEWHERE</span>
        </div>
      )}
    </div>
  );
}

// ── Composer modal (POST to API) ────────────────────────────────────────────

const KINDS: { key: 'MOAN' | 'ROAST' | 'COPE' | 'BANTER'; placeholder: string }[] = [
  { key: 'MOAN',   placeholder: 'GET IT ALL OFF YOUR CHEST. EVERY GRIEVANCE.' },
  { key: 'ROAST',  placeholder: 'PUT THEM ON BLAST. NO HOLDS BARRED.' },
  { key: 'COPE',   placeholder: 'TELL US THE LIE THAT GETS YOU THROUGH THE NIGHT.' },
  { key: 'BANTER', placeholder: "DROP THE BANTER. MAKE THEM LAUGH. MAKE THEM CRY." },
];

export function Composer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useCurrentUser();
  const { data: teams = [] } = useTeams();
  const create = useCreateMoan();
  const [kind, setKind] = useState<'MOAN' | 'ROAST' | 'COPE' | 'BANTER'>('MOAN');
  const [teamSlug, setTeamSlug] = useState<string>('');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Default the team selector to the user's team once teams load
  useEffect(() => {
    if (open && !teamSlug && user?.team_slug) setTeamSlug(user.team_slug);
  }, [open, user?.team_slug, teamSlug]);

  if (!open) return null;
  const max = 280;
  const remaining = max - text.length;
  const placeholder = KINDS.find(k => k.key === kind)?.placeholder ?? '';
  const selectedTeam = teamSlug ? teams.find(t => t.slug === teamSlug) ?? null : null;

  const submit = async () => {
    setError(null);
    try {
      const created = await create.mutateAsync({
        kind, text,
        team_slug: teamSlug || undefined,
      });
      if (created.status === 'HELD') {
        setError('Moan held for review. It will publish if approved.');
      } else {
        setText('');
        onClose();
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="composer-scrim" onClick={onClose}>
      <div className="composer-sheet" onClick={e => e.stopPropagation()}
           role="dialog" aria-modal="true" aria-label="Compose a moan">
        {/* Top bar — close + post button (right) */}
        <div className="composer-topbar">
          <button className="composer-close" onClick={onClose} type="button"
                   aria-label="Close composer">✕</button>
          <button
            className="composer-post"
            type="button"
            disabled={!text.trim() || create.isPending}
            onClick={submit}
          >{create.isPending ? '…' : 'MOAN'}</button>
        </div>

        {/* Body: avatar + writeable area */}
        <div className="composer-body">
          {user && <UserAvatar user={user} size={48} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <TeamPicker teams={teams} selected={selectedTeam}
                         onPick={(slug) => setTeamSlug(slug ?? '')} />
            <textarea
              className="composer-input"
              placeholder={placeholder}
              value={text} maxLength={max}
              onChange={e => setText(e.target.value)}
              autoFocus
              rows={4}
            />
          </div>
        </div>

        {error && (
          <div style={{
            margin: '0 16px 8px',
            padding: 10, fontSize: 13,
            background: 'var(--red)', color: 'var(--cream)',
            fontFamily: 'var(--font-mono)',
          }}>{error}</div>
        )}

        {/* Bottom action row: kind chips + counter */}
        <div className="composer-actions">
          <div className="composer-kind-row">
            {KINDS.map(k => (
              <button key={k.key} type="button"
                className={'composer-kind-pill' + (kind === k.key ? ' active' : '')}
                onClick={() => setKind(k.key)}
                title={k.key}>{k.key}</button>
            ))}
          </div>
          <div className="composer-counter" data-warn={remaining < 20 ? '1' : undefined}
                data-over={remaining < 0 ? '1' : undefined}>
            {remaining}
          </div>
        </div>
      </div>
    </div>
  );
}

function TeamPicker({
  teams, selected, onPick,
}: {
  teams: Team[];
  selected: Team | null;
  onPick: (slug: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return teams.slice(0, 10);
    return teams
      .filter(t =>
        t.name.toLowerCase().includes(q)
        || t.short_name.toLowerCase().includes(q)
        || t.city.toLowerCase().includes(q)
        || t.slug.includes(q),
      )
      .slice(0, 12);
  }, [teams, query]);

  if (!open) {
    return (
      <button
        type="button"
        className="composer-team-pill"
        onClick={() => setOpen(true)}
      >
        {selected ? (
          <>
            <span className="composer-team-pill-dot"
                   style={{ background: selected.primary_color }} />
            Posting about <b>{selected.short_name}</b>
            <span style={{ opacity: 0.6, fontSize: 11, marginLeft: 4 }}>· change</span>
          </>
        ) : (
          <span style={{ opacity: 0.6 }}>+ Add a team</span>
        )}
      </button>
    );
  }

  return (
    <div className="composer-team-picker">
      <input
        type="text"
        autoFocus
        className="composer-team-search"
        placeholder="Type a team or city…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { setOpen(false); setQuery(''); }
          if (e.key === 'Enter' && matches[0]) {
            onPick(matches[0].slug); setOpen(false); setQuery('');
          }
        }}
      />
      <div className="composer-team-results">
        {selected && (
          <button
            type="button" className="composer-team-row"
            onClick={() => { onPick(null); setOpen(false); setQuery(''); }}
            style={{ borderBottom: '1px dashed var(--rule)' }}
          >
            <span className="composer-team-pill-dot" style={{ background: 'transparent',
                    border: '2px dashed var(--ink)' }} />
            <span style={{ color: 'var(--red)' }}>Clear team</span>
          </button>
        )}
        {matches.length === 0 && (
          <div style={{ padding: 12, fontFamily: 'var(--font-mono)', fontSize: 12,
                          opacity: 0.6 }}>No teams found.</div>
        )}
        {matches.map(t => (
          <button
            key={t.id} type="button" className="composer-team-row"
            onClick={() => { onPick(t.slug); setOpen(false); setQuery(''); }}
          >
            <span className="composer-team-pill-dot" style={{ background: t.primary_color }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 15 }}>{t.name}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10,
                              opacity: 0.6, letterSpacing: '0.05em' }}>
                {t.league.toUpperCase()} · {t.city.toUpperCase()}
              </div>
            </span>
          </button>
        ))}
      </div>
      <button type="button"
        className="composer-team-cancel"
        onClick={() => { setOpen(false); setQuery(''); }}
      >CANCEL</button>
    </div>
  );
}

// ── Trending Tags Rail (replaces dummy) ─────────────────────────────────────

export function TrendingRail() {
  const { data: tags = [] } = useTrendingTags('all');
  return (
    <div className="aside-card">
      <div className="aside-card-head">
        TRENDING TAGS <small>ALL TIME · BOOTSTRAPPED</small>
      </div>
      <div className="aside-card-body">
        {tags.length === 0 && (
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 11, opacity: 0.5, padding: 8,
          }}>NO TRENDING TAGS YET</div>
        )}
        {tags.map(t => (
          <div key={t.tag} className="trending-row">
            <span className="tag-text">{t.tag}</span>
            <span className="sport">{t.sport ? t.sport.toUpperCase() : '—'}</span>
            <span className="moans">{t.moans.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Teams browser (all 104, grouped by league) ──────────────────────────────

export function TeamsPage({ onPickTeam }: { onPickTeam?: (team: Team) => void }) {
  const { data: teams = [], isLoading } = useTeams();
  const { user } = useCurrentUser();
  const setTeam = useSetTeam();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!query) return teams;
    const q = query.toLowerCase();
    return teams.filter(t =>
      t.name.toLowerCase().includes(q)
      || t.short_name.toLowerCase().includes(q)
      || t.city.toLowerCase().includes(q)
      || t.slug.includes(q)
    );
  }, [teams, query]);

  const grouped = useMemo(() => {
    const g: Record<string, Team[]> = {};
    for (const t of filtered) (g[t.league] ??= []).push(t);
    return g;
  }, [filtered]);

  const leagues = ['Premier League', 'Championship', 'League One', 'League Two', 'Scottish Premiership'];

  return (
    <div className="teams-page">
      <div style={{
        padding: '24px 0', borderBottom: '3px solid var(--ink)', marginBottom: 16,
      }}>
        <h1 className="headline" style={{
          fontSize: 64, color: 'var(--ink)', textShadow: '3px 3px 0 var(--red)', margin: 0,
        }}>EVERY CLUB. EVERY MOAN.</h1>
        <p style={{
          fontFamily: 'var(--font-mono)', fontSize: 12, marginTop: 8, opacity: 0.7,
        }}>{teams.length} CLUBS · {leagues.length} LEAGUES · ENGLAND + WALES + SCOTLAND</p>
      </div>

      <div style={{ marginBottom: 24 }}>
        <input
          placeholder="SEARCH TEAMS…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          style={{
            width: '100%',
            padding: '12px 16px',
            fontFamily: 'var(--font-display)', fontSize: 18, letterSpacing: '0.05em',
            border: '3px solid var(--ink)', background: 'var(--paper)',
            outline: 'none',
          }}
        />
      </div>

      {isLoading && <div style={{ fontFamily: 'var(--font-mono)' }}>LOADING…</div>}

      {leagues.map(league => grouped[league] && grouped[league].length > 0 && (
        <section key={league} style={{ marginBottom: 32 }}>
          <h2 style={{
            fontFamily: 'var(--font-display)', fontSize: 32, lineHeight: 1,
            margin: '0 0 12px', borderBottom: '2px solid var(--ink)', paddingBottom: 8,
          }}>
            {league.toUpperCase()}
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 12, opacity: 0.6,
              marginLeft: 12, letterSpacing: '0.1em',
            }}>{grouped[league].length} CLUBS</span>
          </h2>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 8,
          }}>
            {grouped[league].map(t => {
              const isMine = user?.team_id === t.id;
              return (
                <button key={t.id} type="button"
                  onClick={() => onPickTeam ? onPickTeam(t) : setTeam.mutate(t.slug)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: 10,
                    background: isMine ? t.primary_color : 'var(--paper)',
                    color: isMine ? t.secondary_color : 'var(--ink)',
                    border: `3px solid ${isMine ? 'var(--ink)' : t.primary_color}`,
                    cursor: 'pointer',
                    fontFamily: 'var(--font-display)', fontSize: 13, lineHeight: 1.1,
                    textAlign: 'left',
                  }}>
                  <TeamCrest team={t} size={36} />
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {t.short_name}
                    </div>
                    <div style={{
                      fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.05em',
                      opacity: 0.7,
                    }}>{t.city.toUpperCase()}</div>
                  </div>
                  {isMine && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9 }}>● YOURS</span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

// ── My profile (real /me data) ──────────────────────────────────────────────

export function MeProfile({ onPickTeam }: { onPickTeam: () => void }): ReactNode {
  const { user, authEnabled } = useCurrentUser();
  const { data: teams = [] } = useTeams();
  const myTeam = teams.find(t => t.id === user?.team_id);
  if (!user) {
    return <div style={{ fontFamily: 'var(--font-mono)' }}>LOADING DOSSIER…</div>;
  }
  return (
    <div className="profile" style={{ paddingTop: 16 }}>
      <div className="profile-header" style={{ position: 'relative', minHeight: 200 }}>
        <div className="profile-bg" style={{
          position: 'absolute', inset: 0, background: myTeam?.primary_color ?? 'var(--ink)',
        }}>
          <div className="halftone" style={{
            position: 'absolute', inset: 0,
            backgroundImage: 'radial-gradient(rgba(0,0,0,0.3) 1.2px, transparent 1.4px)',
            backgroundSize: '8px 8px',
          }} />
        </div>
        <div className="profile-id" style={{ position: 'relative', zIndex: 1 }}>
          <UserAvatar user={user as unknown as UserRef} size={140} />
          <div className="profile-id-text">
            <div className="profile-handle">@{user.handle}</div>
            <div className="profile-team-line" style={{ color: myTeam?.primary_color ?? '#fff' }}>
              {myTeam ? <TeamCrest team={myTeam} size={28} /> : null}
              {myTeam ? `${myTeam.name} · CARD-CARRYING SUFFERER` : 'NO TEAM YET — PICK ONE'}
            </div>
            <div style={{ marginTop: 12 }}>
              <button className="btn-primary" onClick={onPickTeam} type="button">
                {myTeam ? 'CHANGE TEAM' : 'PICK YOUR TEAM'}
              </button>
              {!authEnabled && (
                <span style={{
                  marginLeft: 16, fontFamily: 'var(--font-mono)', fontSize: 11, opacity: 0.6,
                }}>AUTH DISABLED · ACTING AS GUEST</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
