import { useEffect, useState } from "react";
import { useAppSelector } from "./redux";

export function useSupportsCloudFeature(feature: string) {
  const [supported, setSupported] = useState<boolean>(false);
  const selfHostedCloudUrl = useAppSelector(
    (state) => state.userPreferences.value?.selfHostedCloudUrl
  );

  useEffect(() => {
    let cancelled = false;

    // Default to true if not self hosted cloud (fallback behavior to Official Cloud features).
    // Actually, supportsCloudFeature handles this logic in main process.
    // For specific features we need to IPC invoke.
    if (feature === "hidden-games") {
      window.electron
        .getHiddenGamesSupported()
        .then((res) => {
          if (!cancelled) setSupported(res);
        })
        .catch(() => {
          if (!cancelled) setSupported(false);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [feature, selfHostedCloudUrl]);

  return supported;
}
