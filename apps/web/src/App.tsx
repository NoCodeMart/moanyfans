import { useEffect, useState, type CSSProperties } from 'react';
import { Ticker, Wordmark } from './components/Brand';
import { Composer, Feed, MeProfile, MoanDetail, TeamsPage, TrendingRail } from './components/Live';
import { Battle, Leaderboards, LiveThread, Rivalry } from './components/Screens';
import { useCurrentUser } from './lib/auth';

type Palette = { red: string; orange: string; yellow: string; blue: string };
const PALETTES: Record<string, Palette> = {
  tabloid:   { red: '#e63946', orange: '#ff6b1a', yellow: '#ffd60a', blue: '#3a6ea5' },
  terrace:   { red: '#d62828', orange: '#f77f00', yellow: '#fcbf49', blue: '#003049' },
  neon:      { red: '#ff006e', orange: '#fb5607', yellow: '#ffbe0b', blue: '#3a86ff' },
  newsprint: { red: '#9d0208', orange: '#dc2f02', yellow: '#e9c46a', blue: '#264653' },
};

type Route = 'feed' | 'live' | 'battle' | 'rivalry' | 'leaderboard' | 'profile' | 'teams';

const NAV_ITEMS: { id: Route; label: string; icon: string; section: 'main' | 'discover' | 'you'; badge?: string; demo?: boolean }[] = [
  { id: 'feed',        label: 'THE FEED',         icon: 'F', section: 'main' },
  { id: 'live',        label: 'LIVE MOAN-ALONG',  icon: '●', section: 'main', badge: 'DEMO', demo: true },
  { id: 'battle',      label: 'ROAST BATTLE',     icon: 'X', section: 'main', badge: 'DEMO', demo: true },
  { id: 'teams',       label: 'ALL CLUBS',        icon: '⚑', section: 'discover' },
  { id: 'rivalry',     label: 'RIVALRIES',        icon: 'V', section: 'discover', demo: true },
  { id: 'leaderboard', label: 'LEADERBOARDS',     icon: '#', section: 'discover', demo: true },
  { id: 'profile',     label: 'YOUR DOSSIER',     icon: '@', section: 'you' },
];

const TICKER_ITEMS = [
  "BREAKING: GUEST_TESTER hits 12K agree reactions on the Manchester United board moan",
  "HOT_TAKE_HARRY drops Arsenal-midfield-in-a-phone-box take, fans shaken",
  "TRENDING #BOEHLYOUT · Chelsea fans queue round the block to file moans",
  "RAGE_RANKER weekly top 3: 1) United · 2) Chelsea · 3) Tottenham (Spursy)",
  "TRENDING #TROPHYDROUGHT — Spurs fan ratios Arsenal supporter so hard he changes club",
  "COPELORD_BOT auto-replies to every Liverpool fan, server load nominal",
  "OLD FIRM banter: Celtic fans roast Rangers' Viaplay Cup celebration",
  "LEEDS fans file 47th promotion-cycle moan of the season",
];

const FILTERS = ['ALL', 'MOAN', 'ROAST', 'COPE', 'BANTER'];
const PALETTE_KEYS = Object.keys(PALETTES) as (keyof typeof PALETTES)[];

function readMoanIdFromUrl(): string | null {
  // Supports /m/<id> path AND ?m=<id> query (the API permalink redirects via ?m=)
  const path = window.location.pathname.match(/^\/m\/([0-9a-f-]{36})/i);
  if (path) return path[1];
  const params = new URLSearchParams(window.location.search);
  return params.get('m');
}

