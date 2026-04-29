import { useState, useEffect, type CSSProperties } from 'react';
import { TEAMS, USERS, TRENDING } from './data';
import { Avatar, Ticker, Wordmark } from './components/Brand';
import {
  Battle, Composer, Feed, Leaderboards, LiveThread, Profile, Rivalry,
} from './components/Screens';

type Palette = { red: string; orange: string; yellow: string; blue: string };
const PALETTES: Record<string, Palette> = {
  tabloid:   { red: '#e63946', orange: '#ff6b1a', yellow: '#ffd60a', blue: '#3a6ea5' },
  terrace:   { red: '#d62828', orange: '#f77f00', yellow: '#fcbf49', blue: '#003049' },
  neon:      { red: '#ff006e', orange: '#fb5607', yellow: '#ffbe0b', blue: '#3a86ff' },
  newsprint: { red: '#9d0208', orange: '#dc2f02', yellow: '#e9c46a', blue: '#264653' },
};

type Route = 'feed' | 'live' | 'battle' | 'rivalry' | 'leaderboard' | 'profile';

const NAV_ITEMS: { id: Route; label: string; icon: string; section: 'main' | 'discover' | 'you'; badge?: string }[] = [
  { id: 'feed',        label: 'THE FEED',         icon: 'F', section: 'main' },
  { id: 'live',        label: 'LIVE MOAN-ALONG',  icon: '●', section: 'main', badge: 'LIVE' },
  { id: 'battle',      label: 'ROAST BATTLE',     icon: 'X', section: 'main' },
  { id: 'rivalry',     label: 'RIVALRIES',        icon: 'V', section: 'discover' },
  { id: 'leaderboard', label: 'LEADERBOARDS',     icon: '#', section: 'discover' },
  { id: 'profile',     label: 'YOUR DOSSIER',     icon: '@', section: 'you' },
];

const TICKER_ITEMS = [
  "BREAKING: COPE_LORD_55 hits 30K cope reactions, becomes patron saint of relegation",
  "FC GRUMBLE manager spotted ordering a sad pasty at services",
  "ROAST BATTLE: CHAD_NUTMEG +18,402 vs COPE_LORD_55 +6,201 — round 2 closing",
  "LIVE: TANTRUM 4-0 GRUMBLE · 67' · Grumble fan eats own scarf on camera",
  "TRENDING #SLIPPERGATE — manager wears slippers to press conference, loses 2-0",
  "FAIL FALCONS lose 14th consecutive · Tanya files 3rd moan of the day",
  "DOOM DYNAMOS draft pick rated 'has hands' — analysts panic",
  "MELTDOWN MOTORS pit stop now officially classified as a coffee break",
];

const FILTERS = ['ALL', 'MOAN', 'ROAST', 'COPE', 'football', 'basketball', 'nfl', 'cricket', 'rugby', 'baseball', 'f1', 'hockey'];
const PALETTE_KEYS = Object.keys(PALETTES) as (keyof typeof PALETTES)[];

