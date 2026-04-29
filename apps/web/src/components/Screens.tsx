import { useState, useEffect, useMemo, type CSSProperties } from 'react';
import {
  TEAMS, USERS, MOANS, LIVE_THREAD, RIVALRY,
  teamById, userByHandle, fmt,
  type Moan, type Reactions, type Kind,
} from '../data';
import {
  Avatar, Crest, Halftone, Headline, Placeholder, ReactionBar, Stamp, Tag,
} from './Brand';

type ReactionKey = keyof Reactions;

function MoanCard({ moan, intensity }: { moan: Moan; intensity: number }) {
  const team = teamById(moan.team);
  const user = userByHandle(moan.user);
  const target = moan.target ? userByHandle(moan.target) : null;
  const [reacted, setReacted] = useState<ReactionKey | null>(null);
  const [counts, setCounts] = useState<Reactions>(moan.reactions);

  if (!user) return null;

  const react = (k: ReactionKey) => {
    if (reacted === k) return;
    setCounts(c => ({
      ...c,
      [k]: c[k] + 1,
      ...(reacted ? { [reacted]: c[reacted] - 1 } : {}),
    }));
    setReacted(k);
  };

  const kindColor =
    moan.kind === 'ROAST' ? 'var(--red)' :
    moan.kind === 'COPE' ? 'var(--blue)' : 'var(--ink)';

  return (
    <article className="moan-card" data-kind={moan.kind}>
      <div className="moan-tape" />
      <header className="moan-head">
        <div className="moan-head-l">
          <Avatar user={user} size={44} />
          <div className="moan-meta">
            <div className="moan-handle">
              @{user.handle}
              {team && (
                <span className="moan-team-pill" style={{ background: team.primary, color: team.secondary }}>
                  {team.name}
                </span>
              )}
            </div>
            <div className="moan-sub">
              <span>{moan.minsAgo}M AGO</span>
              <span>·</span>
              <span>VIA TERRACE</span>
              {target && (
                <>
                  <span>·</span>
                  <span style={{ color: 'var(--red)' }}>RE: @{target.handle}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="moan-kind-stamp" style={{ background: kindColor }}>{moan.kind}</div>
      </header>

      <div className="moan-body">
        <p
          className="moan-text"
          style={{
            fontSize: intensity > 7 ? 26 : intensity > 4 ? 22 : 18,
            fontWeight: intensity > 6 ? 800 : 600,
          }}
        >
          {moan.text}
        </p>
        {moan.media && (
          <div className="moan-media">
            <Placeholder label={moan.media.label} tone={moan.kind === 'ROAST' ? 'red' : 'ink'} />
          </div>
        )}
        <div className="moan-tags">
          {moan.tags.map(t => <Tag key={t}>{t}</Tag>)}
        </div>
      </div>

      <ReactionBar counts={counts} onReact={react} active={reacted} />
    </article>
  );
}

function ComposerInline({ onCompose }: { onCompose: () => void }) {
  return (
    <button className="composer-inline" onClick={onCompose} type="button">
      <Avatar user={USERS[0]} size={44} />
      <span className="composer-inline-text">WHAT'S RUINING YOUR DAY, FAN?</span>
      <span className="composer-inline-cta">START MOANING →</span>
    </button>
  );
}

export function Feed({
  filter,
  intensity,
  onCompose,
}: {
  filter: string;
  intensity: number;
  onCompose: () => void;
}) {
  const filtered = useMemo(() => {
    if (filter === 'ALL') return MOANS;
    return MOANS.filter(m => {
      const t = teamById(m.team);
      return t?.sport === filter.toLowerCase() || m.kind === filter;
    });
  }, [filter]);

  return (
    <div className="feed">
      <ComposerInline onCompose={onCompose} />
      <div className="feed-divider">
        <span>━━━ FRESH MOANS · UPDATED EVERY 14 SECONDS ━━━</span>
      </div>
      {filtered.map(m => <MoanCard key={m.id} moan={m} intensity={intensity} />)}
      <div className="feed-end">
        <Stamp rotate={-3}>YOU'VE HIT THE BOTTOM, GO MOAN ELSEWHERE</Stamp>
      </div>
    </div>
  );
}

export function Composer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [kind, setKind] = useState<Kind>('MOAN');
  const [team, setTeam] = useState<string>(TEAMS[0].id);
  const [text, setText] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');

  if (!open) return null;
  const max = 280;
  const heat = Math.min(10, Math.floor((text.length / max) * 10));

  const addTag = () => {
    if (!tagInput) return;
    const tag = tagInput.startsWith('#') ? tagInput.toUpperCase() : '#' + tagInput.toUpperCase();
    setTags([...tags, tag]);
    setTagInput('');
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="composer" onClick={e => e.stopPropagation()}>
        <div className="composer-head">
          <h2>FILE A FORMAL MOAN</h2>
          <button className="composer-x" onClick={onClose} type="button">✕</button>
        </div>

        <div className="composer-kind">
          {(['MOAN', 'ROAST', 'COPE', 'BANTER'] as Kind[]).map(k => (
            <button
              key={k}
              type="button"
              className={'composer-kind-btn' + (kind === k ? ' active' : '')}
              onClick={() => setKind(k)}
            >
              {k}
            </button>
          ))}
        </div>

        <div className="composer-team">
          <label>FILING ON BEHALF OF:</label>
          <div className="composer-team-grid">
            {TEAMS.slice(0, 9).map(tt => (
              <button
                key={tt.id}
                type="button"
                className={'composer-team-chip' + (team === tt.id ? ' active' : '')}
                onClick={() => setTeam(tt.id)}
                style={{ ['--tc' as string]: tt.primary } as CSSProperties}
              >
                <Crest team={tt} size={28} />
                <span>{tt.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="composer-textarea-wrap">
          <textarea
            className="composer-textarea"
            placeholder={
              kind === 'ROAST'
                ? 'PUT THEM ON BLAST. NO HOLDS BARRED.'
                : kind === 'COPE'
                ? 'TELL US THE LIE THAT GETS YOU THROUGH THE NIGHT.'
                : 'GET IT ALL OFF YOUR CHEST. EVERY GRIEVANCE.'
            }
            value={text}
            maxLength={max}
            onChange={e => setText(e.target.value)}
          />
          <div className="composer-meter">
            <div className="composer-meter-track">
              <div className="composer-meter-fill" style={{ width: `${(text.length / max) * 100}%` }} />
            </div>
            <span className="composer-meter-label">RAGE LEVEL: {heat}/10 · {text.length}/{max}</span>
          </div>
        </div>

        <div className="composer-tags">
          <label>TAGS</label>
          <div className="composer-tag-row">
            {tags.map(t => (
              <Tag key={t} active onClick={() => setTags(tags.filter(x => x !== t))}>{t} ✕</Tag>
            ))}
            <input
              className="composer-tag-input"
              placeholder="ADD TAG…"
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addTag()}
            />
          </div>
        </div>

        <div className="composer-foot">
          <div className="composer-foot-meta">
            <Stamp rotate={-4} color="var(--red)">PUBLIC · NO TAKEBACKS</Stamp>
          </div>
          <button className="btn-primary" disabled={!text.trim()} type="button">
            FILE MOAN →
          </button>
        </div>
      </div>
    </div>
  );
}

export function Battle() {
  const [round] = useState(2);
  const a = USERS.find(u => u.handle === 'CHAD_NUTMEG')!;
  const b = USERS.find(u => u.handle === 'COPE_LORD_55')!;
  const [votes, setVotes] = useState({ a: 18402, b: 6201 });
  const [voted, setVoted] = useState<'a' | 'b' | null>(null);
  const total = votes.a + votes.b;
  const aPct = (votes.a / total) * 100;

  const exchanges: { side: 'a' | 'b'; text: string }[] = [
    { side: 'a', text: "Mate your team's last trophy was when bread cost 30p. Update your bio. Update your life." },
    { side: 'b', text: "At least my bread is real. Yours is sponsored by 4 shell companies and a casino." },
    { side: 'a', text: "We're sponsored by THE PREMIER LEAGUE TROPHY. Cope harder." },
    { side: 'b', text: "Imagine peaking at trophy lifting and not at, you know, being a person." },
    { side: 'a', text: "I support a club. You support a charity case. Different sports." },
  ];

  const vote = (side: 'a' | 'b') => {
    if (voted) return;
    setVoted(side);
    setVotes(v => ({ ...v, [side]: v[side] + 1 }));
  };

  return (
    <div className="battle">
      <div className="battle-banner">
        <Stamp rotate={-3} color="var(--red)" size={20}>LIVE · ROUND {round}/3</Stamp>
        <Headline size={72}>HEAD-TO-HEAD ROAST BATTLE</Headline>
        <div className="battle-clock">
          <span className="battle-clock-num">02:14</span>
          <span className="battle-clock-lbl">REMAINING</span>
        </div>
      </div>

      <div className="battle-corners">
        <div className={'battle-corner battle-a' + (voted === 'a' ? ' winning' : '')}>
          <Avatar user={a} size={88} />
          <div className="battle-corner-handle">@{a.handle}</div>
          <div className="battle-corner-team">{teamById(a.team)?.name}</div>
          <div className="battle-corner-stat">
            <span>{fmt(a.roastScore)}</span>
            <span>CAREER ROASTS</span>
          </div>
          <button className="btn-primary battle-vote" onClick={() => vote('a')} disabled={!!voted} type="button">
            {voted === 'a' ? '✓ VOTED' : 'VOTE'}
          </button>
        </div>

        <div className="battle-vs">
          <span className="battle-vs-text">VS</span>
        </div>

        <div className={'battle-corner battle-b' + (voted === 'b' ? ' winning' : '')}>
          <Avatar user={b} size={88} />
          <div className="battle-corner-handle">@{b.handle}</div>
          <div className="battle-corner-team">{teamById(b.team)?.name}</div>
          <div className="battle-corner-stat">
            <span>{fmt(b.roastScore)}</span>
            <span>CAREER ROASTS</span>
          </div>
          <button className="btn-primary battle-vote" onClick={() => vote('b')} disabled={!!voted} type="button">
            {voted === 'b' ? '✓ VOTED' : 'VOTE'}
          </button>
        </div>
      </div>

      <div className="battle-bar">
        <div className="battle-bar-fill" style={{ width: `${aPct}%`, background: 'var(--red)' }}>
          <span>{aPct.toFixed(1)}%</span>
        </div>
        <div className="battle-bar-fill" style={{ width: `${100 - aPct}%`, background: 'var(--blue)' }}>
          <span>{(100 - aPct).toFixed(1)}%</span>
        </div>
      </div>

      <div className="battle-exchange">
        <div className="battle-exchange-label">━━━ THE EXCHANGE ━━━</div>
        {exchanges.map((ex, i) => (
          <div key={i} className={'battle-msg battle-msg-' + ex.side}>
            <span className="battle-msg-num">#{i + 1}</span>
            <p>{ex.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Leaderboards() {
  const [board, setBoard] = useState<'moaners' | 'roasters'>('moaners');

  const sorted = useMemo(() => {
    const key = board === 'moaners' ? 'moanScore' : 'roastScore';
    return [...USERS].sort((x, y) => y[key] - x[key]);
  }, [board]);

  const max = sorted[0][board === 'moaners' ? 'moanScore' : 'roastScore'];

  return (
    <div className="leaderboards">
      <div className="leaderboards-head">
        <Headline size={72}>THE WALL OF FAME</Headline>
        <p className="leaderboards-sub">…AND THE WALL OF SHAME, THERE'S NO DIFFERENCE.</p>
      </div>

      <div className="leaderboards-tabs">
        <button
          type="button"
          className={'lb-tab' + (board === 'moaners' ? ' active' : '')}
          onClick={() => setBoard('moaners')}
        >
          BIGGEST MOANERS
        </button>
        <button
          type="button"
          className={'lb-tab' + (board === 'roasters' ? ' active' : '')}
          onClick={() => setBoard('roasters')}
        >
          TOP ROASTERS
        </button>
      </div>

      <div className="leaderboards-list">
        {sorted.map((u, i) => {
          const team = teamById(u.team)!;
          const score = u[board === 'moaners' ? 'moanScore' : 'roastScore'];
          return (
            <div key={u.handle} className={'lb-row' + (i < 3 ? ' lb-row-top' : '')}>
              <div className="lb-rank">{String(i + 1).padStart(2, '0')}</div>
              <Avatar user={u} size={56} />
              <div className="lb-info">
                <div className="lb-handle">@{u.handle}</div>
                <div className="lb-team" style={{ color: team.primary }}>{team.name}</div>
                <div className="lb-badges">
                  {u.badges.map(b => <span key={b} className="lb-badge">{b}</span>)}
                </div>
              </div>
              <div className="lb-bar-wrap">
                <div className="lb-bar" style={{ width: `${(score / max) * 100}%` }} />
                <span className="lb-score">{fmt(score)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Rivalry() {
  const a = teamById(RIVALRY.a)!;
  const b = teamById(RIVALRY.b)!;
  const aFanCount = 158_000;
  const bFanCount = 412_000;

  return (
    <div className="rivalry">
      <div className="rivalry-banner" style={{ background: 'var(--ink)' }}>
        <Halftone color="rgba(230,57,70,0.4)" size={6} opacity={0.5} style={{ position: 'absolute', inset: 0 }} />
        <div className="rivalry-banner-content">
          <div className="rivalry-team rivalry-team-a">
            <Crest team={a} size={120} />
            <div className="rivalry-team-name" style={{ color: 'var(--cream)' }}>{a.name}</div>
            <div className="rivalry-team-city" style={{ color: a.primary }}>{a.city.toUpperCase()}</div>
          </div>
          <div className="rivalry-vs">
            <Headline size={120} color="var(--cream)" shadow="var(--red)">VS</Headline>
            <div className="rivalry-meetings">{RIVALRY.meetings} MEETINGS · ALL TIME</div>
          </div>
          <div className="rivalry-team rivalry-team-b">
            <Crest team={b} size={120} />
            <div className="rivalry-team-name" style={{ color: 'var(--cream)' }}>{b.name}</div>
            <div className="rivalry-team-city" style={{ color: b.primary }}>{b.city.toUpperCase()}</div>
          </div>
        </div>
      </div>

      <div className="rivalry-record">
        <div className="rec-cell"><b>{RIVALRY.aWins}</b><span>{a.name} WINS</span></div>
        <div className="rec-cell"><b>{RIVALRY.draws}</b><span>DRAWS</span></div>
        <div className="rec-cell"><b>{RIVALRY.bWins}</b><span>{b.name} WINS</span></div>
      </div>

      <div className="rivalry-grid">
        <div className="rivalry-card">
          <div className="rivalry-card-label">TROPHY GAP</div>
          <div className="rivalry-trophies">
            <div className="trophy-col">
              <div className="trophy-num" style={{ color: a.primary }}>{RIVALRY.trophyGap.a}</div>
              <div className="trophy-team">{a.name}</div>
              <div className="trophy-row">
                {Array.from({ length: RIVALRY.trophyGap.a }).map((_, i) => <span key={i}>🏆</span>)}
              </div>
            </div>
            <div className="trophy-vs">…</div>
            <div className="trophy-col">
              <div className="trophy-num" style={{ color: b.primary }}>{RIVALRY.trophyGap.b}</div>
              <div className="trophy-team">{b.name}</div>
              <div className="trophy-row trophy-row-many">
                {Array.from({ length: 24 }).map((_, i) => <span key={i}>🏆</span>)}
                <span className="trophy-more">+{RIVALRY.trophyGap.b - 24}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="rivalry-card rivalry-card-quote">
          <div className="rivalry-card-label">MOAN OF THE CENTURY</div>
          <blockquote>"{RIVALRY.biggestMoan.text}"</blockquote>
          <cite>— @{RIVALRY.biggestMoan.user}</cite>
        </div>

        <div className="rivalry-card rivalry-card-quote rivalry-card-roast">
          <div className="rivalry-card-label">ROAST OF THE CENTURY</div>
          <blockquote>"{RIVALRY.biggestRoast.text}"</blockquote>
          <cite>— @{RIVALRY.biggestRoast.user}</cite>
        </div>

        <div className="rivalry-card">
          <div className="rivalry-card-label">FAN DENSITY ON MOANYFANS</div>
          <div className="fan-bars">
            <div className="fan-bar">
              <span className="fan-bar-name">{a.name}</span>
              <div className="fan-bar-track">
                <div className="fan-bar-fill" style={{ width: `${(aFanCount / bFanCount) * 100}%`, background: a.primary }} />
              </div>
              <span className="fan-bar-num">{fmt(aFanCount)}</span>
            </div>
            <div className="fan-bar">
              <span className="fan-bar-name">{b.name}</span>
              <div className="fan-bar-track">
                <div className="fan-bar-fill" style={{ width: '100%', background: b.primary }} />
              </div>
              <span className="fan-bar-num">{fmt(bFanCount)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Profile() {
  const u = USERS[0];
  const team = teamById(u.team)!;

  const stats: { label: string; value: string | number; sub: string }[] = [
    { label: 'TOTAL MOANS', value: 1844, sub: 'LIFETIME' },
    { label: 'AVG. RAGE', value: '8.2', sub: 'OUT OF 10' },
    { label: 'ROAST W/L', value: '124–18', sub: 'UNDEFEATED VS @CHAD_NUTMEG' },
    { label: 'COPIEST TAKE', value: '"4TH IS A TROPHY"', sub: '+421 COPE REACTS' },
    { label: 'STREAK', value: '47 DAYS', sub: 'CONSECUTIVE MOANS' },
    { label: 'PHONE-INS', value: '12', sub: 'ONE WAS ON RADIO' },
  ];

  const monthlyMoans = [12, 19, 8, 24, 31, 18, 9, 14, 38, 22, 41, 28];
  const monthLabels = ['J','F','M','A','M','J','J','A','S','O','N','D'];

  return (
    <div className="profile">
      <div className="profile-header">
        <div className="profile-bg" style={{ background: team.primary }}>
          <Halftone color="rgba(0,0,0,.3)" size={6} style={{ position: 'absolute', inset: 0 }} />
        </div>
        <div className="profile-id">
          <Avatar user={u} size={140} />
          <div className="profile-id-text">
            <div className="profile-handle">@{u.handle}</div>
            <div className="profile-team-line" style={{ color: team.primary }}>
              <Crest team={team} size={28} /> {team.name} · CARD-CARRYING SUFFERER
            </div>
            <div className="profile-badges">
              {u.badges.map(b => <span key={b} className="profile-badge">{b}</span>)}
              <span className="profile-badge">CERTIFIED MOANER · TIER S</span>
            </div>
          </div>
          <button className="btn-primary" type="button">FOLLOW THE PAIN</button>
        </div>
      </div>

      <div className="profile-stats">
        {stats.map(s => (
          <div key={s.label} className="profile-stat">
            <div className="profile-stat-label">{s.label}</div>
            <div className="profile-stat-value">{s.value}</div>
            <div className="profile-stat-sub">{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="profile-chart">
        <div className="profile-chart-head">
          <h3>MOAN OUTPUT · LAST 12 MONTHS</h3>
          <span>+38% YoY</span>
        </div>
        <div className="profile-chart-bars">
          {monthlyMoans.map((v, i) => (
            <div key={i} className="profile-chart-bar-wrap">
              <div className="profile-chart-bar" style={{ height: `${(v / 41) * 100}%` }}>
                <span>{v}</span>
              </div>
              <span className="profile-chart-month">{monthLabels[i]}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="profile-recent">
        <h3>RECENT MOANS</h3>
        {MOANS.filter(m => m.user === u.handle).map(m => (
          <MoanCard key={m.id} moan={m} intensity={7} />
        ))}
      </div>
    </div>
  );
}

export function LiveThread() {
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setPulse(p => p + 1), 1500);
    return () => clearInterval(id);
  }, []);

  const { competition, minute, score, events } = LIVE_THREAD;
  const homeTeam = teamById('fc-grumble');
  const awayTeam = teamById('real-tantrum');

  return (
    <div className="live">
      <div className="live-scoreboard">
        <div className="live-pulse" key={pulse} />
        <div className="live-comp">{competition}</div>
        <div className="live-match">
          <div className="live-team live-team-l">
            <Crest team={homeTeam} size={64} />
            <span className="live-team-name">{homeTeam?.name}</span>
          </div>
          <div className="live-score">
            <span className="live-score-num">{score.home}</span>
            <span className="live-score-sep">—</span>
            <span className="live-score-num">{score.away}</span>
          </div>
          <div className="live-team live-team-r">
            <Crest team={awayTeam} size={64} />
            <span className="live-team-name">{awayTeam?.name}</span>
          </div>
        </div>
        <div className="live-minute">
          <span className="live-dot">●</span> {minute}'
          <span className="live-watching">{fmt(events[events.length - 1].users)} WATCHING & MOANING</span>
        </div>
      </div>

      <div className="live-thread">
        <div className="live-thread-head">
          <Stamp rotate={-2} color="var(--red)">LIVE MOAN-ALONG</Stamp>
          <span>EVERY MINUTE. EVERY MISTAKE. EVERY MELTDOWN.</span>
        </div>

        {[...events].reverse().map((e, i) => (
          <div key={i} className={'live-event' + (e.live ? ' live-event-now' : '')}>
            <div className="live-event-min">{e.min}'</div>
            <div className="live-event-body">
              <p>{e.text}</p>
              <div className="live-event-meta">
                <span>{fmt(e.users)} FANS REACTING</span>
                {e.live && <span className="live-now">● HAPPENING NOW</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
