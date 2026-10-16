import {
  gameRequestQueue,
  HYDRA_GAME_REQUEST_TIMEOUT_MS,
} from "./game-request-queue";
import type { Game } from "@types";
import { HydraApi } from "../hydra-api";
import { gamesSublevel, levelKeys } from "@main/level";
import {
  libraryWriteQueue,
  withHydraClaim,
  getHydraPlaytimeRevision,
} from "./library-write-queue";

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

/* Sessions Hydra doesn't count toward its own playtime — Epic and Steam
   games whose time the store reports — never reach trackGamePlaytime, so
   the heatmap would miss them. Their wall-clock time is collected here and
   reported in whole seconds, carrying the remainder to the next flush. */
const untrackedSessionTime = new Map<string, number>();

export const recordUntrackedSessionTime = (
  game: Game,
  deltaInMillis: number
) => {
  if (!HydraApi.isSelfHostedCloudEnabled()) return;
  if (game.shop === "custom" || !(deltaInMillis > 0)) return;

  const key = levelKeys.game(game.shop, game.objectId);
  untrackedSessionTime.set(
    key,
    (untrackedSessionTime.get(key) ?? 0) + deltaInMillis
  );
};

export const flushUntrackedSessionTime = (game: Game, sessionEnded = false) => {
  const key = levelKeys.game(game.shop, game.objectId);
  const pending = untrackedSessionTime.get(key) ?? 0;
  const seconds = Math.trunc(pending / 1000);

  if (sessionEnded) untrackedSessionTime.delete(key);
  else untrackedSessionTime.set(key, pending - seconds * 1000);

  reportPlaytimeToSelfHostedCloud(game, seconds);
};

export const trackGamePlaytime = async (
  game: Game,
  deltaInMillis: number,
  lastTimePlayed: Date
) => {
  if (game.shop === "custom") return;
  const context = HydraApi.getAuthContext();
  const key = levelKeys.game(game.shop, game.objectId);
  const current = () =>
    context
      ? HydraApi.isAuthContextCurrent(context)
      : HydraApi.getAuthContext() === null;
  const revision = getHydraPlaytimeRevision(key);
  const task = () =>
    gameRequestQueue.run(
      [key],
      async () => {
        if (getHydraPlaytimeRevision(key) !== revision) return;
        reportPlaytimeToSelfHostedCloud(game, Math.trunc(deltaInMillis / 1000));
        if (deltaInMillis >= 1000)
          await libraryWriteQueue.run(async () => {
            const latest = await gamesSublevel.get(key);
            if (latest)
              await gamesSublevel.put(key, { ...latest, source: "hydra" });
          }, current);
        return HydraApi.put(
          `/profile/games/${game.shop}/${encodeURIComponent(game.objectId)}`,
          {
            playTimeDeltaInSeconds: Math.trunc(deltaInMillis / 1000),
            lastTimePlayed,
          },
          {
            ...(context ? { authContext: context } : {}),
            timeout: HYDRA_GAME_REQUEST_TIMEOUT_MS,
          }
        );
      },
      current
    );
  return deltaInMillis >= 1000 ? withHydraClaim(key, task) : task();
};
