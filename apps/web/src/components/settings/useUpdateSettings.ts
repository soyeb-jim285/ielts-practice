import { useMutation } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { SettingsPatch } from '@server/settings';
import { toast } from '@/components/ui';
import { call, client, type Me, type Settings } from '@/lib/api';
import { meQuery, queryClient, useAccount } from '@/lib/query';

const patchMe = (fn: (s: Settings) => Settings) => queryClient.setQueryData<Me>(meQuery.queryKey, (me) => me && { ...me, settings: fn(me.settings) });

/** Optimistic settings update: the `me` cache changes immediately, rolls back with a toast on failure. */
export function useUpdateSettings() {
  return useMutation({
    mutationFn: (patch: SettingsPatch) => call(client.PUT('/api/settings', { body: patch })),
    onMutate: (patch) => {
      const prev = queryClient.getQueryData<Me>(meQuery.queryKey)?.settings;
      patchMe((s) => ({ ...s, ...patch }));
      return { prev };
    },
    onError: (e, _patch, ctx) => {
      if (ctx?.prev) patchMe(() => ctx.prev!);
      toast(`Couldn't save: ${e.message}`, { tone: 'bad' });
    },
    onSuccess: (settings) => patchMe(() => settings),
  });
}

/** Keeps settings.timeZone on the browser's zone (the coach's local day and the Monday email use it). Silent: a failure retries next visit. */
export function useSyncTimeZone() {
  const stored = useAccount()?.settings.timeZone;
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!stored || !tz || stored === tz) return;
    call(client.PUT('/api/settings', { body: { timeZone: tz } })).then((s) => patchMe(() => s), () => {});
  }, [stored]);
}
