import type { Game } from "@types";
import type { EpicSnapshotGame } from "../../../types/epic-integration.types";

/**
 * What to send the self-hosted server for one Epic game, or `null` when there
 * is nothing worth sending: the server files achievements under the official
 * game id, so a game the merge hasn't linked yet waits for the next sync, and
 * a game Epic didn't report achievements for has nothing new.
 *
 * Epic names an achievement by its `externalId`. That is what the server
 * stores and counts, matched case-insensitively like every other unlock.
 */
export const buildEpicAchievementMirrorPayload = (
  snapshot: EpicSnapshotGame,
  game: Pick<Game, "remoteId"> | undefined
) => {
  if (!game?.remoteId) return null;

  const achievements = (snapshot.achievements ?? []).flatMap((achievement) => {
    const unlockTime = Date.parse(achievement.unlockTime);
    if (!achievement.externalId || !Number.isFinite(unlockTime)) return [];
    return [{ name: achievement.externalId, unlockTime }];
  });

  if (!achievements.length) return null;

  return {
    id: game.remoteId,
    objectId: `${snapshot.namespace}:${snapshot.catalogItemId}`,
    shop: "epic" as const,
    achievements,
  };
};
