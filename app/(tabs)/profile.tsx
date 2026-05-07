import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { useSession } from '@/lib/auth';
import { useManualSync, useSyncStatusCounts } from '@/lib/queries/exhibitions';
import { supabase } from '@/lib/supabase';

function Row({
  color,
  label,
}: {
  color: string;
  label: string;
}) {
  return (
    <View className="flex-row items-center">
      <View className={`mr-2 h-2 w-2 rounded-full ${color}`} />
      <Text className="text-sm text-zinc-900">{label}</Text>
    </View>
  );
}

type SyncProblem = {
  id: string;
  sync_status: string;
  retry_count: number;
  last_error: string | null;
};

export default function ProfileScreen() {
  const { session } = useSession();
  const { data: counts } = useSyncStatusCounts();
  const manualSync = useManualSync();

  const totalPending = counts?.totalPending ?? 0;
  const totalFailed = counts?.totalFailed ?? 0;
  const allClean = totalPending === 0 && totalFailed === 0;

  const breakdown = [
    {
      label: '展览',
      pending: counts?.exhibitions.pending ?? 0,
      failed: counts?.exhibitions.failed ?? 0,
    },
    {
      label: '文物照片',
      pending: counts?.artifacts.pending ?? 0,
      failed: counts?.artifacts.failed ?? 0,
    },
    {
      label: '感受录音',
      pending: counts?.impressions.pending ?? 0,
      failed: counts?.impressions.failed ?? 0,
    },
  ];

  return (
    <View className="flex-1 bg-zinc-50 px-6 pt-6">
      <View className="rounded-xl border border-zinc-200 bg-white p-4">
        <Text className="text-xs uppercase tracking-wider text-zinc-500">
          登录账号
        </Text>
        <Text className="mt-1 text-base font-medium text-zinc-900">
          {session?.user?.email ?? '加载中…'}
        </Text>
      </View>

      <View className="mt-4 rounded-xl border border-zinc-200 bg-white p-4">
        <Text className="text-xs uppercase tracking-wider text-zinc-500">
          同步状态
        </Text>
        {allClean ? (
          <View className="mt-2">
            <Row color="bg-emerald-500" label="全部已同步" />
          </View>
        ) : (
          <View className="mt-2 gap-1.5">
            {breakdown
              .filter((b) => b.pending > 0 || b.failed > 0)
              .map((b) => (
                <View key={b.label}>
                  {b.pending > 0 && (
                    <Row
                      color="bg-amber-500"
                      label={`${b.label}: ${b.pending} 条待同步`}
                    />
                  )}
                  {b.failed > 0 && (
                    <Row
                      color="bg-red-500"
                      label={`${b.label}: ${b.failed} 条同步失败`}
                    />
                  )}
                </View>
              ))}
          </View>
        )}

        <SyncProblemList
          title="文物照片失败原因"
          problems={counts?.artifactProblems ?? []}
        />
        <SyncProblemList
          title="感受录音失败原因"
          problems={counts?.impressionProblems ?? []}
        />

        <Pressable
          onPress={() => manualSync.mutate()}
          disabled={manualSync.isPending}
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

function SyncProblemList({
  title,
  problems,
}: {
  title: string;
  problems: SyncProblem[];
}) {
  if (problems.length === 0) return null;
  return (
    <View className="mt-3 rounded-lg bg-red-50 px-3 py-2">
      <Text className="text-xs font-medium text-red-700">{title}</Text>
      <View className="mt-1.5 gap-1">
        {problems.map((problem) => (
          <Text key={problem.id} className="text-xs leading-4 text-red-700">
            {shortId(problem.id)} · {problem.sync_status} · 重试
            {problem.retry_count} 次 · {formatSyncError(problem.last_error)}
          </Text>
        ))}
      </View>
    </View>
  );
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function formatSyncError(error: string | null): string {
  if (!error) return '未知错误';
  return error.length > 80 ? `${error.slice(0, 80)}...` : error;
}
