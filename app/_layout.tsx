import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import Constants from 'expo-constants';
import { type Href, Stack, useRouter, useSegments } from 'expo-router';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';
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

const IMPORT_ROUTE = '/import' as Href;

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
  useSharedImportRedirect();

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
        <Stack.Screen name="import" options={{ title: '导入照片' }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

function useSharedImportRedirect() {
  const router = useRouter();
  const segments = useSegments();
  const { hasShareIntent, shareIntent } = useShareIntentContext();

  useEffect(() => {
    if (!hasShareIntent) return;
    const hasImages = shareIntent.files?.some((file) =>
      file.mimeType?.startsWith('image/'),
    );
    if (!hasImages || String(segments[0]) === 'import') return;
    router.push(IMPORT_ROUTE);
  }, [hasShareIntent, router, segments, shareIntent.files]);
}

export default function RootLayout() {
  const shareIntentDisabled = Constants.appOwnership === 'expo';

  return (
    <ShareIntentProvider
      options={{ disabled: shareIntentDisabled, scheme: 'exhitrack' }}
    >
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{ persister: asyncStoragePersister, buster: 'v2-localfirst' }}
      >
        <AuthProvider>
          <RootLayoutInner />
        </AuthProvider>
      </PersistQueryClientProvider>
    </ShareIntentProvider>
  );
}
