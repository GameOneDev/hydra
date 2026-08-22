import type { ProfileVisibility } from "@types";

import { HydraApi } from "./hydra-api";
import { ACHIEVEMENT_SOUVENIRS_FEATURE } from "./souvenir-routes";
import { logger } from "./logger";

/* What this process last pushed, so refreshing user data — which happens on
   every launch and after every profile change — doesn't become a request per
   refresh. Keyed by user as well as value, so signing in as someone else
   still mirrors their setting. */
let mirrored: string | null = null;

export const resetSouvenirsVisibilityMirror = () => {
  mirrored = null;
};

/**
 * Mirrors the account's souvenir privacy setting to the self-hosted cloud
 * server.
 *
 * The setting itself belongs to the official profile, but the self-hosted
 * server is the one answering when another member opens this profile's
 * souvenir tab — and it cannot read the official profile of someone who isn't
 * the caller. Until it has been told, it treats the account as private, so
 * this runs whenever the launcher *learns* the value, not only when the user
 * changes it.
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
      /* Let the next refresh try again rather than leaving the server on a
         setting the user has since changed. */
      mirrored = null;
      logger.error(
        "Failed to mirror souvenir visibility to the self-hosted cloud",
        error
      );
    }
  );
};
