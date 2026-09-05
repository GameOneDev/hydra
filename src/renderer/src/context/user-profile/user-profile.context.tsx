import {
  darkenColor,
  ensureArray,
  getShopsForProfilePlatform,
  readStoredProfilePlatform,
  readStoredProfileSort,
  readStoredSouvenirSort,
} from "@renderer/helpers";
import { logger } from "@renderer/logger";
import { useAppSelector, useToast } from "@renderer/hooks";
import type {
  Badge,
  ProfileSouvenir,
  SouvenirsHiddenReason,
  SouvenirSort,
  SteamAchievement,
  UserProfile,
  UserStats,
  UserGame,
} from "@types";
import {
  enrichSouvenirAchievements,
  getSouvenirKey,
  normalizeProfileSouvenir,
} from "@shared";
import { average } from "color.js";

import { createContext, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  applySelfHostedArtwork,
  fetchSelfHostedArtwork,
  type SelfHostedArtworkMap,
} from "@renderer/services/self-hosted-artwork.service";

export interface UserProfileContext {
  userProfile: UserProfile | null;
  heroBackground: string;
  /* Indicates if the current user is viewing their own profile */
  isMe: boolean;
  userStats: UserStats | null;
  getUserProfile: () => Promise<void>;
  getUserStats: (shops?: string[]) => Promise<void>;
  getUserLibraryGames: (
    sortBy?: string,
    reset?: boolean,
    shops?: string[]
  ) => Promise<void>;
  loadMoreLibraryGames: (sortBy?: string, shops?: string[]) => Promise<boolean>;
  setSelectedBackgroundImage: React.Dispatch<React.SetStateAction<string>>;
  backgroundImage: string;
  badges: Badge[];
  libraryGames: UserGame[];
  pinnedGames: UserGame[];
  hasMoreLibraryGames: boolean;
  isLoadingLibraryGames: boolean;
  souvenirs: ProfileSouvenir[];
  souvenirsTotal: number;
  hasReachedSouvenirLimit: boolean;
  souvenirsHiddenReason: SouvenirsHiddenReason;
  hasMoreSouvenirs: boolean;
  isLoadingSouvenirs: boolean;
  getUserSouvenirs: (sortBy?: SouvenirSort) => Promise<boolean>;
  loadMoreSouvenirs: (sortBy?: SouvenirSort) => Promise<boolean>;
  updateSouvenir: (
    souvenirId: string,
    update: Partial<ProfileSouvenir>
  ) => void;
  removeSouvenir: (souvenirId: string) => Promise<void>;
  loadedLibrarySortBy: string | null;
}

export const DEFAULT_USER_PROFILE_BACKGROUND = "#151515B3";

export const userProfileContext = createContext<UserProfileContext>({
  userProfile: null,
  heroBackground: DEFAULT_USER_PROFILE_BACKGROUND,
  isMe: false,
  userStats: null,
  getUserProfile: async () => {},
  getUserStats: async (_shops?: string[]) => {},
  getUserLibraryGames: async (
    _sortBy?: string,
    _reset?: boolean,
    _shops?: string[]
  ) => {},
  loadMoreLibraryGames: async (_sortBy?: string, _shops?: string[]) => false,
  setSelectedBackgroundImage: () => {},
  backgroundImage: "",
  badges: [],
  libraryGames: [],
  pinnedGames: [],
  hasMoreLibraryGames: false,
  isLoadingLibraryGames: false,
  souvenirs: [],
  souvenirsTotal: 0,
  hasReachedSouvenirLimit: false,
  souvenirsHiddenReason: null,
  hasMoreSouvenirs: false,
  isLoadingSouvenirs: false,
  getUserSouvenirs: async () => false,
  loadMoreSouvenirs: async () => false,
  updateSouvenir: () => {},
  removeSouvenir: async () => {},
  loadedLibrarySortBy: null,
});

const { Provider } = userProfileContext;
export const { Consumer: UserProfileContextConsumer } = userProfileContext;

export interface UserProfileContextProviderProps {
  children: React.ReactNode;
  userId: string;
}

