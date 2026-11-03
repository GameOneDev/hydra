import { HydraApi } from "../hydra-api";
import type { HydraApiAuthContext } from "../hydra-auth-context";
import { logger } from "../logger";
import {
  buildGameLinks,
  type LinkableGame,
} from "./self-hosted-game-links-core";

/* What a self-hosted server advertises once it can rebuild the combined
   Steam/Epic achievement view from these links. */
const COMBINED_ACHIEVEMENTS_FEATURE = "achievements-combined";

/**
 * Sends the self-hosted server which library games are copies of the same
 * title, read off the official profile a library merge has just fetched.
 *
 * The server can't work that out itself, and needs it to answer the combined
 * Steam/Epic achievement view when official Hydra won't. The whole set goes
 * every time, so a link the catalogue dropped goes from the server too.
 * Fire-and-forget: the library is already merged.
 */
export const syncSelfHostedGameLinks = async (
  games: readonly LinkableGame[],
  context: HydraApiAuthContext | null
) => {
  if (!HydraApi.isSelfHostedCloudEnabled()) return;
  if (!HydraApi.supportsCloudFeature(COMBINED_ACHIEVEMENTS_FEATURE)) return;

  await HydraApi.put("/profile/game-links", buildGameLinks(games), {
    needsSubscription: true,
    ...(context ? { authContext: context } : {}),
  }).catch((error) =>
    logger.error("Failed to send game links to the self-hosted cloud", error)
  );
};
