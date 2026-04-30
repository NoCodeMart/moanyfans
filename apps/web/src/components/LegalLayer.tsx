import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';

const AGE_KEY = 'moanyfans:age_ok';
const COOKIE_KEY = 'moanyfans:cookie_choice';
const LEGAL_VERSION = '2026-04-29';

export type LegalView = 'terms' | 'privacy' | 'community' | null;

export function LegalLayer({
  view, onClose,
}: { view: LegalView; onClose: () => void }) {
  const [ageOk, setAgeOk] = useState<boolean>(() => localStorage.getItem(AGE_KEY) === LEGAL_VERSION);
  const [cookieChoice, setCookieChoice] = useState<string | null>(
    () => localStorage.getItem(COOKIE_KEY),
  );

  // Lock scroll when an overlay is open
  useEffect(() => {
    const lock = !ageOk || view !== null;
    document.body.style.overflow = lock ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [ageOk, view]);

  return (
    <>
      {!ageOk && (
        <AgeGate onAccept={() => {
          localStorage.setItem(AGE_KEY, LEGAL_VERSION);
          setAgeOk(true);
        }} />
      )}
      {ageOk && !cookieChoice && (
        <CookieBanner onChoose={(choice) => {
          localStorage.setItem(COOKIE_KEY, choice);
          setCookieChoice(choice);
        }} />
      )}
      {view !== null && <LegalModal view={view} onClose={onClose} />}
    </>
  );
}

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 9999,
  background: 'rgba(10, 9, 8, 0.85)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 24,
};

function AgeGate({ onAccept }: { onAccept: () => void }) {
  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-labelledby="age-gate-title">
      <div style={{
        background: 'var(--cream)', color: 'var(--ink)',
        maxWidth: 440, width: '100%',
        border: '4px solid var(--ink)',
        boxShadow: '8px 8px 0 var(--red)',
        padding: 28,
      }}>
        <div style={{
          display: 'inline-block',
          fontFamily: 'var(--font-display)', fontSize: 14,
          letterSpacing: '0.1em',
          background: 'var(--red)', color: 'var(--cream)',
          padding: '4px 10px', marginBottom: 16,
        }}>OVER 13S ONLY</div>
        <h2 id="age-gate-title" style={{
          fontFamily: 'var(--font-display)', fontSize: 36, lineHeight: 1.05,
          margin: '0 0 12px',
        }}>
          THIS IS A SPORTS MOANING SITE.
        </h2>
        <p style={{ fontSize: 15, lineHeight: 1.5, margin: '0 0 16px' }}>
          Moanyfans hosts adult-flavoured football banter — strong language,
          rough opinions, the occasional roast. By entering you confirm
          you're <b>at least 13 years old</b> and you understand it's banter,
          not bullying. If you're not, kindly close the tab.
        </p>
        <p style={{ fontSize: 13, color: '#5a5048', margin: '0 0 20px' }}>
          We don't allow harassment, threats, slurs, doxxing, or claims of
          fact about real people that you can't prove. Reports get reviewed.
        </p>
        <button
          type="button"
          onClick={onAccept}
          style={{
            width: '100%',
            fontFamily: 'var(--font-display)', fontSize: 18, letterSpacing: '0.05em',
            background: 'var(--ink)', color: 'var(--cream)',
            border: 'none', padding: '14px 20px', cursor: 'pointer',
          }}
        >I'M 13+ AND I'M IN</button>
      </div>
    </div>
  );
}

function CookieBanner({ onChoose }: { onChoose: (c: string) => void }) {
  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9000,
      background: 'var(--ink)', color: 'var(--cream)',
      borderTop: '4px solid var(--red)',
      padding: '14px 20px',
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14,
      fontFamily: 'var(--font-mono)', fontSize: 12,
    }}>
      <div style={{ flex: '1 1 320px' }}>
        <b style={{ fontFamily: 'var(--font-display)', fontSize: 14, letterSpacing: '0.05em' }}>COOKIES.</b>
        {' '}We use a tiny number of cookies to keep you signed in and
        remember your team. No advertising trackers, no selling data.
      </div>
      <button
        type="button"
        onClick={() => onChoose('rejected')}
        style={{
          background: 'transparent', color: 'var(--cream)',
          border: '2px solid var(--cream)',
          padding: '8px 14px', cursor: 'pointer',
          fontFamily: 'var(--font-display)', fontSize: 13, letterSpacing: '0.05em',
        }}
      >REJECT</button>
      <button
        type="button"
        onClick={() => onChoose('accepted')}
        style={{
          background: 'var(--red)', color: 'var(--cream)',
          border: '2px solid var(--red)',
          padding: '8px 16px', cursor: 'pointer',
          fontFamily: 'var(--font-display)', fontSize: 13, letterSpacing: '0.05em',
        }}
      >ACCEPT</button>
    </div>
  );
}

function LegalModal({ view, onClose }: { view: NonNullable<LegalView>; onClose: () => void }) {
  const content = LEGAL_CONTENT[view];
  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--cream)', color: 'var(--ink)',
          maxWidth: 720, width: '100%',
          maxHeight: '85vh', overflow: 'auto',
          border: '4px solid var(--ink)',
          padding: 0,
          position: 'relative',
        }}
      >
        <header style={{
          background: 'var(--ink)', color: 'var(--cream)',
          padding: '16px 24px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          position: 'sticky', top: 0, zIndex: 1,
        }}>
          <div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.15em', opacity: 0.7 }}>MOANYFANS</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, letterSpacing: '0.04em' }}>{content.title}</div>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{
              background: 'var(--red)', color: 'var(--cream)',
              border: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-display)', fontSize: 18,
              padding: '4px 12px',
            }}
          >×</button>
        </header>
        <div style={{ padding: '24px 28px', fontSize: 14, lineHeight: 1.55 }}>
          {content.body}
          <div style={{ marginTop: 32, fontFamily: 'var(--font-mono)', fontSize: 11, opacity: 0.55 }}>
            VERSION {LEGAL_VERSION}
          </div>
        </div>
      </div>
    </div>
  );
}

