import type { Game, UnlockedAchievement } from "@types";

/**
 * The games a run actually read achievements for. One it skipped — rate
 * limited, or gone from the run — is recorded without a list, and has nothing
 * new to mirror.
 */
export const syncedSteamAppIds = <T>(
  achievementsByAppId: ReadonlyMap<string, T | undefined>
): string[] =>
  [...achievementsByAppId.entries()]
    .filter(([, achievements]) => achievements !== undefined)
    .map(([steamAppId]) => steamAppId);

/**
 * What to send for one game, or `null` when there is nothing worth sending:
 * the server files achievements under the official game id, so a game the
 * profile merge hasn't linked yet waits for the next run, and an empty unlock
 * list would only cost a request.
 */
export const buildSteamAchievementMirrorPayload = (
  steamAppId: string,
  game: Pick<Game, "remoteId" | "hasActiveSteamImport"> | undefined,
  unlockedAchievements: UnlockedAchievement[] | undefined
) => {
  if (!game?.remoteId) return null;
  if (!unlockedAchievements?.length) return null;

  return {
    id: game.remoteId,
    objectId: steamAppId,
    shop: "steam" as const,
    /* Lets that server answer a profile filtered to the Steam library: it
       stores achievements per game and has no other way to know which games
       the Steam integration brought in. */
    hasActiveSteamImport: game.hasActiveSteamImport === true,
    achievements: unlockedAchievements,
  };
};
