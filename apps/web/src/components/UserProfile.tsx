import type { CSSProperties } from 'react';
import { api, type PublicUser } from '../lib/api';
import { useCurrentUser } from '../lib/auth';
import { useFollow, useUser, useUserMoans } from '../lib/hooks';
import { MoanCard } from './Live';
import { useMutation, useQueryClient } from '@tanstack/react-query';

function MuteToggle({ handle, muted }: { handle: string; muted: boolean }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => muted ? api.unmuteUser(handle) : api.muteUser(handle),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user', handle] });
      qc.invalidateQueries({ queryKey: ['feed'] });
    },
  });
  return (
    <button
      type="button"
      onClick={() => m.mutate()}
      disabled={m.isPending}
      title={muted ? 'Unmute' : 'Hide their moans from your feed'}
      style={{
        background: muted ? 'var(--ink)' : 'var(--paper)',
        color: muted ? 'var(--cream)' : 'var(--ink)',
        border: '2px solid var(--ink)',
        padding: '8px 14px', cursor: 'pointer',
        fontFamily: 'var(--font-display)', fontSize: 13,
        letterSpacing: '0.05em', borderRadius: 999,
      }}
    >
      {m.isPending ? '…' : muted ? 'UNMUTE' : 'MUTE'}
    </button>
  );
}

function BlockToggle({ handle, blocked }: { handle: string; blocked: boolean }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => blocked ? api.unblockUser(handle) : api.blockUser(handle),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user', handle] });
      qc.invalidateQueries({ queryKey: ['feed'] });
    },
  });
  const confirmAndRun = () => {
    if (blocked || window.confirm(`Block @${handle}? You won't see each other anywhere.`)) {
      m.mutate();
    }
  };
  return (
    <button
      type="button"
      onClick={confirmAndRun}
      disabled={m.isPending}
      title={blocked ? 'Unblock' : 'Block this user'}
      style={{
        background: blocked ? 'var(--ink)' : 'var(--paper)',
        color: blocked ? 'var(--cream)' : 'var(--ink)',
        border: '2px solid var(--ink)',
        padding: '8px 14px', cursor: 'pointer',
        fontFamily: 'var(--font-display)', fontSize: 13,
        letterSpacing: '0.05em', borderRadius: 999,
      }}
    >
      {m.isPending ? '…' : blocked ? 'UNBLOCK' : 'BLOCK'}
    </button>
  );
}

function PublicAvatar({ user, size = 120 }:
  { user: { handle: string; avatar_seed: string | null; avatar_style: string | null; team_primary: string | null }; size?: number }) {
  const seed = user.avatar_seed || user.handle;
  if (user.avatar_style) {
    const url = `https://api.dicebear.com/9.x/${encodeURIComponent(user.avatar_style)}/svg?seed=${encodeURIComponent(seed)}`;
    return (
      <span style={{
        width: size, height: size, display: 'inline-block',
        borderRadius: '50%', overflow: 'hidden',
        border: '3px solid var(--ink)',
        boxShadow: '4px 4px 0 var(--ink)',
        background: 'var(--cream)',
      }}>
        <img src={url} alt={`@${user.handle} avatar`} width={size} height={size}
              style={{ display: 'block', width: '100%', height: '100%' }} />
      </span>
    );
  }
  // Fallback solid avatar with initials
  const initials = (user.avatar_seed ?? user.handle).slice(0, 2).toUpperCase();
  return (
    <span style={{
      width: size, height: size, display: 'inline-grid', placeItems: 'center',
      borderRadius: '50%', border: '3px solid var(--ink)',
      boxShadow: '4px 4px 0 var(--ink)',
      background: user.team_primary ?? 'var(--ink)',
      color: 'var(--cream)',
      fontFamily: 'var(--font-display)', fontSize: size * 0.42,
    } as CSSProperties}>{initials}</span>
  );
}

