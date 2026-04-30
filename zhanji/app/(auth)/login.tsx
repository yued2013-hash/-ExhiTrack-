import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { z } from 'zod';

import { supabase } from '@/lib/supabase';

const schema = z.object({
  email: z.string().email('请输入有效邮箱'),
  password: z.string().min(6, '密码至少 6 位'),
});

type FormData = z.infer<typeof schema>;

export default function LoginScreen() {
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  const handleSignIn = handleSubmit(async (data) => {
    setSubmitting(true);
    setErrorMsg(null);
    const { error } = await supabase.auth.signInWithPassword(data);
    if (error) setErrorMsg(error.message);
    setSubmitting(false);
  });

  const handleSignUp = handleSubmit(async (data) => {
    setSubmitting(true);
    setErrorMsg(null);
    const { error, data: signUpData } = await supabase.auth.signUp(data);
    if (error) {
      setErrorMsg(error.message);
    } else if (!signUpData.session) {
      Alert.alert('注册成功', '请检查邮箱完成确认后再登录。\n（如已在 Supabase 关闭邮箱确认，可直接登录）');
    }
    setSubmitting(false);
  });

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-white"
    >
      <View className="flex-1 justify-center px-6">
        <Text className="mb-2 text-3xl font-bold text-zinc-900">Exhitrack</Text>
        <Text className="mb-10 text-base text-zinc-500">观展档案 · 个人文博知识库</Text>

        <Text className="mb-1.5 text-sm font-medium text-zinc-700">邮箱</Text>
        <Controller
          control={control}
          name="email"
          render={({ field: { onChange, value, onBlur } }) => (
            <TextInput
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              className="rounded-lg border border-zinc-300 px-4 py-3 text-base text-zinc-900"
              placeholder="you@example.com"
              placeholderTextColor="#a1a1aa"
            />
          )}
        />
        {errors.email && (
          <Text className="mt-1 text-xs text-red-600">{errors.email.message}</Text>
        )}

        <Text className="mb-1.5 mt-4 text-sm font-medium text-zinc-700">密码</Text>
        <Controller
          control={control}
          name="password"
          render={({ field: { onChange, value, onBlur } }) => (
            <TextInput
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="password"
              className="rounded-lg border border-zinc-300 px-4 py-3 text-base text-zinc-900"
              placeholder="至少 6 位"
              placeholderTextColor="#a1a1aa"
            />
          )}
        />
        {errors.password && (
          <Text className="mt-1 text-xs text-red-600">{errors.password.message}</Text>
        )}

        {errorMsg && (
          <View className="mt-4 rounded-md bg-red-50 px-3 py-2">
            <Text className="text-sm text-red-700">{errorMsg}</Text>
          </View>
        )}

        <Pressable
          onPress={handleSignIn}
          disabled={submitting}
          className="mt-6 items-center rounded-lg bg-emerald-700 py-3.5 active:bg-emerald-800 disabled:opacity-50"
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-base font-medium text-white">登录</Text>
          )}
        </Pressable>

        <Pressable
          onPress={handleSignUp}
          disabled={submitting}
          className="mt-3 items-center rounded-lg border border-zinc-300 py-3.5 active:bg-zinc-50 disabled:opacity-50"
        >
          <Text className="text-base font-medium text-zinc-700">没有账号？注册</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
