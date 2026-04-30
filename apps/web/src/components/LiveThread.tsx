import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Side } from '../lib/api';
import { useCreateMoan, useFixture, useFixtureThread } from '../lib/hooks';

const SIDE_COLORS: Record<Side, string> = {
  HOME: 'var(--blue)',
  AWAY: 'var(--red)',
  NEUTRAL: 'var(--ink)',
};

export function LiveThread({ fixtureId, onClose }: { fixtureId: string; onClose: () => void }) {
  const fixture = useFixture(fixtureId);
  const [side, setSide] = useState<Side>('NEUTRAL');
  const [filterSide, setFilterSide] = useState<Side | null>(null);
  const thread = useFixtureThread(fixtureId, filterSide ?? undefined);
  const create = useCreateMoan();
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement | null>(null);

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

  const submit = async () => {
    const t = text.trim();
    if (!t || !f) return;
    try {
      await create.mutateAsync({
        kind: 'MOAN',
        text: t,
        fixture_id: fixtureId,
        side,
        team_slug: side === 'HOME' ? f.home_team.slug : side === 'AWAY' ? f.away_team.slug : undefined,
      });
      setText('');
      thread.refetch();
    } catch (err) {
      console.error('moan submit failed', err);
    }
  };

  useEffect(() => {
    ref.current?.focus();
  }, []);

  if (fixture.isLoading) return <div style={{ padding: 24 }}>Loading fixture…</div>;
  if (!f) return <div style={{ padding: 24 }}>Fixture not found.</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 180px)', minHeight: 600 }}>
      <ScoreBanner
        homeShort={f.home_team.short_name}
        homePrimary={f.home_team.primary_color}
        awayShort={f.away_team.short_name}
        awayPrimary={f.away_team.primary_color}
        homeScore={f.home_score}
        awayScore={f.away_score}
        status={liveStatus}
        minute={minute}
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
              {opt === 'HOME' ? `HOME (${f.home_team.short_name})`
                : opt === 'AWAY' ? `AWAY (${f.away_team.short_name})`
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
            homeShort={f.home_team.short_name}
            awayShort={f.away_team.short_name}
            homePrimary={f.home_team.primary_color}
            awayPrimary={f.away_team.primary_color}
          />
        ))}
      </div>

      <div style={{
        position: 'sticky', bottom: 0,
        background: 'var(--paper)', borderTop: '4px solid var(--ink)',
        padding: 12,
      }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          {(['HOME', 'NEUTRAL', 'AWAY'] as Side[]).map(s => {
            const active = side === s;
            const colour = s === 'HOME' ? f.home_team.primary_color
              : s === 'AWAY' ? f.away_team.primary_color
              : 'var(--ink)';
            const label = s === 'HOME' ? f.home_team.short_name
              : s === 'AWAY' ? f.away_team.short_name
              : 'NEUTRAL';
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSide(s)}
                style={{
                  fontFamily: 'var(--font-display)', fontSize: 12, letterSpacing: '0.05em',
                  padding: '6px 14px',
                  background: active ? colour : 'transparent',
                  color: active ? 'var(--cream)' : 'var(--ink)',
                  border: `2px solid ${colour}`,
                  cursor: 'pointer',
                }}
              >POSTING AS {label}</button>
            );
          })}
          <span style={{ flex: 1 }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, alignSelf: 'center',
                          opacity: 0.7 }}>{liveStatus === 'LIVE' ? `LIVE · ${minute}'` : liveStatus}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <textarea
            ref={ref}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
            }}
            placeholder={`MOAN AT ${minute}'… (⌘↵ to send)`}
            maxLength={500}
            rows={2}
            style={{
              flex: 1, resize: 'vertical', padding: 10,
              border: '2px solid var(--ink)', background: 'var(--paper)',
              fontFamily: 'var(--font-body)', fontSize: 14,
            }}
          />
          <button
            type="button"
            onClick={submit}
            disabled={create.isPending || !text.trim()}
            style={{
              background: SIDE_COLORS[side], color: 'var(--cream)',
              border: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-display)', fontSize: 16,
              letterSpacing: '0.05em',
              padding: '0 24px',
              opacity: !text.trim() || create.isPending ? 0.5 : 1,
            }}
          >{create.isPending ? '…' : 'MOAN'}</button>
        </div>
      </div>
    </div>
  );
}

function ScoreBanner({
  homeShort, homePrimary, awayShort, awayPrimary,
  homeScore, awayScore, status, minute, competition, onBack,
}: {
  homeShort: string; homePrimary: string;
  awayShort: string; awayPrimary: string;
  homeScore: number | null; awayScore: number | null;
  status: string; minute: number;
  competition: string; onBack: () => void;
}) {
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
                       color: status === 'LIVE' ? 'var(--red)' : 'var(--ink)' }}>
          {status === 'LIVE' ? `● LIVE · ${minute}'`
            : status === 'FT' ? 'FULL TIME'
            : 'SCHEDULED'}
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
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9,
                            background: 'var(--ink)', color: 'var(--cream)',
                            padding: '1px 5px', letterSpacing: '0.1em' }}>HOUSE</span>
          )}
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9,
                          background: sideColour, color: 'var(--cream)',
                          padding: '1px 5px', letterSpacing: '0.1em' }}>{sideLabel}</span>
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.4 }}>{item.text}</div>
        {(item.laughs || item.agrees || item.cope || item.ratio) ? (
          <div style={{ display: 'flex', gap: 12, marginTop: 6,
                         fontFamily: 'var(--font-mono)', fontSize: 10, opacity: 0.6 }}>
            {!!item.laughs && <span>😂 {item.laughs}</span>}
            {!!item.agrees && <span>💯 {item.agrees}</span>}
            {!!item.cope && <span>🤡 {item.cope}</span>}
            {!!item.ratio && <span>🧂 {item.ratio}</span>}
          </div>
        ) : null}
      </div>
    </div>
  );
}