const SectionTitle = ({ children }: { children: ReactNode }) => (
  <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, letterSpacing: '0.04em',
                margin: '20px 0 6px', textTransform: 'uppercase' }}>{children}</h3>
);

const LEGAL_CONTENT: Record<NonNullable<LegalView>, { title: string; body: ReactNode }> = {
  terms: {
    title: 'TERMS OF USE',
    body: (
      <>
        <p>By using Moanyfans you agree to behave like a grown-up sports fan and
        accept that this is a banter platform first, a discussion forum second.</p>

        <SectionTitle>The deal</SectionTitle>
        <p>You can post moans, roasts, copes and banter about football clubs and
        public figures (managers, owners, pundits) so long as you're not making
        false claims of fact about real people. You own what you write; you grant
        us a worldwide licence to display, distribute and feature it on the
        platform and in our promotional content.</p>

        <SectionTitle>Your account</SectionTitle>
        <p>You must be 13 or older. One account per human. Don't impersonate
        real people, brands or other users. Don't share your login. We can
        suspend accounts that break these rules.</p>

        <SectionTitle>What we don't allow</SectionTitle>
        <p>Doxxing, threats, slurs targeting protected characteristics, sexual
        content, content involving minors in any negative context, fraud,
        spam, or claims of crime/abuse against named real people that you
        can't prove. See Community Standards for the full list.</p>

        <SectionTitle>Removal &amp; appeals</SectionTitle>
        <p>We can remove or hold posts at our discretion. If you think a removal
        was wrong, email <code>contact@moanyfans.co.uk</code> and we'll review.</p>

        <SectionTitle>No warranty</SectionTitle>
        <p>The service is provided "as is". We're not liable for hurt feelings,
        broken sleep, ratioed timelines or your team's form. UK law applies;
        disputes go to the courts of England &amp; Wales.</p>
      </>
    ),
  },
  privacy: {
    title: 'PRIVACY NOTICE',
    body: (
      <>
        <p>Plain English version: we keep what we need to run the site, nothing
        more, and we don't sell you to advertisers.</p>

        <SectionTitle>What we collect</SectionTitle>
        <ul style={{ paddingLeft: 18 }}>
          <li>Account data: handle, email, the team you support.</li>
          <li>Content: every moan, roast, reaction, report, vote.</li>
          <li>Technical: IP, user agent, basic device info — for abuse
              prevention and uptime.</li>
        </ul>

        <SectionTitle>Cookies</SectionTitle>
        <p>A small number of strictly-necessary cookies for sign-in and
        preferences. No third-party advertising cookies. No cross-site
        tracking pixels. You can reject the optional ones in the banner.</p>

        <SectionTitle>Who sees your data</SectionTitle>
        <p>Public posts are public — that's the point. Account email and IP are
        not shared except where required by law (e.g. court order) or to
        keep the platform safe. We use third-party providers for hosting
        (Coolify on a UK VPS), email (Resend), and AI moderation/recap
        generation (Anthropic) — these process data on our behalf.</p>

        <SectionTitle>Your rights</SectionTitle>
        <p>You can ask for a copy of your data, ask us to delete your account,
        or correct something we hold. Email <code>privacy@moanyfans.co.uk</code>.
        We respond within 30 days. UK data protection regulator: ICO
        (<code>ico.org.uk</code>).</p>

        <SectionTitle>Retention</SectionTitle>
        <p>Active account data: until you delete it. Deleted accounts: anonymised
        within 30 days. Logs: 30 days max.</p>
      </>
    ),
  },
  community: {
    title: 'COMMUNITY STANDARDS',
    body: (
      <>
        <p>Banter is the point. Bullying isn't. Read this once and then crack
        on.</p>

        <SectionTitle>Encouraged</SectionTitle>
        <ul style={{ paddingLeft: 18 }}>
          <li>Sharp opinions on clubs, owners, managers, pundits.</li>
          <li>Roasting other supporters' takes.</li>
          <li>Hyperbole, sarcasm, gallows humour.</li>
        </ul>

        <SectionTitle>Not tolerated</SectionTitle>
        <ul style={{ paddingLeft: 18 }}>
          <li>Slurs targeting race, religion, sexuality, gender or disability.</li>
          <li>Threats, doxxing, contact details of real people.</li>
          <li>Specific claims of crime, drugs or abuse against named real
              people without public evidence — that's defamation territory.</li>
          <li>Sexual content. Anything involving minors.</li>
          <li>Spam, scams, links to off-platform fraud.</li>
        </ul>

        <SectionTitle>Reporting</SectionTitle>
        <p>Use the report button on any post. Three independent reports
        auto-hides a post pending human review. Repeat offenders get
        suspended.</p>

        <SectionTitle>Moderation tools</SectionTitle>
        <p>We use AI (Claude Haiku) as a first-pass score on submissions
        flagged for likely defamation or slurs; a human makes the final
        call before anything stays removed.</p>
      </>
    ),
  },
};
