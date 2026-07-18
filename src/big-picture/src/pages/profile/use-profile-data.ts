import type {
  Badge,
  ComparedAchievements,
  SteamAchievement,
  UserAchievement,
  UserFriend,
  UserFriends,
  UserGame,
  UserLibraryResponse,
  UserProfile,
  UserStats,
} from "@types";
import { useCallback, useEffect, useState } from "react";
import { applySelfHostedArtwork } from "@renderer/services/self-hosted-artwork.service";
import { getGameIdentityKey } from "../../helpers";
import {
  fetchSelfHostedAchievementSum,
  fetchSelfHostedBanner,
  fetchSelfHostedRecentAchievements,
  getProfileArtwork,
} from "./self-hosted-profile";

const PROFILE_RECENT_ACHIEVEMENT_GROUP_LIMIT = 2;
const PROFILE_RECENT_ACHIEVEMENTS_PER_GAME = 2;
const PROFILE_RECENT_ACHIEVEMENT_LIBRARY_TAKE = 12;
const PROFILE_FRIENDS_LIMIT = 5;
const PROFILE_REMOTE_LIBRARY_PAGE_SIZE = 12;
const PROFILE_FAVORITE_GAME_LIMIT = 1;
const PROFILE_RECENT_ACTIVITY_GAMES_LIMIT = 3;

type ProfileComparedAchievement = ComparedAchievements["achievements"][number];

type ProfileRecentAchievement = {
  key: string;
  icon: string;
  displayName: string;
  description: string;
  unlockTime: number;
};

export type ProfileRecentAchievementGroup = {
  game: UserGame;
  newCount: number;
  achievements: ProfileRecentAchievement[];
};

type AchievementGame = {
  game: UserGame;
  achievements: ProfileRecentAchievement[];
};

type CancellationSignal = {
  cancelled: boolean;
};

function ensureArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function normalizeUserProfile(profile: UserProfile): UserProfile {
  return {
    ...profile,
    badges: ensureArray(profile.badges),
    friends: ensureArray(profile.friends),
    libraryGames: ensureArray(profile.libraryGames),
    recentGames: ensureArray(profile.recentGames),
  };
}

/**
 * Normalizes the profile, then fills in what the official API withholds from
 * non-subscribers: the custom images on its embedded game lists and the
 * profile banner. Both fall back to the official values when the
 * self-hosted server has nothing, so real Hydra Cloud members are unaffected.
 */
async function resolveUserProfile(
  profileId: string,
  profile: UserProfile
): Promise<UserProfile> {
  const normalized = normalizeUserProfile(profile);

  const [artwork, banner] = await Promise.all([
    getProfileArtwork(profileId),
    normalized.backgroundImageUrl
      ? Promise.resolve(null)
      : fetchSelfHostedBanner(profileId),
  ]);

  return {
    ...normalized,
    backgroundImageUrl: normalized.backgroundImageUrl ?? banner,
    libraryGames: applySelfHostedArtwork(normalized.libraryGames, artwork),
    recentGames: applySelfHostedArtwork(normalized.recentGames, artwork),
  };
}

function getComparedAchievement(
  achievement: ProfileComparedAchievement
): ProfileRecentAchievement | null {
  if (
    !achievement.targetStat.unlocked ||
    typeof achievement.targetStat.unlockTime !== "number"
  ) {
    return null;
  }

  return {
    key: `${achievement.displayName}-${achievement.targetStat.unlockTime}`,
    icon: achievement.icon,
    displayName: achievement.displayName,
    description: achievement.description,
    unlockTime: achievement.targetStat.unlockTime,
  };
}

function getOwnUnlockedAchievement(
  achievement: UserAchievement
): ProfileRecentAchievement | null {
  if (!achievement.unlocked || typeof achievement.unlockTime !== "number") {
    return null;
  }

  return {
    key: `${achievement.displayName}-${achievement.unlockTime}`,
    icon: achievement.icon,
    displayName: achievement.displayName,
    description: achievement.description ?? "",
    unlockTime: achievement.unlockTime,
  };
}

function getRecentAchievementGameKey(game: UserGame) {
  return getGameIdentityKey(game);
}

