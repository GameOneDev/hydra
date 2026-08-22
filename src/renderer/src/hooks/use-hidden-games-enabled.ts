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