export function UserProfileContextProvider({
  children,
  userId,
}: Readonly<UserProfileContextProviderProps>) {
  const { userDetails } = useAppSelector((state) => state.userDetails);
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const selfHostedCloudUrl = userPreferences?.selfHostedCloudUrl;
  const authUserId = userDetails?.id;

  const [userStats, setUserStats] = useState<UserStats | null>(null);

  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [libraryGames, setLibraryGames] = useState<UserGame[]>([]);
  const [pinnedGames, setPinnedGames] = useState<UserGame[]>([]);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [heroBackground, setHeroBackground] = useState(
    DEFAULT_USER_PROFILE_BACKGROUND
  );
  const [selectedBackgroundImage, setSelectedBackgroundImage] = useState("");
  const [libraryPage, setLibraryPage] = useState(0);
  const [hasMoreLibraryGames, setHasMoreLibraryGames] = useState(true);
  const [isLoadingLibraryGames, setIsLoadingLibraryGames] = useState(false);
  const [souvenirs, setSouvenirs] = useState<ProfileSouvenir[]>([]);
  const [souvenirsTotal, setSouvenirsTotal] = useState(0);
  const [hasReachedSouvenirLimit, setHasReachedSouvenirLimit] = useState(false);
  const [souvenirsHiddenReason, setSouvenirsHiddenReason] =
    useState<SouvenirsHiddenReason>(null);
  const [isLoadingSouvenirs, setIsLoadingSouvenirs] = useState(false);
  const souvenirRequestIdRef = useRef(0);
  const [loadedLibrarySortBy, setLoadedLibrarySortBy] = useState<string | null>(
    null
  );
  const previousUserIdRef = useRef(userId);
  const userStatsRequestIdRef = useRef(0);

  /* Custom game images this profile's owner keeps on the self-hosted server.
     Fetched once per profile and shared by every library request below, so
     paging through a library doesn't re-request the whole set. */
  const artworkRef = useRef<{
    userId: string;
    promise: Promise<SelfHostedArtworkMap | null>;
  } | null>(null);

  const getSelfHostedArtwork = useCallback(() => {
    if (artworkRef.current?.userId !== userId) {
      artworkRef.current = {
        userId,
        promise: fetchSelfHostedArtwork(userId, selfHostedCloudUrl),
      };
    }

    return artworkRef.current.promise;
  }, [userId, selfHostedCloudUrl]);

  const isMe = userDetails?.id === userProfile?.id;

  const getHeroBackgroundFromImageUrl = async (imageUrl: string) => {
    const output = await average(imageUrl, { amount: 1, format: "hex" });

    return `linear-gradient(135deg, ${darkenColor(output as string, 0.5)}, ${darkenColor(output as string, 0.6, 0.5)})`;
  };

  const getBackgroundImageUrl = () => {
    if (selectedBackgroundImage && isMe)
      return `local:${selectedBackgroundImage}`;
    if (userProfile?.backgroundImageUrl) return userProfile.backgroundImageUrl;

    return "";
  };

  const { t, i18n } = useTranslation("user_profile");

  const { showErrorToast } = useToast();
  const navigate = useNavigate();

  const getUserStats = useCallback(
    async (shops = ["steam", "launchbox"]) => {
      const params = new URLSearchParams();
      shops.forEach((shop) => params.append("shop", shop));

      const requestId = ++userStatsRequestIdRef.current;

      window.electron.hydraApi
        .get<UserStats>(`/users/${userId}/stats?${params.toString()}`, {
          needsAuth: false,
        })
        .then(async (stats) => {
          if (requestId !== userStatsRequestIdRef.current) return;

          let merged = stats;

          /* The official API only computes achievement totals for
             subscribers; the self-hosted server knows them from achievement
             sync, so fill the gap from there. */
          if (
            merged.unlockedAchievementSum === undefined &&
            selfHostedCloudUrl
          ) {
            try {
              const fallback = await window.electron.hydraApi.get<{
                unlockedAchievementSum: number | null;
              }>(`/profile/stats/${userId}`);

              if (typeof fallback?.unlockedAchievementSum === "number") {
                merged = {
                  ...merged,
                  unlockedAchievementSum: fallback.unlockedAchievementSum,
                };
              }
            } catch {
              /* No achievement data on the self-hosted server either */
            }
          }

          /* the fallback is awaited, so a newer request may have started */
          if (requestId !== userStatsRequestIdRef.current) return;

          setUserStats(merged);
        });
    },
    [userId, selfHostedCloudUrl]
  );

  const getUserLibraryGames = useCallback(
    async (sortBy?: string, reset = true, shops = ["steam", "launchbox"]) => {
      if (reset) {
        setLibraryPage(0);
        setHasMoreLibraryGames(true);
        setIsLoadingLibraryGames(true);
      }

      try {
        const params = new URLSearchParams();
        params.append("take", "12");
        params.append("skip", "0");
        shops.forEach((shop) => params.append("shop", shop));
        if (sortBy) {
          params.append("sortBy", sortBy);
        }

        const url = `/users/${userId}/library?${params.toString()}`;

        const [response, artwork] = await Promise.all([
          window.electron.hydraApi.get<{
            library: UserGame[];
            pinnedGames: UserGame[];
          }>(url, { needsAuth: false }),
          getSelfHostedArtwork(),
        ]);

        if (reset) {
          setLoadedLibrarySortBy(sortBy ?? null);
        }

        if (response) {
          setLibraryGames(applySelfHostedArtwork(response.library, artwork));
          setPinnedGames(applySelfHostedArtwork(response.pinnedGames, artwork));
          setHasMoreLibraryGames(response.library.length === 12);
        } else {
          setLibraryGames([]);
          setPinnedGames([]);
          setHasMoreLibraryGames(false);
        }
      } catch (error) {
        setLibraryGames([]);
        setPinnedGames([]);
        setHasMoreLibraryGames(false);
      } finally {
        setIsLoadingLibraryGames(false);
      }
    },
    [userId, getSelfHostedArtwork]
  );

  const loadMoreLibraryGames = useCallback(
    async (
      sortBy?: string,
      shops = ["steam", "launchbox"]
    ): Promise<boolean> => {
      if (isLoadingLibraryGames || !hasMoreLibraryGames) {
        return false;
      }

      setIsLoadingLibraryGames(true);
      try {
        const nextPage = libraryPage + 1;
        const params = new URLSearchParams();
        params.append("take", "12");
        params.append("skip", String(nextPage * 12));
        shops.forEach((shop) => params.append("shop", shop));
        if (sortBy) {
          params.append("sortBy", sortBy);
        }

        const url = `/users/${userId}/library?${params.toString()}`;

        const [response, artwork] = await Promise.all([
          window.electron.hydraApi.get<{
            library: UserGame[];
            pinnedGames: UserGame[];
          }>(url, { needsAuth: false }),
          getSelfHostedArtwork(),
        ]);

        if (response && response.library.length > 0) {
          setLibraryGames((prev) => {
            const existingIds = new Set(prev.map((game) => game.objectId));
            const newGames = applySelfHostedArtwork(
              response.library.filter(
                (game) => !existingIds.has(game.objectId)
              ),
              artwork
            );
            return [...prev, ...newGames];
          });
          setLibraryPage(nextPage);
          setHasMoreLibraryGames(response.library.length === 12);
          return true;
        } else {
          setHasMoreLibraryGames(false);
          return false;
        }
      } catch (error) {
        setHasMoreLibraryGames(false);
        return false;
      } finally {
        setIsLoadingLibraryGames(false);
      }
    },
    [
      userId,
      libraryPage,
      hasMoreLibraryGames,
      isLoadingLibraryGames,
      getSelfHostedArtwork,
    ]
  );

  const fetchSouvenirsPage = useCallback(
    async (sortBy: SouvenirSort, skip: number) => {
      const language = i18n.language.split("-")[0];

      /* Reads from whichever server this profile's owner captured on — the
         self-hosted one, or official Hydra for everyone else. */
      const response = await window.electron.getProfileSouvenirs({
        userId,
        skip,
        sortBy,
        language,
      });

      if (!response) return null;

      /* A self-hosted cloud server only knows the achievement names the
         launcher sent it, so the catalogue fills in display names, icons and
         points. A no-op for official Hydra Cloud, which sends them. */
      const items = await enrichSouvenirAchievements(
        (response.items ?? []).map((item) => normalizeProfileSouvenir(item)),
        (shop, objectId) =>
          window.electron.hydraApi.get<SteamAchievement[]>(
            `/games/${shop}/${objectId}/achievements`,
            { params: { language }, needsAuth: false }
          )
      );

      return { ...response, items };
    },
    [i18n.language, userId]
  );

  const getUserSouvenirs = useCallback(
    async (sortBy: SouvenirSort = "recent") => {
      const requestId = ++souvenirRequestIdRef.current;
      setIsLoadingSouvenirs(true);

      try {
        const response = await fetchSouvenirsPage(sortBy, 0);
        if (requestId !== souvenirRequestIdRef.current) return false;

        setSouvenirs(response?.items ?? []);
        setSouvenirsTotal(response?.total ?? 0);
        setHasReachedSouvenirLimit(response?.hasReachedLimit ?? false);
        setSouvenirsHiddenReason(response?.hiddenReason ?? null);
        return true;
      } catch {
        if (requestId !== souvenirRequestIdRef.current) return false;

        setSouvenirs([]);
        setSouvenirsTotal(0);
        setHasReachedSouvenirLimit(false);
        setSouvenirsHiddenReason(null);
        return false;
      } finally {
        if (requestId === souvenirRequestIdRef.current) {
          setIsLoadingSouvenirs(false);
        }
      }
    },
    [fetchSouvenirsPage]
  );

  const loadMoreSouvenirs = useCallback(
    async (sortBy: SouvenirSort = "recent") => {
      if (isLoadingSouvenirs || souvenirs.length >= souvenirsTotal) {
        return false;
      }

      const requestId = souvenirRequestIdRef.current;
      setIsLoadingSouvenirs(true);

      try {
        const response = await fetchSouvenirsPage(sortBy, souvenirs.length);
        if (requestId !== souvenirRequestIdRef.current || !response) {
          return false;
        }

        setSouvenirs((current) => {
          const existingKeys = new Set(
            current.map((souvenir) => getSouvenirKey(souvenir.id))
          );
          const nextItems = response.items.filter(
            (souvenir) => !existingKeys.has(getSouvenirKey(souvenir.id))
          );

          return [...current, ...nextItems];
        });
        setSouvenirsTotal(response.total);
        setHasReachedSouvenirLimit(response.hasReachedLimit);
        setSouvenirsHiddenReason(response.hiddenReason);
        return true;
      } catch {
        return false;
      } finally {
        if (requestId === souvenirRequestIdRef.current) {
          setIsLoadingSouvenirs(false);
        }
      }
    },
    [fetchSouvenirsPage, isLoadingSouvenirs, souvenirs, souvenirsTotal]
  );

  const updateSouvenir = useCallback(
    (souvenirId: string, update: Partial<ProfileSouvenir>) => {
      const key = getSouvenirKey(souvenirId);

      setSouvenirs((current) =>
        current.map((souvenir) =>
          getSouvenirKey(souvenir.id) === key
            ? { ...souvenir, ...update }
            : souvenir
        )
      );
    },
    []
  );

  const removeSouvenir = useCallback(
    async (souvenirId: string) => {
      const key = getSouvenirKey(souvenirId);
      const requestId = souvenirRequestIdRef.current;

      setSouvenirs((current) =>
        current.filter((souvenir) => getSouvenirKey(souvenir.id) !== key)
      );
      setSouvenirsTotal((current) => Math.max(0, current - 1));

      try {
        const response = await fetchSouvenirsPage("recent", 0);
        if (requestId !== souvenirRequestIdRef.current || !response) return;

        setHasReachedSouvenirLimit(response.hasReachedLimit);
      } catch {
        // Keep the last server-provided value until the next successful refresh.
      }
    },
    [fetchSouvenirsPage]
  );

  const getUserProfile = useCallback(async () => {
    const storedShops = getShopsForProfilePlatform(readStoredProfilePlatform());

    getUserStats(storedShops);

    getUserLibraryGames(readStoredProfileSort(), true, storedShops);
    void getUserSouvenirs(readStoredSouvenirSort());

    const profileParams = new URLSearchParams();
    profileParams.append("shop", "steam");
    profileParams.append("shop", "launchbox");

    return window.electron.hydraApi
      .get<UserProfile>(`/users/${userId}?${profileParams.toString()}`, {
        needsAuth: false,
      })
      .then(async (userProfile) => {
        let profile = userProfile;

        /* The official API only stores banners for subscribers; users of a
           self-hosted cloud server keep theirs there, so fall back to it
           when the official profile has none. */
        if (!profile.backgroundImageUrl && selfHostedCloudUrl) {
          try {
            const fallback = await window.electron.hydraApi.get<{
              backgroundImageUrl: string | null;
            }>(`/profile/banners/${userId}`);

            if (fallback?.backgroundImageUrl) {
              profile = {
                ...profile,
                backgroundImageUrl: fallback.backgroundImageUrl,
              };
            }
          } catch {
            /* No banner on the self-hosted server either */
          }
        }

        /* The profile response embeds its own game lists, which need the
           same custom images as the paged library above. */
        const artwork = await getSelfHostedArtwork();
        if (artwork?.size) {
          profile = {
            ...profile,
            libraryGames: applySelfHostedArtwork(profile.libraryGames, artwork),
            recentGames: applySelfHostedArtwork(profile.recentGames, artwork),
          };
        }

        setUserProfile(profile);

        if (profile.profileImageUrl) {
          getHeroBackgroundFromImageUrl(profile.profileImageUrl).then((color) =>
            setHeroBackground(color)
          );
        }
      })
      .catch((error) => {
        /* This catch covers the whole chain above, not just the request, so
           a bug in the handling reads to the user as a missing profile.
           Record what actually failed. */
        logger.error("Failed to load profile", userId, error);
        showErrorToast(t("user_not_found"));
        navigate(-1);
      });
  }, [
    navigate,
    getUserStats,
    getUserLibraryGames,
    getUserSouvenirs,
    showErrorToast,
    userId,
    selfHostedCloudUrl,
    getSelfHostedArtwork,
    t,
  ]);

  const getBadges = useCallback(async () => {
    const language = i18n.language.split("-")[0];
    const params = new URLSearchParams({ locale: language });

    const badges = await window.electron.hydraApi.get<Badge[]>(
      `/badges?${params.toString()}`,
      { needsAuth: false }
    );
    setBadges(ensureArray<Badge>(badges, "/badges"));
  }, [i18n]);

  useEffect(() => {
    if (previousUserIdRef.current !== userId) {
      previousUserIdRef.current = userId;
      setUserProfile(null);
      setLibraryGames([]);
      setPinnedGames([]);
      setHeroBackground(DEFAULT_USER_PROFILE_BACKGROUND);
      setLibraryPage(0);
      setHasMoreLibraryGames(true);
      setSouvenirs([]);
      setSouvenirsTotal(0);
      setHasReachedSouvenirLimit(false);
      setSouvenirsHiddenReason(null);
    }

    getUserProfile();
    getBadges();
  }, [getUserProfile, getBadges, authUserId, userId]);

  return (
    <Provider
      value={{
        userProfile,
        heroBackground,
        isMe,
        getUserProfile,
        getUserStats,
        getUserLibraryGames,
        loadMoreLibraryGames,
        setSelectedBackgroundImage,
        backgroundImage: getBackgroundImageUrl(),
        userStats,
        badges,
        libraryGames,
        pinnedGames,
        hasMoreLibraryGames,
        isLoadingLibraryGames,
        souvenirs,
        souvenirsTotal,
        hasReachedSouvenirLimit,
        souvenirsHiddenReason,
        hasMoreSouvenirs: souvenirs.length < souvenirsTotal,
        isLoadingSouvenirs,
        getUserSouvenirs,
        loadMoreSouvenirs,
        updateSouvenir,
        removeSouvenir,
        loadedLibrarySortBy,
      }}
    >
      {children}
    </Provider>
  );
}