function getAchievementTimeline(achievementsByGame: AchievementGame[]) {
  return achievementsByGame
    .flatMap(({ game, achievements }) => {
      const gameKey = getRecentAchievementGameKey(game);

      return achievements.map((achievement) => ({
        gameKey,
        achievement,
      }));
    })
    .sort((a, b) => b.achievement.unlockTime - a.achievement.unlockTime);
}

function getAchievementBlocks(achievementsByGame: AchievementGame[]) {
  return getAchievementTimeline(achievementsByGame).reduce<
    Array<{
      gameKey: string;
      achievements: ProfileRecentAchievement[];
    }>
  >((blocks, item) => {
    const currentBlock = blocks.at(-1);

    if (currentBlock?.gameKey === item.gameKey) {
      currentBlock.achievements.push(item.achievement);
    } else {
      blocks.push({
        gameKey: item.gameKey,
        achievements: [item.achievement],
      });
    }

    return blocks;
  }, []);
}

function buildRecentAchievementGroups(
  achievementsByGame: AchievementGame[]
): ProfileRecentAchievementGroup[] {
  const games = new Map(
    achievementsByGame.map(({ game }) => [
      getRecentAchievementGameKey(game),
      game,
    ])
  );
  const selectedGameKeys = new Set<string>();

  return getAchievementBlocks(achievementsByGame)
    .map(({ gameKey, achievements }) => {
      const game = games.get(gameKey);
      if (!game || selectedGameKeys.has(gameKey)) return null;

      selectedGameKeys.add(gameKey);

      return {
        game,
        newCount: achievements.length,
        achievements: achievements.slice(
          0,
          PROFILE_RECENT_ACHIEVEMENTS_PER_GAME
        ),
      };
    })
    .filter((group): group is ProfileRecentAchievementGroup => group !== null)
    .slice(0, PROFILE_RECENT_ACHIEVEMENT_GROUP_LIMIT);
}

/* Every library request on the profile page goes through here, so the
   self-hosted custom images are overlaid once, centrally. */
async function getUserLibrary(
  targetUserId: string,
  query: string
): Promise<UserLibraryResponse> {
  const [response, artwork] = await Promise.all([
    globalThis.window.electron.hydraApi.get<UserLibraryResponse>(
      `/users/${targetUserId}/library?${query}`
    ),
    getProfileArtwork(targetUserId),
  ]);

  if (!artwork?.size) return response;

  return {
    ...response,
    library: applySelfHostedArtwork(ensureArray(response.library), artwork),
    pinnedGames: applySelfHostedArtwork(
      ensureArray(response.pinnedGames),
      artwork
    ),
  };
}

async function fetchRemoteLibraryGames(
  targetUserId: string,
  signal: CancellationSignal,
  knownLibraryCount?: number
) {
  if (typeof knownLibraryCount === "number" && knownLibraryCount <= 0) {
    return { games: [], totalCount: 0 };
  }

  if (knownLibraryCount) {
    const response = await getUserLibrary(
      targetUserId,
      `take=${knownLibraryCount}&skip=0`
    );
    const games = ensureArray(response.library);

    return {
      games,
      totalCount: response.totalCount ?? games.length,
    };
  }

  const games: UserGame[] = [];
  let totalCount = 0;
  let hasMore = true;

  while (hasMore && !signal.cancelled) {
    const response = await getUserLibrary(
      targetUserId,
      `take=${PROFILE_REMOTE_LIBRARY_PAGE_SIZE}&skip=${games.length}`
    );
    const pageGames = ensureArray(response.library);
    games.push(...pageGames);
    totalCount = response.totalCount ?? games.length;

    const reachedLastPage = pageGames.length < PROFILE_REMOTE_LIBRARY_PAGE_SIZE;
    const reachedTotal = games.length >= totalCount;
    hasMore = !reachedLastPage && !reachedTotal;
  }

  return { games, totalCount: totalCount || games.length };
}

