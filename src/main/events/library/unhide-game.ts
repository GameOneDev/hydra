import { registerEvent } from "../register-event";
import { gamesSublevel } from "@main/level";
import { HydraApi } from "@main/services";
import type { GameShop } from "@types";

const unhideGame = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const gameKey = `${shop}:${objectId}`;
  const game = await gamesSublevel.get(gameKey).catch(() => null);

  if (!game) return;

  await HydraApi.delete(
    `/profile/hidden-games?shop=${encodeURIComponent(shop)}&objectId=${encodeURIComponent(objectId)}`,
    { needsAuth: true }
  ).catch(() => {});

  let newRemoteId = null;
  if (HydraApi.isLoggedIn()) {
    try {
      const result = await HydraApi.post(
        "/profile/games",
        {
          objectId,
          shop,
          playTimeInMilliseconds: Math.trunc(game.playTimeInMilliseconds ?? 0),
          lastTimePlayed: game.lastTimePlayed,
        },
        { needsAuth: true }
      );
      if (result?.id) newRemoteId = result.id;
    } catch (err) {
      const logger = require("@main/services/logger").logger;
      logger.error("FAILED TO RE-ADD GAME", err);
    }
    
    if (!newRemoteId) {
      // It might have failed due to a 409 Conflict (already on profile).
      // Let's fetch the remote ID from the official profile.
      try {
        const remoteGames = await HydraApi.get<any[]>("/profile/games", { take: 1000 }).catch(() => []);
        const existing = remoteGames.find(g => g.shop === shop && g.objectId === objectId);
        if (existing) newRemoteId = existing.id;
      } catch (err) {}
    }
  }

  await gamesSublevel.put(gameKey, {
    ...game,
    isHidden: false,
    remoteId: newRemoteId ?? null,
  });
};

registerEvent("unhideGame", unhideGame);