export default function App() {
  const [route, setRoute] = useState<Route>('feed');
  const [composerOpen, setComposerOpen] = useState(false);
  const [filter, setFilter] = useState('ALL');
  const [palette, setPalette] = useState<keyof typeof PALETTES>('neon');
  const [activeMoan, setActiveMoan] = useState<string | null>(() => readMoanIdFromUrl());
  const { user, authEnabled, signInUrl } = useCurrentUser();
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

  // Sync URL with activeMoan so links are shareable + back-button works
  useEffect(() => {
    if (activeMoan) {
      const target = `/m/${activeMoan}`;
      if (window.location.pathname !== target) {
        window.history.pushState({ moan: activeMoan }, '', target);
      }
    } else if (window.location.pathname.startsWith('/m/') || window.location.search.includes('m=')) {
      window.history.pushState({}, '', '/');
    }
  }, [activeMoan]);

  useEffect(() => {
    const onPop = () => setActiveMoan(readMoanIdFromUrl());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const renderTime = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="app" data-density={density}>
      <header className="masthead">
        <div className="masthead-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Wordmark size={28} primary="var(--cream)" accent="var(--red)" spin={false} />
            <span className="masthead-issue">
              <span>VOL. III · NO. 287</span>
              <span>{new Date().toLocaleDateString('en-GB', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()}</span>
              <span style={{ color: 'var(--red)' }}>● LIVE</span>
            </span>
          </div>
          <div className="masthead-search">
            <span style={{ marginRight: 8, opacity: 0.6 }}>🔎</span>
            <input placeholder="SEARCH MOANS, ROASTS, FANS, TEAMS, GRIEVANCES…" />
            <span style={{ opacity: 0.4 }}>⌘K</span>
          </div>
          <div className="masthead-actions">
            {authEnabled && !user ? (
              <a className="masthead-btn alt" href={signInUrl}>SIGN IN</a>
            ) : (
              <button className="masthead-btn alt" onClick={() => setRoute('profile')} type="button">
                @{user?.handle ?? 'GUEST'}
                {!authEnabled && <span style={{ opacity: 0.5, marginLeft: 6, fontSize: 10 }}>· DEV</span>}
              </button>
            )}
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
            {n.badge && (
              <span style={{
                fontSize: 9, fontFamily: 'var(--font-mono)',
                color: n.demo ? 'var(--ink)' : 'var(--red)',
                opacity: n.demo ? 0.5 : 1,
              }}>● {n.badge}</span>
            )}
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
            {n.demo && (
              <span style={{
                fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--ink)', opacity: 0.5,
              }}>● DEMO</span>
            )}
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
        {activeMoan && (
          <div style={{ paddingTop: 16 }}>
            <MoanDetail moanId={activeMoan} onBack={() => setActiveMoan(null)} />
          </div>
        )}
        {!activeMoan && route === 'feed' && (
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
                  {f}
                </button>
              ))}
            </div>
            <Feed filter={filter}
                  onCompose={() => setComposerOpen(true)}
                  onOpenMoan={setActiveMoan} />
          </>
        )}
        {!activeMoan && route === 'teams' && <TeamsPage />}
        {!activeMoan && route === 'profile' && <MeProfile onPickTeam={() => setRoute('teams')} />}
        {!activeMoan && route === 'live' && <DemoBanner><LiveThread /></DemoBanner>}
        {!activeMoan && route === 'battle' && <DemoBanner><Battle /></DemoBanner>}
        {!activeMoan && route === 'rivalry' && <DemoBanner><Rivalry /></DemoBanner>}
        {!activeMoan && route === 'leaderboard' && <DemoBanner><Leaderboards /></DemoBanner>}
      </main>

      <aside className="aside">
        <TrendingRail />

        <div className="aside-card" style={{ background: 'var(--red)', color: 'var(--cream)', borderColor: 'var(--ink)' }}>
          <div className="aside-card-head" style={{ background: 'var(--cream)', color: 'var(--ink)' }}>
            ROAST BATTLE · DEMO
          </div>
          <div className="aside-card-body">
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, lineHeight: 1, marginBottom: 6 }}>
              CHAD vs COPELORD
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.05em', opacity: 0.85, marginBottom: 12 }}>
              v1.1 FEATURE · STILL DEMO
            </div>
            <button
              className="btn-primary"
              type="button"
              onClick={() => setRoute('battle')}
              style={{ background: 'var(--cream)', color: 'var(--ink)', width: '100%' }}
            >
              SEE THE PROTOTYPE
            </button>
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

function DemoBanner({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <div style={{
        background: 'var(--yellow)', color: 'var(--ink)',
        padding: '8px 16px',
        fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.1em',
        borderBottom: '3px solid var(--ink)',
        marginBottom: 16,
      }}>
        ● DEMO SCREEN — STILL USING DUMMY DATA. SHIPS WITH REAL DATA IN v1.1.
      </div>
      {children}
    </div>
  );
}
