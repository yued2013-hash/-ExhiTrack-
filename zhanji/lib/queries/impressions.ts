import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useUserId } from '@/lib/auth';
import {
  createImpression,
  listImpressionsForExhibition,
  softDeleteImpression,
  type ImpressionRow,
} from '@/lib/db/impressions';
import { toError } from '@/lib/errors';

export type Impression = ImpressionRow;

const ROOT = ['impressions'] as const;

const listKey = (exhibitionId: string | undefined) =>
  [...ROOT, 'list', exhibitionId ?? '__none__'] as const;

export function useImpressions(exhibitionId: string | undefined) {
  return useQuery({
    queryKey: listKey(exhibitionId),
    queryFn: async (): Promise<Impression[]> => {
      if (!exhibitionId) return [];
      try {
        return await listImpressionsForExhibition(exhibitionId);
      } catch (e) {
        throw toError(e);
      }
    },
    enabled: !!exhibitionId,
  });
}

export function useCreateImpression() {
  const qc = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async (input: {
      exhibition_id: string;
      artifact_id: string | null;
      source_voice_uri: string;
      voice_duration_ms: number;
    }): Promise<Impression> => {
      if (!userId) throw new Error('未登录');
      try {
        return await createImpression({ user_id: userId, ...input });
      } catch (e) {
        throw toError(e);
      }
    },
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: listKey(input.exhibition_id) });
    },
  });
}

export function useDeleteImpression() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ impression_id }: {
      impression_id: string;
      exhibition_id: string;
    }): Promise<void> => {
      try {
        await softDeleteImpression(impression_id);
      } catch (e) {
        throw toError(e);
      }
    },
    onSuccess: (_data, { exhibition_id }) => {
      qc.invalidateQueries({ queryKey: listKey(exhibition_id) });
    },
  });
}
