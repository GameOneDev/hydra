import {
  downloadsSublevel,
  gamesShopAssetsSublevel,
  gamesSublevel,
} from "@main/level";
import type { GameShop } from "@types";
import { getAutomaticCloudSyncDefault } from "./cloud-saves-default";

interface PrepareGameEntryParams {
  gameKey: string;
  title: string;
  objectId: string;
  shop: GameShop;
}

export const prepareGameEntry = async ({
  gameKey,
  title,
  objectId,
  shop,
}: PrepareGameEntryParams): Promise<void> => {
  const game = await gamesSublevel.get(gameKey);
  const gameAssets = await gamesShopAssetsSublevel.get(gameKey);

  await downloadsSublevel.del(gameKey);

  if (game) {
    await gamesSublevel.put(gameKey, {
      ...game,
      isDeleted: false,
    });
  } else {
    await gamesSublevel.put(gameKey, {
      title,
      iconUrl: gameAssets?.iconUrl ?? null,
      libraryHeroImageUrl: gameAssets?.libraryHeroImageUrl ?? null,
      logoImageUrl: gameAssets?.logoImageUrl ?? null,
      objectId,
      shop,
      remoteId: null,
      playTimeInMilliseconds: 0,
      lastTimePlayed: null,
      addedToLibraryAt: new Date(),
      isDeleted: false,
      automaticCloudSync: await getAutomaticCloudSyncDefault(),
    });
  }
};
