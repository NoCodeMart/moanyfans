import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useCurrentUser } from '../lib/auth';
import { useFeed, useSetTeam } from '../lib/hooks';
import { MoanCard } from './Live';

export function TeamFeed({ slug, onClose, onOpenMoan, onOpenUser }: {
  slug: string;
  onClose: () => void;
  onOpenMoan?: (id: string) => void;
  onOpenUser?: (handle: string) => void;
}) {
  const team = useQuery({
    queryKey: ['team', slug],
    queryFn: () => api.getTeam(slug),
    staleTime: 1000 * 60 * 60,
  });
  const moans = useFeed({ team: slug });
  const { user } = useCurrentUser();
  const setTeam = useSetTeam();

  const t = team.data;
  const isMine = !!user && user.team_id === t?.id;

  return (
    <div className="team-feed">
      <button type="button" onClick={onClose}
        style={{
          padding: '6px 12px', marginBottom: 12,
          fontFamily: 'var(--font-display)', fontSize: 13,
          background: 'var(--ink)', color: 'var(--cream)', border: 0, cursor: 'pointer',
        }}>← BACK</button>

      <header className="team-feed-banner" style={{
        background: t?.primary_color ?? 'var(--ink)',
        color: t?.secondary_color ?? 'var(--cream)',
      }}>
        <div className="team-feed-banner-grain" />
        <div className="team-feed-banner-content">
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11,
                          letterSpacing: '0.15em', opacity: 0.85 }}>
            {(t?.league ?? '').toUpperCase()} · {(t?.city ?? '').toUpperCase()}
          </div>
          <h1 className="headline" style={{
            fontSize: 'clamp(36px, 8vw, 64px)', margin: '6px 0 4px',
            color: t?.secondary_color ?? 'var(--cream)',
          }}>
            {t?.name ?? slug}
          </h1>
          {!isMine && t && user && (
            <button
              type="button"
              onClick={() => setTeam.mutate(t.slug)}
              disabled={setTeam.isPending}
              style={{
                marginTop: 8,
                background: t.secondary_color, color: t.primary_color,
                border: 0, padding: '8px 16px', cursor: 'pointer',
                fontFamily: 'var(--font-display)', fontSize: 13,
                letterSpacing: '0.05em', borderRadius: 999,
              }}
            >
              {setTeam.isPending ? '…' : 'SET AS MY TEAM'}
            </button>
          )}
          {isMine && (
            <span style={{
              display: 'inline-block', marginTop: 8,
              background: 'var(--cream)', color: 'var(--ink)',
              padding: '4px 10px',
              fontFamily: 'var(--font-mono)', fontSize: 11,
              letterSpacing: '0.1em',
            }}>
              CARD-CARRYING SUFFERER
            </span>
          )}
        </div>
      </header>

      <div className="feed-divider"><span>━━━ MOANS · {(t?.short_name ?? slug).toUpperCase()} ━━━</span></div>

      {moans.isLoading && <div style={{ fontFamily: 'var(--font-mono)' }}>LOADING…</div>}
      {!moans.isLoading && (moans.data?.length ?? 0) === 0 && (
        <div style={{ fontFamily: 'var(--font-mono)', textAlign: 'center', padding: 32, opacity: 0.55 }}>
          NO MOANS ABOUT {(t?.short_name ?? slug).toUpperCase()} YET. BE THE FIRST.
        </div>
      )}
      {moans.data?.map(m => (
        <MoanCard key={m.id} moan={m} onOpen={onOpenMoan} onOpenUser={onOpenUser} />
      ))}
    </div>
  );
}
