import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

const KEY = 'active-exhibition-id';

let cached: string | null | undefined;
const listeners = new Set<(id: string | null) => void>();

async function load(): Promise<string | null> {
  if (cached !== undefined) return cached;
  const value = await AsyncStorage.getItem(KEY);
  cached = value;
  return value;
}

/**
 * Set the active exhibition id. Persists to AsyncStorage and notifies
 * all currently-mounted hooks (so e.g. setting from /exhibition/new
 * updates the capture screen on resume).
 */
export async function setActiveExhibitionId(id: string): Promise<void> {
  cached = id;
  await AsyncStorage.setItem(KEY, id);
  listeners.forEach((l) => l(id));
}

export function useActiveExhibitionId(): string | null {
  const [id, setId] = useState<string | null>(cached ?? null);

  useEffect(() => {
    load().then((v) => setId(v));
    const listener = (next: string | null) => setId(next);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return id;
}
