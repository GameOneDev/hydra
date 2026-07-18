import type { GameShop } from "@types";
import { useEffect, useState } from "react";
import {
  fetchSelfHostedArtwork,
  type SelfHostedArtworkMap,
} from "@renderer/services/self-hosted-artwork.service";

/**
 * Fallbacks for profile data the official API only serves to Hydra Cloud
 * subscribers. When a self-hosted cloud server is configured it holds this
 * data for everyone on it, so these lookups fill the gaps the official
 * response left. Each resolves to `null` when there is no server, the user
 * isn't on it, or the request fails — callers then keep whatever the
 * official API gave them.
 */

type PreferencesBridge = {
  getUserPreferences?: () => Promise<{
    selfHostedCloudUrl?: string | null;
  } | null>;
};

const getSelfHostedCloudUrl = async (): Promise<string | null> => {
  const electron = globalThis.window.electron as PreferencesBridge;
  if (typeof electron.getUserPreferences !== "function") return null;

  try {
    const preferences = await electron.getUserPreferences();
    return preferences?.selfHostedCloudUrl ?? null;
  } catch {
    return null;
  }
};

/* One page load fetches its library several times over (paged library,
   achievement leaders, the profile's own embedded lists). Memoising per user
   collapses those into a single artwork request. The window is short so that
   re-opening a profile after changing an image shows the new one — this
   cache outlives the page, unlike the desktop profile's. */
const ARTWORK_CACHE_TTL_IN_MS = 30_000;

let cachedArtwork: {
  userId: string;
  fetchedAt: number;
  promise: Promise<SelfHostedArtworkMap | null>;
} | null = null;

export const getProfileArtwork = (
  userId: string
): Promise<SelfHostedArtworkMap | null> => {
  const isFresh =
    cachedArtwork?.userId === userId &&
    Date.now() - cachedArtwork.fetchedAt < ARTWORK_CACHE_TTL_IN_MS;

  if (isFresh && cachedArtwork) return cachedArtwork.promise;

  cachedArtwork = {
    userId,
    fetchedAt: Date.now(),
    promise: getSelfHostedCloudUrl().then((selfHostedCloudUrl) =>
      fetchSelfHostedArtwork(userId, selfHostedCloudUrl)
    ),
  };

  return cachedArtwork.promise;
};

/**
 * Whether this profile has custom images on the self-hosted server.
 *
 * Big Picture only renders custom artwork for profiles it believes are Hydra
 * Cloud subscribers, which self-hosted members are not. Finding artwork for
 * them here is what earns the same treatment.
 */
export function useHasSelfHostedArtwork(userId: string | undefined): boolean {
  const [hasArtwork, setHasArtwork] = useState(false);

  useEffect(() => {
    if (!userId) {
      setHasArtwork(false);
      return;
    }

    let isMounted = true;
    setHasArtwork(false);

    void getProfileArtwork(userId).then((artwork) => {
      if (isMounted) setHasArtwork(Boolean(artwork?.size));
    });

    return () => {
      isMounted = false;
    };
  }, [userId]);

  return hasArtwork;
}

/** Profile banner, which the official API only stores for subscribers. */
export const fetchSelfHostedBanner = async (
  userId: string
): Promise<string | null> => {
  if (!(await getSelfHostedCloudUrl())) return null;

  try {
    const response = await globalThis.window.electron.hydraApi.get<{
      backgroundImageUrl: string | null;
    }>(`/profile/banners/${userId}`);

    return response?.backgroundImageUrl ?? null;
  } catch {
    return null;
  }
};

export type SelfHostedUnlockedAchievement = {
  name: string;
  /* Same field the launcher uses for its own achievements, so the value
     needs no conversion before it reaches the shared rendering path. */
  unlockTime: number;
};

export type SelfHostedAchievementGame = {
  shop: GameShop;
  objectId: string;
  achievements: SelfHostedUnlockedAchievement[];
};

/**
 * Recently unlocked achievements, which the official API only compares for
 * subscribers. The server stores names and unlock times only — the caller
 * joins the catalogue for icons and titles.
 */
export const fetchSelfHostedRecentAchievements = async (
  userId: string
): Promise<SelfHostedAchievementGame[]> => {
  if (!(await getSelfHostedCloudUrl())) return [];

  try {
    const response = await globalThis.window.electron.hydraApi.get<{
      games: SelfHostedAchievementGame[];
    }>(`/profile/achievements/${userId}`);

    return Array.isArray(response?.games) ? response.games : [];
  } catch {
    return [];
  }
};

/** Achievement total, which the official API only computes for subscribers. */
export const fetchSelfHostedAchievementSum = async (
  userId: string
): Promise<number | null> => {
  if (!(await getSelfHostedCloudUrl())) return null;

  try {
    const response = await globalThis.window.electron.hydraApi.get<{
      unlockedAchievementSum: number | null;
    }>(`/profile/stats/${userId}`);

    return typeof response?.unlockedAchievementSum === "number"
      ? response.unlockedAchievementSum
      : null;
  } catch {
    return null;
  }
};
