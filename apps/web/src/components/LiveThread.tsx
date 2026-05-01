import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { ReactionKind, Side, TeamRef } from '../lib/api';
import { useCreateMoan, useFixture, useFixtureThread, useReact } from '../lib/hooks';

// Render the common-knowledge name of a team, not its tabloid nickname.
// "Leeds United" → "Leeds", "Manchester United" → "Man United",
// "Tottenham Hotspur" → "Tottenham", "Brighton & Hove Albion" → "Brighton".
function displayTeam(t: { name: string; short_name: string }): string {
  const n = t.name;
  if (n.startsWith('Manchester ')) return 'Man ' + n.slice(11);
  // Strip common suffixes one at a time
  return n
    .replace(/\s+(United|City|Town|Hotspur|Albion|Wanderers|Rovers|FC|& Hove Albion).*$/i, '')
    .trim() || t.short_name;
}
export type _Display = TeamRef;  // satisfy the import

const SIDE_COLORS: Record<Side, string> = {
  HOME: 'var(--blue)',
  AWAY: 'var(--red)',
  NEUTRAL: 'var(--ink)',
};

export function LiveThread({ fixtureId, onClose }: { fixtureId: string; onClose: () => void }) {
  const fixture = useFixture(fixtureId);
  const [filterSide, setFilterSide] = useState<Side | null>(null);
  const thread = useFixtureThread(fixtureId, filterSide ?? undefined);

  const f = fixture.data;
  const liveStatus = f?.status ?? 'SCHEDULED';
  const minute = f?.minute_estimate ?? 0;

  const sortedItems = useMemo(() => {
    if (!thread.data) return [];
    return [...thread.data].sort((a, b) => {
      if (a.minute !== b.minute) return b.minute - a.minute;
      return b.created_at.localeCompare(a.created_at);
    });
  }, [thread.data]);

  if (fixture.isLoading) return <div style={{ padding: 24 }}>Loading fixture…</div>;
  if (!f) return <div style={{ padding: 24 }}>Fixture not found.</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 180px)', minHeight: 600 }}>
      <ScoreBanner
        homeShort={displayTeam(f.home_team)}
        homePrimary={f.home_team.primary_color}
        awayShort={displayTeam(f.away_team)}
        awayPrimary={f.away_team.primary_color}
        homeScore={f.home_score}
        awayScore={f.away_score}
        status={liveStatus}
        minute={minute}
        period={f.period ?? null}
        competition={f.competition}
        onBack={onClose}
      />

      <div style={{
        display: 'flex', gap: 6, padding: '12px 0',
        flexWrap: 'wrap', borderBottom: '2px solid var(--ink)',
      }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.1em',
                        opacity: 0.6, marginRight: 8, alignSelf: 'center' }}>FILTER:</span>
        {(['ALL', 'HOME', 'AWAY', 'NEUTRAL'] as const).map(opt => {
          const active = (opt === 'ALL' && filterSide === null) || filterSide === opt;
          const colour = opt === 'ALL' ? 'var(--ink)'
            : opt === 'HOME' ? f.home_team.primary_color
            : opt === 'AWAY' ? f.away_team.primary_color
            : 'var(--ink)';
          return (
            <button
              key={opt}
              type="button"
              onClick={() => setFilterSide(opt === 'ALL' ? null : opt as Side)}
              style={{
                fontFamily: 'var(--font-display)', fontSize: 13, letterSpacing: '0.05em',
                padding: '6px 12px',
                background: active ? colour : 'var(--paper)',
                color: active ? 'var(--cream)' : 'var(--ink)',
                border: `2px solid ${colour}`,
                cursor: 'pointer',
              }}
            >
              {opt === 'HOME' ? `HOME (${displayTeam(f.home_team)})`
                : opt === 'AWAY' ? `AWAY (${displayTeam(f.away_team)})`
                : opt}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '12px 0' }}>
        {sortedItems.length === 0 && (
          <div style={{ textAlign: 'center', padding: 32, opacity: 0.6,
                         fontFamily: 'var(--font-mono)', fontSize: 13 }}>
            No moans yet. Be the first to drop one at minute {minute}'.
          </div>
        )}
        {sortedItems.map((item) => (
          <ThreadRow
            key={`${item.type}-${item.moan_id ?? item.created_at}`}
            item={item}
            homeShort={displayTeam(f.home_team)}
            awayShort={displayTeam(f.away_team)}
            homePrimary={f.home_team.primary_color}
            awayPrimary={f.away_team.primary_color}
          />
        ))}
      </div>

      <LiveComposer
        fixtureId={fixtureId}
        homeLabel={displayTeam(f.home_team)}
        awayLabel={displayTeam(f.away_team)}
        homePrimary={f.home_team.primary_color}
        awayPrimary={f.away_team.primary_color}
        homeSlug={f.home_team.slug}
        awaySlug={f.away_team.slug}
      />
    </div>
  );
}

