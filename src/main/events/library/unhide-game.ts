import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { HydraApi, logger } from "@main/services";
import { createGame } from "@main/services/library-sync";
import type { GameShop } from "@types";

const unhideGame = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  if (!HydraApi.supportsHiddenGames()) return false;

  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey).catch(() => null);

  if (!game) return false;

  /* Same reasoning as hideGame: while the server still lists the game as
     hidden, the next sync would hide it back. */
  try {
    await HydraApi.delete(
      `/profile/hidden-games?shop=${encodeURIComponent(shop)}&objectId=${encodeURIComponent(objectId)}`
    );
  } catch (err) {
    logger.error(`Failed to unhide ${gameKey} on the server`, err);
    return false;
  }

  const unhiddenGame = { ...game, isHidden: false, remoteId: null };
  await gamesSublevel.put(gameKey, unhiddenGame);

  /* Restores the public profile entry and its remoteId. A failure leaves
     remoteId null, so uploadGamesBatch retries. */
  await createGame(unhiddenGame).catch((err) => {
    logger.warn(`Failed to restore ${gameKey} on the profile`, err);
  });

  return true;
};

registerEvent("unhideGame", unhideGame);