async function fetchAchievementGames(
  targetUserId: string,
  /* The official API leaves unlock counts off non-subscribers' libraries, so
     the self-hosted path can't filter on them — it already knows which games
     have unlocks and only needs this list to name and illustrate them. */
  { requireUnlockedCount = true }: { requireUnlockedCount?: boolean } = {}
): Promise<UserGame[]> {
  const searchParams = new URLSearchParams({
    take: String(PROFILE_RECENT_ACHIEVEMENT_LIBRARY_TAKE),
    skip: "0",
    sortBy: "achievementCount",
  });
  searchParams.append("shop", "steam");
  searchParams.append("shop", "launchbox");

  const response = await getUserLibrary(targetUserId, searchParams.toString());
  const games = ensureArray(response.library);

  return requireUnlockedCount
    ? games.filter((game) => (game.unlockedAchievementCount ?? 0) > 0)
    : games;
}

async function fetchGameAchievements(
  game: UserGame,
  targetUserId: string,
  isOwnProfile: boolean
): Promise<AchievementGame> {
  if (isOwnProfile) {
    const achievements =
      await globalThis.window.electron.getUnlockedAchievements(
        game.objectId,
        game.shop
      );

    return {
      game,
      achievements: achievements
        .map(getOwnUnlockedAchievement)
        .filter(
          (achievement): achievement is ProfileRecentAchievement =>
            achievement !== null
        ),
    };
  }

  const comparison =
    await globalThis.window.electron.getComparedUnlockedAchievements(
      game.objectId,
      game.shop,
      targetUserId
    );

  return {
    game,
    achievements: ensureArray(comparison.achievements)
      .map(getComparedAchievement)
      .filter(
        (achievement): achievement is ProfileRecentAchievement =>
          achievement !== null
      ),
  };
}

/**
 * Recent achievements for a profile whose owner has no official
 * subscription, built from the self-hosted server's synced unlocks.
 *
 * That server keeps only achievement names and unlock times, so the public
 * catalogue supplies the icon and title for each one. Anything the catalogue
 * doesn't know is dropped rather than rendered blank.
 */
async function fetchSelfHostedAchievementGroups(
  targetUserId: string
): Promise<ProfileRecentAchievementGroup[]> {
  const [achievementGames, library] = await Promise.all([
    fetchSelfHostedRecentAchievements(targetUserId),
    fetchAchievementGames(targetUserId, { requireUnlockedCount: false }),
  ]);

  if (!achievementGames.length) return [];

  const libraryByGame = new Map(
    library.map((game) => [getGameIdentityKey(game), game])
  );

  const settled = await Promise.allSettled(
    achievementGames.map(async ({ shop, objectId, achievements }) => {
      const game = libraryByGame.get(getGameIdentityKey({ shop, objectId }));
      if (!game) return null;

      const catalogue = await globalThis.window.electron.hydraApi.get<
        SteamAchievement[]
      >(`/games/${shop}/${objectId}/achievements`);

      const metadataByName = new Map(
        ensureArray(catalogue).map((entry) => [entry.name, entry])
      );

      return {
        game,
        achievements: achievements
          .map(({ name, unlockedAt }) => {
            const metadata = metadataByName.get(name);
            if (!metadata) return null;

            return {
              key: `${name}-${unlockedAt}`,
              icon: metadata.icon,
              displayName: metadata.displayName,
              description: metadata.description ?? "",
              unlockTime: unlockedAt,
            };
          })
          .filter(
            (achievement): achievement is ProfileRecentAchievement =>
              achievement !== null
          ),
      };
    })
  );

  const achievementsByGame = settled
    .filter(
      (result): result is PromiseFulfilledResult<AchievementGame | null> =>
        result.status === "fulfilled"
    )
    .map(({ value }) => value)
    .filter((entry): entry is AchievementGame => entry !== null)
    .filter(({ achievements }) => achievements.length > 0);

  return buildRecentAchievementGroups(achievementsByGame);
}

async function fetchRecentAchievementGroups(
  targetUserId: string,
  isOwnProfile: boolean
) {
  const games = await fetchAchievementGames(targetUserId);
  const settled = await Promise.allSettled(
    games.map((game) => fetchGameAchievements(game, targetUserId, isOwnProfile))
  );
  const achievementsByGame = settled
    .filter(
      (result): result is PromiseFulfilledResult<AchievementGame> =>
        result.status === "fulfilled"
    )
    .map(({ value }) => value)
    .filter(({ achievements }) => achievements.length > 0);

  return buildRecentAchievementGroups(achievementsByGame);
}

