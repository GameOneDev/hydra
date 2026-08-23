import { gamesSublevel, gamesShopAssetsSublevel, levelKeys } from "@main/level";
import { getSteamAppDetails } from "../steam";
import { HydraApi } from "../hydra-api";
import { logger } from "../logger";
import { buildSteamCoverImageUrl } from "./steam-assets";
import type { GameShop } from "@types";

const PLACEHOLDER_TITLE = "Hidden Game";

/** Resolves a title and cover for a game hidden on another device. */
const resolveHiddenGameAssets = async (shop: GameShop, objectId: string) => {
  const existingAsset = await gamesShopAssetsSublevel
    .get(levelKeys.game(shop, objectId))
    .catch(() => null);

  if (existingAsset && existingAsset.title !== PLACEHOLDER_TITLE) {
    return {
      title: existingAsset.title,
      coverImageUrl: existingAsset.coverImageUrl || null,
      iconUrl: existingAsset.iconUrl || null,
    };
  }

  try {
    if (shop === "steam") {
      const details = await getSteamAppDetails(objectId, "english");

      return {
        title: details?.name ?? PLACEHOLDER_TITLE,
        coverImageUrl: buildSteamCoverImageUrl(objectId),
        iconUrl: null,
      };
    }

    if (shop === "launchbox") {
      const basic = await HydraApi.get<{
        title: string;
        coverImageUrl: string | null;
      }>(`/games/launchbox/${objectId}`, null, { needsAuth: false });

      if (basic) {
        return {
          title: basic.title,
          coverImageUrl: basic.coverImageUrl,
          iconUrl: null,
        };
      }
    }
  } catch (err) {
    logger.warn(`Failed to resolve assets for hidden game ${objectId}`, err);
  }

  return { title: PLACEHOLDER_TITLE, coverImageUrl: null, iconUrl: null };
};

const createHiddenGamePlaceholder = async (
  shop: GameShop,
  objectId: string
) => {
  const gameKey = levelKeys.game(shop, objectId);
  const { title, coverImageUrl, iconUrl } = await resolveHiddenGameAssets(
    shop,
    objectId
  );

  await gamesSublevel.put(gameKey, {
    shop,
    objectId,
    title,
    iconUrl,
    libraryHeroImageUrl: null,
    logoImageUrl: null,
    isDeleted: false,
    isHidden: true,
    remoteId: null,
    playTimeInMilliseconds: 0,
    lastTimePlayed: null,
  });

  await gamesShopAssetsSublevel.put(gameKey, {
    updatedAt: Date.now(),
    shop,
    objectId,
    title,
    coverImageUrl,
    iconUrl,
    libraryHeroImageUrl: null,
    libraryImageUrl: null,
    logoImageUrl: null,
    logoPosition: null,
    downloadSources: [],
  });
};

export const syncHiddenGames = async () => {
  if (!HydraApi.supportsHiddenGames()) return;

  const hiddenOnServer = await HydraApi.get<
    Array<{ shop: GameShop; objectId: string }>
  >("/profile/hidden-games").catch((err) => {
    logger.error("Failed to fetch hidden games", err);
    return null;
  });

  /* Without the server list there is no way to tell an unhidden game from an
     unreachable server, so leave the local state alone. */
  if (!hiddenOnServer) return;

  const serverHiddenKeys = new Set<string>();

  for (const { shop, objectId } of hiddenOnServer) {
    const gameKey = levelKeys.game(shop, objectId);
    serverHiddenKeys.add(gameKey);

    const game = await gamesSublevel.get(gameKey).catch(() => null);

    if (!game) {
      await createHiddenGamePlaceholder(shop, objectId);
      continue;
    }

    let { remoteId } = game;

    if (remoteId) {
      /* Keeping remoteId on failure leaves the removal for the next sync. */
      const removed = await HydraApi.delete(`/profile/games/${remoteId}`)
        .then(() => true)
        .catch(() => false);

      if (removed) remoteId = null;
    }

    if (!game.isHidden || game.remoteId !== remoteId) {
      await gamesSublevel.put(gameKey, { ...game, isHidden: true, remoteId });
    }
  }

  const entries = await gamesSublevel.iterator().all();

  for (const [gameKey, game] of entries) {
    if (game.isHidden && !serverHiddenKeys.has(gameKey)) {
      await gamesSublevel.put(gameKey, { ...game, isHidden: false });
    }
  }
};
