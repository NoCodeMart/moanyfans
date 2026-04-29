import { type CSSProperties } from 'react';
import { Wordmark } from './Brand';

export function Landing({ onEnter, onLegal }:
  { onEnter: () => void; onLegal: (v: 'terms' | 'privacy' | 'community') => void }) {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--cream)', color: 'var(--ink)',
      display: 'flex', flexDirection: 'column',
    }}>
      <header style={{
        background: 'var(--ink)', color: 'var(--cream)',
        borderBottom: '6px solid var(--red)',
        padding: '14px 20px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <Wordmark size={26} primary="var(--cream)" accent="var(--red)" spin={false} />
        <button
          type="button"
          onClick={onEnter}
          style={{
            background: 'var(--red)', color: 'var(--cream)', border: 0,
            padding: '8px 14px',
            fontFamily: 'var(--font-display)', fontSize: 13, letterSpacing: '0.05em',
            cursor: 'pointer',
          }}
        >ENTER →</button>
      </header>

      <main style={{
        flex: 1,
        padding: '40px 20px 80px',
        maxWidth: 980, margin: '0 auto', width: '100%',
        display: 'flex', flexDirection: 'column', gap: 40,
      }}>
        <section>
          <div style={{
            display: 'inline-block',
            background: 'var(--yellow)', color: 'var(--ink)',
            fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.15em',
            padding: '4px 10px',
            border: '2px solid var(--ink)',
            transform: 'rotate(-1deg)',
            marginBottom: 18,
          }}>UK FOOTBALL · BANTER FIRST · NO MERCY</div>

          <h1 className="headline" style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(48px, 11vw, 120px)',
            lineHeight: 0.92, letterSpacing: '-0.01em',
            margin: 0,
            textShadow: '4px 4px 0 var(--red)',
          }}>
            BIN<br/>THE LOT.
          </h1>

          <p style={{
            marginTop: 24,
            fontSize: 'clamp(17px, 2.4vw, 22px)', lineHeight: 1.4,
            maxWidth: 640,
          }}>
            Moanyfans is the home of UK football moaning. Pseudonymous. Brutal.
            Live. Drop a moan, ratio a rival, and watch your team self-destruct
            with 30,000 other fans pressing the red button.
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 28 }}>
            <button
              type="button"
              onClick={onEnter}
              style={{
                background: 'var(--red)', color: 'var(--cream)', border: 0,
                padding: '16px 26px',
                fontFamily: 'var(--font-display)', fontSize: 22,
                letterSpacing: '0.04em', cursor: 'pointer',
                boxShadow: '4px 4px 0 var(--ink)',
              }}
            >ENTER THE STADIUM →</button>
            <a
              href="#features"
              style={{
                background: 'transparent', color: 'var(--ink)',
                border: '3px solid var(--ink)',
                padding: '13px 22px',
                fontFamily: 'var(--font-display)', fontSize: 18,
                letterSpacing: '0.04em', textDecoration: 'none',
              }}
            >WHAT IS THIS?</a>
          </div>
        </section>

        <section id="features" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 16,
        }}>
          <FeatureCard
            tone="var(--red)"
            label="LIVE MOAN-ALONG"
            title="EVERY MINUTE. EVERY MISTAKE."
            body="Real-time fan thread for every Premier League and Scottish Premiership game. Pick a side, post mid-match, watch the meltdown."
          />
          <FeatureCard
            tone="var(--blue)"
            label="ROAST BATTLE"
            title="ONE-ON-ONE. NO EXIT."
            body="Challenge a rival to a 24-hour roast battle. Crowd votes the winner. Loser's moan card gets framed."
          />
          <FeatureCard
            tone="var(--yellow)" inkColor="var(--ink)"
            label="HOUSE AI"
            title="HARRY · COPELORD · RAGE_RANKER"
            body="AI characters drop hot takes after every result, reply with copium, and rank the week's most embarrassing performances."
          />
          <FeatureCard
            tone="var(--ink)"
            label="104 CLUBS"
            title="PL · CHAMPIONSHIP · L1 · L2 · SPL"
            body="Every team in English football's top four divisions plus the Scottish Premiership. Pick yours. Defend the badge."
          />
        </section>

        <section style={{
          background: 'var(--ink)', color: 'var(--cream)',
          padding: 24,
          textAlign: 'center',
        }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11,
                          letterSpacing: '0.15em', opacity: 0.7, marginBottom: 8 }}>
            HOUSE RULES, IN ONE LINE
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(20px, 4vw, 30px)',
                          lineHeight: 1.2 }}>
            Banter, not bullying. Opinion, not defamation. Over-13s only.
          </div>
        </section>

        <section style={{ textAlign: 'center', padding: '12px 0 40px' }}>
          <button
            type="button"
            onClick={onEnter}
            style={{
              background: 'var(--red)', color: 'var(--cream)', border: 0,
              padding: '18px 32px',
              fontFamily: 'var(--font-display)', fontSize: 24,
              letterSpacing: '0.04em', cursor: 'pointer',
              boxShadow: '5px 5px 0 var(--ink)',
            }}
          >START MOANING →</button>
        </section>
      </main>

      <footer style={{
        background: 'var(--ink)', color: 'var(--cream)',
        padding: 16, textAlign: 'center',
        fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.1em',
        display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap',
      }}>
        <span>MOANYFANS™</span><span>·</span>
        <button type="button" onClick={() => onLegal('terms')} className="footer-link">TERMS</button>
        <span>·</span>
        <button type="button" onClick={() => onLegal('privacy')} className="footer-link">PRIVACY</button>
        <span>·</span>
        <button type="button" onClick={() => onLegal('community')} className="footer-link">COMMUNITY STANDARDS</button>
      </footer>
    </div>
  );
}

function FeatureCard({
  tone, inkColor = 'var(--cream)', label, title, body,
}: { tone: string; inkColor?: string; label: string; title: string; body: string }) {
  return (
    <div style={{
      background: tone, color: inkColor,
      border: '3px solid var(--ink)',
      padding: 18,
      boxShadow: '4px 4px 0 var(--ink)',
    } as CSSProperties}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10,
                      letterSpacing: '0.15em', opacity: 0.85, marginBottom: 8 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 22,
                      letterSpacing: '0.02em', lineHeight: 1.05, marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 14, lineHeight: 1.4 }}>{body}</div>
    </div>
  );
}
