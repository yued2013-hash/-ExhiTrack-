import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import * as Haptics from 'expo-haptics';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type IconName = keyof typeof Ionicons.glyphMap;

const META: Record<
  string,
  { active: IconName; inactive: IconName; label: string }
> = {
  index: { active: 'home', inactive: 'home-outline', label: '首页' },
  library: { active: 'albums', inactive: 'albums-outline', label: '文博库' },
  capture: { active: 'camera', inactive: 'camera', label: '拍摄' },
  profile: { active: 'person', inactive: 'person-outline', label: '我的' },
};

const ACTIVE_COLOR = '#15803d';
const INACTIVE_COLOR = '#71717a';

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{ paddingBottom: insets.bottom, overflow: 'visible' }}
      className="flex-row border-t border-zinc-200 bg-white"
    >
      {state.routes.map((route, index) => {
        const meta = META[route.name];
        if (!meta) return null;
        const isFocused = state.index === index;

        const onPress = () => {
          Haptics.selectionAsync().catch(() => {});
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        if (route.name === 'capture') {
          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              className="flex-1 items-center justify-end pb-1"
              style={{ overflow: 'visible' }}
            >
              <View
                className="-mt-7 h-14 w-14 items-center justify-center rounded-full bg-emerald-700 active:bg-emerald-800"
                style={{
                  elevation: 6,
                  shadowColor: '#000',
                  shadowOpacity: 0.18,
                  shadowRadius: 6,
                  shadowOffset: { width: 0, height: 3 },
                }}
              >
                <Ionicons name="camera" size={26} color="#fff" />
              </View>
              <Text className="mt-1 text-[10px] text-zinc-500">{meta.label}</Text>
            </Pressable>
          );
        }

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            className="flex-1 items-center justify-center py-2"
          >
            <Ionicons
              name={isFocused ? meta.active : meta.inactive}
              size={22}
              color={isFocused ? ACTIVE_COLOR : INACTIVE_COLOR}
            />
            <Text
              className={`mt-0.5 text-[10px] ${isFocused ? 'font-medium text-emerald-700' : 'text-zinc-500'}`}
            >
              {meta.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
