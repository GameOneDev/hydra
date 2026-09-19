import { gamesSublevel, levelKeys } from "@main/level";

import { AchievementMemoryStore } from "../achievements/achievement-memory-store";
import { HydraApi } from "../hydra-api";
import { steamSyncLogger } from "../logger";
import { buildSteamAchievementMirrorPayload } from "./steam-achievements-cloud-mirror-core";

export { syncedSteamAppIds } from "./steam-achievements-cloud-mirror-core";

/* What a self-hosted server advertises at /capabilities once it stores
   achievements. */
const ACHIEVEMENTS_FEATURE = "achievements";

/**
 * Mirrors the unlocks a Steam sync imported to the self-hosted cloud server.
 *
 * The Steam integration publishes its snapshot through
 * `/profile/integrations/steam`, which only official Hydra answers. Without
 * this a self-hosted account would keep achievements only for what this
 * machine detected locally, and its profile totals and per-game lists — both
 * read back from that server — would miss everything Steam brought in. The
 * regular achievement sync takes the same unlocks, so send them there too.
 *
 * Failures are logged per game: a server that is down must not fail the sync
 * run, and the next one sends the same unlocks again.
 */
export const mirrorSteamAchievementsToSelfHostedCloud = async (
  steamAppIds: Iterable<string>
): Promise<number> => {
  if (!HydraApi.isSelfHostedCloudEnabled()) return 0;
  if (!HydraApi.supportsCloudFeature(ACHIEVEMENTS_FEATURE)) return 0;

  let mirroredGames = 0;

  for (const steamAppId of steamAppIds) {
    const game = await gamesSublevel.get(levelKeys.game("steam", steamAppId));

    const payload = buildSteamAchievementMirrorPayload(
      steamAppId,
      game,
      AchievementMemoryStore.get("steam", steamAppId)?.unlockedAchievements
    );

    if (!payload) continue;

    try {
      await HydraApi.put("/profile/games/achievements", payload, {
        needsSubscription: true,
      });

      mirroredGames += 1;
    } catch (error) {
      steamSyncLogger.error(
        "Failed to mirror Steam achievements to the self-hosted cloud",
        steamAppId,
        error
      );
    }
  }

  return mirroredGames;
};
