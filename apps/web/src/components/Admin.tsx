import { useState, type CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type AdminUserRow, type ReportRow } from '../lib/api';
import { useCurrentUser } from '../lib/auth';

type Tab = 'overview' | 'reports' | 'users';

export function AdminPage() {
  const { user, loading } = useCurrentUser();
  const [tab, setTab] = useState<Tab>('overview');

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>;
  if (!user || !user.is_admin) {
    return (
      <div style={{ padding: 32, textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
        You don't have access to this area.
      </div>
    );
  }

  return (
    <div style={{ padding: '16px 0 80px' }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 36, margin: '0 0 12px' }}>
        ADMIN CONSOLE
      </h1>
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {(['overview', 'reports', 'users'] as Tab[]).map(t => (
          <button key={t} type="button" onClick={() => setTab(t)} style={pillStyle(tab === t)}>
            {t.toUpperCase()}
          </button>
        ))}
      </div>
      {tab === 'overview' && <Overview />}
      {tab === 'reports' && <Reports />}
      {tab === 'users' && <Users />}
    </div>
  );
}

function pillStyle(active: boolean): CSSProperties {
  return {
    fontFamily: 'var(--font-display)', fontSize: 13,
    letterSpacing: '0.05em', padding: '6px 14px',
    border: '2px solid var(--ink)',
    background: active ? 'var(--ink)' : 'var(--paper)',
    color: active ? 'var(--cream)' : 'var(--ink)',
    cursor: 'pointer',
  };
}

function Overview() {
  const stats = useQuery({ queryKey: ['admin', 'stats'], queryFn: api.adminStats, refetchInterval: 30_000 });
  if (stats.isLoading) return <div>Loading…</div>;
  const s = stats.data;
  if (!s) return <div>Couldn't load stats.</div>;
  const cards = [
    { label: 'USERS', value: s.users_total, sub: `+${s.users_24h} in 24h` },
    { label: 'MOANS', value: s.moans_total, sub: `+${s.moans_24h} in 24h` },
    { label: 'OPEN REPORTS', value: s.reports_open, sub: 'Awaiting review' },
    { label: 'HELD MOANS', value: s.moans_held, sub: 'Auto-flagged' },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
      {cards.map(c => (
        <div key={c.label} style={{
          background: 'var(--paper)', border: '2px solid var(--ink)',
          padding: 16, boxShadow: '3px 3px 0 var(--ink)',
        }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11,
                          letterSpacing: '0.1em', opacity: 0.7 }}>{c.label}</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 36, lineHeight: 1.1 }}>
            {c.value.toLocaleString()}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, opacity: 0.6 }}>
            {c.sub}
          </div>
        </div>
      ))}
    </div>
  );
}

function Reports() {
  const qc = useQueryClient();
  const [showResolved, setShowResolved] = useState(false);
  const reports = useQuery({
    queryKey: ['admin', 'reports', showResolved],
    queryFn: () => api.adminListReports(showResolved),
  });
  const resolve = useMutation({
    mutationFn: (id: string) => api.adminResolveReport(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'reports'] }),
  });
  const moderate = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'remove' | 'restore' | 'publish' }) =>
      api.adminModerateMoan(id, action),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'reports'] });
      qc.invalidateQueries({ queryKey: ['feed'] });
    },
  });
  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          <input type="checkbox" checked={showResolved}
            onChange={e => setShowResolved(e.target.checked)} /> Show resolved
        </label>
      </div>
      {reports.isLoading && <div>Loading…</div>}
      {!reports.isLoading && (reports.data?.length ?? 0) === 0 && (
        <div style={{ padding: 24, opacity: 0.6, fontFamily: 'var(--font-mono)' }}>
          No reports.
        </div>
      )}
      {reports.data?.map(r => <ReportCard key={r.id} r={r} resolve={resolve} moderate={moderate} />)}
    </div>
  );
}

