import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { MoanCard } from './Live';

export function TagFeed({ slug, onClose, onOpenMoan, onOpenUser, onOpenTeam }: {
  slug: string;
  onClose: () => void;
  onOpenMoan?: (id: string) => void;
  onOpenUser?: (handle: string) => void;
  onOpenTeam?: (slug: string) => void;
}) {
  const cleanSlug = slug.replace(/^#/, '').toUpperCase();
  const moans = useQuery({
    queryKey: ['tag', cleanSlug, 'moans'],
    queryFn: () => api.tagMoans(cleanSlug),
    staleTime: 30_000,
  });

  return (
    <div className="tag-feed">
      <button type="button" onClick={onClose}
        style={{
          padding: '6px 12px', marginBottom: 12,
          fontFamily: 'var(--font-display)', fontSize: 13,
          background: 'var(--ink)', color: 'var(--cream)', border: 0, cursor: 'pointer',
        }}>← BACK</button>

      <header className="tag-feed-banner">
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11,
                        letterSpacing: '0.15em', opacity: 0.7 }}>HASHTAG · TRENDING</div>
        <h1 className="headline" style={{
          fontSize: 'clamp(40px, 9vw, 80px)', margin: '4px 0 8px',
          color: 'var(--cream)',
          textShadow: '4px 4px 0 var(--red)',
        }}>#{cleanSlug}</h1>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, opacity: 0.7 }}>
          {moans.data ? `${moans.data.length} MOANS` : 'LOADING…'}
        </div>
      </header>

      <div className="feed-divider"><span>━━━ MOANS · #{cleanSlug} ━━━</span></div>

      {!moans.isLoading && (moans.data?.length ?? 0) === 0 && (
        <div style={{ fontFamily: 'var(--font-mono)', textAlign: 'center', padding: 32, opacity: 0.55 }}>
          NO MOANS UNDER THIS TAG YET.
        </div>
      )}
      {moans.data?.map(m => (
        <MoanCard key={m.id} moan={m}
                   onOpen={onOpenMoan}
                   onOpenUser={onOpenUser}
                   onOpenTeam={onOpenTeam} />
      ))}
    </div>
  );
}
