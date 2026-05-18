import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useUserId } from '@/lib/auth';
import {
  captureArtifact,
  createArtifactEntryFromSource,
  getArtifact,
  getArtifactPhotoUri,
  importArtifacts,
  listArtifactsForExhibition,
  softDeleteArtifact,
  updateArtifactInfo,
  type ArtifactInfoPatch,
  type ArtifactRow,
} from '@/lib/db/artifacts';
import { toError } from '@/lib/errors';
import {
  isNativeOcrUnavailable,
  recognizeTextFromImageUri,
} from '@/lib/ocr/localTextRecognition';
import { supabase } from '@/lib/supabase';
import { runSync } from '@/lib/sync';

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
        if (!row) throw new Error('鏂囩墿涓嶅瓨鍦ㄦ垨宸茶鍒犻櫎');
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
      if (!userId) throw new Error('Not signed in');
      try {
        return await captureArtifact({ user_id: userId, ...input });
      } catch (e) {
        throw toError(e);
      }
    },
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: listKey(input.exhibition_id) });
      qc.invalidateQueries({ queryKey: ['sync-status'] });
      runSync(userId, { pull: false }).catch((e) =>
        console.error('[sync] post-capture-artifact', e),
      );
    },
  });
}

export function useImportArtifacts() {
  const qc = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async (input: {
      exhibition_id: string;
      photos: Array<{
        uri: string;
        photo_taken_at?: string;
        latitude?: number | null;
        longitude?: number | null;
      }>;
    }): Promise<Artifact[]> => {
      if (!userId) throw new Error('Not signed in');
      try {
        return await importArtifacts(
          input.photos.map((photo) => ({
            user_id: userId,
            exhibition_id: input.exhibition_id,
            source_photo_uri: photo.uri,
            photo_taken_at: photo.photo_taken_at,
            latitude: photo.latitude,
            longitude: photo.longitude,
          })),
        );
      } catch (e) {
        throw toError(e);
      }
    },
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: listKey(input.exhibition_id) });
      qc.invalidateQueries({ queryKey: ['sync-status'] });
      runSync(userId, { pull: false }).catch((e) =>
        console.error('[sync] post-import-artifacts', e),
      );
    },
  });
}

export function useDeleteArtifact() {
  const qc = useQueryClient();
  const userId = useUserId();
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
      qc.invalidateQueries({ queryKey: ['sync-status'] });
      qc.removeQueries({ queryKey: detailKey(artifact_id) });
      runSync(userId, { pull: false }).catch((e) =>
        console.error('[sync] post-delete-artifact', e),
      );
    },
  });
}

export function useUpdateArtifactInfo() {
  const qc = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async ({
      artifact_id,
      patch,
    }: {
      artifact_id: string;
      exhibition_id: string;
      patch: ArtifactInfoPatch;
    }): Promise<void> => {
      try {
        await updateArtifactInfo(artifact_id, patch);
      } catch (e) {
        throw toError(e);
      }
    },
    onSuccess: (_data, { exhibition_id, artifact_id }) => {
      qc.invalidateQueries({ queryKey: listKey(exhibition_id) });
      qc.invalidateQueries({ queryKey: detailKey(artifact_id) });
      qc.invalidateQueries({ queryKey: ['sync-status'] });
      runSync(userId, { pull: false, force: true }).catch((e) =>
        console.error('[sync] post-update-artifact-info', e),
      );
    },
  });
}

export function useReadArtifactText() {
  const qc = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async ({
      artifact_id,
    }: {
      artifact_id: string;
      exhibition_id: string;
    }): Promise<ArtifactRow> => {
      if (!userId) throw new Error('Not signed in');
      try {
        await updateArtifactInfo(artifact_id, {
          extraction_status: 'processing',
          extraction_error: null,
          extraction_updated_at: new Date().toISOString(),
        });

        await runSync(userId, { pull: false, force: true });
        const artifact = await getArtifact(artifact_id);
        if (!artifact) throw new Error('Artifact not found.');
        if (!artifact.photo_cloud_url) {
          throw new Error('Photo has not been uploaded yet. Sync first and retry.');
        }

        const { data, error } = await supabase.functions.invoke('extract-artifact-info', {
          body: {
            items: [
              {
                artifact_id,
                photo_url: artifact.photo_cloud_url,
              },
            ],
          },
        });
        if (error) throw toError(error);
        assertExtractionSucceeded(data);

        await runSync(userId, { pull: true, force: true });
        const updated = await getArtifact(artifact_id);
        if (!updated) throw new Error('Failed to read extraction result.');
        return updated;
      } catch (e) {
        const error = toError(e);
        await updateArtifactInfo(artifact_id, {
          extraction_status: 'failed',
          extraction_error: error.message,
          extraction_updated_at: new Date().toISOString(),
        });
        throw error;
      }
    },
    onSuccess: (_artifact, { exhibition_id, artifact_id }) => {
      qc.invalidateQueries({ queryKey: listKey(exhibition_id) });
      qc.invalidateQueries({ queryKey: detailKey(artifact_id) });
      qc.invalidateQueries({ queryKey: ['sync-status'] });
    },
  });
}

