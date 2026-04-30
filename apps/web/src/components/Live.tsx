/**
 * API-backed components: feed, composer, moan card, teams browser, team picker.
 * The demo-only ones (Battle, Rivalry, Leaderboards, LiveThread) still live in Screens.tsx
 * with dummy data until those features ship in v1.1.
 */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, mediaUrl, type MediaUpload, type Moan, type ReactionKind, type Team, type UserRef } from '../lib/api';
import { useCurrentUser } from '../lib/auth';
import {
  useCreateMoan, useFeed, useMyMoans, useMyStats, useReact, useSetTeam,
  useTeams, useTrendingTags, useUpdateMe,
} from '../lib/hooks';
import { TeamCrest } from './Crest';
import { currentSubscription, pushSupported, subscribePush, unsubscribePush } from '../lib/push';

// Default handler when a MoanCard is rendered outside the App shell —
// pushes ?u=HANDLE so the App URL listener can open the profile view.
function defaultOpenUser(handle: string) {
  const u = new URL(window.location.href);
  u.searchParams.set('u', handle);
  window.history.pushState({}, '', u.toString());
  window.dispatchEvent(new PopStateEvent('popstate'));
}

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

// DB enum names stay (laughs/agrees/cope/ratio) — only the UI labels + emoji change.
const REACTIONS: { key: ReactionKind; label: string; emoji: string; color: string }[] = [
  { key: 'laughs', label: 'HA',     emoji: '😂', color: 'var(--yellow)' },
  { key: 'agrees', label: 'TRUE',   emoji: '💯', color: 'var(--green, #06a77d)' },
  { key: 'cope',   label: 'CLOWN',  emoji: '🤡', color: 'var(--blue)' },
  { key: 'ratio',  label: 'SEETHE', emoji: '🧂', color: 'var(--red)' },
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
  const [copied, setCopied] = useState(false);

  const hasNativeShare = typeof navigator !== 'undefined'
    && typeof (navigator as Navigator).share === 'function';

  const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches;

  const nativeShare = async () => {
    try {
      await (navigator as Navigator).share({
        title: 'Moanyfans',
        text,
        url,
      });
    } catch {
      // user cancelled or share failed — silent
    }
  };
  const copy = () => {
    navigator.clipboard.writeText(url).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  // Mobile + native share API → single big button → OS share sheet
  if (isMobile && hasNativeShare) {
    return (
      <div style={{
        display: 'flex', gap: 8, padding: '8px 12px', alignItems: 'center',
        borderTop: '1px dashed var(--rule, #c7bfa9)',
      }}>
        <button
          type="button"
          onClick={nativeShare}
          style={{
            flex: 1,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            background: 'var(--ink)', color: 'var(--cream)', border: 0,
            padding: '10px 14px',
            fontFamily: 'var(--font-display)', fontSize: 14, letterSpacing: '0.05em',
            borderRadius: 6, cursor: 'pointer',
          }}
        >
          <ShareIcon /> SHARE
        </button>
        <button type="button" onClick={copy}
          aria-label="Copy link" title={copied ? 'Copied!' : 'Copy link'}
          style={{
            width: 40, height: 40, background: copied ? 'var(--green, #06a77d)' : 'var(--cream-2)',
            color: 'var(--ink)', border: '1.5px solid var(--ink)', borderRadius: 6,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}>{copied ? <CheckIcon /> : <LinkIcon />}</button>
      </div>
    );
  }

  // Desktop / no-native-share → individual brand buttons
  const links: { label: string; href: string; bg: string; icon: ReactNode }[] = [
    { label: 'WhatsApp',  href: `https://api.whatsapp.com/send?text=${enc(text + ' ' + url)}`, bg: '#25D366', icon: <WhatsAppIcon /> },
    { label: 'X',         href: `https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(url)}`, bg: '#000', icon: <XIcon /> },
    { label: 'Facebook',  href: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`, bg: '#1877F2', icon: <FacebookIcon /> },
    { label: 'Reddit',    href: `https://www.reddit.com/submit?url=${enc(url)}&title=${enc(text)}`, bg: '#FF4500', icon: <RedditIcon /> },
  ];
  return (
    <div style={{
      display: 'flex', gap: 6, padding: '8px 12px', alignItems: 'center',
      borderTop: '1px dashed var(--rule, #c7bfa9)',
    }}>
      <span style={{ alignSelf: 'center', opacity: 0.55, marginRight: 4,
                      fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em' }}>SHARE</span>
      {links.map(l => (
        <a key={l.label}
           href={l.href} target="_blank" rel="noopener noreferrer"
           aria-label={`Share on ${l.label}`}
           title={`Share on ${l.label}`}
           style={{
             width: 30, height: 30,
             display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
             background: l.bg, color: '#fff', borderRadius: '50%',
             textDecoration: 'none',
           }}>{l.icon}</a>
      ))}
      <button type="button" onClick={copy}
        aria-label="Copy link" title={copied ? 'Copied!' : 'Copy link'}
        style={{
          width: 30, height: 30, background: copied ? 'var(--green, #06a77d)' : 'var(--ink)',
          color: 'var(--cream)', border: 0, borderRadius: '50%',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        }}>{copied ? <CheckIcon /> : <LinkIcon />}</button>
    </div>
  );
}

const ShareIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
    <polyline points="16 6 12 2 8 6"/>
    <line x1="12" y1="2" x2="12" y2="15"/>
  </svg>
);

// Brand-faithful share icons (current logos as of 2026)
const WhatsAppIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
    <path d="M19.05 4.91A9.82 9.82 0 0 0 12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.91-7.01zM12.05 20.15h-.01a8.23 8.23 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.21 8.21 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.83 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.55-3.7 8.23-8.24 8.23zm4.52-6.16c-.25-.12-1.46-.72-1.69-.8-.23-.08-.39-.12-.56.12-.16.25-.64.8-.78.97-.14.16-.29.18-.54.06-.25-.12-1.04-.38-1.99-1.22-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.39.11-.51.12-.12.25-.29.37-.43.12-.14.16-.25.25-.41.08-.16.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.41-.56-.42h-.48c-.16 0-.43.06-.66.31-.23.25-.86.84-.86 2.06s.88 2.39 1.01 2.55c.12.16 1.74 2.66 4.21 3.73.59.25 1.05.4 1.4.51.59.19 1.13.16 1.55.1.47-.07 1.46-.6 1.66-1.18.21-.58.21-1.07.14-1.18-.06-.11-.22-.17-.47-.29z"/>
  </svg>
);
const XIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
    <path d="M18.244 2H21l-6.553 7.49L22 22h-6.78l-4.78-6.27L4.97 22H2.21l7.014-8.014L2 2h6.93l4.32 5.71L18.244 2zm-2.38 18h1.74L8.21 4H6.36l9.504 16z"/>
  </svg>
);
const FacebookIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
    <path d="M22 12c0-5.52-4.48-10-10-10S2 6.48 2 12c0 4.99 3.66 9.13 8.44 9.88V14.9H7.9V12h2.54V9.8c0-2.51 1.49-3.9 3.78-3.9 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.45 2.9h-2.34v6.98C18.34 21.13 22 16.99 22 12z"/>
  </svg>
);
const RedditIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
    <path d="M22 12.07a2.18 2.18 0 0 0-3.7-1.55c-1.45-1-3.4-1.65-5.55-1.74l1.13-3.55 3.04.66a1.62 1.62 0 1 0 .15-.94l-3.4-.74-1.27 3.96c-2.21.06-4.21.7-5.7 1.71A2.18 2.18 0 1 0 4.36 14a4.27 4.27 0 0 0-.04.6c0 3.06 3.46 5.55 7.73 5.55s7.73-2.49 7.73-5.55c0-.2-.01-.4-.04-.6A2.18 2.18 0 0 0 22 12.07zM7.5 13.5a1.25 1.25 0 1 1 2.5 0 1.25 1.25 0 0 1-2.5 0zm7.84 3.7c-.75.74-2.18 1.07-3.34 1.07s-2.59-.33-3.34-1.07a.4.4 0 0 1 .57-.57c.55.55 1.78.85 2.77.85.99 0 2.22-.3 2.77-.85a.4.4 0 0 1 .57.57zM14 14.75a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5z"/>
  </svg>
);
const LinkIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/>
    <path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>
  </svg>
);
const CheckIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);