// Composer is intentionally separate so that polling-driven re-renders of the
// parent (score updates, new thread items every 5s) can NEVER blur the
// textarea or wipe what the user is typing. It only re-renders when its own
// state changes or its props change — and those props are stable strings.
const LiveComposer = memo(function LiveComposer({
  fixtureId, homeLabel, awayLabel, homePrimary, awayPrimary, homeSlug, awaySlug,
}: {
  fixtureId: string;
  homeLabel: string; awayLabel: string;
  homePrimary: string; awayPrimary: string;
  homeSlug: string; awaySlug: string;
}) {
  const [side, setSide] = useState<Side>('NEUTRAL');
  const [hasText, setHasText] = useState(false);
  const create = useCreateMoan();
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    ref.current?.focus();
    // DIAGNOSTIC: trace what steals focus from the moan composer.
    const el = ref.current;
    if (!el) return;
    const onBlur = (e: FocusEvent) => {
      const stack = new Error('blur-trace').stack?.split('\n').slice(1, 4).join('\n');
      console.warn('[moan-composer] BLUR', {
        relatedTarget: e.relatedTarget,
        relatedTag: (e.relatedTarget as HTMLElement)?.tagName,
        relatedClass: (e.relatedTarget as HTMLElement)?.className,
        activeElement: document.activeElement?.tagName,
        activeId: (document.activeElement as HTMLElement)?.id,
        time: performance.now().toFixed(0),
        stack,
      });
    };
    const onFocus = () => {
      console.info('[moan-composer] FOCUS', performance.now().toFixed(0));
    };
    el.addEventListener('blur', onBlur);
    el.addEventListener('focus', onFocus);
    // Track if the element gets removed from the DOM while we were typing.
    const mo = new MutationObserver(() => {
      if (!document.contains(el)) {
        console.error('[moan-composer] TEXTAREA REMOVED FROM DOM');
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      el.removeEventListener('blur', onBlur);
      el.removeEventListener('focus', onFocus);
      mo.disconnect();
    };
  }, []);

  const submit = async () => {
    const t = (ref.current?.value ?? '').trim();
    if (!t) return;
    try {
      await create.mutateAsync({
        kind: 'MOAN', text: t, fixture_id: fixtureId, side,
        team_slug: side === 'HOME' ? homeSlug : side === 'AWAY' ? awaySlug : undefined,
      });
      if (ref.current) ref.current.value = '';
      setHasText(false);
    } catch (err) {
      console.error('moan submit failed', err);
    }
  };

  // Render to a stable container in <body> so polling-driven reconciliation
  // of the LiveThread subtree can never touch this textarea's DOM node.
  // Without this the textarea was being detached every 5–10s when the
  // useFixtureThread / useFixture polls fired, blurring the user mid-sentence.
  const portalHost = useMemo(() => {
    let host = document.getElementById('moan-composer-portal');
    if (!host) {
      host = document.createElement('div');
      host.id = 'moan-composer-portal';
      document.body.appendChild(host);
    }
    return host;
  }, []);

  return createPortal(
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0,
      background: 'var(--paper)', borderTop: '4px solid var(--ink)',
      padding: 12, zIndex: 100,
    }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        {(['HOME', 'NEUTRAL', 'AWAY'] as Side[]).map(s => {
          const active = side === s;
          const colour = s === 'HOME' ? homePrimary
            : s === 'AWAY' ? awayPrimary : 'var(--ink)';
          const label = s === 'HOME' ? homeLabel
            : s === 'AWAY' ? awayLabel : 'NEUTRAL';
          return (
            <button key={s} type="button" onClick={() => setSide(s)}
              style={{
                fontFamily: 'var(--font-display)', fontSize: 12, letterSpacing: '0.05em',
                padding: '6px 14px',
                background: active ? colour : 'transparent',
                color: active ? 'var(--cream)' : 'var(--ink)',
                border: `2px solid ${colour}`, cursor: 'pointer',
              }}>POSTING AS {label}</button>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <textarea
          ref={ref}
          name="moan-composer"
          defaultValue=""
          onInput={(e) => setHasText(!!(e.target as HTMLTextAreaElement).value.trim())}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
          }}
          placeholder="Drop your moan… (⌘↵ to send)"
          maxLength={500}
          rows={2}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          data-gramm="false"
          data-gramm_editor="false"
          data-enable-grammarly="false"
          data-lt-active="false"
          data-1p-ignore="true"
          data-lpignore="true"
          data-bwignore="true"
          data-form-type="other"
          style={{
            flex: 1, resize: 'vertical', padding: 10,
            border: '2px solid var(--ink)', background: 'var(--paper)',
            fontFamily: 'var(--font-body)', fontSize: 14,
          }}
        />
        <button type="button" onClick={submit}
          disabled={create.isPending || !hasText}
          style={{
            background: SIDE_COLORS[side], color: 'var(--cream)',
            border: 'none', cursor: 'pointer',
            fontFamily: 'var(--font-display)', fontSize: 16,
            letterSpacing: '0.05em', padding: '0 24px',
            opacity: !hasText || create.isPending ? 0.5 : 1,
          }}>{create.isPending ? '…' : 'MOAN'}</button>
      </div>
    </div>,
    portalHost,
  );
});

function ScoreBanner({
  homeShort, homePrimary, awayShort, awayPrimary,
  homeScore, awayScore, status, minute, period, competition, onBack,
}: {
  homeShort: string; homePrimary: string;
  awayShort: string; awayPrimary: string;
  homeScore: number | null; awayScore: number | null;
  status: string; minute: number;
  period: '1H' | 'HT' | '2H' | 'FT' | null;
  competition: string; onBack: () => void;
}) {
  const liveLabel =
    period === 'HT' ? '⏸ HALF TIME'
    : status === 'LIVE' ? `● LIVE · ${minute}'`
    : status === 'FT' ? 'FULL TIME'
    : 'SCHEDULED';
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr auto 1fr',
      alignItems: 'center', gap: 12,
      padding: 16, border: '4px solid var(--ink)',
      background: 'var(--paper)',
      position: 'sticky', top: 0, zIndex: 5,
    } as CSSProperties}>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10,
                       letterSpacing: '0.15em', opacity: 0.55 }}>HOME</div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 36,
                       color: homePrimary, lineHeight: 1 }}>{homeShort}</div>
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10,
                       letterSpacing: '0.15em', marginBottom: 2,
                       color: period === 'HT' ? 'var(--blue)'
                              : status === 'LIVE' ? 'var(--red)' : 'var(--ink)' }}>
          {liveLabel}
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 48, lineHeight: 1 }}>
          {homeScore ?? '—'} <span style={{ opacity: 0.4 }}>·</span> {awayScore ?? '—'}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10,
                       letterSpacing: '0.1em', opacity: 0.55, marginTop: 4 }}>
          {competition}
        </div>
      </div>
      <div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10,
                       letterSpacing: '0.15em', opacity: 0.55 }}>AWAY</div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 36,
                       color: awayPrimary, lineHeight: 1 }}>{awayShort}</div>
      </div>
      <button
        type="button"
        onClick={onBack}
        style={{
          gridColumn: '1 / -1',
          marginTop: 8,
          background: 'transparent', border: '2px solid var(--ink)',
          padding: '4px 10px', cursor: 'pointer',
          fontFamily: 'var(--font-mono)', fontSize: 11,
          letterSpacing: '0.1em',
        }}
      >← ALL FIXTURES</button>
    </div>
  );
}

