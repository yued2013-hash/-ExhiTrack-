import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useUserId } from '@/lib/auth';
import {
  captureArtifact,
  getArtifact,
  listArtifactsForExhibition,
  softDeleteArtifact,
  type ArtifactRow,
} from '@/lib/db/artifacts';
import { toError } from '@/lib/errors';

export type Artifact = ArtifactRow;

const ROOT = ['artifacts'] as const;

const listKey = (exhibitionId: string | undefined) =>
  [...ROOT, 'list', exhibitionId ?? '__none__'] as const;
const detailKey = (id: string) => [...ROOT, 'detail', id] as const;

export function useArtifacts(exhibitionId: string | undefined) {
  return useQuery({
    queryKey: listKey(exhibitionId),
    queryFn: async (): Promise<Artifact[]> => {
      if (!exhibitionId) return [];
      try {
        return await listArtifactsForExhibition(exhibitionId);
      } catch (e) {
        throw toError(e);
      }
    },
    enabled: !!exhibitionId,
  });
}

export function useArtifact(id: string | undefined) {
  return useQuery({
    queryKey: id ? detailKey(id) : [...ROOT, 'detail', '__none__'],
    queryFn: async (): Promise<Artifact> => {
      if (!id) throw new Error('No id');
      try {
        const row = await getArtifact(id);
        if (!row) throw new Error('文物不存在或已被删除');
        return row;
      } catch (e) {
        throw toError(e);
      }
    },
    enabled: !!id,
  });
}

export function useCaptureArtifact() {
  const qc = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async (input: {
      exhibition_id: string;
      source_photo_uri: string;
      group_id: string;
    }): Promise<Artifact> => {
      if (!userId) throw new Error('未登录');
      try {
        return await captureArtifact({ user_id: userId, ...input });
      } catch (e) {
        throw toError(e);
      }
    },
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: listKey(input.exhibition_id) });
    },
  });
}

export function useDeleteArtifact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ artifact_id }: {
      artifact_id: string;
      exhibition_id: string;
    }): Promise<void> => {
      try {
        await softDeleteArtifact(artifact_id);
      } catch (e) {
        throw toError(e);
      }
    },
    onSuccess: (_data, { exhibition_id, artifact_id }) => {
      qc.invalidateQueries({ queryKey: listKey(exhibition_id) });
      qc.removeQueries({ queryKey: detailKey(artifact_id) });
    },
  });
}
