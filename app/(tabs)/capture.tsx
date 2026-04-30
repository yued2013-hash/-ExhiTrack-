import { Ionicons } from '@expo/vector-icons';
import { Text, View } from 'react-native';

export default function CaptureScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-zinc-50 px-6">
      <Ionicons name="camera-outline" size={56} color="#a1a1aa" />
      <Text className="mt-4 text-base text-zinc-700">拍摄 · 即将上线</Text>
      <Text className="mt-1 text-center text-sm text-zinc-500">
        自定义相机、连拍归组、实时 OCR
        {'\n'}批次 3 实装
      </Text>
    </View>
  );
}
