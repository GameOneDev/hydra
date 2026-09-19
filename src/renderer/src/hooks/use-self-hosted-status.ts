import { useCallback, useEffect, useState } from "react";

import type { SelfHostedServerStatus } from "@types";

const DISABLED_STATUS: SelfHostedServerStatus = {
  url: null,
  state: "disabled",
  latencyInMs: null,
  version: null,
  features: [],
  error: null,
  checkedAt: null,
};

/**
 * Live reachability of the self-hosted cloud storage server.
 *
 * The main process owns the probing — it is the one that talks to the server
 * and gates features on its capabilities — and pushes every result here, so
 * the status the UI shows never disagrees with the one the launcher acts on.
 */
export function useSelfHostedStatus() {
  const [status, setStatus] = useState<SelfHostedServerStatus>(DISABLED_STATUS);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    window.electron
      .getSelfHostedStatus()
      .then((value) => {
        if (!cancelled) setStatus(value);
      })
      .catch(() => {});

    const unsubscribe = window.electron.onSelfHostedStatusUpdated((value) => {
      if (!cancelled) setStatus(value);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);

    try {
      const value = await window.electron.refreshSelfHostedStatus();
      setStatus(value);
      return value;
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  return { status, refresh, isRefreshing };
}
