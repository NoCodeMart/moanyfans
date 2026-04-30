const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return `${API_URL}/media/${path}`;
}

export type ReactionKind = 'laughs' | 'agrees' | 'cope' | 'ratio';
export type MoanKind = 'MOAN' | 'ROAST' | 'BANTER';
export type MoanStatus = 'PUBLISHED' | 'HELD' | 'REJECTED' | 'REMOVED';

export type CurrentUser = {
  id: string;
  handle: string;
  email: string;
  team_id: string | null;
  team_slug: string | null;
  team_name: string | null;
  is_admin: boolean;
  is_house_account: boolean;
  auth_enabled: boolean;
  can_switch_team_at: string | null;
  bio: string | null;
  avatar_seed: string | null;
  avatar_style: string | null;
  created_at: string | null;
};

export type ProfileStats = {
  moans: number;
  laughs_received: number;
  agrees_received: number;
  cope_received: number;
  ratio_received: number;
  streak_days: number;
};

export type UpdateMe = {
  bio?: string | null;
  avatar_seed?: string | null;
  avatar_style?: string | null;
};

export type PublicUser = {
  id: string;
  handle: string;
  avatar_seed: string | null;
  avatar_style: string | null;
  bio: string | null;
  team_id: string | null;
  team_slug: string | null;
  team_name: string | null;
  team_primary: string | null;
  is_house_account: boolean;
  follower_count: number;
  following_count: number;
  moan_count: number;
  you_follow: boolean;
  follows_you: boolean;
  you_blocked: boolean;
  blocked_you: boolean;
  you_muted: boolean;
  created_at: string | null;
};

