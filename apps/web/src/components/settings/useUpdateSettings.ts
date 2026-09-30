import { useMutation } from '@tanstack/react-query';
import type { SettingsPatch } from '@server/settings';
import { toast } from '@/components/ui';
import { api, type Me, type Settings } from '@/lib/api';
import { meQuery, queryClient } from '@/lib/query';

const patchMe = (fn: (s: Settings) => Settings) => queryClient.setQueryData<Me>(meQuery.queryKey, (me) => me && { ...me, settings: fn(me.settings) });

/** Optimistic settings update: the `me` cache changes immediately, rolls back with a toast on failure. */
export function useUpdateSettings() {
  return useMutation({
    mutationFn: (patch: SettingsPatch) => api.put<Settings>('/settings', patch),
    onMutate: (patch) => {
      const prev = queryClient.getQueryData<Me>(meQuery.queryKey)?.settings;
      patchMe((s) => ({ ...s, ...patch, models: { ...s.models, ...patch.models } }));
      return { prev };
    },
    onError: (e, _patch, ctx) => {
      if (ctx?.prev) patchMe(() => ctx.prev!);
      toast(`Couldn't save: ${e.message}`, { tone: 'bad' });
    },
    onSuccess: (settings) => patchMe(() => settings),
  });
}
