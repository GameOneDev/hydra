import type { Game } from "@types";
import { HydraApi } from "../hydra-api";

const localDay = (date: Date) => {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
};

/* Fire-and-forget: the heatmap is a nice-to-have and must never fail the
   official playtime sync this piggybacks on. */
const reportPlaytimeToSelfHostedCloud = (
  game: Game,
  deltaInSeconds: number
) => {
  if (!HydraApi.isSelfHostedCloudEnabled()) return;
  if (deltaInSeconds <= 0) return;

  HydraApi.post("/profile/playtime", {
    shop: game.shop,
    objectId: game.objectId,
    deltaInSeconds,
    day: localDay(new Date()),
  }).catch(() => {});
};

export const trackGamePlaytime = async (
  game: Game,
  deltaInMillis: number,
  lastTimePlayed: Date
) => {
  if (game.shop === "custom") {
    return;
  }

  const playTimeDeltaInSeconds = Math.trunc(deltaInMillis / 1000);

  reportPlaytimeToSelfHostedCloud(game, playTimeDeltaInSeconds);

  return HydraApi.put(`/profile/games/${game.shop}/${game.objectId}`, {
    playTimeDeltaInSeconds,
    lastTimePlayed,
  });
};
