import type { User } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { supabase } from '@/lib/supabase';

export default function ProfileScreen() {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  return (
    <View className="flex-1 bg-zinc-50 px-6 pt-6">
      <View className="rounded-xl border border-zinc-200 bg-white p-4">
        <Text className="text-xs uppercase tracking-wider text-zinc-500">登录账号</Text>
        <Text className="mt-1 text-base font-medium text-zinc-900">
          {user?.email ?? '加载中…'}
        </Text>
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
