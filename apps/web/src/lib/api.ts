const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

export type CurrentUser = {
  id: string;
  handle: string;
  email: string;
  team_id: string | null;
  is_admin: boolean;
  is_house_account: boolean;
  auth_enabled: boolean;
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
  return res.json() as Promise<T>;
}

export const api = {
  me: () => request<CurrentUser>('/me'),
  listTeams: (league?: string) =>
    request<Team[]>(`/teams${league ? `?league=${encodeURIComponent(league)}` : ''}`),
  getTeam: (slug: string) => request<Team>(`/teams/${slug}`),
};
