import { gamesSublevel, levelKeys } from "@main/level";
import type { EpicSnapshotGame } from "../../../types/epic-integration.types";

import { HydraApi } from "../hydra-api";
import type { HydraApiAuthContext } from "../hydra-auth-context";
import { logger } from "../logger";
import { buildEpicAchievementMirrorPayload } from "./epic-achievements-cloud-mirror-core";

/* What a self-hosted server advertises at /capabilities once it stores
   achievements. */
const ACHIEVEMENTS_FEATURE = "achievements";

/**
 * Mirrors the Epic unlocks a sync collected to the self-hosted cloud server.
 *
 * They reach Hydra only inside the Epic snapshot, which only official Hydra
 * accepts, so the server that answers this account's profile totals and
 * recent achievements would otherwise never count them. Runs after the
 * library merge, which is what gives each Epic game the official id the
 * server files achievements under.
 *
 * Failures are logged per game: a server that is down must not fail the
 * sync, and the next one sends the same unlocks again.
 */
export const mirrorEpicAchievementsToSelfHostedCloud = async (
  games: readonly EpicSnapshotGame[],
  context: HydraApiAuthContext
): Promise<number> => {
  if (!HydraApi.isSelfHostedCloudEnabled()) return 0;
  if (!HydraApi.supportsCloudFeature(ACHIEVEMENTS_FEATURE)) return 0;

  let mirroredGames = 0;

  for (const snapshot of games) {
    if (!HydraApi.isAuthContextCurrent(context)) break;

    const objectId = `${snapshot.namespace}:${snapshot.catalogItemId}`;
    const game = await gamesSublevel
      .get(levelKeys.game("epic", objectId))
      .catch(() => undefined);
    const payload = buildEpicAchievementMirrorPayload(snapshot, game);
    if (!payload) continue;

    try {
      await HydraApi.put("/profile/games/achievements", payload, {
        needsSubscription: true,
        authContext: context,
      });
      mirroredGames += 1;
    } catch (error) {
      logger.error(
        "Failed to mirror Epic achievements to the self-hosted cloud",
        objectId,
        error
      );
    }
  }

  return mirroredGames;
};
