import { useEffect, useState, type CSSProperties } from 'react';
import { Ticker, Wordmark } from './components/Brand';
import { Composer, Feed, MeProfile, MoanDetail, TeamsPage, TrendingRail } from './components/Live';
import { BattlesPage, BattlesAsideCard, LiveMoanAlong } from './components/LivePages';
import { Landing } from './components/Landing';
import { LegalLayer, type LegalView } from './components/LegalLayer';
import { NotificationBell } from './components/Notifications';
import { OnboardingWizard } from './components/Onboarding';
import { SearchOverlay } from './components/SearchOverlay';
import { TagFeed } from './components/TagFeed';
import { TeamFeed } from './components/TeamFeed';
import { UserProfileView } from './components/UserProfile';
import { Leaderboards, Rivalry } from './components/Screens';
import { useCurrentUser } from './lib/auth';

const VISITED_KEY = 'moanyfans:visited';

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
  { id: 'live',        label: 'LIVE MOAN-ALONG',  icon: '●', section: 'main', badge: 'LIVE' },
  { id: 'battle',      label: 'ROAST BATTLE',     icon: 'X', section: 'main' },
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
  "HOUSE BOT auto-replies to every Liverpool fan, server load nominal",
  "OLD FIRM banter: Celtic fans roast Rangers' Viaplay Cup celebration",
  "LEEDS fans file 47th promotion-cycle moan of the season",
];

const FILTERS: { key: string; label: string }[] = [
  { key: 'ALL',       label: 'ALL' },
  { key: 'FOLLOWING', label: '👥 FOLLOWING' },
  { key: 'MOAN',      label: '😤 MOAN' },
  { key: 'ROAST',     label: '🔥 ROAST' },
  { key: 'BANTER',    label: '😂 BANTER' },
];
const PALETTE_KEYS = Object.keys(PALETTES) as (keyof typeof PALETTES)[];

function readMoanIdFromUrl(): string | null {
  // Supports /m/<id> path AND ?m=<id> query (the API permalink redirects via ?m=)
  const path = window.location.pathname.match(/^\/m\/([0-9a-f-]{36})/i);
  if (path) return path[1];
  const params = new URLSearchParams(window.location.search);
  return params.get('m');
}

function readUserHandleFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('u');
}

function readTeamSlugFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('team');
}

function readTagSlugFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('tag');
}

