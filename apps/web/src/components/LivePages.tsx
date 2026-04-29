/**
 * Drama screens — real, API-backed: LiveThread (with SSE auto-updates),
 * BattlesList + BattleDetail (challenge + vote + exchange).
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api, type Battle, type BattleMsg, type Fixture, type LiveEvent,
} from '../lib/api';
import { useCurrentUser } from '../lib/auth';
import { LiveThread } from './LiveThread';

// ── Time helpers ────────────────────────────────────────────────────────────
function timeUntil(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms < 0) return 'STARTED';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h >= 24) return `IN ${Math.floor(h / 24)}D ${h % 24}H`;
  if (h >= 1) return `IN ${h}H ${m}M`;
  return `IN ${m}M`;
}

function formatKickoff(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  }).toUpperCase();
}

function timeRemaining(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'TIME UP';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return h > 0 ? `${h}H ${m}M LEFT` : `${m}M ${String(s).padStart(2, '0')}S LEFT`;
}

// ────────────────────────────────────────────────────────────────────────────
// LIVE MOAN-ALONG
// ────────────────────────────────────────────────────────────────────────────

// Display order for league strips — PL first, then EFL tiers, then SPL
const LEAGUE_ORDER = [
  'English Premier League',
  'English League Championship',
  'English League 1',
  'English League 2',
  'Scottish Premiership',
] as const;

const LEAGUE_LABEL: Record<string, string> = {
  'English Premier League':       'PREMIER LEAGUE',
  'English League Championship':  'CHAMPIONSHIP',
  'English League 1':             'LEAGUE ONE',
  'English League 2':             'LEAGUE TWO',
  'Scottish Premiership':         'SCOTTISH PREMIERSHIP',
};

function groupByLeague(fixtures: Fixture[]): Map<string, Fixture[]> {
  const m = new Map<string, Fixture[]>();
  for (const f of fixtures) {
    const arr = m.get(f.competition) ?? [];
    arr.push(f);
    m.set(f.competition, arr);
  }
  return m;
}

export function LiveMoanAlong() {
  const { data: live = [], isLoading } = useQuery({
    queryKey: ['fixtures', 'LIVE'],
    queryFn: () => api.listFixtures({ status: 'LIVE' }),
    refetchInterval: 30_000,
  });
  const { data: upcoming = [] } = useQuery({
    queryKey: ['fixtures', 'SCHEDULED'],
    // limit 100 = full backend cap; covers every upcoming fixture across all leagues
    queryFn: () => api.listFixtures({ status: 'SCHEDULED', limit: 100 }),
  });
  const { data: past = [] } = useQuery({
    queryKey: ['fixtures', 'FT'],
    queryFn: () => api.listFixtures({ status: 'FT', limit: 12 }),
  });

  const [activeId, setActiveId] = useState<string | null>(null);

  // Auto-pick the first live fixture once loaded
  useEffect(() => {
    if (!activeId && live.length > 0) setActiveId(live[0].id);
  }, [live, activeId]);

  if (isLoading) {
    return <div style={{ fontFamily: 'var(--font-mono)' }}>LOADING FIXTURES…</div>;
  }

  const activeFixture = [...live, ...past].find(f => f.id === activeId);
  const upcomingByLeague = groupByLeague(upcoming);
  const pastByLeague = groupByLeague(past);

  // Total upcoming + which leagues are populated
  const populatedLeagues = LEAGUE_ORDER.filter(
    l => (upcomingByLeague.get(l)?.length ?? 0) > 0,
  );

  return (
    <div className="live">
      <div style={{
        padding: '24px 0',
        borderBottom: '3px solid var(--ink)',
        marginBottom: 16,
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
      }}>
        <div>
          <h1 className="headline" style={{
            fontSize: 64, color: 'var(--ink)', textShadow: '3px 3px 0 var(--red)', margin: 0,
          }}>LIVE MOAN-ALONG</h1>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, marginTop: 8, opacity: 0.7 }}>
            EVERY MINUTE. EVERY MISTAKE. EVERY MELTDOWN.
          </p>
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, textAlign: 'right', opacity: 0.7 }}>
          <div>{live.length} LIVE</div>
          <div>{upcoming.length} UPCOMING ACROSS {populatedLeagues.length} LEAGUES</div>
        </div>
      </div>

      {/* Live fixtures (always one strip — usually small, all leagues mixed) */}
      {live.length > 0 && (
        <FixtureStrip
          title="● LIVE NOW" titleColor="var(--red)"
          fixtures={live} activeId={activeId} onPick={setActiveId} pulse
        />
      )}

      {/* Upcoming — one strip per league, in fixed display order */}
      {populatedLeagues.map(league => (
        <FixtureStrip
          key={`up-${league}`}
          title={`UPCOMING · ${LEAGUE_LABEL[league] ?? league.toUpperCase()}`}
          titleColor="var(--ink)"
          fixtures={(upcomingByLeague.get(league) ?? []).slice(0, 30)}
          activeId={null}
          onPick={() => {}}
        />
      ))}

      {/* Recent FT — one strip per league that has finished games to show */}
      {LEAGUE_ORDER.filter(l => (pastByLeague.get(l)?.length ?? 0) > 0).map(league => (
        <FixtureStrip
          key={`ft-${league}`}
          title={`RECENT FT · ${LEAGUE_LABEL[league] ?? league.toUpperCase()}`}
          titleColor="var(--ink)"
          fixtures={(pastByLeague.get(league) ?? []).slice(0, 8)}
          activeId={activeId}
          onPick={setActiveId}
        />
      ))}

      {activeFixture && activeFixture.status === 'LIVE' && (
        <div style={{ marginTop: 24 }}>
          <LiveThread fixtureId={activeFixture.id} onClose={() => setActiveId(null)} />
        </div>
      )}
      {activeFixture && activeFixture.status !== 'LIVE' && (
        <FixtureLiveThread key={activeFixture.id} fixture={activeFixture} />
      )}
    </div>
  );
}

