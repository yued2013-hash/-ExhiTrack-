import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';

import { useDeleteExhibition, useExhibitions, type Exhibition } from '@/lib/queries/exhibitions';

export default function HomeScreen() {
  const router = useRouter();
  const { data, isLoading, isError, error, refetch, isRefetching } = useExhibitions();
  const deleteMutation = useDeleteExhibition();

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-zinc-50">
        <ActivityIndicator />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-zinc-50 px-6">
        <Ionicons name="cloud-offline-outline" size={40} color="#dc2626" />
        <Text className="mt-3 text-base text-zinc-700">加载失败</Text>
        <Text className="mt-1 text-center text-sm text-zinc-500">
          {(error as Error)?.message ?? '未知错误'}
        </Text>
        <Pressable
          onPress={() => refetch()}
          className="mt-5 rounded-lg bg-emerald-700 px-5 py-2.5 active:bg-emerald-800"
        >
          <Text className="text-sm font-medium text-white">重试</Text>
        </Pressable>
      </View>
    );
  }

  const exhibitions = data ?? [];

  if (exhibitions.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-zinc-50 px-6">
        <Ionicons name="albums-outline" size={56} color="#a1a1aa" />
        <Text className="mt-4 text-base text-zinc-700">还没有展览</Text>
        <Text className="mt-1 text-sm text-zinc-500">点右上角 + 添加你的第一场展览</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-zinc-50">
      <FlatList<Exhibition>
        data={exhibitions}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16 }}
        ItemSeparatorComponent={() => <View className="h-3" />}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        renderItem={({ item }) => (
          <Pressable
            onPress={() =>
              router.push({ pathname: '/exhibition/[id]', params: { id: item.id } })
            }
            onLongPress={() => {
              Alert.alert('删除展览', `确定删除「${item.name}」?\n（仅删除展览记录，不会影响照片）`, [
                { text: '取消', style: 'cancel' },
                {
                  text: '删除',
                  style: 'destructive',
                  onPress: () => deleteMutation.mutate(item.id),
                },
              ]);
            }}
            className="rounded-xl border border-zinc-200 bg-white p-4 active:bg-zinc-100"
          >
            <View className="flex-row items-center">
              <Text
                className="flex-1 text-base font-semibold text-zinc-900"
                numberOfLines={1}
              >
                {item.name}
              </Text>
              {item.sync_status !== 'synced' && (
                <View className="ml-2 flex-row items-center">
                  <View className="mr-1 h-1.5 w-1.5 rounded-full bg-amber-500" />
                  <Text className="text-[10px] text-amber-600">
                    {item.sync_status === 'failed' ? '同步失败' : '待同步'}
                  </Text>
                </View>
              )}
            </View>
            <View className="mt-1 flex-row items-center justify-between">
              <Text className="flex-1 text-sm text-zinc-500" numberOfLines={1}>
                {item.museum ?? '未填博物馆'}
              </Text>
              {item.visit_date && (
                <Text className="ml-2 text-xs text-zinc-400">{item.visit_date}</Text>
              )}
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}