export default function App() {
  const [route, setRoute] = useState<Route>('feed');
  const [composerOpen, setComposerOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<{ moanId: string; handle: string } | null>(null);
  const openReply = (target: { moanId: string; handle: string }) => {
    setReplyTo(target);
    setComposerOpen(true);
  };
  const [filter, setFilter] = useState('ALL');
  const [palette, setPalette] = useState<keyof typeof PALETTES>('neon');
  const [activeMoan, setActiveMoan] = useState<string | null>(() => readMoanIdFromUrl());
  const [activeUser, setActiveUser] = useState<string | null>(() => readUserHandleFromUrl());
  const [activeTeam, setActiveTeam] = useState<string | null>(() => readTeamSlugFromUrl());
  const [activeTag, setActiveTag] = useState<string | null>(() => readTagSlugFromUrl());
  const [legalView, setLegalView] = useState<LegalView>(null);
  const [showLanding, setShowLanding] = useState<boolean>(() => {
    if (readMoanIdFromUrl()) return false;
    if (window.location.search.includes('app=1')) return false;
    return localStorage.getItem(VISITED_KEY) !== '1';
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const startOnboarding = () => setOnboardingOpen(true);
  const finishOnboarding = () => {
    localStorage.setItem(VISITED_KEY, '1');
    setOnboardingOpen(false);
    setShowLanding(false);
  };

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

  // Sync URL with activeUser
  useEffect(() => {
    const url = new URL(window.location.href);
    if (activeUser) {
      if (url.searchParams.get('u') !== activeUser) {
        url.searchParams.set('u', activeUser);
        window.history.pushState({ user: activeUser }, '', url.toString());
      }
    } else if (url.searchParams.has('u')) {
      url.searchParams.delete('u');
      window.history.pushState({}, '', url.toString());
    }
  }, [activeUser]);

  // Sync URL with activeTeam
  useEffect(() => {
    const url = new URL(window.location.href);
    if (activeTeam) {
      if (url.searchParams.get('team') !== activeTeam) {
        url.searchParams.set('team', activeTeam);
        window.history.pushState({ team: activeTeam }, '', url.toString());
      }
    } else if (url.searchParams.has('team')) {
      url.searchParams.delete('team');
      window.history.pushState({}, '', url.toString());
    }
  }, [activeTeam]);

  // Sync URL with activeTag
  useEffect(() => {
    const url = new URL(window.location.href);
    if (activeTag) {
      if (url.searchParams.get('tag') !== activeTag) {
        url.searchParams.set('tag', activeTag);
        window.history.pushState({ tag: activeTag }, '', url.toString());
      }
    } else if (url.searchParams.has('tag')) {
      url.searchParams.delete('tag');
      window.history.pushState({}, '', url.toString());
    }
  }, [activeTag]);

  useEffect(() => {
    const onPop = () => {
      setActiveMoan(readMoanIdFromUrl());
      setActiveUser(readUserHandleFromUrl());
      setActiveTeam(readTeamSlugFromUrl());
      setActiveTag(readTagSlugFromUrl());
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // ⌘K / Ctrl+K opens search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Wheel events anywhere on the page (including the side rails) scroll
  // the main column. X-style — you don't have to aim at the feed.
  // Skipped on touch / small screens where native page scroll is in charge.
  useEffect(() => {
    if (window.matchMedia('(max-width: 760px)').matches) return;
    const onWheel = (e: WheelEvent) => {
      const main = document.querySelector('.main') as HTMLElement | null;
      if (!main) return;
      const target = e.target as HTMLElement | null;
      // Let the rails handle their own scroll if they actually overflow,
      // and let any nested scrollable area (modals, popovers) do its thing.
      if (target && target.closest('.main, [data-scroll-self], dialog, .modal')) return;
      main.scrollBy({ top: e.deltaY, behavior: 'auto' });
      e.preventDefault();
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, []);

  const renderTime = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  if (showLanding) {
    return (
      <>
        <Landing onEnter={startOnboarding} onLegal={(v) => setLegalView(v)} />
        {onboardingOpen && <OnboardingWizard onClose={finishOnboarding} />}
        <LegalLayer view={legalView} onClose={() => setLegalView(null)} />
      </>
    );
  }

  return (
    <div className="app" data-density={density}>
      <header className="masthead">
        <div className="masthead-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              type="button"
              className="mobile-menu-btn"
              aria-label="Open menu"
              onClick={() => setDrawerOpen(true)}
            >☰</button>
            <Wordmark size={28} primary="var(--cream)" accent="var(--red)" spin={false} />
            <span className="masthead-issue">
              <span>VOL. III · NO. 287</span>
              <span>{new Date().toLocaleDateString('en-GB', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()}</span>
              <span style={{ color: 'var(--red)' }}>● LIVE</span>
            </span>
          </div>
          <button
            type="button"
            className="masthead-search"
            onClick={() => setSearchOpen(true)}
            aria-label="Open search"
          >
            <span style={{ marginRight: 8, opacity: 0.6 }}>🔎</span>
            <span style={{ flex: 1, textAlign: 'left', opacity: 0.6 }}>
              SEARCH MOANS, ROASTS, FANS, TEAMS, GRIEVANCES…
            </span>
            <span style={{ opacity: 0.4 }}>⌘K</span>
          </button>
          <div className="masthead-actions">
            <NotificationBell
              onOpenUser={(h) => setActiveUser(h)}
              onOpenMoan={(id) => setActiveMoan(id)}
            />
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
        {activeTag && (
          <div style={{ paddingTop: 16 }}>
            <TagFeed slug={activeTag}
                      onClose={() => setActiveTag(null)}
                      onOpenMoan={setActiveMoan}
                      onOpenUser={setActiveUser}
                      onOpenTeam={setActiveTeam} />
          </div>
        )}
        {!activeTag && activeTeam && (
          <div style={{ paddingTop: 16 }}>
            <TeamFeed slug={activeTeam}
                       onClose={() => setActiveTeam(null)}
                       onOpenMoan={setActiveMoan}
                       onOpenUser={setActiveUser} />
          </div>
        )}
        {!activeTeam && activeUser && (
          <div style={{ paddingTop: 16 }}>
            <UserProfileView handle={activeUser}
                              onClose={() => setActiveUser(null)}
                              onPickHandle={(h) => setActiveUser(h)} />
          </div>
        )}
        {!activeTeam && !activeUser && activeMoan && (
          <div style={{ paddingTop: 16 }}>
            <MoanDetail moanId={activeMoan}
                          onBack={() => setActiveMoan(null)}
                          onReply={openReply}
                          onOpenUser={setActiveUser}
                          onOpenTeam={setActiveTeam}
                          onOpenTag={setActiveTag} />
          </div>
        )}
        {!activeTag && !activeTeam && !activeUser && !activeMoan && route === 'feed' && (
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
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 14,
                    letterSpacing: '0.05em',
                    padding: '6px 12px',
                    border: '2px solid var(--ink)',
                    background: filter === f.key ? 'var(--ink)' : 'var(--paper)',
                    color: filter === f.key ? 'var(--cream)' : 'var(--ink)',
                    cursor: 'pointer',
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <Feed filter={filter}
                  onOpenMoan={setActiveMoan}
                  onOpenUser={setActiveUser}
                  onOpenTeam={setActiveTeam}
                  onOpenTag={setActiveTag}
                  onReply={openReply} />
          </>
        )}
        {!activeTag && !activeTeam && !activeUser && !activeMoan && route === 'teams' && (
          <TeamsPage onPickTeam={(t) => setActiveTeam(t.slug)} />
        )}
        {!activeTag && !activeTeam && !activeUser && !activeMoan && route === 'profile' && <MeProfile onPickTeam={() => setRoute('teams')} />}
        {!activeTag && !activeTeam && !activeUser && !activeMoan && route === 'live' && <LiveMoanAlong />}
        {!activeTag && !activeTeam && !activeUser && !activeMoan && route === 'battle' && <BattlesPage />}
        {!activeTag && !activeTeam && !activeUser && !activeMoan && route === 'rivalry' && <DemoBanner><Rivalry /></DemoBanner>}
        {!activeTag && !activeTeam && !activeUser && !activeMoan && route === 'leaderboard' && <DemoBanner><Leaderboards /></DemoBanner>}
      </main>

      <aside className="aside">
        <TrendingRail />

        <BattlesAsideCard onOpen={() => setRoute('battle')} />

        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: '0.1em',
          opacity: 0.6,
          textAlign: 'center',
          padding: 12,
          display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 6,
        }}>
          <span>MOANYFANS™ · NO MERCY POLICY ·</span>
          <button type="button" onClick={() => { localStorage.removeItem(VISITED_KEY); setShowLanding(true); }} className="footer-link">HOME</button>
          <span>·</span>
          <button type="button" onClick={() => setLegalView('terms')} className="footer-link">TERMS</button>
          <span>·</span>
          <button type="button" onClick={() => setLegalView('privacy')} className="footer-link">PRIVACY</button>
          <span>·</span>
          <button type="button" onClick={() => setLegalView('community')} className="footer-link">COMMUNITY STANDARDS</button>
        </div>
      </aside>

      <Composer open={composerOpen} replyTo={replyTo}
                 onClose={() => { setComposerOpen(false); setReplyTo(null); }} />
      <LegalLayer view={legalView} onClose={() => setLegalView(null)} />
      {onboardingOpen && <OnboardingWizard onClose={() => setOnboardingOpen(false)} />}
      {searchOpen && (
        <SearchOverlay
          onClose={() => setSearchOpen(false)}
          onPickMoan={(id) => { setSearchOpen(false); setActiveMoan(id); }}
          onPickUser={(h) => { setSearchOpen(false); setActiveUser(h); }}
          onPickTeam={(slug) => { setSearchOpen(false); setActiveTeam(slug); }}
        />
      )}

      {drawerOpen && (
        <>
          <div className="mobile-drawer-backdrop" onClick={() => setDrawerOpen(false)} />
          <div className="mobile-drawer" role="dialog" aria-modal="true">
            <div style={{ display: 'flex', justifyContent: 'space-between',
                            alignItems: 'center', marginBottom: 16 }}>
              <Wordmark size={22} primary="var(--ink)" accent="var(--red)" spin={false} />
              <button
                type="button" aria-label="Close menu"
                onClick={() => setDrawerOpen(false)}
                style={{
                  background: 'var(--ink)', color: 'var(--cream)', border: 0,
                  width: 32, height: 32, fontSize: 18, cursor: 'pointer',
                }}
              >×</button>
            </div>
            {NAV_ITEMS.map(n => (
              <button
                key={n.id}
                type="button"
                className={'nav-item' + (route === n.id ? ' active' : '')}
                onClick={() => { setRoute(n.id); setDrawerOpen(false); setActiveMoan(null); }}
              >
                <span className="nav-item-icon">{n.icon}</span>
                <span style={{ flex: 1 }}>{n.label}</span>
              </button>
            ))}
            <button
              type="button"
              className="nav-cta"
              onClick={() => { setComposerOpen(true); setDrawerOpen(false); }}
            >FILE A MOAN</button>
          </div>
        </>
      )}

      {/* Mobile bottom tabs */}
      <nav className="bottom-tabs" aria-label="Primary">
        {([
          { id: 'feed' as Route, icon: 'F', label: 'FEED' },
          { id: 'live' as Route, icon: '●', label: 'LIVE' },
          { id: 'teams' as Route, icon: '⚑', label: 'CLUBS' },
          { id: 'profile' as Route, icon: '@', label: 'YOU' },
        ]).map(t => (
          <button
            key={t.id}
            type="button"
            className={'bottom-tab' + (route === t.id ? ' active' : '')}
            onClick={() => { setRoute(t.id); setActiveMoan(null); }}
          >
            <span className="bt-icon">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
        <button
          type="button" className="bottom-tab"
          onClick={() => setComposerOpen(true)}
          style={{ color: 'var(--red)' }}
        >
          <span className="bt-icon">+</span>
          <span>MOAN</span>
        </button>
      </nav>
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