function ThreadRow({
  item, homeShort, awayShort, homePrimary, awayPrimary,
}: {
  item: import('../lib/api').ThreadItem;
  homeShort: string; awayShort: string;
  homePrimary: string; awayPrimary: string;
}) {
  if (item.type === 'event') {
    const isGoal = (item.text ?? '').includes('GOAL');
    const isFT = (item.text ?? '').startsWith('FULL TIME');
    const isKO = (item.text ?? '').startsWith('KICK OFF');
    const tone = isGoal ? 'var(--red)' : isFT ? 'var(--ink)' : isKO ? 'var(--blue)' : 'var(--ink)';
    return (
      <div style={{
        display: 'flex', gap: 10, padding: '10px 12px', margin: '6px 0',
        background: tone, color: 'var(--cream)',
        borderLeft: '6px solid var(--ink)',
      }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, minWidth: 38 }}>
          {item.minute}'
        </span>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 16,
                        letterSpacing: '0.03em', flex: 1 }}>{item.text}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9,
                        opacity: 0.7, alignSelf: 'center' }}>{item.source}</span>
      </div>
    );
  }
  const sideColour = item.side === 'HOME' ? homePrimary
    : item.side === 'AWAY' ? awayPrimary
    : 'var(--ink)';
  const sideLabel = item.side === 'HOME' ? homeShort
    : item.side === 'AWAY' ? awayShort
    : 'NEUTRAL';
  return (
    <div style={{
      display: 'flex', gap: 10, padding: '10px 12px', margin: '6px 0',
      background: 'var(--paper)', borderLeft: `4px solid ${sideColour}`,
      border: '1px solid rgba(10,9,8,0.1)',
    }}>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 14,
                      minWidth: 38, color: sideColour }}>{item.minute}'</span>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 4 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 13,
                          color: sideColour }}>@{item.user_handle}</span>
          {item.is_house && (
            <span title="AI conversation starter — not a real fan"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 9,
                            background: 'var(--ink)', color: 'var(--cream)',
                            padding: '1px 5px', letterSpacing: '0.1em' }}>AI</span>
          )}
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9,
                          background: sideColour, color: 'var(--cream)',
                          padding: '1px 5px', letterSpacing: '0.1em' }}>{sideLabel}</span>
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.4 }}>{item.text}</div>
        {item.moan_id && <ThreadReactBar item={item} />}
      </div>
    </div>
  );
}