function FixtureStrip({
  title, titleColor, fixtures, activeId, onPick, pulse,
}: {
  title: string;
  titleColor: string;
  fixtures: Fixture[];
  activeId: string | null;
  onPick: (id: string) => void;
  pulse?: boolean;
}) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{
        fontFamily: 'var(--font-display)', fontSize: 20, lineHeight: 1,
        color: titleColor, margin: '0 0 8px',
        animation: pulse ? 'pulseFlash 1.4s infinite' : undefined,
      }}>{title}</h3>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
        {fixtures.map(f => {
          const isActive = activeId === f.id;
          const isLive = f.status === 'LIVE';
          return (
            <button key={f.id} type="button" onClick={() => onPick(f.id)}
              disabled={f.status === 'SCHEDULED'}
              style={{
                minWidth: 240, padding: 12,
                background: isActive ? 'var(--ink)' : 'var(--paper)',
                color: isActive ? 'var(--cream)' : 'var(--ink)',
                border: `3px solid ${isLive ? 'var(--red)' : 'var(--ink)'}`,
                fontFamily: 'var(--font-display)',
                cursor: f.status === 'SCHEDULED' ? 'default' : 'pointer',
                textAlign: 'left',
                opacity: f.status === 'SCHEDULED' ? 0.7 : 1,
              }}>
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em',
                marginBottom: 4, opacity: 0.7,
              }}>
                {f.competition.toUpperCase()}
                {isLive && f.minute_estimate != null && (
                  <span style={{ color: 'var(--red)', marginLeft: 6 }}>● {f.minute_estimate}'</span>
                )}
                {f.status === 'SCHEDULED' && (
                  <span style={{ marginLeft: 6 }}>{timeUntil(f.kickoff_at)}</span>
                )}
                {f.status === 'FT' && <span style={{ marginLeft: 6 }}>FT</span>}
              </div>
              <div style={{ fontSize: 18, lineHeight: 1.05 }}>
                {f.home_team.short_name}
                {f.home_score != null && <strong style={{ marginLeft: 6 }}>{f.home_score}</strong>}
                <span style={{ opacity: 0.5, margin: '0 6px' }}>vs</span>
                {f.away_score != null && <strong style={{ marginRight: 6 }}>{f.away_score}</strong>}
                {f.away_team.short_name}
              </div>
              {f.status === 'SCHEDULED' && (
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, opacity: 0.6, marginTop: 4 }}>
                  {formatKickoff(f.kickoff_at)}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FixtureLiveThread({ fixture }: { fixture: Fixture }) {
  const qc = useQueryClient();
  // Poll the events endpoint every 3s while LIVE, every 30s for FT (rare updates).
  // SSE was buffered by Traefik in production — polling is robust through any proxy
  // and the user-visible lag (≤3s) is fine for a thread that gets ~1 event/minute.
  const { data: events = [] } = useQuery<LiveEvent[]>({
    queryKey: ['fixture-events', fixture.id],
    queryFn: () => api.listFixtureEvents(fixture.id),
    refetchInterval: fixture.status === 'LIVE' ? 3_000 : 30_000,
  });

  // Refresh fixture summary every 15s while live (catches goals/score changes)
  useEffect(() => {
    if (fixture.status !== 'LIVE') return;
    const t = window.setInterval(() => {
      qc.invalidateQueries({ queryKey: ['fixtures', 'LIVE'] });
    }, 15_000);
    return () => clearInterval(t);
  }, [fixture.status, qc]);

  // Events sorted newest first by minute (the API already returns this order)
  const sortedEvents = useMemo(() => {
    return [...events].sort((a, b) => {
      if (b.minute !== a.minute) return b.minute - a.minute;
      return b.created_at.localeCompare(a.created_at);
    });
  }, [events]);

  return (
    <div className="live-thread">
      {/* Scoreboard */}
      <div style={{
        position: 'relative',
        background: 'var(--ink)', color: 'var(--cream)',
        padding: 24, marginBottom: 16,
      }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.15em',
          opacity: 0.7, marginBottom: 8,
        }}>
          {fixture.competition.toUpperCase()}
          {fixture.status === 'LIVE' && fixture.minute_estimate != null && (
            <span style={{ color: 'var(--red)', marginLeft: 12 }}>
              ● LIVE · {fixture.minute_estimate}'
            </span>
          )}
          {fixture.status === 'FT' && <span style={{ marginLeft: 12 }}>FULL TIME</span>}
        </div>
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 24,
        }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{
              fontFamily: 'var(--font-display)', fontSize: 32, lineHeight: 1,
              color: fixture.home_team.primary_color,
            }}>
              {fixture.home_team.name}
            </div>
          </div>
          <div style={{
            fontFamily: 'var(--font-display)', fontSize: 64, lineHeight: 1,
          }}>
            {fixture.home_score ?? 0}<span style={{ opacity: 0.4 }}>—</span>{fixture.away_score ?? 0}
          </div>
          <div>
            <div style={{
              fontFamily: 'var(--font-display)', fontSize: 32, lineHeight: 1,
              color: fixture.away_team.primary_color,
            }}>
              {fixture.away_team.name}
            </div>
          </div>
        </div>
      </div>

      {/* Events feed */}
      <div>
        {sortedEvents.length === 0 && (
          <div style={{
            padding: 32, textAlign: 'center',
            fontFamily: 'var(--font-mono)', opacity: 0.5,
          }}>NO EVENTS YET — STAY MOANED IN.</div>
        )}
        {sortedEvents.map(e => (
          <div key={e.id} style={{
            display: 'grid', gridTemplateColumns: '60px 1fr', gap: 16,
            padding: '16px 0',
            borderBottom: '1px dashed var(--rule, #c7bfa9)',
          }}>
            <div style={{
              fontFamily: 'var(--font-display)', fontSize: 28, lineHeight: 1,
              color: 'var(--red)',
            }}>{e.minute}'</div>
            <div>
              <p style={{
                fontFamily: 'var(--font-body, var(--font-display))', fontSize: 18,
                margin: 0, lineHeight: 1.4,
              }}>{e.text}</p>
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: 10, marginTop: 6, opacity: 0.5,
              }}>{e.source}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// ROAST BATTLES
// ────────────────────────────────────────────────────────────────────────────

export function BattlesPage() {
  const { user } = useCurrentUser();
  const [activeId, setActiveId] = useState<string | null>(null);
  const { data: battles = [], isLoading, refetch } = useQuery({
    queryKey: ['battles'],
    queryFn: () => api.listBattles(),
    refetchInterval: 15_000,
  });
  const [composeOpen, setComposeOpen] = useState(false);

  if (activeId) {
    return <BattleDetail id={activeId} onBack={() => setActiveId(null)} />;
  }

  return (
    <div className="battles-page">
      <div style={{
        padding: '24px 0',
        borderBottom: '3px solid var(--ink)',
        marginBottom: 16,
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
      }}>
        <div>
          <h1 className="headline" style={{
            fontSize: 64, color: 'var(--ink)', textShadow: '3px 3px 0 var(--red)', margin: 0,
          }}>ROAST BATTLES</h1>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, marginTop: 8, opacity: 0.7 }}>
            CHALLENGE A FAN. 48 HOURS. WINNER TAKES THE CARD.
          </p>
        </div>
        {user && (
          <button className="btn-primary" type="button" onClick={() => setComposeOpen(true)}>
            CHALLENGE SOMEONE +
          </button>
        )}
      </div>

      {composeOpen && <ChallengeModal onClose={() => { setComposeOpen(false); refetch(); }} />}

      {isLoading && <div style={{ fontFamily: 'var(--font-mono)' }}>LOADING…</div>}
      {!isLoading && battles.length === 0 && (
        <div style={{
          padding: 48, textAlign: 'center',
          fontFamily: 'var(--font-display)', fontSize: 24, color: 'var(--ink)',
        }}>NO BATTLES IN THE RING. STEP UP, MOANER.</div>
      )}

      <div style={{ display: 'grid', gap: 12 }}>
        {battles.map(b => <BattleCard key={b.id} battle={b} onOpen={() => setActiveId(b.id)} />)}
      </div>
    </div>
  );
}

