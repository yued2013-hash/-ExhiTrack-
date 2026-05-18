import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  type TextInputSelectionChangeEventData,
  View,
} from 'react-native';

import {
  getArtifactPhotoUri,
  getArtifactThumbnailUri,
  type ArtifactRow,
} from '@/lib/db/artifacts';
import type { ArtifactPhotoRole } from '@/lib/db/artifactPhotos';
import {
  getImpressionVoiceUri,
  type ImpressionRow,
} from '@/lib/db/impressions';
import { formatError } from '@/lib/errors';
import {
  useArtifacts,
  useCreateArtifactEntryFromSource,
  useDeleteArtifact,
  useExtractArtifactInfo,
  useImportArtifacts,
  useReadArtifactText,
  useUpdateArtifactInfo,
} from '@/lib/queries/artifacts';
import {
  useArtifactPhotos,
  useLinkArtifactPhoto,
} from '@/lib/queries/artifactPhotos';
import { useDeleteExhibition, useExhibition } from '@/lib/queries/exhibitions';
import {
  useDeleteImpression,
  useImpressions,
} from '@/lib/queries/impressions';
import { supabase } from '@/lib/supabase';

export default function ExhibitionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useExhibition(id);
  const { data: artifacts } = useArtifacts(id);
  const deleteMutation = useDeleteExhibition();
  const deleteArtifactMutation = useDeleteArtifact();
  const importMutation = useImportArtifacts();
  const extractMutation = useExtractArtifactInfo();
  const createArtifactEntryMutation = useCreateArtifactEntryFromSource();
  const linkArtifactPhotoMutation = useLinkArtifactPhoto();
  const readTextMutation = useReadArtifactText();
  const updateArtifactInfoMutation = useUpdateArtifactInfo();
  const [selectingArtifacts, setSelectingArtifacts] = useState(false);
  const [selectedArtifactIds, setSelectedArtifactIds] = useState<string[]>([]);
  const [editingArtifact, setEditingArtifact] = useState<ArtifactRow | null>(null);
  const [infoDraft, setInfoDraft] = useState<ArtifactInfoDraft>(EMPTY_INFO_DRAFT);

  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`artifacts:${id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'artifacts',
          filter: `exhibition_id=eq.${id}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['artifacts'] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, queryClient]);

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

  const toggleSelectedArtifact = (artifactId: string) => {
    setSelectedArtifactIds((current) =>
      current.includes(artifactId)
        ? current.filter((item) => item !== artifactId)
        : [...current, artifactId],
    );
  };

  const confirmExtract = (artifactIds: string[]) => {
    if (artifactIds.length === 0) return;
    const estimatedMb = Math.max(1, Math.ceil(artifactIds.length * 1.5));
    Alert.alert(
      '识别展签',
      `将上传 ${artifactIds.length} 张照片到云端，预计消耗约 ${estimatedMb} MB 流量。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '开始识别',
          onPress: async () => {
            try {
              await extractMutation.mutateAsync({
                exhibition_id: data.id,
                artifact_ids: artifactIds,
              });
              setSelectingArtifacts(false);
              setSelectedArtifactIds([]);
              Alert.alert('识别完成', '结构化信息已同步到本地。');
            } catch (e) {
              console.error('[extract-artifact-info]', e);
              Alert.alert('识别失败', formatError(e));
            }
          },
        },
      ],
    );
  };

  const startEditingArtifact = (artifact: ArtifactRow) => {
    setEditingArtifact(artifact);
    setInfoDraft({
      name: artifact.name ?? '',
      dynasty: artifact.dynasty ?? '',
      category: artifact.category ?? '',
      origin: artifact.origin ?? '',
      era: artifact.era ?? '',
      label_description: artifact.label_description ?? '',
      raw_ocr_text: artifact.raw_ocr_text ?? '',
    });
  };

  const readArtifactText = async (artifact: ArtifactRow) => {
    try {
      const updated = await readTextMutation.mutateAsync({
        artifact_id: artifact.id,
        exhibition_id: data.id,
      });
      setEditingArtifact(updated);
      setInfoDraft({
        name: updated.name ?? '',
        dynasty: updated.dynasty ?? '',
        category: updated.category ?? '',
        origin: updated.origin ?? '',
        era: updated.era ?? '',
        label_description: updated.label_description ?? '',
        raw_ocr_text: updated.raw_ocr_text ?? '',
      });
    } catch (e) {
      console.error('[read-artifact-text]', e);
      Alert.alert('读取失败', formatError(e));
    }
  };

  const saveArtifactInfo = async () => {
    if (!editingArtifact) return;
    try {
      await updateArtifactInfoMutation.mutateAsync({
        artifact_id: editingArtifact.id,
        exhibition_id: data.id,
        patch: {
          name: emptyToNull(infoDraft.name),
          dynasty: emptyToNull(infoDraft.dynasty),
          category: emptyToNull(infoDraft.category),
          origin: emptyToNull(infoDraft.origin),
          era: emptyToNull(infoDraft.era),
          label_description: emptyToNull(infoDraft.label_description),
          raw_ocr_text: emptyToNull(infoDraft.raw_ocr_text),
          extraction_status: 'manual',
          extraction_error: null,
        },
      });
      setEditingArtifact(null);
    } catch (e) {
      console.error('[update-artifact-info]', e);
      Alert.alert('保存失败', formatError(e));
    }
  };

  const createNextArtifactEntry = async () => {
    if (!editingArtifact) return;
    try {
      const nextArtifact = await createArtifactEntryMutation.mutateAsync({
        source_artifact_id: editingArtifact.id,
        exhibition_id: data.id,
        patch: {
          raw_ocr_text: emptyToNull(infoDraft.raw_ocr_text),
          extraction_status: 'manual',
          extraction_error: null,
        },
      });
      setEditingArtifact(nextArtifact);
      setInfoDraft({
        ...EMPTY_INFO_DRAFT,
        raw_ocr_text: infoDraft.raw_ocr_text,
      });
    } catch (e) {
      console.error('[create-artifact-entry]', e);
      Alert.alert('新建条目失败', formatError(e));
    }
  };

  const linkPhotoToCurrentArtifact = async (
    photoArtifactId: string,
    role: ArtifactPhotoRole,
  ) => {
    if (!editingArtifact) return;
    try {
      await linkArtifactPhotoMutation.mutateAsync({
        artifact_id: editingArtifact.id,
        photo_artifact_id: photoArtifactId,
        role,
      });
    } catch (e) {
      console.error('[link-artifact-photo]', e);
      Alert.alert('关联照片失败', formatError(e));
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
          {(artifacts?.length ?? 0) > 0 && (
            <Pressable
              onPress={() => {
                if (selectingArtifacts && selectedArtifactIds.length > 0) {
                  confirmExtract(selectedArtifactIds);
                  return;
                }
                setSelectingArtifacts((value) => !value);
                setSelectedArtifactIds([]);
              }}
              disabled={extractMutation.isPending}
              className="mr-2 flex-row items-center rounded-full bg-emerald-700 px-3 py-2 active:bg-emerald-600 disabled:opacity-60"
            >
              {extractMutation.isPending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="scan-outline" size={15} color="#fff" />
                  <Text className="ml-1.5 text-xs font-medium text-white">
                    {selectingArtifacts
                      ? selectedArtifactIds.length > 0
                        ? `识别${selectedArtifactIds.length}张`
                        : '取消'
                      : '批量识别'}
                  </Text>
                </>
              )}
            </Pressable>
          )}
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
                        onPress={() => {
                          if (selectingArtifacts) toggleSelectedArtifact(a.id);
                        }}
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
                        <View className="absolute left-2 right-2 top-2 flex-row justify-between">
                          <ExtractionPill artifact={a} />
                          {selectingArtifacts && (
                            <View
                              className={`h-6 w-6 items-center justify-center rounded-full ${
                                selectedArtifactIds.includes(a.id)
                                  ? 'bg-emerald-700'
                                  : 'bg-white/90'
                              }`}
                            >
                              <Ionicons
                                name={
                                  selectedArtifactIds.includes(a.id)
                                    ? 'checkmark'
                                    : 'ellipse-outline'
                                }
                                size={15}
                                color={
                                  selectedArtifactIds.includes(a.id)
                                    ? '#fff'
                                    : '#71717a'
                                }
                              />
                            </View>
                          )}
                        </View>
                        {!selectingArtifacts && (
                          <View className="absolute bottom-2 left-2 right-2 flex-row gap-1">
                            <Pressable
                              onPress={() => readArtifactText(a)}
                              disabled={readTextMutation.isPending}
                              className="flex-1 items-center rounded bg-black/70 py-1"
                            >
                              <Text className="text-[10px] font-medium text-white">
                                读字
                              </Text>
                            </Pressable>
                            <Pressable
                              onPress={() => startEditingArtifact(a)}
                              className="flex-1 items-center rounded bg-white/90 py-1"
                            >
                              <Text className="text-[10px] font-medium text-zinc-900">
                                编辑
                              </Text>
                            </Pressable>
                          </View>
                        )}
                        {a.name && (
                          <View className="absolute bottom-9 left-2 right-2 rounded bg-white/90 px-1 py-0.5">
                            <Text
                              numberOfLines={1}
                              className="text-[10px] font-medium text-zinc-900"
                            >
                              {a.name}
                            </Text>
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

      <ArtifactInfoEditor
        artifact={editingArtifact}
        draft={infoDraft}
        saving={
          updateArtifactInfoMutation.isPending ||
          createArtifactEntryMutation.isPending ||
          linkArtifactPhotoMutation.isPending
        }
        artifacts={artifacts ?? []}
        onChange={setInfoDraft}
        onClose={() => setEditingArtifact(null)}
        onCreateEntry={createNextArtifactEntry}
        onLinkPhoto={linkPhotoToCurrentArtifact}
        onSave={saveArtifactInfo}
      />
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

type ArtifactInfoDraft = {
  name: string;
  dynasty: string;
  category: string;
  origin: string;
  era: string;
  label_description: string;
  raw_ocr_text: string;
};

const EMPTY_INFO_DRAFT: ArtifactInfoDraft = {
  name: '',
  dynasty: '',
  category: '',
  origin: '',
  era: '',
  label_description: '',
  raw_ocr_text: '',
};

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function ExtractionPill({ artifact }: { artifact: ArtifactRow }) {
  const status = artifact.extraction_status ?? 'idle';
  const styles =
    status === 'done' || status === 'manual'
      ? 'bg-emerald-700'
      : status === 'failed'
        ? 'bg-red-600'
        : status === 'processing' || status === 'queued'
          ? 'bg-amber-500'
          : 'bg-black/60';
  const label =
    status === 'done'
      ? '已识别'
      : status === 'manual'
        ? '手填'
        : status === 'failed'
          ? '待补全'
          : status === 'processing' || status === 'queued'
            ? '识别中'
            : '未识别';

  return (
    <View className={`rounded-full px-1.5 py-0.5 ${styles}`}>
      <Text className="text-[9px] font-medium text-white">{label}</Text>
    </View>
  );
}

function ArtifactInfoEditor({
  artifact,
  artifacts,
  draft,
  saving,
  onChange,
  onClose,
  onCreateEntry,
  onLinkPhoto,
  onSave,
}: {
  artifact: ArtifactRow | null;
  artifacts: ArtifactRow[];
  draft: ArtifactInfoDraft;
  saving: boolean;
  onChange: (draft: ArtifactInfoDraft) => void;
  onClose: () => void;
  onCreateEntry: () => void;
  onLinkPhoto: (photoArtifactId: string, role: ArtifactPhotoRole) => void;
  onSave: () => void;
}) {
  const [assignIndex, setAssignIndex] = useState(0);
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [photoRole, setPhotoRole] = useState<ArtifactPhotoRole>('label');
  const lastAssignedTextRef = useRef('');
  const assignTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { data: linkedPhotos } = useArtifactPhotos(artifact?.id);

  useEffect(() => {
    setAssignIndex(0);
    setLinkPickerOpen(false);
    setPhotoRole('label');
    lastAssignedTextRef.current = '';
    if (assignTimerRef.current) {
      clearTimeout(assignTimerRef.current);
      assignTimerRef.current = null;
    }
  }, [artifact?.id]);

  const assignSelectedOcrText = (
    event: NativeSyntheticEvent<TextInputSelectionChangeEventData>,
  ) => {
    const { start, end } = event.nativeEvent.selection;
    if (start === end || assignIndex >= OCR_ASSIGN_FIELDS.length) return;

    const selectedText = draft.raw_ocr_text
      .slice(Math.min(start, end), Math.max(start, end))
      .trim();
    if (!selectedText || selectedText === lastAssignedTextRef.current) return;

    if (assignTimerRef.current) clearTimeout(assignTimerRef.current);
    assignTimerRef.current = setTimeout(() => {
      const field = OCR_ASSIGN_FIELDS[assignIndex];
      if (!field) return;
      lastAssignedTextRef.current = selectedText;
      onChange({ ...draft, [field]: selectedText });
      setAssignIndex((current) => current + 1);
    }, 4000);
  };

  return (
    <Modal visible={!!artifact} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/40">
        <View className="max-h-[88%] rounded-t-3xl bg-white p-5">
          <View className="flex-row items-center justify-between">
            <Text className="text-lg font-semibold text-zinc-900">编辑文物信息</Text>
            <Pressable
              onPress={onClose}
              className="h-9 w-9 items-center justify-center rounded-full bg-zinc-100"
            >
              <Ionicons name="close" size={18} color="#18181b" />
            </Pressable>
          </View>
          <ScrollView className="mt-4" keyboardShouldPersistTaps="handled">
            <InfoInput
              label="文物名称"
              value={draft.name}
              onChangeText={(name) => onChange({ ...draft, name })}
            />
            <InfoInput
              label="朝代"
              value={draft.dynasty}
              onChangeText={(dynasty) => onChange({ ...draft, dynasty })}
            />
            <InfoInput
              label="品类"
              value={draft.category}
              onChangeText={(category) => onChange({ ...draft, category })}
            />
            <InfoInput
              label="出土地 / 来源"
              value={draft.origin}
              onChangeText={(origin) => onChange({ ...draft, origin })}
            />
            <InfoInput
              label="具体年代"
              value={draft.era}
              onChangeText={(era) => onChange({ ...draft, era })}
            />
            <InfoInput
              label="OCR 原文"
              value={draft.raw_ocr_text}
              onChangeText={(raw_ocr_text) =>
                onChange({ ...draft, raw_ocr_text })
              }
              onSelectionChange={assignSelectedOcrText}
              multiline
            />
            <InfoInput
              label="OCR 整理结果"
              value={draft.label_description}
              onChangeText={(label_description) =>
                onChange({ ...draft, label_description })
              }
              multiline
            />
            {artifact && (
              <View className="mb-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                <View className="flex-row items-center justify-between">
                  <Text className="text-xs font-medium text-zinc-600">
                    关联照片（{linkedPhotos?.length ?? 0}）
                  </Text>
                  <Pressable
                    onPress={() => setLinkPickerOpen((value) => !value)}
                    className="rounded-full bg-white px-3 py-1.5"
                  >
                    <Text className="text-xs font-medium text-zinc-900">
                      {linkPickerOpen ? '收起' : '添加'}
                    </Text>
                  </Pressable>
                </View>

                {linkPickerOpen && (
                  <View className="mt-3">
                    <View className="mb-3 flex-row flex-wrap gap-2">
                      {PHOTO_ROLE_OPTIONS.map((option) => (
                        <Pressable
                          key={option.value}
                          onPress={() => setPhotoRole(option.value)}
                          className={`rounded-full px-3 py-1.5 ${
                            photoRole === option.value
                              ? 'bg-emerald-700'
                              : 'bg-white'
                          }`}
                        >
                          <Text
                            className={`text-xs font-medium ${
                              photoRole === option.value
                                ? 'text-white'
                                : 'text-zinc-700'
                            }`}
                          >
                            {option.label}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                    <View className="flex-row flex-wrap">
                      {artifacts.map((item) => {
                        const uri =
                          getArtifactThumbnailUri(item) ?? getArtifactPhotoUri(item);
                        const isCurrent = item.id === artifact.id;
                        return (
                          <Pressable
                            key={item.id}
                            onPress={() => onLinkPhoto(item.id, photoRole)}
                            disabled={saving}
                            className="aspect-square w-1/4 p-1 disabled:opacity-50"
                          >
                            <View className="flex-1 overflow-hidden rounded-lg bg-zinc-200">
                              {uri ? (
                                <Image
                                  source={{ uri }}
                                  contentFit="cover"
                                  style={{ flex: 1 }}
                                />
                              ) : (
                                <View className="flex-1 items-center justify-center">
                                  <Ionicons
                                    name="image-outline"
                                    size={18}
                                    color="#a1a1aa"
                                  />
                                </View>
                              )}
                              <View className="absolute left-1 top-1 rounded bg-black/60 px-1">
                                <Text className="text-[9px] text-white">
                                  {isCurrent ? '当前' : photoRoleLabel(photoRole)}
                                </Text>
                              </View>
                            </View>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                )}
              </View>
            )}
          </ScrollView>
          <View className="mt-4 flex-row gap-2">
            <Pressable
              onPress={onCreateEntry}
              disabled={saving || !artifact}
              className="flex-1 items-center rounded-xl border border-emerald-700 py-3 active:bg-emerald-50 disabled:opacity-50"
            >
              <Text className="text-sm font-semibold text-emerald-700">
                新建条目
              </Text>
            </Pressable>
            <Pressable
              onPress={onSave}
              disabled={saving}
              className="flex-1 items-center rounded-xl bg-emerald-700 py-3 active:bg-emerald-600 disabled:opacity-50"
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="text-sm font-semibold text-white">保存</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const OCR_ASSIGN_FIELDS: (keyof Pick<
  ArtifactInfoDraft,
  'name' | 'dynasty' | 'category' | 'origin' | 'era' | 'label_description'
>)[] = ['name', 'dynasty', 'category', 'origin', 'era', 'label_description'];

const PHOTO_ROLE_OPTIONS: { value: ArtifactPhotoRole; label: string }[] = [
  { value: 'label', label: '展签' },
  { value: 'detail', label: '细节' },
  { value: 'scene', label: '场景' },
  { value: 'other', label: '其他' },
];

function photoRoleLabel(role: ArtifactPhotoRole): string {
  return PHOTO_ROLE_OPTIONS.find((option) => option.value === role)?.label ?? '照片';
}

function InfoInput({
  label,
  value,
  onChangeText,
  onSelectionChange,
  multiline = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  onSelectionChange?: (
    event: NativeSyntheticEvent<TextInputSelectionChangeEventData>,
  ) => void;
  multiline?: boolean;
}) {
  return (
    <View className="mb-3">
      <Text className="mb-1 text-xs font-medium text-zinc-500">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onSelectionChange={onSelectionChange}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        className={`rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-900 ${
          multiline ? 'min-h-24 py-3' : 'h-11'
        }`}
      />
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
