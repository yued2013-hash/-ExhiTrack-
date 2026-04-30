import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { useSession } from '@/lib/auth';
import { useManualSync, useSyncStatusCounts } from '@/lib/queries/exhibitions';
import { supabase } from '@/lib/supabase';

export default function ProfileScreen() {
  const { session } = useSession();
  const { data: counts } = useSyncStatusCounts();
  const manualSync = useManualSync();

  const pending = counts?.pending ?? 0;
  const failed = counts?.failed ?? 0;
  const allClean = pending === 0 && failed === 0;

  return (
    <View className="flex-1 bg-zinc-50 px-6 pt-6">
      <View className="rounded-xl border border-zinc-200 bg-white p-4">
        <Text className="text-xs uppercase tracking-wider text-zinc-500">登录账号</Text>
        <Text className="mt-1 text-base font-medium text-zinc-900">
          {session?.user?.email ?? '加载中…'}
        </Text>
      </View>

      <View className="mt-4 rounded-xl border border-zinc-200 bg-white p-4">
        <Text className="text-xs uppercase tracking-wider text-zinc-500">同步状态</Text>
        {allClean ? (
          <View className="mt-2 flex-row items-center">
            <View className="mr-2 h-2 w-2 rounded-full bg-emerald-500" />
            <Text className="text-base font-medium text-zinc-900">全部已同步</Text>
          </View>
        ) : (
          <View className="mt-2 gap-1">
            {pending > 0 && (
              <View className="flex-row items-center">
                <View className="mr-2 h-2 w-2 rounded-full bg-amber-500" />
                <Text className="text-base text-zinc-900">
                  {pending} 条待同步至云端
                </Text>
              </View>
            )}
            {failed > 0 && (
              <View className="flex-row items-center">
                <View className="mr-2 h-2 w-2 rounded-full bg-red-500" />
                <Text className="text-base text-zinc-900">{failed} 条同步失败</Text>
              </View>
            )}
          </View>
        )}

        <Pressable
          onPress={() => manualSync.mutate()}
          disabled={manualSync.isPending || allClean}
          className="mt-4 items-center rounded-lg bg-emerald-700 py-2.5 active:bg-emerald-800 disabled:opacity-40"
        >
          {manualSync.isPending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-sm font-medium text-white">立即同步</Text>
          )}
        </Pressable>
      </View>

      <Pressable
        onPress={() => supabase.auth.signOut()}
        className="mt-6 items-center rounded-xl border border-zinc-300 bg-white py-3 active:bg-zinc-100"
      >
        <Text className="text-sm font-medium text-zinc-700">登出</Text>
      </Pressable>
    </View>
  );
}
