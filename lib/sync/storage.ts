import * as FileSystem from 'expo-file-system/legacy';

import { toError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

const STORAGE_UPLOAD_TIMEOUT_MS = 30_000;

/**
 * Upload a local file to a public Supabase Storage bucket and return its URL.
 * The cloud path must start with `{user_id}/...` to satisfy storage RLS.
 */
export async function uploadFileToStorage(
  bucket: string,
  localRelativePath: string,
  cloudPath: string,
  contentType: string,
): Promise<string> {
  const fileUri = `${FileSystem.documentDirectory}${localRelativePath}`;
  const info = await FileSystem.getInfoAsync(fileUri);
  if (!info.exists) {
    throw new Error(`本地文件不存在:${localRelativePath}`);
  }

  let bytes: ArrayBuffer;
  try {
    const base64 = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    bytes = base64ToArrayBuffer(base64);
  } catch (e) {
    throw new Error(`读取本地媒体失败:${toError(e).message}`);
  }

  const { error } = await withTimeout(
    supabase.storage
      .from(bucket)
      .upload(cloudPath, bytes, { upsert: true, contentType }),
    STORAGE_UPLOAD_TIMEOUT_MS,
    `上传到 Supabase Storage 超时:${cloudPath}`,
  );
  if (error) {
    throw new Error(`上传到 Supabase Storage 失败:${toError(error).message}`);
  }
  const { data } = supabase.storage.from(bucket).getPublicUrl(cloudPath);
  return data.publicUrl;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = base64.replace(/\s/g, '').replace(/=+$/, '');
  const bytes: number[] = [];

  for (let i = 0; i < clean.length; i += 4) {
    const chunk = clean.slice(i, i + 4);
    const values = chunk.split('').map((char) => alphabet.indexOf(char));
    if (values.some((value) => value < 0)) {
      throw new Error('base64 编码无效');
    }

    const buffer =
      ((values[0] ?? 0) << 18) |
      ((values[1] ?? 0) << 12) |
      ((values[2] ?? 0) << 6) |
      (values[3] ?? 0);

    bytes.push((buffer >> 16) & 255);
    if (chunk.length > 2) bytes.push((buffer >> 8) & 255);
    if (chunk.length > 3) bytes.push(buffer & 255);
  }

  return new Uint8Array(bytes).buffer;
}

export async function removeFromStorage(
  bucket: string,
  cloudPaths: string[],
): Promise<void> {
  if (cloudPaths.length === 0) return;
  const { error } = await supabase.storage.from(bucket).remove(cloudPaths);
  if (error) {
    // Best-effort delete; log but don't block the metadata delete that follows.
    console.warn('[sync.storage] remove failed', { bucket, cloudPaths, error });
  }
}
