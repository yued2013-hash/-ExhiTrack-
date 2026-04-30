import { Ionicons } from '@expo/vector-icons';
import { Text, View } from 'react-native';

export default function LibraryScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-zinc-50 px-6">
      <Ionicons name="albums-outline" size={56} color="#a1a1aa" />
      <Text className="mt-4 text-base text-zinc-700">文博库 · 即将上线</Text>
      <Text className="mt-1 text-center text-sm text-zinc-500">
        跨展览搜索文物 / 朝代 / 品类
        {'\n'}批次 9 实装
      </Text>
    </View>
  );
}