function ReportCard({ r, resolve, moderate }: {
  r: ReportRow;
  resolve: { mutate: (id: string) => void; isPending: boolean };
  moderate: { mutate: (v: { id: string; action: 'remove' | 'restore' | 'publish' }) => void; isPending: boolean };
}) {
  return (
    <div style={{
      background: 'var(--paper)', border: '2px solid var(--ink)',
      padding: 14, marginBottom: 12, boxShadow: '3px 3px 0 var(--ink)',
    }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 14 }}>
          @{r.moan_user_handle}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, opacity: 0.7 }}>
          {r.moan_status}{r.moan_deleted ? ' · deleted' : ''}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, opacity: 0.7 }}>
          reported by @{r.reporter_handle} · {new Date(r.created_at).toLocaleString('en-GB')}
        </span>
      </div>
      <div style={{ marginBottom: 8 }}>{r.moan_text}</div>
      <div style={{ marginBottom: 10, fontFamily: 'var(--font-mono)', fontSize: 12, opacity: 0.8 }}>
        Reason: {r.reason}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => moderate.mutate({ id: r.moan_id, action: 'remove' })}
          disabled={moderate.isPending}
          style={btn('var(--red)', 'var(--cream)')}>REMOVE MOAN</button>
        {r.moan_deleted && (
          <button type="button" onClick={() => moderate.mutate({ id: r.moan_id, action: 'restore' })}
            disabled={moderate.isPending}
            style={btn('var(--green, #06a77d)', 'var(--cream)')}>RESTORE</button>
        )}
        <a href={`/m/${r.moan_id}`} target="_blank" rel="noreferrer"
           style={{ ...btn('var(--paper)', 'var(--ink)'), textDecoration: 'none' }}>
          VIEW MOAN ↗
        </a>
        <a href={`/?u=${encodeURIComponent(r.moan_user_handle)}`}
           style={{ ...btn('var(--paper)', 'var(--ink)'), textDecoration: 'none' }}>
          VIEW USER ↗
        </a>
        <button type="button" onClick={() => resolve.mutate(r.id)} disabled={resolve.isPending}
          style={btn('var(--ink)', 'var(--cream)')}>MARK RESOLVED</button>
      </div>
    </div>
  );
}

function Users() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const users = useQuery({
    queryKey: ['admin', 'users', q, includeDeleted],
    queryFn: () => api.adminListUsers(q || undefined, includeDeleted),
  });
  const action = useMutation({
    mutationFn: ({ handle, action }: { handle: string; action: 'ban' | 'unban' | 'make_admin' | 'remove_admin' }) =>
      api.adminUserAction(handle, action),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <input value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search handles…"
          style={{
            padding: '6px 10px', border: '2px solid var(--ink)',
            background: 'var(--paper)', fontFamily: 'var(--font-mono)', fontSize: 13,
            flex: 1, maxWidth: 300,
          }} />
        <label style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          <input type="checkbox" checked={includeDeleted}
            onChange={e => setIncludeDeleted(e.target.checked)} /> Include banned
        </label>
      </div>
      {users.isLoading && <div>Loading…</div>}
      {users.data?.map(u => <UserRow key={u.id} u={u} action={action} />)}
    </div>
  );
}

function UserRow({ u, action }: {
  u: AdminUserRow;
  action: { mutate: (v: { handle: string; action: 'ban' | 'unban' | 'make_admin' | 'remove_admin' }) => void; isPending: boolean };
}) {
  return (
    <div style={{
      background: 'var(--paper)', border: '2px solid var(--ink)',
      padding: 12, marginBottom: 8, display: 'flex', gap: 12, alignItems: 'center',
      boxShadow: '2px 2px 0 var(--ink)',
      opacity: u.deleted ? 0.55 : 1,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 16 }}>
          @{u.handle}
          {u.is_admin && <span style={tag('var(--red)')}>ADMIN</span>}
          {u.is_house && <span style={tag('var(--ink)')}>AI</span>}
          {u.deleted && <span style={tag('#888')}>BANNED</span>}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, opacity: 0.65 }}>
          {u.moan_count} moans · {u.follower_count} followers · joined {new Date(u.created_at).toLocaleDateString('en-GB')}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {!u.deleted && (
          <button type="button" disabled={action.isPending}
            onClick={() => { if (window.confirm(`Ban @${u.handle}?`)) action.mutate({ handle: u.handle, action: 'ban' }); }}
            style={btn('var(--red)', 'var(--cream)')}>BAN</button>
        )}
        {u.deleted && (
          <button type="button" disabled={action.isPending}
            onClick={() => action.mutate({ handle: u.handle, action: 'unban' })}
            style={btn('var(--green, #06a77d)', 'var(--cream)')}>UNBAN</button>
        )}
        {!u.is_admin && (
          <button type="button" disabled={action.isPending}
            onClick={() => action.mutate({ handle: u.handle, action: 'make_admin' })}
            style={btn('var(--paper)', 'var(--ink)')}>+ ADMIN</button>
        )}
        {u.is_admin && (
          <button type="button" disabled={action.isPending}
            onClick={() => action.mutate({ handle: u.handle, action: 'remove_admin' })}
            style={btn('var(--paper)', 'var(--ink)')}>− ADMIN</button>
        )}
      </div>
    </div>
  );
}

function btn(bg: string, color: string): CSSProperties {
  return {
    background: bg, color, border: '2px solid var(--ink)',
    padding: '6px 12px', cursor: 'pointer',
    fontFamily: 'var(--font-display)', fontSize: 12, letterSpacing: '0.05em',
  };
}

function tag(bg: string): CSSProperties {
  return {
    marginLeft: 8, fontSize: 9, padding: '2px 6px',
    fontFamily: 'var(--font-mono)', letterSpacing: '0.1em',
    background: bg, color: 'var(--cream)',
  };
}
