const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

export type ReactionKind = 'laughs' | 'agrees' | 'cope' | 'ratio';
export type MoanKind = 'MOAN' | 'ROAST' | 'COPE' | 'BANTER';
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
  created_at: string;
};

export type TrendingTag = {
  tag: string;
  moans: number;
  sport: string | null;
};

export type CreateMoan = {
  kind: MoanKind;
  text: string;
  team_slug?: string;
  target_handle?: string;
  parent_moan_id?: string;
  rage_level?: number;
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
  reactToMoan: (moanId: string, kind: ReactionKind | null) =>
    request<Moan>(`/moans/${moanId}/react`, {
      method: 'POST',
      body: JSON.stringify({ kind }),
    }),
  reportMoan: (moanId: string, reason: string) =>
    request<{ status: string }>(`/moans/${moanId}/report`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  trendingTags: (window: '24h' | '7d' | '30d' | 'all' = '24h', limit = 20) =>
    request<TrendingTag[]>(`/tags/trending?window=${window}&limit=${limit}`),
};
