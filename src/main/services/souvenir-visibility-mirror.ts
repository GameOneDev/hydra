import type { ProfileVisibility } from "@types";

import { HydraApi } from "./hydra-api";
import { ACHIEVEMENT_SOUVENIRS_FEATURE } from "./souvenir-routes";
import { logger } from "./logger";

/* What this process last pushed, so a user-data refresh doesn't become a
   request per refresh. Keyed by user too, so signing in as someone else still
   mirrors their setting. */
let mirrored: string | null = null;

export const resetSouvenirsVisibilityMirror = () => {
  mirrored = null;
};

/**
 * Mirrors the account's souvenir privacy setting to the self-hosted server,
 * which answers for other viewers but can't read the official profile of
 * anyone but the caller. It assumes private until told, so this runs whenever
 * the launcher *learns* the value, not only when the user changes it.
 *
 * Fire-and-forget: a profile load must not fail because the mirror did.
 */
export const mirrorSouvenirsVisibility = (
  userId: string | undefined,
  visibility: ProfileVisibility | undefined
) => {
  if (!userId || !visibility) return;
  if (!HydraApi.isSelfHostedCloudEnabled()) return;
  if (!HydraApi.supportsCloudFeature(ACHIEVEMENT_SOUVENIRS_FEATURE)) return;

  const key = `${userId}:${visibility}`;
  if (mirrored === key) return;

  mirrored = key;

  HydraApi.patch("/profile/souvenirs-visibility", { visibility }).catch(
    (error) => {
      // Let the next refresh try again.
      mirrored = null;
      logger.error(
        "Failed to mirror souvenir visibility to the self-hosted cloud",
        error
      );
    }
  );
};
