import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { toError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export type Exhibition = {
  id: string;
  user_id: string;
  name: string;
  museum: string | null;
  visit_date: string | null;
  created_at: string;
  updated_at: string;
};

export type ExhibitionInput = {
  name: string;
  museum?: string | null;
  visit_date?: string | null;
};

export const exhibitionsKey = ['exhibitions'] as const;
export const exhibitionDetailKey = (id: string) => ['exhibitions', id] as const;

export function useExhibitions() {
  return useQuery({
    queryKey: exhibitionsKey,
    queryFn: async (): Promise<Exhibition[]> => {
      const { data, error } = await supabase
        .from('exhibitions')
        .select('*')
        .order('visit_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });
      if (error) throw toError(error);
      return data ?? [];
    },
  });
}

export function useExhibition(id: string | undefined) {
  return useQuery({
    queryKey: id ? exhibitionDetailKey(id) : ['exhibitions', '__none__'],
    queryFn: async (): Promise<Exhibition> => {
      const { data, error } = await supabase
        .from('exhibitions')
        .select('*')
        .eq('id', id!)
        .single();
      if (error) throw toError(error);
      return data;
    },
    enabled: !!id,
  });
}

export function useCreateExhibition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ExhibitionInput): Promise<Exhibition> => {
      const payload = {
        name: input.name,
        museum: input.museum?.trim() || null,
        visit_date: input.visit_date || null,
      };
      const { data, error } = await supabase
        .from('exhibitions')
        .insert(payload)
        .select()
        .single();
      if (error) throw toError(error);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: exhibitionsKey });
    },
  });
}

export function useDeleteExhibition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('exhibitions').delete().eq('id', id);
      if (error) throw toError(error);
    },
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: exhibitionsKey });
      qc.removeQueries({ queryKey: exhibitionDetailKey(id) });
    },
  });
}
