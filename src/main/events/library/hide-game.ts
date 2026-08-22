import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { HydraApi, logger } from "@main/services";
import type { GameShop } from "@types";

const hideGame = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  if (!HydraApi.supportsHiddenGames()) return false;

  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey).catch(() => null);

  if (!game) return false;

  /* The server owns the hidden state: if it never records the game, the next
     sync unhides it again and re-uploads it to the public profile. */
  try {
    await HydraApi.post("/profile/hidden-games", { shop, objectId });
  } catch (err) {
    logger.error(`Failed to hide ${gameKey} on the server`, err);
    return false;
  }

  let { remoteId } = game;

  if (remoteId) {
    /* Keeping remoteId on failure leaves the removal for the next sync. */
    const removed = await HydraApi.delete(`/profile/games/${remoteId}`)
      .then(() => true)
      .catch((err) => {
        logger.warn(`Failed to remove ${gameKey} from the profile`, err);
        return false;
      });

    if (removed) remoteId = null;
  }

  await gamesSublevel.put(gameKey, { ...game, isHidden: true, remoteId });

  return true;
};

registerEvent("hideGame", hideGame);