function BattleCard({ battle: b, onOpen }: { battle: Battle; onOpen: () => void }) {
  const total = b.challenger_votes + b.opponent_votes;
  const cPct = total ? (b.challenger_votes / total) * 100 : 50;
  const isClosed = b.status === 'CLOSED' || b.status === 'EXPIRED';
  const winner = b.winner_id === b.challenger.id ? 'challenger'
                : b.winner_id === b.opponent.id ? 'opponent' : null;
  return (
    <button type="button" onClick={onOpen} style={{
      background: 'var(--paper)', border: '3px solid var(--ink)', padding: 16,
      cursor: 'pointer', textAlign: 'left',
    }}>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em',
        opacity: 0.6, marginBottom: 6,
      }}>
        {b.status} · {isClosed
          ? (winner ? `WINNER: @${b[winner].handle.toUpperCase()}` : 'TIE')
          : timeRemaining(b.expires_at)}
        · {b.message_count} EXCHANGES
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 16 }}>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22 }}>@{b.challenger.handle}</div>
          {b.challenger.team_name && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, opacity: 0.6 }}>
              {b.challenger.team_name}
            </div>
          )}
        </div>
        <div style={{
          fontFamily: 'var(--font-display)', fontSize: 28, color: 'var(--red)',
        }}>VS</div>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22 }}>@{b.opponent.handle}</div>
          {b.opponent.team_name && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, opacity: 0.6 }}>
              {b.opponent.team_name}
            </div>
          )}
        </div>
      </div>
      {/* Vote bar */}
      <div style={{ display: 'flex', height: 24, marginTop: 12 }}>
        <div style={{
          width: `${cPct}%`, background: 'var(--red)', color: 'var(--cream)',
          fontFamily: 'var(--font-mono)', fontSize: 11, padding: '4px 8px',
          textAlign: 'right',
        }}>
          {Math.round(cPct)}% · {b.challenger_votes}
        </div>
        <div style={{
          width: `${100 - cPct}%`, background: 'var(--blue)', color: 'var(--cream)',
          fontFamily: 'var(--font-mono)', fontSize: 11, padding: '4px 8px',
        }}>
          {Math.round(100 - cPct)}% · {b.opponent_votes}
        </div>
      </div>
      {b.topic && (
        <p style={{
          marginTop: 12, fontFamily: 'var(--font-body, serif)', fontStyle: 'italic',
        }}>"{b.topic}"</p>
      )}
    </button>
  );
}