// ── MoanCard ────────────────────────────────────────────────────────────────

function defaultOpenTeam(slug: string) {
  const u = new URL(window.location.href);
  u.searchParams.set('team', slug);
  window.history.pushState({}, '', u.toString());
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function defaultOpenTag(slug: string) {
  const u = new URL(window.location.href);
  u.searchParams.set('tag', slug.replace(/^#/, '').toUpperCase());
  window.history.pushState({}, '', u.toString());
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function MoanCard({ moan, onOpen, onOpenUser, onOpenTeam, onOpenTag, onReply }: {
  moan: Moan; onOpen?: (id: string) => void;
  onOpenUser?: (handle: string) => void;
  onOpenTeam?: (slug: string) => void;
  onOpenTag?: (slug: string) => void;
  onReply?: (target: { moanId: string; handle: string }) => void;
}) {
  const kindColor =
    moan.kind === 'ROAST' ? 'var(--red)' : 'var(--ink)';

  const openSelf = () => {
    if (onOpen) onOpen(moan.id);
    else window.location.assign(`/m/${moan.id}`);
  };

  return (
    <article className="moan-card" data-kind={moan.kind}>
      <div className="moan-tape" />
      <header className="moan-head">
        <div className="moan-head-l">
          <button type="button"
            onClick={() => (onOpenUser ?? defaultOpenUser)(moan.user.handle)}
            style={{ background: 'transparent', border: 0, padding: 0, cursor: 'pointer' }}
            aria-label={`Open @${moan.user.handle}`}>
            <UserAvatar user={moan.user} size={44} />
          </button>
          <div className="moan-meta">
            <div className="moan-handle">
              <button type="button"
                       onClick={() => (onOpenUser ?? defaultOpenUser)(moan.user.handle)}
                       style={{
                         background: 'transparent', border: 0, padding: 0, cursor: 'pointer',
                         font: 'inherit', color: 'inherit', letterSpacing: 'inherit',
                       }}>@{moan.user.handle}</button>
              {moan.team && (
                <button type="button"
                  onClick={() => (onOpenTeam ?? defaultOpenTeam)(moan.team!.slug)}
                  className="moan-team-pill"
                  style={{
                    background: moan.team.primary_color,
                    color: moan.team.secondary_color,
                    border: 0, cursor: 'pointer', font: 'inherit',
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}>
                  <TeamCrest team={moan.team} size={20} withInitials={false} />
                  {moan.team.name}
                </button>
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
        {moan.media_path && (
          <a
            href={mediaUrl(moan.media_path) ?? '#'}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'block', marginTop: 12,
              border: '2px solid var(--ink)',
              maxWidth: 540, background: 'var(--ink)',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={mediaUrl(moan.media_path) ?? ''}
              alt=""
              loading="lazy"
              style={{
                display: 'block',
                width: '100%', maxHeight: 480,
                objectFit: 'contain',
                background: 'var(--ink)',
              }}
            />
          </a>
        )}
        {moan.tags.length > 0 && (
          <div className="moan-tags">
            {moan.tags.map(t => (
              <button key={t} className="tag" type="button"
                onClick={() => (onOpenTag ?? defaultOpenTag)(t)}>{t}</button>
            ))}
          </div>
        )}
      </div>

      <ReactionBar moan={moan} />
      <div className="moan-reply-row">
        <button
          type="button"
          className="moan-reply-btn"
          onClick={() => (onReply ?? defaultReply)({ moanId: moan.id, handle: moan.user.handle })}
          aria-label="Reply to this moan"
        >
          <ReplyIcon /> REPLY
          {moan.reply_count > 0 && (
            <span className="moan-reply-count">{moan.reply_count.toLocaleString()}</span>
          )}
        </button>
        <button
          type="button"
          className="moan-reply-open"
          onClick={() => (onOpen ? onOpen(moan.id) : window.location.assign(`/m/${moan.id}`))}
        >
          {moan.reply_count > 0 ? 'OPEN THREAD →' : 'OPEN'}
        </button>
        <DeleteMoanButton moan={moan} />
      </div>
      <ShareBar moan={moan} />
    </article>
  );
}

function defaultReply(target: { moanId: string; handle: string }) {
  // Falls back to opening the moan permalink so the reply composer can be shown there.
  window.location.assign(`/m/${target.moanId}`);
}

const ReplyIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
        strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="9 17 4 12 9 7"/>
    <path d="M20 18v-2a4 4 0 0 0-4-4H4"/>
  </svg>
);

// ── Composer Inline (X-style "What's happening?" at top of feed) ───────────

export function ComposerInline() {
  return (
    <div className="composer-inline-card">
      <ComposerForm variant="inline" />
    </div>
  );
}

// ── Single moan permalink view ──────────────────────────────────────────────

export function MoanDetail({ moanId, onBack, onReply, onOpenUser, onOpenTeam, onOpenTag }: {
  moanId: string;
  onBack: () => void;
  onReply?: (target: { moanId: string; handle: string }) => void;
  onOpenUser?: (handle: string) => void;
  onOpenTeam?: (slug: string) => void;
  onOpenTag?: (slug: string) => void;
}) {
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
      {moan && (
        <MoanCard moan={moan} onReply={onReply}
                   onOpenUser={onOpenUser} onOpenTeam={onOpenTeam} onOpenTag={onOpenTag} />
      )}
      {replies.length > 0 && (
        <>
          <div className="feed-divider"><span>━━━ REPLIES ({replies.length}) ━━━</span></div>
          {replies.map(r => (
            <MoanCard key={r.id} moan={r} onReply={onReply}
                       onOpenUser={onOpenUser} onOpenTeam={onOpenTeam} onOpenTag={onOpenTag} />
          ))}
        </>
      )}
    </div>
  );
}

// ── Feed ────────────────────────────────────────────────────────────────────

type FeedFilter = 'ALL' | 'FOLLOWING' | 'MOAN' | 'ROAST' | 'BANTER';
const SPORTS_AVAILABLE = ['football'] as const;

export function Feed({
  filter, onOpenMoan, onOpenUser, onOpenTeam, onOpenTag, onReply,
}: {
  filter: string;
  onOpenMoan?: (id: string) => void;
  onOpenUser?: (handle: string) => void;
  onOpenTeam?: (slug: string) => void;
  onOpenTag?: (slug: string) => void;
  onReply?: (target: { moanId: string; handle: string }) => void;
}) {
  const upperFilter = filter.toUpperCase() as FeedFilter;
  const isKindFilter = ['MOAN', 'ROAST', 'BANTER'].includes(upperFilter);
  const isSportFilter = (SPORTS_AVAILABLE as readonly string[]).includes(filter);

  const isFollowingFilter = upperFilter === 'FOLLOWING';
  const { data: moans, isLoading, isError, error } = useFeed({
    kind: isKindFilter ? (upperFilter as 'MOAN' | 'ROAST' | 'BANTER') : undefined,
    sport: isSportFilter ? filter : undefined,
    following: isFollowingFilter || undefined,
  });

  return (
    <div className="feed">
      <ComposerInline />
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
      {moans?.map(m => <MoanCard key={m.id} moan={m} onOpen={onOpenMoan} onOpenUser={onOpenUser} onOpenTeam={onOpenTeam} onOpenTag={onOpenTag} onReply={onReply} />)}

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

const KINDS: { key: 'MOAN' | 'ROAST' | 'BANTER'; placeholder: string }[] = [
  { key: 'MOAN',   placeholder: 'GET IT ALL OFF YOUR CHEST. EVERY GRIEVANCE.' },
  { key: 'ROAST',  placeholder: 'PUT THEM ON BLAST. NO HOLDS BARRED.' },
  { key: 'BANTER', placeholder: "DROP THE BANTER. MAKE THEM LAUGH. MAKE THEM CRY." },
];

export function Composer({ open, onClose, replyTo }: {
  open: boolean; onClose: () => void;
  replyTo?: { moanId: string; handle: string } | null;
}) {
  if (!open) return null;
  return (
    <div className="composer-scrim" onClick={onClose}>
      <div className="composer-sheet" onClick={e => e.stopPropagation()}
           role="dialog" aria-modal="true" aria-label="Compose a moan">
        <div className="composer-topbar">
          <button className="composer-close" onClick={onClose} type="button"
                   aria-label="Close composer">✕</button>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11,
                          letterSpacing: '0.1em', opacity: 0.6 }}>
            {replyTo ? `REPLYING TO @${replyTo.handle}` : 'NEW MOAN'}
          </span>
        </div>
        <ComposerForm variant="modal" autoFocus onPosted={onClose} replyTo={replyTo ?? null} />
      </div>
    </div>
  );
}

function DeleteMoanButton({ moan }: { moan: Moan }) {
  const { user } = useCurrentUser();
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: () => api.deleteMoan(moan.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['moan', moan.id] });
      if (moan.parent_moan_id) {
        qc.invalidateQueries({ queryKey: ['moan', moan.parent_moan_id, 'replies'] });
      }
      qc.invalidateQueries({ queryKey: ['fixture-thread'] });
    },
  });
  if (!user || user.handle !== moan.user.handle) return null;
  return (
    <button
      type="button"
      className="moan-delete-btn"
      onClick={() => {
        if (window.confirm('Delete this moan? This cannot be undone.')) del.mutate();
      }}
      disabled={del.isPending}
      aria-label="Delete this moan"
      title="Delete"
    >
      {del.isPending ? '…' : <BinIcon />}
    </button>
  );
}

const BinIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
        strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

function PushToggle() {
  const supported = pushSupported();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supported) return;
    currentSubscription().then(s => setEnabled(!!s)).catch(() => {});
  }, [supported]);

  if (!supported) return null;

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      if (enabled) {
        await unsubscribePush();
        setEnabled(false);
      } else {
        await subscribePush();
        setEnabled(true);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ margin: '12px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
      <button type="button" onClick={toggle} disabled={busy}
        style={{
          fontFamily: 'var(--font-display)', fontSize: 13, letterSpacing: '0.05em',
          padding: '8px 14px',
          background: enabled ? 'var(--ink)' : 'var(--paper)',
          color: enabled ? 'var(--cream)' : 'var(--ink)',
          border: '2px solid var(--ink)', cursor: busy ? 'wait' : 'pointer',
        }}>
        {busy ? '…' : enabled ? '🔔 PUSH ON · TAP TO MUTE' : '🔕 ENABLE PUSH NOTIFICATIONS'}
      </button>
      {error && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--red)' }}>
          {error}
        </span>
      )}
    </div>
  );
}

