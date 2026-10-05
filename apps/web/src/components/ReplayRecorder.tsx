import { useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import { startReplay } from '@/lib/replay';

/** Records the tab with rrweb for the owner's support tooling (docs/admin/DESIGN.md). Renders nothing; waits for idle so it never delays first paint. */
export function ReplayRecorder() {
  const router = useRouter();
  useEffect(() => {
    const go = () => startReplay(router);
    if ('requestIdleCallback' in window) {
      const id = requestIdleCallback(go);
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(go, 2000);
    return () => clearTimeout(id);
  }, [router]);
  return null;
}
