import { Ionicons } from '@expo/vector-icons';
import {
  AudioModule,
  RecordingPresets,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCaptureArtifact } from '@/lib/queries/artifacts';
import { useCreateImpression } from '@/lib/queries/impressions';
import { useExhibitions } from '@/lib/queries/exhibitions';

const GROUP_TIMEOUT_MS = 60_000;
const MIN_RECORDING_MS = 500;

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export default function CaptureScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [capturing, setCapturing] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);

  // Multi-shot grouping: photos taken within 60s of the previous one share a group_id.
  const activeGroupIdRef = useRef<string | null>(null);
  const [groupCount, setGroupCount] = useState(0);
  const [lastCaptureAt, setLastCaptureAt] = useState(0);

  // Last captured artifact ID — voice recordings auto-bind to it.
  const lastArtifactIdRef = useRef<string | null>(null);

  // Voice recording.
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 200);
  const recordingStartRef = useRef<number>(0);
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0);

  const { data: exhibitions } = useExhibitions();
  const activeExhibition = exhibitions?.[0];
  const captureMutation = useCaptureArtifact();
  const createImpressionMutation = useCreateImpression();

  // Safety fallback: if onCameraReady never fires (some Android quirks),
  // unlock the shutter after 4s anyway. Once ready, stays ready forever —
  // resetting on tab unfocus caused a deadlock where active toggle didn't
  // re-fire onCameraReady.
  useEffect(() => {
    if (cameraReady) return;
    const timeout = setTimeout(() => {
      console.log('[capture] camera ready timeout fallback (4s)');
      setCameraReady(true);
    }, 4000);
    return () => clearTimeout(timeout);
  }, [cameraReady]);

  // Expire the active group after GROUP_TIMEOUT_MS of inactivity.
  useEffect(() => {
    if (groupCount === 0 || lastCaptureAt === 0) return;
    const elapsed = Date.now() - lastCaptureAt;
    const remaining = GROUP_TIMEOUT_MS - elapsed;
    if (remaining <= 0) {
      activeGroupIdRef.current = null;
      setGroupCount(0);
      return;
    }
    const timer = setTimeout(() => {
      console.log('[capture] group expired');
      activeGroupIdRef.current = null;
      setGroupCount(0);
    }, remaining);
    return () => clearTimeout(timer);
  }, [groupCount, lastCaptureAt]);

  // Tick recording duration display while recorder is active.
  useEffect(() => {
    if (!recorderState.isRecording) {
      setRecordingElapsedMs(0);
      return;
    }
    const id = setInterval(() => {
      setRecordingElapsedMs(Date.now() - recordingStartRef.current);
    }, 100);
    return () => clearInterval(id);
  }, [recorderState.isRecording]);

  const startRecording = async () => {
    if (!activeExhibition) return;
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('需要麦克风权限', '请在系统设置允许 Exhitrack 录音后重试');
        return;
      }
      await recorder.prepareToRecordAsync();
      recorder.record();
      recordingStartRef.current = Date.now();
      console.log('[record] started');
    } catch (e) {
      console.error('[record] start error', e);
      Alert.alert('录音启动失败', e instanceof Error ? e.message : String(e));
    }
  };

  const stopRecording = async () => {
    if (!recorderState.isRecording) return;
    if (!activeExhibition) return;
    const duration = Date.now() - recordingStartRef.current;
    try {
      await recorder.stop();
      const uri = recorder.uri;
      console.log('[record] stopped', { duration, uri });
      if (!uri) {
        console.warn('[record] no uri after stop');
        return;
      }
      if (duration < MIN_RECORDING_MS) {
        console.log('[record] too short, discarding');
        return;
      }
      createImpressionMutation.mutate(
        {
          exhibition_id: activeExhibition.id,
          artifact_id: lastArtifactIdRef.current,
          source_voice_uri: uri,
          voice_duration_ms: duration,
        },
        {
          onSuccess: () => console.log('[record] impression saved'),
          onError: (e) => {
            console.error('[record] save failed', e);
            Alert.alert(
              '保存录音失败',
              e instanceof Error ? e.message : String(e),
            );
          },
        },
      );
    } catch (e) {
      console.error('[record] stop error', e);
      Alert.alert('录音停止失败', e instanceof Error ? e.message : String(e));
    }
  };

  const onShutter = async () => {
    if (!cameraRef.current || capturing || !activeExhibition || !cameraReady) {
      console.log('[capture] shutter ignored', {
        hasRef: !!cameraRef.current,
        capturing,
        hasExhibition: !!activeExhibition,
        cameraReady,
      });
      return;
    }
    setCapturing(true);
    // Decide group_id: continue active group if within 60s, else start new.
    const now = Date.now();
    const continuingGroup =
      activeGroupIdRef.current !== null && now - lastCaptureAt < GROUP_TIMEOUT_MS;
    const groupId = continuingGroup ? activeGroupIdRef.current! : Crypto.randomUUID();
    activeGroupIdRef.current = groupId;
    setLastCaptureAt(now);
    setGroupCount(continuingGroup ? groupCount + 1 : 1);
    console.log('[capture] taking picture…', {
      groupId,
      newGroup: !continuingGroup,
    });
    try {
      // shutterSound: false silences the system shutter sound on Android (best-effort —
      // some locales force it on at the OS level, in which case put phone on silent).
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.85,
        shutterSound: false,
      });
      if (!photo) throw new Error('takePictureAsync 返回为空');
      console.log('[capture] picture taken', { uri: photo.uri });
      // Fire-and-forget save so the shutter recovers immediately.
      captureMutation.mutate(
        {
          exhibition_id: activeExhibition.id,
          source_photo_uri: photo.uri,
          group_id: groupId,
        },
        {
          onSuccess: (artifact) => {
            console.log('[capture] save success', { id: artifact.id });
            lastArtifactIdRef.current = artifact.id;
          },
          onError: (e) => {
            console.error('[capture] save failed', e);
            Alert.alert('保存照片失败', e instanceof Error ? e.message : String(e));
          },
        },
      );
    } catch (e) {
      console.error('[capture] takePicture threw', e);
      Alert.alert('拍照失败', e instanceof Error ? e.message : String(e));
    } finally {
      setCapturing(false);
    }
  };

  if (!permission) {
    return (
      <View className="flex-1 items-center justify-center bg-zinc-900">
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View className="flex-1 items-center justify-center bg-zinc-50 px-6">
        <Ionicons name="camera-outline" size={48} color="#a1a1aa" />
        <Text className="mt-4 text-base text-zinc-700">需要相机权限才能拍摄</Text>
        {permission.canAskAgain ? (
          <Pressable
            onPress={requestPermission}
            className="mt-5 rounded-lg bg-emerald-700 px-5 py-2.5 active:bg-emerald-800"
          >
            <Text className="text-sm font-medium text-white">允许相机权限</Text>
          </Pressable>
        ) : (
          <Text className="mt-3 text-center text-xs text-zinc-500">
            权限被永久拒绝。请去系统设置 → Expo Go → 权限 → 相机里手动开启
          </Text>
        )}
      </View>
    );
  }

  if (!activeExhibition) {
    return (
      <View className="flex-1 items-center justify-center bg-zinc-50 px-6">
        <Ionicons name="albums-outline" size={48} color="#a1a1aa" />
        <Text className="mt-4 text-center text-base text-zinc-700">
          先去新建一场展览,才能给文物拍照
        </Text>
        <Pressable
          onPress={() => router.push('/exhibition/new')}
          className="mt-5 rounded-lg bg-emerald-700 px-5 py-2.5 active:bg-emerald-800"
        >
          <Text className="text-sm font-medium text-white">新建展览</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-black">
      <StatusBar style="light" />
      <CameraView
        ref={cameraRef}
        style={{ flex: 1 }}
        facing="back"
        onCameraReady={() => {
          console.log('[capture] camera ready');
          setCameraReady(true);
        }}
        onMountError={(e) => {
          console.error('[capture] camera mount error', e);
        }}
      />

      {!cameraReady && (
        <View className="absolute inset-0 items-center justify-center bg-black">
          <ActivityIndicator color="#fff" />
          <Text className="mt-3 text-sm text-white/70">正在初始化相机…</Text>
        </View>
      )}

      <View
        className="absolute left-0 right-0 top-0 flex-row items-center bg-black/40 px-4 pb-3"
        style={{ paddingTop: insets.top + 12 }}
      >
        <View className="flex-1">
          <Text className="text-xs text-white/70">归入展览</Text>
          <Text className="text-base font-semibold text-white" numberOfLines={1}>
            {activeExhibition.name}
          </Text>
        </View>
        {groupCount > 0 && (
          <View className="ml-3 rounded-full bg-emerald-700/90 px-3 py-1">
            <Text className="text-xs font-medium text-white">
              本组 {groupCount} 张
            </Text>
          </View>
        )}
      </View>

      {recorderState.isRecording && (
        <View
          className="absolute left-0 right-0 items-center"
          style={{ bottom: 130 }}
        >
          <View className="flex-row items-center rounded-full bg-red-600/90 px-4 py-2">
            <View className="mr-2 h-2 w-2 rounded-full bg-white" />
            <Text className="text-sm font-medium text-white">
              录音中 {formatDuration(recordingElapsedMs)}
            </Text>
          </View>
        </View>
      )}

      <View
        className="absolute left-0 right-0 bottom-0 flex-row items-center justify-center pb-8"
      >
        <Pressable
          onPress={onShutter}
          disabled={capturing || !cameraReady || recorderState.isRecording}
          hitSlop={20}
          className="h-20 w-20 items-center justify-center rounded-full border-4 border-white/40 bg-white/10 active:scale-95 disabled:opacity-40"
        >
          {capturing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <View className="h-14 w-14 rounded-full bg-white" />
          )}
        </Pressable>

        {/* Record button: press-and-hold */}
        <Pressable
          onPressIn={startRecording}
          onPressOut={stopRecording}
          hitSlop={12}
          className={`absolute right-8 h-14 w-14 items-center justify-center rounded-full ${
            recorderState.isRecording
              ? 'bg-red-600 active:bg-red-700'
              : 'bg-white/15 active:bg-white/25'
          }`}
          style={{ bottom: 36 }}
        >
          <Ionicons name="mic" size={24} color="#fff" />
        </Pressable>
      </View>

      {captureMutation.isPending && !recorderState.isRecording && (
        <View className="absolute left-0 right-0 items-center" style={{ bottom: 6 }}>
          <Text className="text-xs text-white/70">后台保存中…</Text>
        </View>
      )}
    </View>
  );
}