function MediaPicker({ hasMedia, uploading, onPick }: {
  hasMedia: boolean;
  uploading: boolean;
  onPick: (file: File) => void;
}) {
  const inputId = useMemo(() => `media-${Math.random().toString(36).slice(2, 8)}`, []);
  return (
    <>
      <input
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = '';
        }}
      />
      <label
        htmlFor={inputId}
        className="composer-kind-pill"
        style={{ cursor: uploading ? 'wait' : 'pointer', opacity: hasMedia ? 0.5 : 1 }}
        title={hasMedia ? 'Replace image' : 'Attach image'}
      >
        {uploading ? '…' : (hasMedia ? '🖼 ✓' : '🖼 +')}
      </label>
    </>
  );
}

function ComposerForm({
  variant, autoFocus, onPosted, replyTo,
}: {
  variant: 'inline' | 'modal';
  autoFocus?: boolean;
  onPosted?: () => void;
  replyTo?: { moanId: string; handle: string } | null;
}) {
  const { user } = useCurrentUser();
  const { data: teams = [] } = useTeams();
  const create = useCreateMoan();
  const [kind, setKind] = useState<'MOAN' | 'ROAST' | 'BANTER'>('MOAN');
  const [teamSlug, setTeamSlug] = useState<string>(() => user?.team_slug ?? '');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<boolean>(variant === 'modal');
  const [media, setMedia] = useState<MediaUpload | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!teamSlug && user?.team_slug) setTeamSlug(user.team_slug);
  }, [user?.team_slug, teamSlug]);

  const max = 280;
  const remaining = max - text.length;
  const placeholder = replyTo
    ? `Reply to @${replyTo.handle}…`
    : (variant === 'inline' && !expanded
      ? `What's ruining your day${user ? `, @${user.handle}` : ''}?`
      : (KINDS.find(k => k.key === kind)?.placeholder ?? ''));
  const selectedTeam = teamSlug ? teams.find(t => t.slug === teamSlug) ?? null : null;
  const qc = useQueryClient();

  const submit = async () => {
    setError(null);
    try {
      const created = await create.mutateAsync({
        kind, text,
        team_slug: teamSlug || undefined,
        parent_moan_id: replyTo?.moanId,
        media_path: media?.media_path,
        media_w: media?.media_w,
        media_h: media?.media_h,
        media_mime: media?.media_mime,
      });
      if (replyTo) {
        qc.invalidateQueries({ queryKey: ['moan', replyTo.moanId, 'replies'] });
        qc.invalidateQueries({ queryKey: ['moan', replyTo.moanId] });
      }
      if (created.status === 'HELD') {
        setError('Moan held for review. It will publish if approved.');
      } else {
        setText('');
        setMedia(null);
        setExpanded(variant === 'modal');
        onPosted?.();
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <div className="composer-body">
        {user && <UserAvatar user={user} size={44} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          {expanded && (
            <TeamPicker teams={teams} selected={selectedTeam}
                         onPick={(slug) => setTeamSlug(slug ?? '')} />
          )}
          <textarea
            className="composer-input"
            placeholder={placeholder}
            value={text} maxLength={max}
            onChange={e => setText(e.target.value)}
            onFocus={() => setExpanded(true)}
            autoFocus={autoFocus}
            rows={expanded ? 4 : 2}
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

      {expanded && media && (
        <div style={{ margin: '0 16px 8px', position: 'relative', display: 'inline-block' }}>
          <img
            src={mediaUrl(media.media_path) ?? ''}
            alt="Attached preview"
            style={{
              maxWidth: '100%', maxHeight: 280,
              border: '2px solid var(--ink)',
              display: 'block',
            }}
          />
          <button
            type="button"
            onClick={() => setMedia(null)}
            aria-label="Remove image"
            style={{
              position: 'absolute', top: 6, right: 6,
              background: 'var(--ink)', color: 'var(--cream)', border: 0,
              width: 28, height: 28, cursor: 'pointer',
              fontFamily: 'var(--font-mono)', fontSize: 14,
            }}
          >×</button>
        </div>
      )}

      {expanded && (
        <div className="composer-actions">
          <div className="composer-kind-row">
            {KINDS.map(k => (
              <button key={k.key} type="button"
                className={'composer-kind-pill' + (kind === k.key ? ' active' : '')}
                onClick={() => setKind(k.key)}
                title={k.key}>{k.key}</button>
            ))}
            <MediaPicker
              hasMedia={!!media}
              uploading={uploading}
              onPick={async (file) => {
                setError(null);
                setUploading(true);
                try {
                  const m = await api.uploadMedia(file);
                  setMedia(m);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setUploading(false);
                }
              }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="composer-counter"
                  data-warn={remaining < 20 ? '1' : undefined}
                  data-over={remaining < 0 ? '1' : undefined}>{remaining}</div>
            <button
              className="composer-post"
              type="button"
              disabled={(!text.trim() && !media) || create.isPending || uploading}
              onClick={submit}
            >{create.isPending ? '…' : 'MOAN'}</button>
          </div>
        </div>
      )}
    </>
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
            <TeamCrest team={selected} size={20} withInitials={false} />
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
            <TeamCrest team={t} size={26} />
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
          <button key={t.tag} type="button" className="trending-row"
            onClick={() => defaultOpenTag(t.tag)}
            style={{ background: 'transparent', border: 0, cursor: 'pointer',
                       width: '100%', textAlign: 'left', font: 'inherit',
                       letterSpacing: 'inherit', color: 'inherit' }}>
            <span className="tag-text">{t.tag}</span>
            <span className="sport">{t.sport ? t.sport.toUpperCase() : '—'}</span>
            <span className="moans">{t.moans.toLocaleString()}</span>
          </button>
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

// Wrapper avatar that prefers DiceBear-rendered SVG when the user has set a style.
function ProfileAvatar({ user, size = 140 }:
  { user: { handle: string; team_id?: string | null; avatar_seed?: string | null; avatar_style?: string | null }; size?: number }) {
  const seed = user.avatar_seed || user.handle;
  if (user.avatar_style) {
    const url = `https://api.dicebear.com/9.x/${encodeURIComponent(user.avatar_style)}/svg?seed=${encodeURIComponent(seed)}`;
    return (
      <span style={{
        width: size, height: size, display: 'inline-block',
        borderRadius: '50%', overflow: 'hidden',
        border: '3px solid var(--ink)',
        boxShadow: '4px 4px 0 var(--ink)',
        background: 'var(--cream)',
      }}>
        <img src={url} alt={`@${user.handle} avatar`} width={size} height={size}
              style={{ display: 'block', width: '100%', height: '100%' }} />
      </span>
    );
  }
  return <UserAvatar user={user as unknown as UserRef} size={size} />;
}

export function MeProfile({ onPickTeam }: { onPickTeam: () => void }): ReactNode {
  const { user, authEnabled } = useCurrentUser();
  const { data: teams = [] } = useTeams();
  const stats = useMyStats();
  const myMoans = useMyMoans(20);
  const update = useUpdateMe();
  const [editingBio, setEditingBio] = useState(false);
  const [bioDraft, setBioDraft] = useState('');
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);

  const myTeam = teams.find(t => t.id === user?.team_id);

  if (!user) {
    return <div style={{ fontFamily: 'var(--font-mono)' }}>LOADING DOSSIER…</div>;
  }

  const startEditBio = () => {
    setBioDraft(user.bio ?? '');
    setEditingBio(true);
  };
  const saveBio = async () => {
    try {
      await update.mutateAsync({ bio: bioDraft });
      setEditingBio(false);
    } catch {/* ignore */}
  };

  return (
    <div className="profile-page">
      {/* Banner */}
      <div className="profile-banner" style={{ background: myTeam?.primary_color ?? 'var(--ink)' }}>
        <div className="profile-banner-grain" />
      </div>

      {/* Identity row */}
      <div className="profile-id-row">
        <button type="button" className="profile-avatar-btn"
                 onClick={() => setShowAvatarPicker(true)}
                 aria-label="Change avatar">
          <ProfileAvatar user={user} size={120} />
          <span className="profile-avatar-edit">EDIT</span>
        </button>
        <div className="profile-id-text">
          <div className="profile-handle">@{user.handle}</div>
          <div className="profile-meta">
            {myTeam ? (
              <button type="button"
                onClick={() => defaultOpenTeam(myTeam.slug)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: 'transparent', border: 0, padding: 0, cursor: 'pointer',
                  font: 'inherit', color: 'inherit', letterSpacing: 'inherit',
                }}
              >
                <TeamCrest team={myTeam} size={22} withInitials={false} />
                {myTeam.name}
              </button>
            ) : (<span style={{ opacity: 0.6 }}>No team yet</span>)}
            {user.created_at && (
              <span style={{ opacity: 0.55 }}>· joined {new Date(user.created_at).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</span>
            )}
          </div>
        </div>
        <button className="profile-team-btn" type="button" onClick={onPickTeam}>
          {myTeam ? 'CHANGE TEAM' : 'PICK TEAM'}
        </button>
      </div>

      {/* Bio */}
      <div className="profile-bio">
        {editingBio ? (
          <>
            <textarea
              value={bioDraft}
              onChange={(e) => setBioDraft(e.target.value)}
              maxLength={200}
              rows={3}
              placeholder="Add a one-line bio. Be honest."
              className="profile-bio-input"
            />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, opacity: 0.6 }}>
                {200 - bioDraft.length} / 200
              </span>
              <span style={{ flex: 1 }} />
              <button type="button" onClick={() => setEditingBio(false)} className="profile-btn-ghost">CANCEL</button>
              <button type="button" onClick={saveBio} disabled={update.isPending} className="profile-btn-solid">SAVE</button>
            </div>
          </>
        ) : (
          <div onClick={startEditBio} className="profile-bio-display">
            {user.bio ? user.bio : <span style={{ opacity: 0.55 }}>Add a bio…</span>}
            <span className="profile-bio-edit">edit</span>
          </div>
        )}
      </div>

      {/* Stats row */}
      <div className="profile-stats">
        <Stat label="MOANS" value={stats.data?.moans ?? 0} />
        <Stat label="😂 HA" value={stats.data?.laughs_received ?? 0} colour="var(--yellow)" />
        <Stat label="💯 TRUE" value={stats.data?.agrees_received ?? 0} colour="var(--green, #06a77d)" />
        <Stat label="🤡 CLOWN" value={stats.data?.cope_received ?? 0} colour="var(--blue)" />
        <Stat label="🧂 SEETHE" value={stats.data?.ratio_received ?? 0} colour="var(--red)" />
        <Stat label="STREAK" value={stats.data?.streak_days ?? 0} suffix="d" />
      </div>

      {!authEnabled && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, opacity: 0.5,
                        margin: '8px 0' }}>AUTH DISABLED · ACTING AS GUEST</div>
      )}

      <PushToggle />


      {/* Recent moans */}
      <div className="feed-divider"><span>━━━ YOUR RECENT MOANS ━━━</span></div>
      {myMoans.isLoading && <div style={{ fontFamily: 'var(--font-mono)' }}>LOADING…</div>}
      {!myMoans.isLoading && (myMoans.data?.length ?? 0) === 0 && (
        <div style={{ fontFamily: 'var(--font-mono)', textAlign: 'center', padding: 32, opacity: 0.55 }}>
          NO MOANS YET. GET ONE OFF YOUR CHEST.
        </div>
      )}
      {myMoans.data?.map(m => <MoanCard key={m.id} moan={m} />)}

      {showAvatarPicker && (
        <AvatarPicker user={user}
                       onClose={() => setShowAvatarPicker(false)}
                       onSave={async (style, seed) => {
                         await update.mutateAsync({ avatar_style: style, avatar_seed: seed });
                         setShowAvatarPicker(false);
                       }} />
      )}
    </div>
  );
}

