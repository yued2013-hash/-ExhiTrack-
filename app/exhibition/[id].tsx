import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { formatError } from '@/lib/errors';
import { useDeleteExhibition, useExhibition } from '@/lib/queries/exhibitions';

export default function ExhibitionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data, isLoading, isError, error } = useExhibition(id);
  const deleteMutation = useDeleteExhibition();

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

      <View className="mt-6 rounded-xl border border-zinc-200 bg-white p-5">
        <Text className="text-sm text-zinc-500">
          文物列表、感受、策展叙事将在后续批次接入。
        </Text>
      </View>

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