export default function App() {
  const [route, setRoute] = useState<Route>('feed');
  const [composerOpen, setComposerOpen] = useState(false);
  const [filter, setFilter] = useState('ALL');
  const [palette, setPalette] = useState<keyof typeof PALETTES>('neon');
  const intensity = 10;
  const headline = 'BIN THE LOT';
  const density: 'compact' | 'regular' | 'comfy' = 'compact';

  useEffect(() => {
    const p = PALETTES[palette];
    const r = document.documentElement;
    r.style.setProperty('--red', p.red);
    r.style.setProperty('--orange', p.orange);
    r.style.setProperty('--yellow', p.yellow);
    r.style.setProperty('--blue', p.blue);
  }, [palette]);

  const renderTime = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="app" data-density={density}>
      <header className="masthead">
        <div className="masthead-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Wordmark size={28} primary="var(--cream)" accent="var(--red)" spin={false} />
            <span className="masthead-issue">
              <span>VOL. III · NO. 287</span>
              <span>APR 29, 2026</span>
              <span style={{ color: 'var(--red)' }}>● 41,209 ONLINE</span>
            </span>
          </div>
          <div className="masthead-search">
            <span style={{ marginRight: 8, opacity: 0.6 }}>🔎</span>
            <input placeholder="SEARCH MOANS, ROASTS, FANS, TEAMS, GRIEVANCES…" />
            <span style={{ opacity: 0.4 }}>⌘K</span>
          </div>
          <div className="masthead-actions">
            <button className="masthead-btn alt" onClick={() => setRoute('profile')} type="button">@GAFFER_GAZ</button>
            <button className="masthead-btn" onClick={() => setComposerOpen(true)} type="button">+ MOAN</button>
          </div>
        </div>
      </header>

      <Ticker items={TICKER_ITEMS} />

      <nav className="nav">
        <div className="nav-section-label">THE STADIUM</div>
        {NAV_ITEMS.filter(n => n.section === 'main').map(n => (
          <button
            key={n.id}
            type="button"
            className={'nav-item' + (route === n.id ? ' active' : '')}
            onClick={() => setRoute(n.id)}
          >
            <span className="nav-item-icon">{n.icon}</span>
            <span style={{ flex: 1 }}>{n.label}</span>
            {n.badge && <span style={{ fontSize: 10, color: 'var(--red)', fontFamily: 'var(--font-mono)' }}>● {n.badge}</span>}
          </button>
        ))}
        <div className="nav-section-label">DISCOVER</div>
        {NAV_ITEMS.filter(n => n.section === 'discover').map(n => (
          <button
            key={n.id}
            type="button"
            className={'nav-item' + (route === n.id ? ' active' : '')}
            onClick={() => setRoute(n.id)}
          >
            <span className="nav-item-icon">{n.icon}</span>
            <span style={{ flex: 1 }}>{n.label}</span>
          </button>
        ))}
        <div className="nav-section-label">YOU</div>
        {NAV_ITEMS.filter(n => n.section === 'you').map(n => (
          <button
            key={n.id}
            type="button"
            className={'nav-item' + (route === n.id ? ' active' : '')}
            onClick={() => setRoute(n.id)}
          >
            <span className="nav-item-icon">{n.icon}</span>
            <span style={{ flex: 1 }}>{n.label}</span>
          </button>
        ))}

        <button className="nav-cta" onClick={() => setComposerOpen(true)} type="button">
          FILE A MOAN
        </button>

        <div style={{ marginTop: 24, padding: 12, background: 'var(--ink)', color: 'var(--cream)', position: 'relative' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.15em', opacity: 0.7, marginBottom: 6 }}>
            TODAY'S WEATHER
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, lineHeight: 1, marginBottom: 4 }}>
            BLEAK · CHANCE OF MELTDOWN
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, opacity: 0.7 }}>
            HUMIDITY: HIGH (TEARS) · WIND: BLOWING WHISTLES
          </div>
        </div>

        <div style={{ marginTop: 16, padding: 10, border: '2px solid var(--ink)', background: 'var(--paper)' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.15em', marginBottom: 8, color: 'var(--ink)' }}>
            KIT COLOURS
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {PALETTE_KEYS.map(k => (
              <button
                key={k}
                type="button"
                onClick={() => setPalette(k)}
                aria-label={`Switch palette to ${k}`}
                title={k.toUpperCase()}
                style={{
                  width: 28, height: 28, padding: 0,
                  border: palette === k ? '2px solid var(--ink)' : '2px solid transparent',
                  background: PALETTES[k].red,
                  cursor: 'pointer',
                  position: 'relative',
                } as CSSProperties}
              >
                <span style={{
                  position: 'absolute', inset: 0, top: '50%',
                  background: PALETTES[k].blue,
                }} />
              </button>
            ))}
          </div>
        </div>
      </nav>

      <main className="main">
        {route === 'feed' && (
          <>
            <div style={{
              padding: '24px 0 24px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-end',
              borderBottom: '3px solid var(--ink)',
              marginBottom: 16,
            }}>
              <h1 className="headline" style={{ fontSize: 64, color: 'var(--ink)', textShadow: '3px 3px 0 var(--red)', margin: 0 }}>
                {headline}
              </h1>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.1em', textAlign: 'right' }}>
                <div style={{ fontWeight: 700 }}>FRONT PAGE · UPDATED {renderTime}</div>
                <div style={{ opacity: 0.6 }}>YOUR FEED · CURATED BY ALGORITHMS THAT HATE YOU</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4, padding: '12px 0', flexWrap: 'wrap' }}>
              {FILTERS.map(f => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 14,
                    letterSpacing: '0.05em',
                    padding: '6px 12px',
                    border: '2px solid var(--ink)',
                    background: filter === f ? 'var(--ink)' : 'var(--paper)',
                    color: filter === f ? 'var(--cream)' : 'var(--ink)',
                    cursor: 'pointer',
                  }}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
            <Feed filter={filter} intensity={intensity} onCompose={() => setComposerOpen(true)} />
          </>
        )}
        {route === 'live' && <LiveThread />}
        {route === 'battle' && <Battle />}
        {route === 'rivalry' && <Rivalry />}
        {route === 'leaderboard' && <Leaderboards />}
        {route === 'profile' && <Profile />}
      </main>

      <aside className="aside">
        <div className="aside-card">
          <div className="aside-card-head">
            TRENDING TAGS <small>LAST 24H</small>
          </div>
          <div className="aside-card-body">
            {TRENDING.map(t => (
              <div key={t.tag} className="trending-row">
                <span className="tag-text">{t.tag}</span>
                <span className="sport">{t.sport.toUpperCase()}</span>
                <span className="moans">{t.moans.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="aside-card" style={{ background: 'var(--red)', color: 'var(--cream)', borderColor: 'var(--ink)' }}>
          <div className="aside-card-head" style={{ background: 'var(--cream)', color: 'var(--ink)' }}>
            ROAST BATTLE · LIVE
          </div>
          <div className="aside-card-body">
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, lineHeight: 1, marginBottom: 6 }}>
              CHAD vs COPELORD
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.05em', opacity: 0.85, marginBottom: 12 }}>
              ROUND 2/3 · 02:14 LEFT · 24,603 VOTES IN
            </div>
            <button
              className="btn-primary"
              type="button"
              onClick={() => setRoute('battle')}
              style={{ background: 'var(--cream)', color: 'var(--ink)', width: '100%' }}
            >
              JOIN THE BLOODBATH
            </button>
          </div>
        </div>

        <div className="aside-card">
          <div className="aside-card-head">WHO TO FOLLOW <small>FOR YOUR PAIN</small></div>
          <div className="aside-card-body">
            {USERS.slice(1, 5).map(u => {
              const team = TEAMS.find(tt => tt.id === u.team)!;
              return (
                <div key={u.handle} style={{
                  display: 'grid',
                  gridTemplateColumns: '40px 1fr auto',
                  gap: 10,
                  alignItems: 'center',
                  padding: '8px 0',
                  borderBottom: '1px dashed var(--rule)',
                }}>
                  <Avatar user={u} size={40} />
                  <div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 16 }}>@{u.handle}</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: team.primary, fontWeight: 700 }}>
                      {team.name}
                    </div>
                  </div>
                  <button
                    type="button"
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 12,
                      letterSpacing: '0.05em',
                      padding: '6px 10px',
                      background: 'var(--ink)',
                      color: 'var(--cream)',
                      border: 0,
                      cursor: 'pointer',
                    }}
                  >
                    FOLLOW
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: '0.1em',
          opacity: 0.5,
          textAlign: 'center',
          padding: 12,
        }}>
          MOANYFANS™ · NO MERCY POLICY · ALL TAKES ARE OURS · TERMS · PRIVACY
        </div>
      </aside>

      <Composer open={composerOpen} onClose={() => setComposerOpen(false)} />
    </div>
  );
}