export type Notification = {
  id: string;
  kind: 'followed' | 'reaction' | 'replied' | 'reacted_milestone'
        | 'battle_challenged' | 'battle_won' | 'battle_lost'
        | 'match_starting' | 'weekly_digest' | 'roasted';
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

export type SearchHit = {
  type: 'moan' | 'user' | 'team';
  id: string;
  title: string;
  subtitle: string | null;
  accent: string | null;
  payload: Record<string, unknown>;
};

export type FollowListItem = {
  handle: string;
  avatar_seed: string | null;
  avatar_style: string | null;
  team_primary: string | null;
  bio: string | null;
  you_follow: boolean;
};

export type Team = {
  id: string;
  slug: string;
  name: string;
  short_name: string;
  city: string;
  country: string;
  league: string;
  sport: string;
  primary_color: string;
  secondary_color: string;
  founded_year: number | null;
};

export type UserRef = {
  id: string;
  handle: string;
  avatar_seed: string | null;
  avatar_style: string | null;
  team_id: string | null;
};

export type TeamRef = {
  id: string;
  slug: string;
  name: string;
  primary_color: string;
  secondary_color: string;
};

export type Moan = {
  id: string;
  user: UserRef;
  team: TeamRef | null;
  target_user: UserRef | null;
  parent_moan_id: string | null;
  kind: MoanKind;
  status: MoanStatus;
  text: string;
  rage_level: number;
  laughs: number;
  agrees: number;
  cope: number;
  ratio: number;
  reply_count: number;
  share_count: number;
  tags: string[];
  your_reaction: ReactionKind | null;
  media_path: string | null;
  media_w: number | null;
  media_h: number | null;
  media_mime: string | null;
  created_at: string;
};

export type MediaUpload = {
  media_path: string;
  media_w: number;
  media_h: number;
  media_mime: string;
};

export type TrendingTag = {
  tag: string;
  moans: number;
  sport: string | null;
};

export type FixtureStatus = 'SCHEDULED' | 'LIVE' | 'FT';

export type FixtureTeam = {
  id: string;
  slug: string;
  name: string;
  short_name: string;
  primary_color: string;
  secondary_color: string;
};

export type Fixture = {
  id: string;
  competition: string;
  home_team: FixtureTeam;
  away_team: FixtureTeam;
  kickoff_at: string;
  status: FixtureStatus;
  home_score: number | null;
  away_score: number | null;
  minute_estimate: number | null;
};

export type LiveEvent = {
  id: string;
  fixture_id: string;
  minute: number;
  text: string;
  source: string;
  created_at: string;
};

export type BattleStatus = 'PENDING' | 'ACTIVE' | 'CLOSED' | 'EXPIRED';

export type BattleUser = {
  id: string;
  handle: string;
  avatar_seed: string | null;
  team_id: string | null;
  team_slug: string | null;
  team_name: string | null;
};

export type Battle = {
  id: string;
  challenger: BattleUser;
  opponent: BattleUser;
  topic: string | null;
  status: BattleStatus;
  challenger_votes: number;
  opponent_votes: number;
  winner_id: string | null;
  expires_at: string;
  created_at: string;
  your_vote: string | null;
  message_count: number;
};

export type BattleMsg = {
  id: string;
  user_id: string;
  handle: string;
  text: string;
  created_at: string;
};

export type Side = 'HOME' | 'AWAY' | 'NEUTRAL';

export type CreateMoan = {
  kind: MoanKind;
  text: string;
  team_slug?: string;
  target_handle?: string;
  parent_moan_id?: string;
  rage_level?: number;
  fixture_id?: string;
  side?: Side;
  media_path?: string;
  media_w?: number;
  media_h?: number;
  media_mime?: string;
};

export type ThreadItem = {
  type: 'event' | 'moan';
  minute: number;
  created_at: string;
  text: string | null;
  source: string | null;
  moan_id: string | null;
  user_handle: string | null;
  user_avatar_seed: string | null;
  kind: MoanKind | null;
  side: Side | null;
  laughs: number | null;
  agrees: number | null;
  cope: number | null;
  ratio: number | null;
  your_reaction: ReactionKind | null;
  is_house: boolean | null;
};

export type AdminStats = {
  users_total: number;
  users_24h: number;
  moans_total: number;
  moans_24h: number;
  reports_open: number;
  moans_held: number;
};

export type ReportRow = {
  id: string;
  moan_id: string;
  moan_text: string;
  moan_status: string;
  moan_user_handle: string;
  moan_deleted: boolean;
  reporter_handle: string;
  reason: string;
  created_at: string;
};

export type AdminUserRow = {
  id: string;
  handle: string;
  is_admin: boolean;
  is_house: boolean;
  deleted: boolean;
  moan_count: number;
  follower_count: number;
  created_at: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    credentials: 'include',
  });
  if (!res.ok) {
    let detail: string;
    try {
      const body = (await res.json()) as { detail?: string };
      detail = body.detail ?? res.statusText;
    } catch {
      detail = res.statusText;
    }
    throw new Error(`${res.status}: ${detail}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  me: () => request<CurrentUser>('/me'),
  setTeam: (team_slug: string) => request<CurrentUser>('/me/team', {
    method: 'PUT',
    body: JSON.stringify({ team_slug }),
  }),
  updateMe: (body: UpdateMe) => request<CurrentUser>('/me', {
    method: 'PATCH',
    body: JSON.stringify(body),
  }),
  myStats: () => request<ProfileStats>('/me/stats'),
  myMoans: (limit = 20) =>
    request<Moan[]>(`/moans?mine=true&limit=${limit}`),
  getUser: (handle: string) => request<PublicUser>(`/users/${encodeURIComponent(handle)}`),
  userMoans: (handle: string, limit = 30) =>
    request<Moan[]>(`/moans?user=${encodeURIComponent(handle)}&limit=${limit}`),
  followUser: (handle: string) =>
    request<PublicUser>(`/users/${encodeURIComponent(handle)}/follow`, { method: 'POST' }),
  unfollowUser: (handle: string) =>
    request<PublicUser>(`/users/${encodeURIComponent(handle)}/follow`, { method: 'DELETE' }),
  blockUser: (handle: string) =>
    request<PublicUser>(`/users/${encodeURIComponent(handle)}/block`, { method: 'POST' }),
  unblockUser: (handle: string) =>
    request<PublicUser>(`/users/${encodeURIComponent(handle)}/block`, { method: 'DELETE' }),
  muteUser: (handle: string) =>
    request<PublicUser>(`/users/${encodeURIComponent(handle)}/mute`, { method: 'POST' }),
  unmuteUser: (handle: string) =>
    request<PublicUser>(`/users/${encodeURIComponent(handle)}/mute`, { method: 'DELETE' }),

  // ── Admin
  adminStats: () => request<AdminStats>('/admin/stats'),
  adminListReports: (resolved = false) =>
    request<ReportRow[]>(`/admin/reports?resolved=${resolved}`),
  adminResolveReport: (id: string) =>
    request<{ status: string }>(`/admin/reports/${id}/resolve`, { method: 'POST' }),
  adminModerateMoan: (id: string, action: 'remove' | 'restore' | 'publish') =>
    request<{ status: string }>(`/admin/moans/${id}/moderate`, {
      method: 'POST', body: JSON.stringify({ action }),
    }),
  adminListUsers: (q?: string, include_deleted = false) =>
    request<AdminUserRow[]>(`/admin/users?include_deleted=${include_deleted}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
  adminUserAction: (handle: string, action: 'ban' | 'unban' | 'make_admin' | 'remove_admin') =>
    request<{ status: string }>(`/admin/users/${encodeURIComponent(handle)}/action`, {
      method: 'POST', body: JSON.stringify({ action }),
    }),
  followingFeed: (limit = 50) =>
    request<Moan[]>(`/moans?following=true&limit=${limit}`),
  tagMoans: (slug: string, limit = 50) =>
    request<Moan[]>(`/moans?tag=${encodeURIComponent(slug)}&limit=${limit}`),

  listNotifications: (limit = 30) =>
    request<Notification[]>(`/notifications?limit=${limit}`),
  unreadCount: () => request<{ unread: number }>(`/notifications/unread-count`),
  vapidKey: () => request<{ public_key: string }>('/push/vapid-key'),
  subscribePush: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
    request<{ status: string }>('/me/push/subscribe', {
      method: 'POST', body: JSON.stringify(sub),
    }),
  unsubscribePush: (endpoint: string) =>
    request<{ status: string }>('/me/push/unsubscribe', {
      method: 'POST', body: JSON.stringify({ endpoint }),
    }),
  markAllRead: () => request<{ marked: number }>(`/notifications/mark-all-read`,
    { method: 'POST' }),

  search: (q: string) =>
    request<SearchHit[]>(`/search?q=${encodeURIComponent(q)}`),

  listTeams: (league?: string) =>
    request<Team[]>(`/teams${league ? `?league=${encodeURIComponent(league)}` : ''}`),
  getTeam: (slug: string) => request<Team>(`/teams/${slug}`),

  listMoans: (params: {
    team?: string;
    kind?: MoanKind;
    sport?: string;
    league?: string;
    limit?: number;
    before?: string;
  } = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v != null) q.set(k, String(v));
    }
    return request<Moan[]>(`/moans${q.toString() ? `?${q}` : ''}`);
  },
  getMoan: (id: string) => request<Moan>(`/moans/${id}`),
  listReplies: (moanId: string) => request<Moan[]>(`/moans/${moanId}/replies`),
  createMoan: (body: CreateMoan) =>
    request<Moan>('/moans', { method: 'POST', body: JSON.stringify(body) }),
  uploadMedia: async (file: File): Promise<MediaUpload> => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${API_URL}/media`, {
      method: 'POST',
      body: fd,
      credentials: 'include',
    });
    if (!res.ok) {
      let detail: string;
      try { detail = (await res.json()).detail ?? res.statusText; }
      catch { detail = res.statusText; }
      throw new Error(`${res.status}: ${detail}`);
    }
    return res.json() as Promise<MediaUpload>;
  },
  reactToMoan: (moanId: string, kind: ReactionKind | null) =>
    request<Moan>(`/moans/${moanId}/react`, {
      method: 'POST',
      body: JSON.stringify({ kind }),
    }),
  deleteMoan: (moanId: string) =>
    request<{ status: string }>(`/moans/${moanId}`, { method: 'DELETE' }),
  reportMoan: (moanId: string, reason: string) =>
    request<{ status: string }>(`/moans/${moanId}/report`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  trendingTags: (window: '24h' | '7d' | '30d' | 'all' = '24h', limit = 20) =>
    request<TrendingTag[]>(`/tags/trending?window=${window}&limit=${limit}`),

  listFixtures: (params: { status?: FixtureStatus; team?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v != null) q.set(k, String(v));
    return request<Fixture[]>(`/fixtures${q.toString() ? `?${q}` : ''}`);
  },
  getFixture: (id: string) => request<Fixture>(`/fixtures/${id}`),
  listFixtureEvents: (id: string) => request<LiveEvent[]>(`/fixtures/${id}/events`),
  getFixtureThread: (id: string, side?: Side) =>
    request<ThreadItem[]>(`/fixtures/${id}/thread${side ? `?side=${side}` : ''}`),
  fixtureStreamUrl: (id: string) => `${API_URL}/fixtures/${id}/stream`,

  listBattles: (status?: BattleStatus) =>
    request<Battle[]>(`/battles${status ? `?status=${status}` : ''}`),
  getBattle: (id: string) => request<Battle>(`/battles/${id}`),
  listBattleMessages: (id: string) => request<BattleMsg[]>(`/battles/${id}/messages`),
  createBattle: (opponent_handle: string, topic?: string | null) =>
    request<Battle>('/battles', {
      method: 'POST',
      body: JSON.stringify({ opponent_handle, topic }),
    }),
  postBattleMessage: (id: string, text: string) =>
    request<BattleMsg>(`/battles/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
  voteBattle: (id: string, vote_for_user_id: string) =>
    request<Battle>(`/battles/${id}/vote`, {
      method: 'POST',
      body: JSON.stringify({ vote_for_user_id }),
    }),
};
