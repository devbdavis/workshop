import { useCallback, useEffect, useState } from 'react';
import type { SessionProvider } from '@foundation/types';

export interface CliInfo {
  id: string;
  label: string;
  kind: 'agent' | 'tool';
  provider?: SessionProvider;
  installed: boolean;
  enabled: boolean;
}

export interface ClisResponse {
  clis: CliInfo[];
  available: SessionProvider[];
}

/**
 * Fetches the CLI registry + availability from `/api/settings/clis`. Refetches
 * on mount and on window focus (so toggling availability in another tab is
 * reflected). Shared by AvailableClisSettings, DefaultAiCliSettings, and the
 * New Session provider dropdown so the three never disagree.
 */
export function useAvailableClis() {
  const [data, setData] = useState<ClisResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/clis');
      if (res.ok) {
        setData((await res.json()) as ClisResponse);
      }
    } catch {
      /* keep previous */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  return {
    clis: data?.clis ?? [],
    available: data?.available ?? [],
    loading,
    refresh,
    setData,
  };
}