export function useProfileBadges() {
  const [badges, setBadges] = useState<Badge[]>([]);

  useEffect(() => {
    globalThis.window.electron.hydraApi
      .get<Badge[]>("/badges?locale=en", { needsAuth: false })
      .then((response) => setBadges(ensureArray(response)))
      .catch(() => setBadges([]));
  }, []);

  return badges;
}

export function useExternalProfile(targetUserId: string | undefined) {
  const [externalProfile, setExternalProfile] = useState<UserProfile | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(Boolean(targetUserId));

  const reload = useCallback(async (profileId: string) => {
    const profile = await globalThis.window.electron.hydraApi.get<UserProfile>(
      `/users/${profileId}`
    );
    setExternalProfile(await resolveUserProfile(profileId, profile));
  }, []);

  useEffect(() => {
    if (!targetUserId) {
      setExternalProfile(null);
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    setIsLoading(true);

    globalThis.window.electron.hydraApi
      .get<UserProfile>(`/users/${targetUserId}`)
      .then((profile) => resolveUserProfile(targetUserId, profile))
      .then((profile) => {
        if (isMounted) setExternalProfile(profile);
      })
      .catch(() => {
        if (isMounted) setExternalProfile(null);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [targetUserId]);

  return { externalProfile, isLoading, reload };
}

function useUserStats(targetUserId: string | undefined) {
  const [userStats, setUserStats] = useState<UserStats | null>(null);
  const [isResolved, setIsResolved] = useState(false);

  useEffect(() => {
    if (!targetUserId) {
      setUserStats(null);
      setIsResolved(true);
      return;
    }

    let isMounted = true;
    setUserStats(null);
    setIsResolved(false);

    globalThis.window.electron.hydraApi
      .get<UserStats>(`/users/${targetUserId}/stats`)
      .then(async (stats) => {
        /* The official API only totals achievements for subscribers; the
           self-hosted server knows them from achievement sync. */
        if (stats?.unlockedAchievementSum !== undefined) return stats;

        const unlockedAchievementSum =
          await fetchSelfHostedAchievementSum(targetUserId);

        return unlockedAchievementSum === null
          ? stats
          : { ...stats, unlockedAchievementSum };
      })
      .then((stats) => {
        if (isMounted) setUserStats(stats);
      })
      .catch(() => {
        if (isMounted) setUserStats(null);
      })
      .finally(() => {
        if (isMounted) setIsResolved(true);
      });

    return () => {
      isMounted = false;
    };
  }, [targetUserId]);

  return { userStats, isResolved };
}

function useRemoteLibrary(
  targetUserId: string | undefined,
  isOwnProfile: boolean,
  areStatsResolved: boolean,
  knownLibraryCount: number | undefined
) {
  const [games, setGames] = useState<UserGame[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    if (!targetUserId || isOwnProfile || !areStatsResolved) {
      setGames([]);
      setTotalCount(0);
      return;
    }

    const signal: CancellationSignal = { cancelled: false };
    setGames([]);
    setTotalCount(knownLibraryCount ?? 0);

    fetchRemoteLibraryGames(targetUserId, signal, knownLibraryCount)
      .then((result) => {
        if (signal.cancelled) return;
        setGames(result.games);
        setTotalCount(result.totalCount);
      })
      .catch(() => {
        if (!signal.cancelled) setGames([]);
      });

    return () => {
      signal.cancelled = true;
    };
  }, [areStatsResolved, isOwnProfile, knownLibraryCount, targetUserId]);

  return { games, totalCount };
}

function useRemoteHighlights(
  targetUserId: string | undefined,
  isOwnProfile: boolean
) {
  const [favoriteGame, setFavoriteGame] = useState<UserGame | null>(null);
  const [recentGames, setRecentGames] = useState<UserGame[]>([]);

  useEffect(() => {
    if (!targetUserId || isOwnProfile) {
      setFavoriteGame(null);
      setRecentGames([]);
      return;
    }

    let isMounted = true;
    setFavoriteGame(null);
    setRecentGames([]);

    getUserLibrary(
      targetUserId,
      `take=${PROFILE_FAVORITE_GAME_LIMIT}&skip=0&sortBy=playtime`
    )
      .then((response) => {
        if (isMounted) {
          setFavoriteGame(ensureArray(response.library)[0] ?? null);
        }
      })
      .catch(() => {
        if (isMounted) setFavoriteGame(null);
      });

    getUserLibrary(
      targetUserId,
      `take=${PROFILE_RECENT_ACTIVITY_GAMES_LIMIT}&skip=0&sortBy=playedRecently`
    )
      .then((response) => {
        if (isMounted) setRecentGames(ensureArray(response.library));
      })
      .catch(() => {
        if (isMounted) setRecentGames([]);
      });

    return () => {
      isMounted = false;
    };
  }, [isOwnProfile, targetUserId]);

  return { favoriteGame, recentGames };
}

export function useProfileLibraryData(
  targetUserId: string | undefined,
  isOwnProfile: boolean
) {
  const { userStats, isResolved: areStatsResolved } =
    useUserStats(targetUserId);
  const remoteLibrary = useRemoteLibrary(
    targetUserId,
    isOwnProfile,
    areStatsResolved,
    userStats?.libraryCount
  );
  const remoteHighlights = useRemoteHighlights(targetUserId, isOwnProfile);

  return {
    userStats,
    remoteLibraryGames: remoteLibrary.games,
    remoteLibraryTotalCount: remoteLibrary.totalCount,
    remoteFavoriteGame: remoteHighlights.favoriteGame,
    remoteRecentActivityGames: remoteHighlights.recentGames,
  };
}

export function useProfileFriends(
  targetUserId: string | undefined,
  isOwnProfile: boolean
) {
  const [friends, setFriends] = useState<UserFriend[]>([]);
  const [totalFriends, setTotalFriends] = useState(0);
  const [take, setTake] = useState(PROFILE_FRIENDS_LIMIT);

  useEffect(() => {
    setTake(PROFILE_FRIENDS_LIMIT);
  }, [targetUserId]);

  useEffect(() => {
    if (!targetUserId) {
      setFriends([]);
      setTotalFriends(0);
      return;
    }

    let isMounted = true;
    const path = isOwnProfile
      ? "/profile/friends"
      : `/users/${targetUserId}/friends`;

    globalThis.window.electron.hydraApi
      .get<UserFriends>(path, { params: { take, skip: 0 } })
      .then((response) => {
        if (!isMounted) return;
        const responseFriends = ensureArray(response.friends);
        setFriends(responseFriends);
        setTotalFriends(response.totalFriends ?? responseFriends.length);
      })
      .catch(() => {
        if (!isMounted) return;
        setFriends([]);
        setTotalFriends(0);
      });

    return () => {
      isMounted = false;
    };
  }, [isOwnProfile, take, targetUserId]);

  return {
    friends,
    totalFriends,
    showAll: () => setTake(totalFriends),
  };
}

export function useRecentAchievements(
  targetUserId: string | undefined,
  isOwnProfile: boolean,
  hasActiveSubscription: boolean
) {
  const [groups, setGroups] = useState<ProfileRecentAchievementGroup[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    return globalThis.window.electron.onAchievementUnlocked(() => {
      setRefreshKey((currentKey) => currentKey + 1);
    });
  }, []);

  useEffect(() => {
    if (!targetUserId) {
      setGroups([]);
      return;
    }

    let isMounted = true;

    /* A self-hosted cloud server already grants the viewer a subscription of
       its own, so their own profile takes the branch above and reads
       achievements straight off this device. Only other people's profiles
       need the fallback — theirs live on the server, not here. Without a
       self-hosted server this resolves empty, leaving Hydra Cloud's own
       gating untouched. */
    const load = hasActiveSubscription
      ? fetchRecentAchievementGroups(targetUserId, isOwnProfile)
      : fetchSelfHostedAchievementGroups(targetUserId);

    load
      .then((recentGroups) => {
        if (isMounted) setGroups(recentGroups);
      })
      .catch(() => {
        if (isMounted) setGroups([]);
      });

    return () => {
      isMounted = false;
    };
  }, [hasActiveSubscription, isOwnProfile, refreshKey, targetUserId]);

  return groups;
}