export function UserProfileView({
  handle, onClose, onPickHandle,
}: {
  handle: string;
  onClose: () => void;
  onPickHandle?: (h: string) => void;
}) {
  const { user: me } = useCurrentUser();
  const u = useUser(handle);
  const moans = useUserMoans(handle);
  const follow = useFollow(handle);
  const data = u.data;
  const isMe = me?.handle?.toLowerCase() === handle.toLowerCase();

  return (
    <div className="profile-page">
      <button type="button" onClick={onClose}
        style={{
          padding: '6px 12px', marginBottom: 12,
          fontFamily: 'var(--font-display)', fontSize: 13,
          background: 'var(--ink)', color: 'var(--cream)', border: 0, cursor: 'pointer',
        }}>← BACK</button>

      <div className="profile-banner" style={{
        background: data?.team_primary ?? 'var(--ink)',
      }}>
        <div className="profile-banner-grain" />
      </div>

      <div className="profile-id-row">
        <PublicAvatar user={{
          handle: data?.handle ?? handle,
          avatar_seed: data?.avatar_seed ?? null,
          avatar_style: data?.avatar_style ?? null,
          team_primary: data?.team_primary ?? null,
        }} size={120} />
        <div className="profile-id-text">
          <div className="profile-handle">
            @{data?.handle ?? handle}
            {data?.is_house_account && (
              <span title="AI conversation starter — not a real fan"
                    style={{
                marginLeft: 8, padding: '2px 6px',
                background: 'var(--ink)', color: 'var(--cream)',
                fontFamily: 'var(--font-mono)', fontSize: 10,
                letterSpacing: '0.1em',
              }}>AI</span>
            )}
            {data?.follows_you && !isMe && (
              <span style={{
                marginLeft: 8, padding: '2px 6px',
                background: 'var(--cream-2)', color: 'var(--ink)',
                fontFamily: 'var(--font-mono)', fontSize: 10,
                letterSpacing: '0.1em',
              }}>FOLLOWS YOU</span>
            )}
          </div>
          <div className="profile-meta">
            {data?.team_name && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span className="profile-team-dot"
                       style={{ background: data.team_primary ?? 'var(--ink)' }} />
                {data.team_name}
              </span>
            )}
            {data?.created_at && (
              <span style={{ opacity: 0.55 }}>· joined {new Date(data.created_at).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</span>
            )}
          </div>
        </div>
        {!isMe && data && (
          <div style={{ display: 'flex', gap: 8, alignSelf: 'flex-end', marginBottom: 8 }}>
            {!data.you_blocked && (
              <button
                type="button"
                onClick={() => follow.mutate(!data.you_follow)}
                disabled={follow.isPending || data.blocked_you}
                style={{
                  background: data.you_follow ? 'var(--cream)' : 'var(--red)',
                  color: data.you_follow ? 'var(--ink)' : 'var(--cream)',
                  border: '2px solid var(--ink)',
                  padding: '8px 18px', cursor: 'pointer',
                  fontFamily: 'var(--font-display)', fontSize: 13,
                  letterSpacing: '0.05em', borderRadius: 999,
                }}
              >
                {follow.isPending ? '…' : data.you_follow ? 'FOLLOWING ✓' : 'FOLLOW +'}
              </button>
            )}
            {!data.you_blocked && (
              <MuteToggle handle={handle} muted={data.you_muted} />
            )}
            <BlockToggle handle={handle} blocked={data.you_blocked} />
          </div>
        )}
      </div>

      {data?.bio && (
        <div className="profile-bio">
          <div className="profile-bio-display" style={{ cursor: 'default' }}>{data.bio}</div>
        </div>
      )}

      <div className="profile-stats">
        <button type="button" className="profile-stat"
                 onClick={() => onPickHandle?.(handle)}
                 style={{ cursor: 'pointer' }}>
          <div className="profile-stat-num">{data?.moan_count ?? 0}</div>
          <div className="profile-stat-lbl">MOANS</div>
        </button>
        <div className="profile-stat">
          <div className="profile-stat-num">{data?.follower_count ?? 0}</div>
          <div className="profile-stat-lbl">FOLLOWERS</div>
        </div>
        <div className="profile-stat">
          <div className="profile-stat-num">{data?.following_count ?? 0}</div>
          <div className="profile-stat-lbl">FOLLOWING</div>
        </div>
      </div>

      <div className="feed-divider"><span>━━━ MOANS BY @{(data?.handle ?? handle).toUpperCase()} ━━━</span></div>
      {moans.isLoading && <div style={{ fontFamily: 'var(--font-mono)' }}>LOADING…</div>}
      {!moans.isLoading && (moans.data?.length ?? 0) === 0 && (
        <div style={{ fontFamily: 'var(--font-mono)', textAlign: 'center', padding: 32, opacity: 0.55 }}>
          NO MOANS YET.
        </div>
      )}
      {moans.data?.map(m => <MoanCard key={m.id} moan={m} />)}
    </div>
  );
}

export type { PublicUser };