function ChallengeModal({ onClose }: { onClose: () => void }) {
  const [opponent, setOpponent] = useState('');
  const [topic, setTopic] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({ mutationFn: () => api.createBattle(opponent, topic || null) });
  const submit = async () => {
    setError(null);
    try {
      await create.mutateAsync();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="composer" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="composer-head">
          <h2>CHALLENGE A FAN</h2>
          <button className="composer-x" onClick={onClose} type="button">✕</button>
        </div>
        <div style={{ padding: 16 }}>
          <label style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>OPPONENT @HANDLE</label>
          <input
            value={opponent}
            onChange={e => setOpponent(e.target.value.toUpperCase())}
            placeholder="HOT_TAKE_HARRY"
            style={{
              width: '100%', padding: 10, marginTop: 4, marginBottom: 16,
              fontFamily: 'var(--font-display)', fontSize: 18,
              border: '3px solid var(--ink)', background: 'var(--paper)',
            }}
          />
          <label style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>TOPIC (OPTIONAL)</label>
          <input
            value={topic}
            onChange={e => setTopic(e.target.value)}
            placeholder="Whose midfield is more embarrassing"
            maxLength={200}
            style={{
              width: '100%', padding: 10, marginTop: 4,
              fontFamily: 'var(--font-display)', fontSize: 16,
              border: '3px solid var(--ink)', background: 'var(--paper)',
            }}
          />
          {error && (
            <div style={{ marginTop: 12, padding: 8, background: 'var(--red)', color: 'var(--cream)' }}>
              {error}
            </div>
          )}
          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" onClick={onClose}
              style={{ padding: '8px 16px', background: 'var(--paper)', border: '2px solid var(--ink)', cursor: 'pointer' }}>
              CANCEL
            </button>
            <button type="button" className="btn-primary"
              disabled={!opponent.trim() || create.isPending}
              onClick={submit}>
              {create.isPending ? 'CHALLENGING…' : 'THROW DOWN →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BattleDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  const { data: battle } = useQuery({
    queryKey: ['battle', id],
    queryFn: () => api.getBattle(id),
    refetchInterval: 5000,
  });
  const { data: messages = [] } = useQuery({
    queryKey: ['battle', id, 'messages'],
    queryFn: () => api.listBattleMessages(id),
    refetchInterval: 5000,
  });
  const [draft, setDraft] = useState('');
  const post = useMutation({
    mutationFn: () => api.postBattleMessage(id, draft),
    onSuccess: () => {
      setDraft('');
      qc.invalidateQueries({ queryKey: ['battle', id, 'messages'] });
    },
  });
  const vote = useMutation({
    mutationFn: (forUserId: string) => api.voteBattle(id, forUserId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['battle', id] }),
  });

  if (!battle) {
    return <div style={{ fontFamily: 'var(--font-mono)' }}>LOADING BATTLE…</div>;
  }

  const isCombatant = user && (user.id === battle.challenger.id || user.id === battle.opponent.id);
  const total = battle.challenger_votes + battle.opponent_votes;
  const cPct = total ? (battle.challenger_votes / total) * 100 : 50;
  const isClosed = battle.status === 'CLOSED' || battle.status === 'EXPIRED';

  return (
    <div className="battle">
      <button type="button" onClick={onBack}
        style={{
          padding: '6px 12px', marginBottom: 16, fontFamily: 'var(--font-display)',
          background: 'var(--ink)', color: 'var(--cream)', border: 0, cursor: 'pointer',
        }}>← BACK TO BATTLES</button>

      <div className="battle-banner">
        <span className="stamp" style={{
          transform: 'rotate(-3deg)', borderColor: 'var(--red)', color: 'var(--red)',
        }}>{battle.status}{!isClosed ? ` · ${timeRemaining(battle.expires_at)}` : ''}</span>
        <h1 className="headline" style={{ fontSize: 64, margin: '8px 0' }}>
          ROAST BATTLE
        </h1>
        {battle.topic && <p style={{ fontStyle: 'italic', fontSize: 18 }}>"{battle.topic}"</p>}
      </div>

      {/* Corners */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 60px 1fr', alignItems: 'center', gap: 16,
        margin: '16px 0',
      }}>
        <Corner side="challenger" battle={battle}
          isWinner={battle.winner_id === battle.challenger.id}
          canVote={!isCombatant && !isClosed}
          isMyVote={battle.your_vote === battle.challenger.id}
          onVote={() => vote.mutate(battle.challenger.id)} />
        <div style={{
          fontFamily: 'var(--font-display)', fontSize: 48, color: 'var(--red)', textAlign: 'center',
        }}>VS</div>
        <Corner side="opponent" battle={battle}
          isWinner={battle.winner_id === battle.opponent.id}
          canVote={!isCombatant && !isClosed}
          isMyVote={battle.your_vote === battle.opponent.id}
          onVote={() => vote.mutate(battle.opponent.id)} />
      </div>

      {/* Vote bar */}
      <div style={{ display: 'flex', height: 32, margin: '8px 0' }}>
        <div style={{
          width: `${cPct}%`, background: 'var(--red)', color: 'var(--cream)',
          fontFamily: 'var(--font-mono)', padding: 8, textAlign: 'right',
        }}>{cPct.toFixed(1)}% · {battle.challenger_votes}</div>
        <div style={{
          width: `${100 - cPct}%`, background: 'var(--blue)', color: 'var(--cream)',
          fontFamily: 'var(--font-mono)', padding: 8,
        }}>{(100 - cPct).toFixed(1)}% · {battle.opponent_votes}</div>
      </div>

      {/* Exchange */}
      <div style={{
        marginTop: 24,
        padding: 16,
        border: '3px solid var(--ink)',
        background: 'var(--paper)',
      }}>
        <div className="feed-divider"><span>━━━ THE EXCHANGE ({messages.length}) ━━━</span></div>
        {messages.length === 0 && (
          <div style={{
            padding: 24, textAlign: 'center', fontFamily: 'var(--font-mono)', opacity: 0.5,
          }}>NO PUNCHES THROWN YET.</div>
        )}
        {messages.map((m, i) => {
          const isChallenger = m.user_id === battle.challenger.id;
          return (
            <div key={m.id} style={{
              display: 'flex', justifyContent: isChallenger ? 'flex-start' : 'flex-end',
              marginBottom: 12,
            }}>
              <div style={{
                maxWidth: '70%',
                padding: 12,
                background: isChallenger ? 'var(--red)' : 'var(--blue)',
                color: 'var(--cream)',
              }}>
                <div style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10, opacity: 0.85, marginBottom: 4,
                }}>#{i + 1} · @{m.handle}</div>
                <p style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 18, lineHeight: 1.3 }}>
                  {m.text}
                </p>
              </div>
            </div>
          );
        })}

        {isCombatant && !isClosed && (
          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              maxLength={400}
              placeholder="THROW A PUNCH…"
              onKeyDown={e => {
                if (e.key === 'Enter' && draft.trim() && !post.isPending) post.mutate();
              }}
              style={{
                flex: 1, padding: 10,
                fontFamily: 'var(--font-display)', fontSize: 16,
                border: '3px solid var(--ink)', background: 'var(--cream)',
              }}
            />
            <button type="button" className="btn-primary"
              disabled={!draft.trim() || post.isPending}
              onClick={() => post.mutate()}>
              {post.isPending ? '…' : 'POST'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Corner({
  side, battle, isWinner, canVote, isMyVote, onVote,
}: {
  side: 'challenger' | 'opponent';
  battle: Battle;
  isWinner: boolean;
  canVote: boolean;
  isMyVote: boolean;
  onVote: () => void;
}) {
  const u = battle[side];
  const ringColor = side === 'challenger' ? 'var(--red)' : 'var(--blue)';
  return (
    <div style={{
      padding: 16,
      background: isWinner ? 'var(--yellow)' : 'var(--paper)',
      border: `4px solid ${ringColor}`,
      textAlign: 'center',
    }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, marginBottom: 4 }}>
        @{u.handle}
      </div>
      {u.team_name && (
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 11, opacity: 0.7, marginBottom: 8,
        }}>{u.team_name}</div>
      )}
      {isWinner && (
        <div style={{
          fontFamily: 'var(--font-display)', fontSize: 14, color: 'var(--ink)',
          background: 'var(--yellow)', padding: 4, marginBottom: 8,
        }}>● WINNER</div>
      )}
      {canVote && (
        <button type="button" onClick={onVote} className="btn-primary" disabled={isMyVote}
          style={{ width: '100%', background: isMyVote ? 'var(--ink)' : ringColor }}>
          {isMyVote ? '✓ VOTED' : 'VOTE'}
        </button>
      )}
    </div>
  );
}
