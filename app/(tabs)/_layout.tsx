import { Ionicons } from '@expo/vector-icons';
import { Tabs, useRouter } from 'expo-router';
import { Pressable } from 'react-native';

import { TabBar } from '@/components/tab-bar';

function HeaderAddButton() {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push('/exhibition/new')}
      hitSlop={12}
      className="mr-3 active:opacity-60"
    >
      <Ionicons name="add" size={28} color="#15803d" />
    </Pressable>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerStyle: { backgroundColor: '#fff' },
        headerTitleStyle: { color: '#18181b', fontWeight: '600' },
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '我的展览',
          headerRight: () => <HeaderAddButton />,
        }}
      />
      <Tabs.Screen name="library" options={{ title: '文博库' }} />
      <Tabs.Screen name="capture" options={{ title: '拍摄', headerShown: false }} />
      <Tabs.Screen name="profile" options={{ title: '我的' }} />
    </Tabs>
  );
}
