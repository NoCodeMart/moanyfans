import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Notification } from '../lib/api';

export function NotificationBell({ onOpenUser, onOpenMoan }:
  { onOpenUser: (h: string) => void; onOpenMoan: (id: string) => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement | null>(null);

  const unread = useQuery({
    queryKey: ['notif', 'unread'],
    queryFn: () => api.unreadCount(),
    refetchInterval: 30_000,
  });
  const list = useQuery({
    queryKey: ['notif', 'list'],
    queryFn: () => api.listNotifications(30),
    enabled: open,
    staleTime: 5_000,
  });
  const markAll = useMutation({
    mutationFn: () => api.markAllRead(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notif'] });
    },
  });

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  const count = unread.data?.unread ?? 0;

  return (
    <div style={{ position: 'relative' }} ref={popRef}>
      <button
        type="button"
        aria-label={`Notifications${count ? ` (${count} unread)` : ''}`}
        onClick={() => setOpen(o => !o)}
        className="masthead-bell"
      >
        <BellIcon />
        {count > 0 && <span className="masthead-bell-dot">{count > 99 ? '99+' : count}</span>}
      </button>

      {open && (
        <div className="notif-pop">
          <div className="notif-pop-head">
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, letterSpacing: '0.04em' }}>
              NOTIFICATIONS
            </span>
            <button type="button" onClick={() => markAll.mutate()}
              disabled={markAll.isPending || count === 0}
              className="notif-mark"
            >MARK ALL READ</button>
          </div>
          <div className="notif-pop-body">
            {list.isLoading && (
              <div style={{ padding: 16, fontFamily: 'var(--font-mono)', opacity: 0.6 }}>
                LOADING…
              </div>
            )}
            {!list.isLoading && (list.data?.length ?? 0) === 0 && (
              <div style={{ padding: 24, fontFamily: 'var(--font-mono)', fontSize: 12,
                              opacity: 0.6, textAlign: 'center' }}>
                No notifications yet. Get moaning to make some noise.
              </div>
            )}
            {list.data?.map(n => (
              <NotifRow key={n.id} n={n}
                         onOpenUser={(h) => { setOpen(false); onOpenUser(h); }}
                         onOpenMoan={(id) => { setOpen(false); onOpenMoan(id); }} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NotifRow({ n, onOpenUser, onOpenMoan }:
  { n: Notification; onOpenUser: (h: string) => void; onOpenMoan: (id: string) => void }) {
  const isUnread = !n.read_at;
  const p = n.payload;
  let body: React.ReactNode = null;
  let click: () => void = () => {};

  if (n.kind === 'followed') {
    const handle = String(p.follower_handle ?? 'someone');
    body = <><b>@{handle}</b> followed you.</>;
    click = () => onOpenUser(handle);
  } else if (n.kind === 'replied') {
    const handle = String(p.replier_handle ?? 'someone');
    body = <><b>@{handle}</b> replied: <i>"{String(p.preview ?? '').slice(0, 80)}"</i></>;
    click = () => onOpenMoan(String(p.parent_id ?? ''));
  } else if (n.kind === 'reaction') {
    const handle = String(p.reactor_handle ?? 'someone');
    const r = String(p.reaction ?? '');
    const label = r === 'laughs' ? '😂 HA'
                  : r === 'agrees' ? '💯 TRUE'
                  : r === 'cope' ? '🤡 CLOWN'
                  : '🧂 SEETHE';
    body = <><b>@{handle}</b> hit <b>{label}</b> on your moan.</>;
    click = () => onOpenMoan(String(p.moan_id ?? ''));
  } else {
    body = <span style={{ opacity: 0.7 }}>{n.kind.replace('_', ' ')}</span>;
  }

  return (
    <button type="button"
      onClick={click}
      className={'notif-row' + (isUnread ? ' notif-row-unread' : '')}
    >
      <span className="notif-row-time">{relativeTime(n.created_at)}</span>
      <span className="notif-row-body">{body}</span>
    </button>
  );
}

function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'NOW';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d`;
  return new Date(iso).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
}

const BellIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
        strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/>
    <path d="M13.7 21a2 2 0 0 1-3.4 0"/>
  </svg>
);
