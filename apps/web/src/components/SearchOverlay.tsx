import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type SearchHit } from '../lib/api';

export function SearchOverlay({ onClose, onPickMoan, onPickUser, onPickTeam }: {
  onClose: () => void;
  onPickMoan: (id: string) => void;
  onPickUser: (handle: string) => void;
  onPickTeam: (slug: string) => void;
}) {
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const results = useQuery<SearchHit[]>({
    queryKey: ['search', debouncedQ],
    queryFn: () => api.search(debouncedQ),
    enabled: debouncedQ.length >= 2,
    staleTime: 30_000,
  });

  const grouped = useMemo(() => {
    const teams: SearchHit[] = [];
    const users: SearchHit[] = [];
    const moans: SearchHit[] = [];
    for (const h of results.data ?? []) {
      if (h.type === 'team') teams.push(h);
      else if (h.type === 'user') users.push(h);
      else moans.push(h);
    }
    return { teams, users, moans };
  }, [results.data]);

  const pick = (h: SearchHit) => {
    if (h.type === 'moan') onPickMoan(h.id);
    else if (h.type === 'user') onPickUser(h.id);
    else if (h.type === 'team') onPickTeam(h.id);
  };

  return (
    <div className="search-scrim" onClick={onClose}>
      <div className="search-card" onClick={(e) => e.stopPropagation()}>
        <div className="search-input-row">
          <span style={{ opacity: 0.6, fontSize: 18 }}>🔎</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search moans, fans, teams…"
            className="search-input"
          />
          <button type="button" onClick={onClose} className="search-close"
                   aria-label="Close search">✕</button>
        </div>

        <div className="search-results">
          {debouncedQ.length < 2 && (
            <div className="search-empty">Type at least 2 characters.</div>
          )}
          {debouncedQ.length >= 2 && results.isLoading && (
            <div className="search-empty">SEARCHING…</div>
          )}
          {debouncedQ.length >= 2 && !results.isLoading && (results.data?.length ?? 0) === 0 && (
            <div className="search-empty">No matches for "{debouncedQ}".</div>
          )}
          {grouped.teams.length > 0 && (
            <Group title="TEAMS">
              {grouped.teams.map(h => (
                <ResultRow key={`team-${h.id}`} hit={h} onPick={() => pick(h)} />
              ))}
            </Group>
          )}
          {grouped.users.length > 0 && (
            <Group title="FANS">
              {grouped.users.map(h => (
                <ResultRow key={`user-${h.id}`} hit={h} onPick={() => pick(h)} />
              ))}
            </Group>
          )}
          {grouped.moans.length > 0 && (
            <Group title="MOANS">
              {grouped.moans.map(h => (
                <ResultRow key={`moan-${h.id}`} hit={h} onPick={() => pick(h)} />
              ))}
            </Group>
          )}
        </div>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="search-group">
      <div className="search-group-head">{title}</div>
      {children}
    </div>
  );
}

function ResultRow({ hit, onPick }: { hit: SearchHit; onPick: () => void }) {
  return (
    <button type="button" onClick={onPick} className="search-row">
      <span className="search-row-dot" style={{ background: hit.accent ?? 'var(--ink)' }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <div className="search-row-title">{hit.title}</div>
        {hit.subtitle && <div className="search-row-sub">{hit.subtitle}</div>}
      </span>
      <span className="search-row-type">{hit.type.toUpperCase()}</span>
    </button>
  );
}
