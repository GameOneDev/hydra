import { registerEvent } from "../register-event";
import type { GameShop } from "@types";
import { createGame } from "@main/services/library-sync";
import {
  gamesShopAssetsSublevel,
  gamesShopCacheSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import { clearFinishedDownload } from "@main/helpers";
import { AchievementWatcherManager } from "@main/services/achievements/achievement-watcher-manager";
import { getAutomaticCloudSyncDefault } from "@main/helpers";

const lookupCachedPlatform = async (
  shop: GameShop,
  objectId: string
): Promise<string | null> => {
  const prefix = `${shop}:${objectId}:`;
  try {
    const entries = await gamesShopCacheSublevel.iterator().all();
    for (const [key, value] of entries) {
      if (
        typeof key === "string" &&
        key.startsWith(prefix) &&
        value?.platform
      ) {
        return value.platform;
      }
    }
  } catch {
    return null;
  }
  return null;
};

const addGameToLibrary = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  title: string,
  platform?: string | null,
  isHidden?: boolean
) => {
  const gameKey = levelKeys.game(shop, objectId);
  let game = await gamesSublevel.get(gameKey);

  const gameAssets = await gamesShopAssetsSublevel.get(gameKey);

  const resolvedPlatform =
    platform ??
    (shop === "launchbox" ? await lookupCachedPlatform(shop, objectId) : null);

  const automaticCloudSyncDefault =
    shop !== "custom" && (await getAutomaticCloudSyncDefault());

  if (game) {
    await clearFinishedDownload(shop, objectId);

    game.isDeleted = false;
    game.addedToLibraryAt ??= new Date();
    if (resolvedPlatform && !game.platform) game.platform = resolvedPlatform;
    game.automaticCloudSync ??= automaticCloudSyncDefault;
    if (isHidden !== undefined) game.isHidden = isHidden;

    await gamesSublevel.put(gameKey, game);
  } else {
    game = {
      title,
      iconUrl: gameAssets?.iconUrl ?? null,
      libraryHeroImageUrl: gameAssets?.libraryHeroImageUrl ?? null,
      logoImageUrl: gameAssets?.logoImageUrl ?? null,
      objectId,
      shop,
      remoteId: null,
      isDeleted: false,
      isHidden: isHidden ?? false,
      playTimeInMilliseconds: 0,
      lastTimePlayed: null,
      addedToLibraryAt: new Date(),
      platform: resolvedPlatform ?? null,
      automaticCloudSync: automaticCloudSyncDefault,
    };

    await gamesSublevel.put(gameKey, game);
  }

  if (game) {
    const created = await createGame(game)
      .then(() => true)
      .catch(() => false);

    /* A hidden game the server never recorded would be unhidden by the next
       sync, so keep it as an ordinary library entry instead. */
    if (!created && game.isHidden) {
      game.isHidden = false;
      await gamesSublevel.put(gameKey, game);
    }

    AchievementWatcherManager.syncGameAchievementFiles(
      game.shop,
      game.objectId
    );
  }
};

registerEvent("addGameToLibrary", addGameToLibrary);
