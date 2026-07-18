import type { Game, ShopAssets } from "@types";
import { HydraApi } from "../hydra-api";
import {
  gamesArtworkSelectionSublevel,
  gamesShopAssetsSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import { reconcileRemoteArtworkSelection } from "./reconcile-remote-artwork-selection";
import type { CustomArtworkUrls } from "./reconcile-remote-artwork-selection";
import {
  artworkKey,
  fetchSelfHostedArtwork,
  type SelfHostedArtworkMap,
} from "./self-hosted-artwork";

type ProfileGame = {
  id: string;
  createdAt?: string | null;
  collectionIds?: string[];
  collectionId?: string | null;
  lastTimePlayed: Date | null;
  playTimeInMilliseconds: number;
  hasManuallyUpdatedPlaytime: boolean;
  isFavorite?: boolean;
  isPinned?: boolean;
  achievementCount: number;
  unlockedAchievementCount: number;
  platform?: string | null;
  customLibraryImageUrl?: string | null;
  customLibraryHeroImageUrl?: string | null;
  customLogoImageUrl?: string | null;
  customIconUrl?: string | null;
} & ShopAssets;

const reconcileCustomAsset = (
  localValue: string | null | undefined,
  remoteValue: string | null | undefined
): string | null | undefined => {
  if (remoteValue === undefined) return localValue;
  if (typeof localValue === "string" && localValue.startsWith("local:")) {
    return localValue;
  }
  return remoteValue;
};

const getOfficialCustomAssets = (game: ProfileGame): CustomArtworkUrls => ({
  customIconUrl: game.customIconUrl,
  customLogoImageUrl: game.customLogoImageUrl,
  customHeroImageUrl: game.customLibraryHeroImageUrl,
  customCoverImageUrl: game.customLibraryImageUrl,
});

/**
 * Which custom images this game should end up with.
 *
 * With a self-hosted server the images it holds win, since that is where
 * this launcher uploads them. The official values stay as the fallback so a
 * real Hydra Cloud subscriber keeps seeing images synced before the server
 * was configured. When neither side has an image the field resolves to
 * `null` rather than being left undefined — that is how removing an image on
 * another device reaches this one.
 */
const getRemoteCustomAssets = (
  game: ProfileGame,
  selfHostedArtwork: SelfHostedArtworkMap | null
): CustomArtworkUrls => {
  const official = getOfficialCustomAssets(game);
  if (!selfHostedArtwork) return official;

  const artwork = selfHostedArtwork.get(artworkKey(game.shop, game.objectId));

  return {
    customIconUrl: artwork?.icons ?? official.customIconUrl ?? null,
    customLogoImageUrl: artwork?.logos ?? official.customLogoImageUrl ?? null,
    customHeroImageUrl: artwork?.heroes ?? official.customHeroImageUrl ?? null,
    customCoverImageUrl: artwork?.grids ?? official.customCoverImageUrl ?? null,
  };
};

const syncArtworkSelectionWithRemote = async (
  gameKey: string,
  localGame: Game | undefined,
  remoteCustomAssets: CustomArtworkUrls
) => {
  const selection = await gamesArtworkSelectionSublevel.get(gameKey);
  if (!selection) return;

  const { selected, changed } = reconcileRemoteArtworkSelection(
    selection.selected,
    localGame ?? {},
    remoteCustomAssets
  );
  if (!changed) return;

  if (Object.keys(selected).length) {
    await gamesArtworkSelectionSublevel.put(gameKey, {
      ...selection,
      selected,
      updatedAt: Date.now(),
    });
  } else {
    await gamesArtworkSelectionSublevel.del(gameKey);
  }
};

interface CollectionSource {
  collectionIds?: string[];
  collectionId?: string | null;
}

const getCollectionIds = (source: CollectionSource | null | undefined) => {
  if (!source) return [];
  if (Array.isArray(source.collectionIds)) return source.collectionIds;
  if (source.collectionId) return [source.collectionId];
  return [];
};

const getLatestLastTimePlayed = (
  localGame: Game,
  remoteGame: ProfileGame
): Date | null => {
  if (localGame.lastTimePlayed == null) return remoteGame.lastTimePlayed;
  if (
    remoteGame.lastTimePlayed &&
    new Date(remoteGame.lastTimePlayed) > new Date(localGame.lastTimePlayed)
  ) {
    return remoteGame.lastTimePlayed;
  }

  return localGame.lastTimePlayed;
};

const getRemoteCoverImageUrl = (game: ProfileGame): string | null => {
  if (game.coverImageUrl) return game.coverImageUrl;
  if (game.shop !== "steam") return null;

  return `https://shared.steamstatic.com/store_item_assets/steam/apps/${game.objectId}/library_600x900_2x.jpg`;
};

const PAGE_SIZE = 100;

const fetchAllGamesForShop = async (
  params: Record<string, unknown> = {}
): Promise<ProfileGame[]> => {
  const all: ProfileGame[] = [];
  let skip = 0;

  for (;;) {
    const page = await HydraApi.get<ProfileGame[]>("/profile/games", {
      ...params,
      take: PAGE_SIZE,
      skip,
    });

    all.push(...page);

    if (page.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
  }

  return all;
};

const fetchRemoteGames = async (): Promise<ProfileGame[]> => {
  const [defaultGames, classicsGames] = await Promise.all([
    fetchAllGamesForShop(),
    fetchAllGamesForShop({ shop: "launchbox" }).catch(
      () => [] as ProfileGame[]
    ),
  ]);

  return [...defaultGames, ...classicsGames];
};

const mergeExistingGame = (
  localGame: Game,
  remoteGame: ProfileGame,
  collectionIds: string[],
  remoteAddedToLibraryAt: Date | null,
  remoteCustomAssets: CustomArtworkUrls
): Game => ({
  ...localGame,
  remoteId: remoteGame.id,
  addedToLibraryAt: localGame.addedToLibraryAt ?? remoteAddedToLibraryAt,
  lastTimePlayed: getLatestLastTimePlayed(localGame, remoteGame),
  playTimeInMilliseconds: Math.max(
    localGame.playTimeInMilliseconds,
    remoteGame.playTimeInMilliseconds
  ),
  favorite: remoteGame.isFavorite ?? localGame.favorite,
  isPinned: remoteGame.isPinned ?? localGame.isPinned,
  collectionIds,
  achievementCount: remoteGame.achievementCount,
  unlockedAchievementCount: remoteGame.unlockedAchievementCount,
  platform: remoteGame.platform ?? localGame.platform,
  customIconUrl: reconcileCustomAsset(
    localGame.customIconUrl,
    remoteCustomAssets.customIconUrl
  ),
  customLogoImageUrl: reconcileCustomAsset(
    localGame.customLogoImageUrl,
    remoteCustomAssets.customLogoImageUrl
  ),
  customHeroImageUrl: reconcileCustomAsset(
    localGame.customHeroImageUrl,
    remoteCustomAssets.customHeroImageUrl
  ),
  customCoverImageUrl: reconcileCustomAsset(
    localGame.customCoverImageUrl,
    remoteCustomAssets.customCoverImageUrl
  ),
});

const createLocalGame = (
  remoteGame: ProfileGame,
  collectionIds: string[],
  addedToLibraryAt: Date | null,
  remoteCustomAssets: CustomArtworkUrls
): Game => ({
  objectId: remoteGame.objectId,
  title: remoteGame.title,
  remoteId: remoteGame.id,
  shop: remoteGame.shop,
  iconUrl: remoteGame.iconUrl,
  libraryHeroImageUrl: remoteGame.libraryHeroImageUrl,
  logoImageUrl: remoteGame.logoImageUrl,
  addedToLibraryAt,
  lastTimePlayed: remoteGame.lastTimePlayed,
  playTimeInMilliseconds: remoteGame.playTimeInMilliseconds,
  hasManuallyUpdatedPlaytime: remoteGame.hasManuallyUpdatedPlaytime,
  isDeleted: false,
  favorite: remoteGame.isFavorite ?? false,
  isPinned: remoteGame.isPinned ?? false,
  collectionIds,
  achievementCount: remoteGame.achievementCount,
  unlockedAchievementCount: remoteGame.unlockedAchievementCount,
  platform: remoteGame.platform ?? null,
  customIconUrl: remoteCustomAssets.customIconUrl ?? null,
  customLogoImageUrl: remoteCustomAssets.customLogoImageUrl ?? null,
  customHeroImageUrl: remoteCustomAssets.customHeroImageUrl ?? null,
  customCoverImageUrl: remoteCustomAssets.customCoverImageUrl ?? null,
});

const mergeRemoteGame = async (
  remoteGame: ProfileGame,
  selfHostedArtwork: SelfHostedArtworkMap | null
) => {
  const gameKey = levelKeys.game(remoteGame.shop, remoteGame.objectId);
  const localGame = await gamesSublevel.get(gameKey);
  const hasRemoteCollectionField =
    Array.isArray(remoteGame.collectionIds) ||
    Object.hasOwn(remoteGame, "collectionId");
  const collectionIds = hasRemoteCollectionField
    ? getCollectionIds(remoteGame)
    : getCollectionIds(localGame);
  const remoteAddedToLibraryAt = remoteGame.createdAt
    ? new Date(remoteGame.createdAt)
    : null;
  const remoteCustomAssets = getRemoteCustomAssets(
    remoteGame,
    selfHostedArtwork
  );
  const mergedGame = localGame
    ? mergeExistingGame(
        localGame,
        remoteGame,
        collectionIds,
        remoteAddedToLibraryAt,
        remoteCustomAssets
      )
    : createLocalGame(
        remoteGame,
        collectionIds,
        remoteAddedToLibraryAt,
        remoteCustomAssets
      );

  await gamesSublevel.put(gameKey, mergedGame);
  await syncArtworkSelectionWithRemote(gameKey, localGame, remoteCustomAssets);

  const localGameShopAsset = await gamesShopAssetsSublevel.get(gameKey);
  await gamesShopAssetsSublevel.put(gameKey, {
    updatedAt: Date.now(),
    ...localGameShopAsset,
    shop: remoteGame.shop,
    objectId: remoteGame.objectId,
    title: localGame?.title || remoteGame.title,
    coverImageUrl: getRemoteCoverImageUrl(remoteGame),
    libraryHeroImageUrl: remoteGame.libraryHeroImageUrl,
    libraryImageUrl: remoteGame.libraryImageUrl,
    logoImageUrl: remoteGame.logoImageUrl,
    iconUrl: remoteGame.iconUrl,
    logoPosition: remoteGame.logoPosition,
    downloadSources: remoteGame.downloadSources,
  });
};

export const mergeWithRemoteGames = async () => {
  try {
    const [remoteGames, selfHostedArtwork] = await Promise.all([
      fetchRemoteGames(),
      fetchSelfHostedArtwork(),
    ]);

    for (const game of remoteGames) {
      await mergeRemoteGame(game, selfHostedArtwork);
    }
  } catch {
    // Keep local library available when remote sync fails.
  }
};
