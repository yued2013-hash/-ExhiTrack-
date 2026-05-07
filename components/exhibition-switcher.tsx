import { Ionicons } from '@expo/vector-icons';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Exhibition } from '@/lib/queries/exhibitions';

type Props = {
  visible: boolean;
  exhibitions: Exhibition[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  onClose: () => void;
  onCreateNew: () => void;
};

export function ExhibitionSwitcher({
  visible,
  exhibitions,
  selectedId,
  onSelect,
  onClose,
  onCreateNew,
}: Props) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View className="flex-1 bg-black/50">
        {/* Backdrop tap closes the sheet */}
        <Pressable className="flex-1" onPress={onClose} />

        <View className="rounded-t-2xl bg-white">
          {/* Drag handle */}
          <View className="items-center pt-3 pb-1">
            <View className="h-1 w-10 rounded-full bg-zinc-300" />
          </View>

          <View className="flex-row items-center justify-between px-4 pb-2 pt-1">
            <Text className="text-base font-semibold text-zinc-900">
              选择展览
            </Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color="#71717a" />
            </Pressable>
          </View>

          <ScrollView
            className="border-t border-zinc-100"
            style={{ maxHeight: 360 }}
          >
            {exhibitions.length === 0 ? (
              <View className="items-center px-6 py-8">
                <Ionicons name="albums-outline" size={36} color="#a1a1aa" />
                <Text className="mt-3 text-sm text-zinc-500">
                  还没有展览
                </Text>
              </View>
            ) : (
              exhibitions.map((e) => {
                const isSelected = e.id === selectedId;
                return (
                  <Pressable
                    key={e.id}
                    onPress={() => onSelect(e.id)}
                    className="flex-row items-center px-4 py-3 active:bg-zinc-50"
                  >
                    <View className="flex-1">
                      <Text
                        className="text-base text-zinc-900"
                        numberOfLines={1}
                      >
                        {e.name}
                      </Text>
                      <Text
                        className="mt-0.5 text-xs text-zinc-500"
                        numberOfLines={1}
                      >
                        {e.museum ?? '—'}
                        {e.visit_date ? ` · ${e.visit_date}` : ''}
                      </Text>
                    </View>
                    {isSelected && (
                      <Ionicons name="checkmark" size={22} color="#15803d" />
                    )}
                  </Pressable>
                );
              })
            )}
          </ScrollView>

          <Pressable
            onPress={onCreateNew}
            className="flex-row items-center border-t border-zinc-100 px-4 py-3 active:bg-zinc-50"
          >
            <Ionicons name="add-circle-outline" size={20} color="#15803d" />
            <Text className="ml-2 text-base font-medium text-emerald-700">
              新建展览
            </Text>
          </Pressable>

          {/* Safe area bottom padding */}
          <View style={{ height: insets.bottom }} />
        </View>
      </View>
    </Modal>
  );
}