function Stat({ label, value, colour, suffix }:
  { label: string; value: number; colour?: string; suffix?: string }) {
  return (
    <div className="profile-stat">
      <div className="profile-stat-num" style={colour ? { color: colour } : undefined}>
        {value.toLocaleString()}{suffix ?? ''}
      </div>
      <div className="profile-stat-lbl">{label}</div>
    </div>
  );
}

const AVATAR_STYLES = [
  { id: 'avataaars', label: 'AVATAR' },
  { id: 'lorelei', label: 'PORTRAIT' },
  { id: 'bottts', label: 'ROBOT' },
  { id: 'fun-emoji', label: 'EMOJI' },
  { id: 'identicon', label: 'PIXEL' },
  { id: 'thumbs', label: 'THUMB' },
  { id: 'big-smile', label: 'SMILE' },
  { id: 'micah', label: 'SKETCH' },
  { id: 'pixel-art', label: 'RETRO' },
  { id: 'shapes', label: 'SHAPES' },
] as const;

function AvatarPicker({ user, onClose, onSave }: {
  user: { handle: string; avatar_seed: string | null; avatar_style: string | null };
  onClose: () => void;
  onSave: (style: string, seed: string) => Promise<void> | void;
}) {
  const [style, setStyle] = useState<string>(user.avatar_style ?? 'avataaars');
  const [seed, setSeed] = useState<string>(user.avatar_seed ?? user.handle);
  const url = `https://api.dicebear.com/9.x/${encodeURIComponent(style)}/svg?seed=${encodeURIComponent(seed)}`;
  const randomise = () => setSeed(Math.random().toString(36).slice(2, 12));
  return (
    <div className="ob-scrim" onClick={onClose}>
      <div className="ob-card" onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 460, alignSelf: 'center', margin: 'auto' }}>
        <div className="ob-header">
          <div className="ob-step-no">CHANGE AVATAR</div>
          <button type="button" onClick={onClose} className="ob-skip">CLOSE ✕</button>
        </div>
        <div className="ob-body">
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 16 }}>
            <span style={{
              width: 100, height: 100, borderRadius: '50%', overflow: 'hidden',
              border: '3px solid var(--ink)', boxShadow: '4px 4px 0 var(--red)',
              background: 'var(--cream)', display: 'inline-block',
            }}>
              <img src={url} alt="preview" width={100} height={100}
                    style={{ display: 'block', width: '100%', height: '100%' }} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <input
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                placeholder="Seed"
                className="ob-input" style={{ marginBottom: 6 }}
              />
              <button type="button" onClick={randomise} className="profile-btn-ghost"
                       style={{ width: '100%' }}>RANDOMISE</button>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
            {AVATAR_STYLES.map(s => {
              const thumbUrl = `https://api.dicebear.com/9.x/${s.id}/svg?seed=${encodeURIComponent(seed)}`;
              const active = style === s.id;
              return (
                <button
                  key={s.id} type="button"
                  onClick={() => setStyle(s.id)}
                  style={{
                    background: active ? 'var(--ink)' : 'var(--cream)',
                    border: `2px solid ${active ? 'var(--red)' : 'var(--ink)'}`,
                    padding: 4, cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                  }}
                  title={s.label}
                >
                  <img src={thumbUrl} alt={s.label} width={48} height={48}
                        style={{ background: 'var(--cream)' }} />
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.05em',
                    color: active ? 'var(--cream)' : 'var(--ink)',
                  }}>{s.label}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="ob-footer">
          <span style={{ flex: 1 }} />
          <button type="button" onClick={() => onSave(style, seed)} className="ob-next">
            SAVE AVATAR
          </button>
        </div>
      </div>
    </div>
  );
}
