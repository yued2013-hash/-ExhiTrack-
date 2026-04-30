import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { z } from 'zod';

import { formatError } from '@/lib/errors';
import { useCreateExhibition } from '@/lib/queries/exhibitions';

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const schema = z.object({
  name: z.string().min(1, '请填写展览名'),
  museum: z.string().optional(),
  visit_date: z
    .string()
    .optional()
    .refine((v) => !v || dateRegex.test(v), { message: '日期格式应为 YYYY-MM-DD' }),
});

type FormData = z.infer<typeof schema>;

const today = () => new Date().toISOString().slice(0, 10);

export default function NewExhibitionScreen() {
  const router = useRouter();
  const createMutation = useCreateExhibition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', museum: '', visit_date: today() },
  });

  const onSubmit = handleSubmit(async (data) => {
    setErrorMsg(null);
    try {
      await createMutation.mutateAsync({
        name: data.name.trim(),
        museum: data.museum?.trim() ?? null,
        visit_date: data.visit_date || null,
      });
      router.back();
    } catch (e: unknown) {
      console.error('[create-exhibition]', e, (e as { cause?: unknown })?.cause);
      setErrorMsg(formatError(e));
    }
  });

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-white"
    >
      <ScrollView contentContainerStyle={{ padding: 24 }} keyboardShouldPersistTaps="handled">
        <Text className="mb-1.5 text-sm font-medium text-zinc-700">展览名 *</Text>
        <Controller
          control={control}
          name="name"
          render={({ field: { onChange, value, onBlur } }) => (
            <TextInput
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              autoFocus
              className="rounded-lg border border-zinc-300 px-4 py-3 text-base text-zinc-900"
              placeholder="例：盛世华彩 — 故宫陶瓷展"
              placeholderTextColor="#a1a1aa"
            />
          )}
        />
        {errors.name && (
          <Text className="mt-1 text-xs text-red-600">{errors.name.message}</Text>
        )}

        <Text className="mb-1.5 mt-5 text-sm font-medium text-zinc-700">博物馆</Text>
        <Controller
          control={control}
          name="museum"
          render={({ field: { onChange, value, onBlur } }) => (
            <TextInput
              value={value ?? ''}
              onChangeText={onChange}
              onBlur={onBlur}
              className="rounded-lg border border-zinc-300 px-4 py-3 text-base text-zinc-900"
              placeholder="例：故宫博物院"
              placeholderTextColor="#a1a1aa"
            />
          )}
        />

        <Text className="mb-1.5 mt-5 text-sm font-medium text-zinc-700">观展日期</Text>
        <Controller
          control={control}
          name="visit_date"
          render={({ field: { onChange, value, onBlur } }) => (
            <TextInput
              value={value ?? ''}
              onChangeText={onChange}
              onBlur={onBlur}
              autoCapitalize="none"
              keyboardType="numbers-and-punctuation"
              className="rounded-lg border border-zinc-300 px-4 py-3 text-base text-zinc-900"
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#a1a1aa"
            />
          )}
        />
        {errors.visit_date && (
          <Text className="mt-1 text-xs text-red-600">{errors.visit_date.message}</Text>
        )}

        {errorMsg && (
          <View className="mt-4 rounded-md bg-red-50 px-3 py-2">
            <Text className="text-sm text-red-700">{errorMsg}</Text>
          </View>
        )}

        <Pressable
          onPress={onSubmit}
          disabled={createMutation.isPending}
          className="mt-8 items-center rounded-lg bg-emerald-700 py-3.5 active:bg-emerald-800 disabled:opacity-50"
        >
          {createMutation.isPending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-base font-medium text-white">创建</Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
