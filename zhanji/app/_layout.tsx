import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';

import '../global.css';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider, useSession } from '@/lib/auth';
import { asyncStoragePersister, queryClient } from '@/lib/queryClient';
import { useSyncEngine } from '@/lib/sync/useSyncEngine';

export const unstable_settings = {
  anchor: '(tabs)',
};

function useAuthRedirect() {
  const { session, ready } = useSession();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    const inAuthGroup = segments[0] === '(auth)';
    if (!session && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (session && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [session, segments, ready, router]);
}

function RootLayoutInner() {
  const colorScheme = useColorScheme();
  const { ready } = useSession();
  useAuthRedirect();
  useSyncEngine();

  if (!ready) return null;

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="exhibition/new"
          options={{ presentation: 'modal', title: '新建展览' }}
        />
        <Stack.Screen name="exhibition/[id]" options={{ title: '展览详情' }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister: asyncStoragePersister, buster: 'v2-localfirst' }}
    >
      <AuthProvider>
        <RootLayoutInner />
      </AuthProvider>
    </PersistQueryClientProvider>
  );
}
