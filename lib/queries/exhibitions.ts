import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useUserId } from '@/lib/auth';
import {
  countPendingArtifacts,
  listArtifactSyncProblems,
  type ArtifactSyncCounts,
  type ArtifactSyncProblem,
} from '@/lib/db/artifacts';
import {
  countPendingArtifactPhotos,
  type ArtifactPhotoSyncCounts,
} from '@/lib/db/artifactPhotos';
import {
  countPendingSync,
  createExhibition,
  getExhibition,
  listExhibitions,
  softDeleteExhibition,
  type ExhibitionRow,
  type SyncCounts,
} from '@/lib/db/exhibitions';
import {
  countPendingImpressions,
  listImpressionSyncProblems,
  type ImpressionSyncCounts,
  type ImpressionSyncProblem,
} from '@/lib/db/impressions';
import { toError } from '@/lib/errors';
import { runManualSync, runSync } from '@/lib/sync';

export type Exhibition = ExhibitionRow;

export type ExhibitionInput = {
  name: string;
  museum?: string | null;
  visit_date?: string | null;
};

const ROOT = ['exhibitions'] as const;
const SYNC_ROOT = ['sync-status'] as const;

const exhibitionsListKey = (userId: string | undefined) =>
  [...ROOT, 'list', userId ?? '__none__'] as const;
const exhibitionDetailKey = (id: string) => [...ROOT, 'detail', id] as const;
const syncCountsKey = (userId: string | undefined) =>
  [...SYNC_ROOT, userId ?? '__none__'] as const;

export function useExhibitions() {
  const userId = useUserId();
  return useQuery({
    queryKey: exhibitionsListKey(userId),
    queryFn: async (): Promise<Exhibition[]> => {
      if (!userId) return [];
      try {
        return await listExhibitions(userId);
      } catch (e) {
        throw toError(e);
      }
    },
    enabled: !!userId,
  });
}

export function useExhibition(id: string | undefined) {
  return useQuery({
    queryKey: id ? exhibitionDetailKey(id) : [...ROOT, 'detail', '__none__'],
    queryFn: async (): Promise<Exhibition> => {
      if (!id) throw new Error('No id');
      try {
        const row = await getExhibition(id);
        if (!row) throw new Error('展览不存在或已被删除');
        return row;
      } catch (e) {
        throw toError(e);
      }
    },
    enabled: !!id,
  });
}

export type AggregateSyncCounts = {
  exhibitions: SyncCounts;
  artifacts: ArtifactSyncCounts;
  artifactPhotos: ArtifactPhotoSyncCounts;
  impressions: ImpressionSyncCounts;
  artifactProblems: ArtifactSyncProblem[];
  impressionProblems: ImpressionSyncProblem[];
  totalPending: number;
  totalFailed: number;
};

export function useSyncStatusCounts() {
  const userId = useUserId();
  return useQuery({
    queryKey: syncCountsKey(userId),
    queryFn: async (): Promise<AggregateSyncCounts> => {
      if (!userId) {
        const empty = { pending: 0, failed: 0 };
        return {
          exhibitions: empty,
          artifacts: empty,
          artifactPhotos: empty,
          impressions: empty,
          artifactProblems: [],
          impressionProblems: [],
          totalPending: 0,
          totalFailed: 0,
        };
      }
      const [
        exhibitions,
        artifacts,
        artifactPhotos,
        impressions,
        artifactProblems,
        impressionProblems,
      ] = await Promise.all([
        countPendingSync(userId),
        countPendingArtifacts(userId),
        countPendingArtifactPhotos(userId),
        countPendingImpressions(userId),
        listArtifactSyncProblems(userId),
        listImpressionSyncProblems(userId),
      ]);
      return {
        exhibitions,
        artifacts,
        artifactPhotos,
        impressions,
        artifactProblems,
        impressionProblems,
        totalPending:
          exhibitions.pending +
          artifacts.pending +
          artifactPhotos.pending +
          impressions.pending,
        totalFailed:
          exhibitions.failed +
          artifacts.failed +
          artifactPhotos.failed +
          impressions.failed,
      };
    },
    enabled: !!userId,
  });
}

export function useCreateExhibition() {
  const qc = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async (input: ExhibitionInput): Promise<Exhibition> => {
      if (!userId) throw new Error('未登录');
      try {
        return await createExhibition({
          user_id: userId,
          name: input.name,
          museum: input.museum?.trim() || null,
          visit_date: input.visit_date || null,
        });
      } catch (e) {
        throw toError(e);
      }
    },
    onSuccess: () => {
      console.log('[mutation] create onSuccess; userId=', userId);
      qc.invalidateQueries({ queryKey: ROOT });
      qc.invalidateQueries({ queryKey: SYNC_ROOT });
      runSync(userId, { pull: false }).catch((e) =>
        console.error('[sync] post-create', e),
      );
    },
  });
}

export function useDeleteExhibition() {
  const qc = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      console.log('[mutation] delete mutationFn called for', id);
      try {
        await softDeleteExhibition(id);
      } catch (e) {
        throw toError(e);
      }
    },
    onSuccess: (_data, id) => {
      console.log('[mutation] delete onSuccess for', id, 'userId=', userId);
      qc.invalidateQueries({ queryKey: ROOT });
      qc.invalidateQueries({ queryKey: SYNC_ROOT });
      qc.removeQueries({ queryKey: exhibitionDetailKey(id) });
      runSync(userId, { pull: false }).catch((e) =>
        console.error('[sync] post-delete', e),
      );
    },
    onError: (e, id) => {
      console.error('[mutation] delete onError for', id, e);
    },
  });
}

export function useManualSync() {
  const userId = useUserId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => runManualSync(userId),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ROOT });
      qc.invalidateQueries({ queryKey: ['artifacts'] });
      qc.invalidateQueries({ queryKey: ['impressions'] });
      qc.invalidateQueries({ queryKey: SYNC_ROOT });
    },
  });
}
