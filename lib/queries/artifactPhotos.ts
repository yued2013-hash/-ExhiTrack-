import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  linkArtifactToPhoto,
  listPhotosForArtifact,
  type ArtifactPhotoRole,
  type LinkedArtifactPhoto,
} from '@/lib/db/artifactPhotos';
import { toError } from '@/lib/errors';

const ROOT = ['artifact-photos'] as const;

const listKey = (artifactId: string | undefined) =>
  [...ROOT, 'list', artifactId ?? '__none__'] as const;

export function useArtifactPhotos(artifactId: string | undefined) {
  return useQuery({
    queryKey: listKey(artifactId),
    queryFn: async (): Promise<LinkedArtifactPhoto[]> => {
      if (!artifactId) return [];
      try {
        return await listPhotosForArtifact(artifactId);
      } catch (e) {
        throw toError(e);
      }
    },
    enabled: !!artifactId,
  });
}

export function useLinkArtifactPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      artifact_id: string;
      photo_artifact_id: string;
      role: ArtifactPhotoRole;
      sort_order?: number;
    }) => {
      try {
        return await linkArtifactToPhoto(input);
      } catch (e) {
        throw toError(e);
      }
    },
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: listKey(input.artifact_id) });
      qc.invalidateQueries({ queryKey: ['artifacts'] });
      qc.invalidateQueries({ queryKey: ['sync-status'] });
    },
  });
}
