import {
  type UseQueryOptions, useMutation, useQuery, useQueryClient,
} from '@tanstack/react-query';
import { api, type CreateMoan, type CurrentUser, type Fixture, type Moan, type ProfileStats, type PublicUser, type ReactionKind, type Side, type Team, type ThreadItem, type UpdateMe } from './api';

export function useTeams(league?: string) {
  return useQuery<Team[]>({
    queryKey: ['teams', league ?? 'all'],
    queryFn: () => api.listTeams(league),
    staleTime: 1000 * 60 * 60, // teams change rarely
  });
}

export function useTeam(slug: string | undefined) {
  return useQuery<Team>({
    queryKey: ['teams', 'one', slug],
    queryFn: () => api.getTeam(slug!),
    enabled: !!slug,
    staleTime: 1000 * 60 * 60,
  });
}

type FeedFilters = {
  team?: string;
  kind?: 'MOAN' | 'ROAST' | 'BANTER';
  sport?: string;
  league?: string;
  following?: boolean;
};

export function useFeed(filters: FeedFilters = {}) {
  return useQuery<Moan[]>({
    queryKey: ['feed', filters],
    queryFn: () => filters.following
      ? api.followingFeed(50)
      : api.listMoans({ ...filters, limit: 50 }),
    staleTime: 30_000,
  });
}

export function useTrendingTags(window: '24h' | '7d' | '30d' | 'all' = '24h') {
  return useQuery({
    queryKey: ['trending-tags', window],
    queryFn: () => api.trendingTags(window, 12),
    staleTime: 60_000,
  });
}

export function useCreateMoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateMoan) => api.createMoan(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['trending-tags'] });
    },
  });
}

export function useReact(moanId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (kind: ReactionKind | null) => api.reactToMoan(moanId, kind),
    onMutate: async (kind) => {
      // Optimistic update across feed cache
      await qc.cancelQueries({ queryKey: ['feed'] });
      const updates: { key: readonly unknown[]; previous: Moan[] | undefined }[] = [];
      qc.getQueriesData<Moan[]>({ queryKey: ['feed'] }).forEach(([key, list]) => {
        if (!list) return;
        updates.push({ key, previous: list });
        const next = list.map((m) => {
          if (m.id !== moanId) return m;
          return applyOptimisticReaction(m, kind);
        });
        qc.setQueryData(key, next);
      });
      return { updates };
    },
    onError: (_err, _kind, ctx) => {
      ctx?.updates.forEach(({ key, previous }) => qc.setQueryData(key, previous));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['fixture-thread'] });
      qc.invalidateQueries({ queryKey: ['moan'] });
    },
  });
}

function applyOptimisticReaction(m: Moan, next: ReactionKind | null): Moan {
  const result: Moan = { ...m };
  if (m.your_reaction) {
    (result as Moan & Record<string, number>)[m.your_reaction] = Math.max(
      0,
      (m as unknown as Record<string, number>)[m.your_reaction] - 1,
    );
  }
  if (next) {
    (result as Moan & Record<string, number>)[next] = ((m as unknown as Record<string, number>)[next] ?? 0) + 1;
  }
  result.your_reaction = next;
  return result;
}

export function useFixture(id: string | null) {
  return useQuery<Fixture>({
    queryKey: ['fixture', id],
    queryFn: () => api.getFixture(id!),
    enabled: !!id,
    refetchInterval: 5000,
  });
}

export function useFixtureThread(id: string | null, side?: Side) {
  return useQuery<ThreadItem[]>({
    queryKey: ['fixture-thread', id, side ?? 'all'],
    queryFn: () => api.getFixtureThread(id!, side),
    enabled: !!id,
    refetchInterval: 3000,
  });
}

export function useMyStats() {
  return useQuery<ProfileStats>({
    queryKey: ['me', 'stats'],
    queryFn: () => api.myStats(),
    staleTime: 30_000,
  });
}

export function useMyMoans(limit = 20) {
  return useQuery<Moan[]>({
    queryKey: ['me', 'moans', limit],
    queryFn: () => api.myMoans(limit),
    staleTime: 15_000,
  });
}

export function useUser(handle: string | null) {
  return useQuery<PublicUser>({
    queryKey: ['user', handle],
    queryFn: () => api.getUser(handle!),
    enabled: !!handle,
    staleTime: 30_000,
  });
}

export function useUserMoans(handle: string | null) {
  return useQuery<Moan[]>({
    queryKey: ['user', handle, 'moans'],
    queryFn: () => api.userMoans(handle!),
    enabled: !!handle,
    staleTime: 30_000,
  });
}

export function useFollow(handle: string) {
  const qc = useQueryClient();
  return useMutation<PublicUser, Error, boolean>({
    mutationFn: (next) => next ? api.followUser(handle) : api.unfollowUser(handle),
    onSuccess: (data) => {
      qc.setQueryData(['user', handle], data);
      qc.invalidateQueries({ queryKey: ['feed'] });
    },
  });
}

export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation<CurrentUser, Error, UpdateMe>({
    mutationFn: (body) => api.updateMe(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export function useSetTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (team_slug: string) => api.setTeam(team_slug),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export type { UseQueryOptions };
