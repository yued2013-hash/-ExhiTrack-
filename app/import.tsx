import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { type Href, useRouter } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { formatError } from '@/lib/errors';
import { useImportArtifacts } from '@/lib/queries/artifacts';
import { useExhibitions } from '@/lib/queries/exhibitions';

const NEW_EXHIBITION_ROUTE = '/exhibition/new' as Href;

export default function ImportSharedPhotosScreen() {
  const router = useRouter();
  const { data: exhibitions, isLoading } = useExhibitions();
  const importMutation = useImportArtifacts();
  const { shareIntent, resetShareIntent } = useShareIntentContext();
  const [selectedExhibitionId, setSelectedExhibitionId] = useState<string | null>(null);

  const imageFiles = useMemo(
    () =>
      (shareIntent.files ?? [])
        .filter((file) => file.mimeType?.startsWith('image/') && file.path)
        .slice(0, 50),
    [shareIntent.files],
  );

  const selectedExhibition =
    exhibitions?.find((item) => item.id === selectedExhibitionId) ?? null;

  const onImport = async () => {
    if (!selectedExhibition || imageFiles.length === 0) return;
    try {
      await importMutation.mutateAsync({
        exhibition_id: selectedExhibition.id,
        photos: imageFiles.map((file) => ({ uri: file.path })),
      });
      resetShareIntent();
      Alert.alert('导入完成', `已导入 ${imageFiles.length} 张照片`, [
        {
          text: '查看展览',
          onPress: () =>
            router.replace({
              pathname: '/exhibition/[id]',
              params: { id: selectedExhibition.id },
            }),
        },
      ]);
    } catch (e) {
      console.error('[import-shared-photos]', e);
      Alert.alert('导入失败', formatError(e));
    }
  };

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-zinc-50">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-zinc-50" contentContainerStyle={{ padding: 16 }}>
      <View className="rounded-xl border border-zinc-200 bg-white p-4">
        <View className="flex-row items-center">
          <View className="mr-3 h-10 w-10 items-center justify-center rounded-full bg-zinc-900">
            <Ionicons name="images-outline" size={20} color="#fff" />
          </View>
          <View className="flex-1">
            <Text className="text-base font-semibold text-zinc-900">
              系统分享导入
            </Text>
            <Text className="mt-0.5 text-xs text-zinc-500">
              已收到 {imageFiles.length} 张图片，最多一次导入 50 张
            </Text>
          </View>
        </View>

        {imageFiles.length > 0 ? (
          <View className="mt-4 flex-row flex-wrap">
            {imageFiles.slice(0, 9).map((file) => (
              <View key={file.path} className="aspect-square w-1/3 p-1">
                <Image
                  source={{ uri: file.path }}
                  contentFit="cover"
                  style={{ flex: 1, borderRadius: 8 }}
                />
              </View>
            ))}
          </View>
        ) : (
          <Text className="mt-4 text-sm text-zinc-500">
            没有可导入的图片。请从系统相册选择照片后分享到 Exhitrack。
          </Text>
        )}
      </View>

      <View className="mt-6 rounded-xl border border-zinc-200 bg-white p-4">
        <Text className="text-sm font-medium text-zinc-700">选择目标展览</Text>
        {(exhibitions?.length ?? 0) === 0 ? (
          <Pressable
            onPress={() => router.push(NEW_EXHIBITION_ROUTE)}
            className="mt-3 flex-row items-center rounded-lg border border-dashed border-zinc-300 px-3 py-3 active:bg-zinc-50"
          >
            <Ionicons name="add-circle-outline" size={20} color="#18181b" />
            <Text className="ml-2 text-sm font-medium text-zinc-900">
              新建展览
            </Text>
          </Pressable>
        ) : (
          <View className="mt-3 gap-2">
            {exhibitions!.map((item) => {
              const selected = selectedExhibitionId === item.id;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => setSelectedExhibitionId(item.id)}
                  className={`flex-row items-center rounded-lg border px-3 py-3 active:bg-zinc-50 ${
                    selected
                      ? 'border-zinc-900 bg-zinc-50'
                      : 'border-zinc-200 bg-white'
                  }`}
                >
                  <Ionicons
                    name={selected ? 'radio-button-on' : 'radio-button-off'}
                    size={20}
                    color={selected ? '#18181b' : '#a1a1aa'}
                  />
                  <View className="ml-2 flex-1">
                    <Text className="text-sm font-medium text-zinc-900">
                      {item.name}
                    </Text>
                    <Text className="mt-0.5 text-xs text-zinc-500">
                      {[item.museum, item.visit_date].filter(Boolean).join(' · ') ||
                        '未填写博物馆和日期'}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      <Pressable
        onPress={onImport}
        disabled={
          !selectedExhibition ||
          imageFiles.length === 0 ||
          importMutation.isPending
        }
        className="mt-6 items-center rounded-xl bg-zinc-900 py-3 active:bg-zinc-700 disabled:opacity-50"
      >
        {importMutation.isPending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text className="text-sm font-semibold text-white">导入到展览</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}
