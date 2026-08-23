import { useEffect, useState } from "react";

/**
 * Whether the hidden games feature is available. The answer depends on the
 * session and on the self-hosted server's capabilities, both of which live in
 * the main process — keeping it there is what lets Big Picture, which has no
 * Redux store, use this hook too.
 */
export function useHiddenGamesEnabled() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const refresh = () =>
      window.electron
        .getHiddenGamesEnabled()
        .then((value) => {
          if (!cancelled) setEnabled(value);
        })
        .catch(() => {
          if (!cancelled) setEnabled(false);
        });

    refresh();

    const unsubscribers = [
      window.electron.onUserPreferencesUpdated(refresh),
      /* The preferences broadcast lands before the new server's capabilities
         are known, so the answer computed from it can still be the old one. */
      window.electron.onCloudServerChanged(refresh),
      /* A server can lose or regain the feature while it runs — the periodic
         probe publishes that, and without this the UI keeps offering an
         action the main process now rejects. */
      window.electron.onSelfHostedStatusUpdated(refresh),
      window.electron.onSignIn(refresh),
      window.electron.onSignOut(refresh),
    ];

    return () => {
      cancelled = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, []);

  return enabled;
}