export function useCreateArtifactEntryFromSource() {
  const qc = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async ({
      source_artifact_id,
      patch,
    }: {
      source_artifact_id: string;
      exhibition_id: string;
      patch?: ArtifactInfoPatch;
    }): Promise<Artifact> => {
      try {
        return await createArtifactEntryFromSource(source_artifact_id, patch);
      } catch (e) {
        throw toError(e);
      }
    },
    onSuccess: (artifact, { exhibition_id }) => {
      qc.invalidateQueries({ queryKey: listKey(exhibition_id) });
      qc.invalidateQueries({ queryKey: detailKey(artifact.id) });
      qc.invalidateQueries({ queryKey: ['sync-status'] });
      runSync(userId, { pull: false, force: true }).catch((e) =>
        console.error('[sync] post-create-artifact-entry', e),
      );
    },
  });
}

export function useExtractArtifactInfo() {
  const qc = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: async ({
      artifact_ids,
    }: {
      exhibition_id: string;
      artifact_ids: string[];
    }): Promise<void> => {
      if (!userId) throw new Error('Not signed in');
      if (artifact_ids.length === 0) return;

      const now = new Date().toISOString();
      await Promise.all(
        artifact_ids.map((id) =>
          updateArtifactInfo(id, {
            extraction_status: 'queued',
            extraction_error: null,
            extraction_updated_at: now,
          }),
        ),
      );

      await runSync(userId, { pull: false, force: true });
      const { localOcrItems, cloudOcrIds } = await prepareExtractionInput(
        artifact_ids,
      );

      const { data, error } = await supabase.functions.invoke('extract-artifact-info', {
        body: {
          items: localOcrItems,
          artifact_ids: cloudOcrIds,
        },
      });
      if (error) throw toError(error);

      await runSync(userId, { pull: true, force: true });
      assertExtractionSucceeded(data);
    },
    onSuccess: (_data, { exhibition_id, artifact_ids }) => {
      qc.invalidateQueries({ queryKey: listKey(exhibition_id) });
      for (const id of artifact_ids) {
        qc.invalidateQueries({ queryKey: detailKey(id) });
      }
      qc.invalidateQueries({ queryKey: ['sync-status'] });
    },
  });
}

async function prepareExtractionInput(artifactIds: string[]): Promise<{
  localOcrItems: Array<{
    artifact_id: string;
    photo_url?: string;
    raw_ocr_text: string;
    ocr_engine: 'mlkit';
  }>;
  cloudOcrIds: string[];
}> {
  const localOcrItems: Array<{
    artifact_id: string;
    photo_url?: string;
    raw_ocr_text: string;
    ocr_engine: 'mlkit';
  }> = [];
  const cloudOcrIds: string[] = [];
  let nativeOcrAvailable = true;

  for (const artifactId of artifactIds) {
    if (!nativeOcrAvailable) {
      cloudOcrIds.push(artifactId);
      continue;
    }

    try {
      const artifact = await getArtifact(artifactId);
      const uri = artifact ? getArtifactPhotoUri(artifact) : null;
      if (!artifact || !uri) {
        cloudOcrIds.push(artifactId);
        continue;
      }

      const result = await recognizeTextFromImageUri(uri);
      localOcrItems.push({
        artifact_id: artifactId,
        photo_url: artifact.photo_cloud_url ?? undefined,
        raw_ocr_text: result.text,
        ocr_engine: result.engine,
      });
    } catch (error) {
      if (isNativeOcrUnavailable(error)) {
        nativeOcrAvailable = false;
      }
      console.warn('[ocr.local] falling back to cloud OCR', artifactId, error);
      cloudOcrIds.push(artifactId);
    }
  }

  return { localOcrItems, cloudOcrIds };
}

function assertExtractionSucceeded(data: unknown): void {
  if (!data || typeof data !== 'object') return;
  const results = (data as { results?: unknown }).results;
  if (!Array.isArray(results)) return;

  const failures = results.filter((item) => {
    if (!item || typeof item !== 'object') return false;
    return (item as { ok?: unknown }).ok === false;
  });
  if (failures.length === 0) return;

  const firstFailure = failures[0] as { error?: unknown };
  const firstMessage =
    typeof firstFailure.error === 'string' ? firstFailure.error : 'Please retry later.';
  throw new Error(
    failures.length === results.length
      ? `Extraction failed: ${firstMessage}`
      : `Partial extraction failed: ${failures.length}/${results.length} items failed. ${firstMessage}`,
  );
}