type ThreadMoan = import("../lib/api").ThreadItem;

const REACTION_LIST: { key: ReactionKind; emoji: string; label: string }[] = [
  { key: "laughs", emoji: "😂", label: "HA" },
  { key: "agrees", emoji: "💯", label: "TRUE" },
  { key: "cope",   emoji: "🤡", label: "CLOWN" },
  { key: "ratio",  emoji: "🧂", label: "SEETHE" },
];

function ThreadReactBar({ item }: { item: ThreadMoan }) {
  const react = useReact(item.moan_id!);
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
      {REACTION_LIST.map(r => {
        const count = (item[r.key] ?? 0) as number;
        const active = item.your_reaction === r.key;
        return (
          <button
            key={r.key}
            type="button"
            disabled={react.isPending}
            onClick={() => react.mutate(active ? null : r.key)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "3px 8px",
              fontFamily: "var(--font-mono)", fontSize: 11,
              border: "1px solid " + (active ? "var(--ink)" : "rgba(10,9,8,0.2)"),
              background: active ? "var(--ink)" : "var(--paper)",
              color: active ? "var(--cream)" : "var(--ink)",
              cursor: react.isPending ? "wait" : "pointer",
            }}
            title={r.label}
          >
            <span>{r.emoji}</span>
            <span>{count}</span>
          </button>
        );
      })}
    </div>
  );
}
