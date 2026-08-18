import { registerEvent } from "../register-event";
import { gamesSublevel } from "@main/level";
import { HydraApi, logger } from "@main/services";
import type { GameShop } from "@types";

const hideGame = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const gameKey = `${shop}:${objectId}`;
  const game = await gamesSublevel.get(gameKey).catch(() => null);

  if (!game) return;

  await HydraApi.post(
    "/profile/hidden-games",
    { shop, objectId },
    { needsAuth: true }
  ).catch((err) => {
    logger.warn(`Failed to sync hideGame to server for ${gameKey}`, err);
  });

  let remoteIdToDelete = game.remoteId;

  if (!remoteIdToDelete && HydraApi.isLoggedIn()) {
    try {
      const remoteGames = await HydraApi.get<any[]>("/profile/games", {
        take: 1000,
      }).catch(() => []);
      const existing = remoteGames.find(
        (g) => g.shop === shop && g.objectId === objectId
      );
      if (existing) remoteIdToDelete = existing.id;
    } catch (err) {
      logger.warn(`Failed to fetch remote profile games for ${gameKey}`, err);
    }
  }

  if (remoteIdToDelete) {
    await HydraApi.delete(`/profile/games/${remoteIdToDelete}`, {
      needsAuth: true,
    }).catch((err) => {
      logger.warn(
        `Failed to delete game from profile games for ${remoteIdToDelete}`,
        err
      );
    });
  }

  await gamesSublevel.put(gameKey, {
    ...game,
    isHidden: true,
    remoteId: null,
  });
};

registerEvent("hideGame", hideGame);
