import { useEffect, useState, type CSSProperties } from 'react';
import { Wordmark } from './Brand';

const STORAGE_KEY = 'moanyfans:waitlist';

export function ComingSoon() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState<boolean>(() => !!localStorage.getItem(STORAGE_KEY));
  const [busy, setBusy] = useState(false);

  useEffect(() => { document.title = 'MOANYFANS — coming soon'; }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!/.+@.+\..+/.test(trimmed)) return;
    setBusy(true);
    // Park locally for now — real waitlist endpoint is post-launch work.
    const list = JSON.parse(localStorage.getItem('moanyfans:waitlist:emails') ?? '[]');
    if (!list.includes(trimmed)) list.push(trimmed);
    localStorage.setItem('moanyfans:waitlist:emails', JSON.stringify(list));
    localStorage.setItem(STORAGE_KEY, trimmed);
    setTimeout(() => { setDone(true); setBusy(false); }, 250);
  }

  return (
    <div style={wrap}>
      <div style={grain} />
      <div style={inner}>
        <div style={{ marginBottom: 24 }}>
          <Wordmark />
        </div>
        <div style={badge}>● COMING SOON</div>
        <h1 style={h1}>The pub<br />without the pub.</h1>
        <p style={lede}>
          Premier League. Old Firm. Championship. Every match, every meltdown — one feed. Built by fans, for fans, with no algorithm trying to sell you a fitness watch.
        </p>

        {done ? (
          <div style={doneBox}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18 }}>YOU'RE ON THE LIST.</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, opacity: 0.7, marginTop: 6 }}>
              We'll ping you the second the doors open.
            </div>
          </div>
        ) : (
          <form onSubmit={submit} style={form}>
            <input
              type="email"
              required
              placeholder="your@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              style={input}
            />
            <button type="submit" disabled={busy} style={btn}>
              {busy ? '…' : 'GET EARLY ACCESS'}
            </button>
          </form>
        )}

        <div style={footer}>
          <span>NO ADS · NO BOTS · NO MIDDLE-CLASS PUNDITRY</span>
        </div>
      </div>
    </div>
  );
}

const wrap: CSSProperties = {
  position: 'fixed', inset: 0,
  background: 'radial-gradient(circle at 30% 20%, #1a1a1a 0%, #0a0a0a 60%, #000 100%)',
  color: 'var(--cream)',
  display: 'grid', placeItems: 'center',
  padding: 24, overflow: 'auto',
};

const grain: CSSProperties = {
  position: 'absolute', inset: 0,
  backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' /%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\' opacity=\'0.35\'/%3E%3C/svg%3E")',
  opacity: 0.18, pointerEvents: 'none', mixBlendMode: 'overlay',
};

const inner: CSSProperties = {
  position: 'relative', zIndex: 1,
  maxWidth: 560, width: '100%',
  textAlign: 'left',
};

const badge: CSSProperties = {
  display: 'inline-block',
  fontFamily: 'var(--font-mono)', fontSize: 11,
  letterSpacing: '0.2em',
  padding: '4px 10px',
  background: 'var(--red, #e63946)', color: '#fff',
  marginBottom: 18,
};

const h1: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: 'clamp(40px, 8vw, 72px)',
  lineHeight: 0.95, margin: '0 0 18px',
  letterSpacing: '-0.02em',
};

const lede: CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 14,
  lineHeight: 1.6, opacity: 0.78,
  margin: '0 0 28px', maxWidth: 460,
};

const form: CSSProperties = {
  display: 'flex', gap: 0,
  border: '2px solid var(--cream)',
  background: 'transparent',
  maxWidth: 460,
};

const input: CSSProperties = {
  flex: 1, minWidth: 0,
  background: 'transparent', border: 0,
  color: 'var(--cream)',
  padding: '12px 14px',
  fontFamily: 'var(--font-mono)', fontSize: 14,
  outline: 'none',
};

const btn: CSSProperties = {
  background: 'var(--cream)', color: '#000',
  border: 0, padding: '12px 18px', cursor: 'pointer',
  fontFamily: 'var(--font-display)', fontSize: 13,
  letterSpacing: '0.05em', whiteSpace: 'nowrap',
};

const doneBox: CSSProperties = {
  border: '2px solid var(--cream)',
  padding: '18px 20px', maxWidth: 460,
  background: 'rgba(255,255,255,0.04)',
};

const footer: CSSProperties = {
  marginTop: 32,
  fontFamily: 'var(--font-mono)', fontSize: 10,
  letterSpacing: '0.18em', opacity: 0.45,
};
