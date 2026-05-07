import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';

import {
  getArtifactPhotoUri,
  getArtifactThumbnailUri,
  type ArtifactRow,
} from '@/lib/db/artifacts';
import {
  getImpressionVoiceUri,
  type ImpressionRow,
} from '@/lib/db/impressions';
import { formatError } from '@/lib/errors';
import {
  useArtifacts,
  useDeleteArtifact,
  useImportArtifacts,
} from '@/lib/queries/artifacts';
import { useDeleteExhibition, useExhibition } from '@/lib/queries/exhibitions';
import {
  useDeleteImpression,
  useImpressions,
} from '@/lib/queries/impressions';

export default function ExhibitionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data, isLoading, isError, error } = useExhibition(id);
  const { data: artifacts } = useArtifacts(id);
  const deleteMutation = useDeleteExhibition();
  const deleteArtifactMutation = useDeleteArtifact();
  const importMutation = useImportArtifacts();

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-zinc-50">
        <ActivityIndicator />
      </View>
    );
  }

  if (isError || !data) {
    return (
      <View className="flex-1 items-center justify-center bg-zinc-50 px-6">
        <Ionicons name="alert-circle-outline" size={40} color="#dc2626" />
        <Text className="mt-3 text-base text-zinc-700">加载失败</Text>
        <Text className="mt-1 text-center text-sm text-zinc-500">
          {(error as Error)?.message ?? '展览不存在或已被删除'}
        </Text>
      </View>
    );
  }

  const onDelete = () => {
    Alert.alert('删除展览', `确定删除「${data.name}」?`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteMutation.mutateAsync(data.id);
            router.back();
          } catch (e) {
            console.error('[delete-exhibition]', e, (e as { cause?: unknown })?.cause);
            Alert.alert('删除失败', formatError(e));
          }
        },
      },
    ]);
  };

  const onImportFromLibrary = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('需要相册权限', '请在系统设置允许 Exhitrack 访问相册后重试');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        selectionLimit: 50,
        exif: true,
        quality: 1,
      });
      if (result.canceled || result.assets.length === 0) return;

      await importMutation.mutateAsync({
        exhibition_id: data.id,
        photos: result.assets.map((asset) => {
          const exif = asset.exif as ImageExif | null | undefined;
          const gps = readGpsFromExif(exif);
          return {
            uri: asset.uri,
            photo_taken_at: readTakenAtFromAsset(asset, exif),
            latitude: gps.latitude,
            longitude: gps.longitude,
          };
        }),
      });

      Alert.alert('导入完成', `已导入 ${result.assets.length} 张照片`);
    } catch (e) {
      console.error('[import-artifacts]', e);
      Alert.alert('导入失败', formatError(e));
    }
  };

  return (
    <ScrollView className="flex-1 bg-zinc-50" contentContainerStyle={{ padding: 16 }}>
      <View className="rounded-xl border border-zinc-200 bg-white p-5">
        <Text className="text-2xl font-bold text-zinc-900">{data.name}</Text>

        {data.sync_status !== 'synced' && (
          <View
            className={`mt-2 flex-row items-center self-start rounded-full px-2.5 py-1 ${
              data.sync_status === 'failed' ? 'bg-red-50' : 'bg-amber-50'
            }`}
          >
            <View
              className={`mr-1.5 h-1.5 w-1.5 rounded-full ${
                data.sync_status === 'failed' ? 'bg-red-500' : 'bg-amber-500'
              }`}
            />
            <Text
              className={`text-xs ${
                data.sync_status === 'failed' ? 'text-red-700' : 'text-amber-700'
              }`}
            >
              {data.sync_status === 'failed' ? '同步失败' : '待同步至云端'}
            </Text>
          </View>
        )}

        <View className="mt-5 gap-3">
          <Field label="博物馆" value={data.museum ?? '—'} />
          <Field label="观展日期" value={data.visit_date ?? '—'} />
          <Field
            label="创建时间"
            value={new Date(data.created_at).toLocaleString('zh-CN')}
          />
        </View>
      </View>

      <View className="mt-6 rounded-xl border border-zinc-200 bg-white p-4">
        <View className="flex-row items-center justify-between">
          <Text className="text-sm font-medium text-zinc-700">
            文物照片（{artifacts?.length ?? 0}）
          </Text>
          <Pressable
            onPress={onImportFromLibrary}
            disabled={importMutation.isPending}
            className="flex-row items-center rounded-full bg-zinc-900 px-3 py-2 active:bg-zinc-700 disabled:opacity-60"
          >
            {importMutation.isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="images-outline" size={15} color="#fff" />
                <Text className="ml-1.5 text-xs font-medium text-white">
                  相册导入
                </Text>
              </>
            )}
          </Pressable>
        </View>
        {(artifacts?.length ?? 0) === 0 ? (
          <Text className="mt-3 text-sm text-zinc-500">
            还没有照片。去拍摄 tab 拍一张，或从相册批量导入。
          </Text>
        ) : (
          <View className="mt-3 gap-3">
            {groupArtifacts(artifacts!).map((group, idx) => (
              <View
                key={group.id}
                className={idx > 0 ? 'border-t border-zinc-100 pt-3' : ''}
              >
                {group.artifacts.length > 1 && (
                  <Text className="mb-2 text-[10px] uppercase tracking-wider text-zinc-400">
                    一组 · {group.artifacts.length} 张
                  </Text>
                )}
                <View className="flex-row flex-wrap">
                  {group.artifacts.map((a) => {
                    const uri =
                      getArtifactThumbnailUri(a) ?? getArtifactPhotoUri(a);
                    return (
                      <Pressable
                        key={a.id}
                        onLongPress={() =>
                          Alert.alert('删除照片', '确定删除这张照片?', [
                            { text: '取消', style: 'cancel' },
                            {
                              text: '删除',
                              style: 'destructive',
                              onPress: () =>
                                deleteArtifactMutation.mutate({
                                  artifact_id: a.id,
                                  exhibition_id: data.id,
                                }),
                            },
                          ])
                        }
                        className="aspect-square w-1/3 p-1"
                      >
                        {uri ? (
                          <Image
                            source={{ uri }}
                            contentFit="cover"
                            style={{ flex: 1, borderRadius: 8 }}
                          />
                        ) : (
                          <View
                            style={{
                              flex: 1,
                              borderRadius: 8,
                              backgroundColor: '#f4f4f5',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <Ionicons
                              name="image-outline"
                              size={20}
                              color="#a1a1aa"
                            />
                          </View>
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
          </View>
        )}
      </View>

      <ImpressionsCard exhibitionId={data.id} />

      <Pressable
        onPress={onDelete}
        disabled={deleteMutation.isPending}
        className="mt-8 items-center rounded-xl border border-red-200 bg-white py-3 active:bg-red-50 disabled:opacity-50"
      >
        {deleteMutation.isPending ? (
          <ActivityIndicator color="#dc2626" />
        ) : (
          <Text className="text-sm font-medium text-red-600">删除展览</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row">
      <Text className="w-20 text-sm text-zinc-500">{label}</Text>
      <Text className="flex-1 text-sm text-zinc-900">{value}</Text>
    </View>
  );
}

type ImageExif = Record<string, unknown>;

function readTakenAtFromAsset(
  asset: ImagePicker.ImagePickerAsset,
  exif: ImageExif | null | undefined,
): string | undefined {
  return (
    readTakenAtFromExif(exif) ??
    readTimestamp((asset as unknown as Record<string, unknown>).creationTime)
  );
}

function readTakenAtFromExif(exif: ImageExif | null | undefined): string | undefined {
  if (!exif) return undefined;
  const raw =
    readString(exif.DateTimeOriginal) ??
    readString(exif.DateTimeDigitized) ??
    readString(exif.DateTime);
  if (!raw) return readTimestamp(exif.DateTimeOriginal);

  // EXIF date usually looks like "2026:05:07 13:45:20".
  const normalized = raw.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
  const offset =
    readString(exif.OffsetTimeOriginal) ??
    readString(exif.OffsetTimeDigitized) ??
    readString(exif.OffsetTime);
  const parsed = new Date(
    offset && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized)
      ? `${normalized}${offset}`
      : normalized,
  );
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function readTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'number') return undefined;
  const milliseconds = value > 10_000_000_000 ? value : value * 1000;
  const parsed = new Date(milliseconds);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function readGpsFromExif(
  exif: ImageExif | null | undefined,
): { latitude: number | null; longitude: number | null } {
  if (!exif) return { latitude: null, longitude: null };

  const latitude = readCoordinate(exif.GPSLatitude, exif.GPSLatitudeRef);
  const longitude = readCoordinate(exif.GPSLongitude, exif.GPSLongitudeRef);
  return { latitude, longitude };
}

function readCoordinate(value: unknown, ref: unknown): number | null {
  const sign = readString(ref)?.toUpperCase();
  if (typeof value === 'number') {
    return sign === 'S' || sign === 'W' ? -value : value;
  }
  if (Array.isArray(value) && value.length >= 3) {
    const degrees = readNumber(value[0]);
    const minutes = readNumber(value[1]);
    const seconds = readNumber(value[2]);
    if (degrees === null || minutes === null || seconds === null) return null;
    const decimal = degrees + minutes / 60 + seconds / 3600;
    return sign === 'S' || sign === 'W' ? -decimal : decimal;
  }
  return null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const numerator = readNumber(record.numerator);
    const denominator = readNumber(record.denominator);
    if (numerator !== null && denominator !== null && denominator > 0) {
      return numerator / denominator;
    }
    const parsedValue = readNumber(record.value);
    if (parsedValue !== null) return parsedValue;
  }
  if (typeof value !== 'string') return null;
  const fraction = value.split('/');
  if (fraction.length === 2) {
    const numerator = Number(fraction[0]);
    const denominator = Number(fraction[1]);
    if (!Number.isNaN(numerator) && denominator > 0) {
      return numerator / denominator;
    }
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Group artifacts by group_id for visual rendering. Artifacts with null
 * group_id (legacy / pre-3.2.1 captures) become their own singleton groups.
 * Assumes input is already sorted by photo_taken_at ASC, so same-group photos
 * are adjacent.
 */
function groupArtifacts(
  artifacts: ArtifactRow[],
): { id: string; artifacts: ArtifactRow[] }[] {
  const groups: { id: string; artifacts: ArtifactRow[] }[] = [];
  const groupById = new Map<string, { id: string; artifacts: ArtifactRow[] }>();
  for (const a of artifacts) {
    const key = a.group_id ?? a.id;
    const existing = groupById.get(key);
    if (existing) {
      existing.artifacts.push(a);
      continue;
    }
    const next = { id: key, artifacts: [a] };
    groupById.set(key, next);
    groups.push(next);
  }
  return groups;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function ImpressionsCard({ exhibitionId }: { exhibitionId: string }) {
  const { data: impressions } = useImpressions(exhibitionId);
  const deleteMutation = useDeleteImpression();
  const [playingId, setPlayingId] = useState<string | null>(null);
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);

  // When audio finishes, clear playingId so the icon flips back to play.
  useEffect(() => {
    if (playingId && status.didJustFinish) {
      setPlayingId(null);
    }
  }, [status.didJustFinish, playingId]);

  const togglePlay = (imp: ImpressionRow) => {
    if (playingId === imp.id) {
      player.pause();
      setPlayingId(null);
      return;
    }
    const uri = getImpressionVoiceUri(imp);
    if (!uri) {
      Alert.alert('无法播放', '录音文件不可用(本地缺失且云端未同步)');
      return;
    }
    player.replace({ uri });
    player.play();
    setPlayingId(imp.id);
  };

  const onDelete = (imp: ImpressionRow) => {
    Alert.alert('删除录音', '确定删除这段感受?', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          if (playingId === imp.id) {
            player.pause();
            setPlayingId(null);
          }
          deleteMutation.mutate({
            impression_id: imp.id,
            exhibition_id: exhibitionId,
          });
        },
      },
    ]);
  };

  return (
    <View className="mt-6 rounded-xl border border-zinc-200 bg-white p-4">
      <Text className="text-sm font-medium text-zinc-700">
        感受录音({impressions?.length ?? 0})
      </Text>
      {(impressions?.length ?? 0) === 0 ? (
        <Text className="mt-3 text-sm text-zinc-500">
          还没有录音。在拍摄页按住右下角的麦克风可以录一段。
        </Text>
      ) : (
        <View className="mt-3 gap-2">
          {impressions!.map((imp) => {
            const isPlaying = playingId === imp.id;
            return (
              <Pressable
                key={imp.id}
                onPress={() => togglePlay(imp)}
                onLongPress={() => onDelete(imp)}
                className="flex-row items-center rounded-lg border border-zinc-200 px-3 py-2.5 active:bg-zinc-50"
              >
                <View className="mr-3 h-9 w-9 items-center justify-center rounded-full bg-emerald-700">
                  <Ionicons
                    name={isPlaying ? 'pause' : 'play'}
                    size={18}
                    color="#fff"
                  />
                </View>
                <View className="flex-1">
                  <Text className="text-sm text-zinc-900">
                    {formatDuration(imp.voice_duration_ms)}
                    {imp.artifact_id ? ' · 关联文物' : ' · 整场感受'}
                  </Text>
                  <Text className="mt-0.5 text-[11px] text-zinc-400">
                    {new Date(imp.recorded_at).toLocaleString('zh-CN')}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}
