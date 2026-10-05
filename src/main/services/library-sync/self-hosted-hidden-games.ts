import { db, gamesSublevel, levelKeys } from "@main/level";
import type { Game, User } from "@types";

import { HydraApi } from "../hydra-api";
import { logger } from "../logger";
import { createGame } from "./create-game";
import {
  isHiddenOnSelfHostedServer,
  planHiddenGamesReconcile,
  type HiddenGameEntry,
  type VisibilityGame,
} from "./self-hosted-hidden-games-core";

/*
 * The self-hosted server keeps a list of games hidden from other members:
 * the profile stats, recent achievements, custom artwork and playtime heatmap
 * it serves all leave them out. Hiding a game used to be this fork's own
 * feature, kept on that server. Upstream 4.1.6 brought its own — Conceal and
 * Hide, on the official API — so the launcher now uses upstream's, and the
 * server's list follows it.
 */

/* What the self-hosted server advertises at /capabilities once it keeps a
   hidden-games list. */
const HIDDEN_GAMES_FEATURE = "hidden-games";
const HIDDEN_GAMES_PATH = "/profile/hidden-games";

type OfficialVisibility = { isHiddenFromOthers: boolean; isConcealed: boolean };

const migrationSublevel = db.sublevel<string, boolean>(
  levelKeys.selfHostedHiddenGamesMigration,
  { valueEncoding: "json" }
);

const serverKeepsHiddenGames = () =>
  HydraApi.isLoggedIn() &&
  HydraApi.isSelfHostedCloudEnabled() &&
  HydraApi.supportsCloudFeature(HIDDEN_GAMES_FEATURE);

const currentUserId = async () => {
  const user = await db
    .get<string, User>(levelKeys.user, { valueEncoding: "json" })
    .catch(() => null);

  return user?.id ?? null;
};

const isMigrated = async (userId: string) =>
  (await migrationSublevel.get(userId)) === true;

/* Without the list there is no telling a revealed game from a server that
   didn't answer, so callers leave everything alone on null. */
const fetchServerList = () =>
  HydraApi.get<HiddenGameEntry[]>(HIDDEN_GAMES_PATH).catch((error) => {
    logger.error("Failed to read the self-hosted hidden games list", error);
    return null;
  });

const addToServerList = ({ shop, objectId }: HiddenGameEntry) =>
  HydraApi.post(HIDDEN_GAMES_PATH, { shop, objectId });

const removeFromServerList = ({ shop, objectId }: HiddenGameEntry) =>
  HydraApi.delete(
    `${HIDDEN_GAMES_PATH}?shop=${encodeURIComponent(shop)}&objectId=${encodeURIComponent(objectId)}`
  );

const isGameNotFoundError = (error: unknown) => {
  if (typeof error !== "object" || error === null) return false;
  const response = (error as { response?: { data?: { message?: unknown } } })
    .response;
  return response?.data?.message === "game/not-found";
};

/* The same call upstream's own visibility toggle makes, including adding a
   game the profile doesn't have yet. */
const setOfficialVisibility = async (game: Game, flag: "hide" | "conceal") => {
  const save = () =>
    HydraApi.put<OfficialVisibility>(
      `/profile/games/${game.shop}/${game.objectId}/${flag}`
    );

  try {
    return await save();
  } catch (error) {
    if (!isGameNotFoundError(error)) throw error;
    await createGame(game);
    return save();
  }
};

/**
 * Moves the games this fork hid on the self-hosted server to upstream's own
 * visibility, once per account.
 *
 * The fork's hide took a game off the official profile altogether. Upstream's
 * batch upload puts every unlinked game back on it — visible — so this runs
 * before that upload: each game goes back on the profile already concealed
 * (out of the library) and hidden from others (off the profile), which
 * together are what hiding meant here.
 *
 * The server's list is left as it is: it still keeps these games off what
 * other members see, and launchers older than 4.1.6 still read it. Nothing is
 * marked done until every game has moved, so a failure retries next sync.
 */
export const migrateSelfHostedHiddenGames = async () => {
  if (!serverKeepsHiddenGames()) return;

  const userId = await currentUserId();
  if (!userId || (await isMigrated(userId))) return;

  const hiddenOnServer = await fetchServerList();
  if (!hiddenOnServer) return;

  let failed = 0;

  for (const entry of hiddenOnServer) {
    const gameKey = levelKeys.game(entry.shop, entry.objectId);
    const game = await gamesSublevel.get(gameKey);

    /* A game hidden on another machine and never synced to this one has
       nothing here to move; that machine moves it. */
    if (!game || game.isDeleted || game.shop === "custom") continue;

    try {
      await setOfficialVisibility(game, "conceal");
      const saved = await setOfficialVisibility(game, "hide");

      const current = await gamesSublevel.get(gameKey);
      if (current) {
        await gamesSublevel.put(gameKey, {
          ...current,
          isConcealed: saved.isConcealed,
          isHiddenFromOthers: saved.isHiddenFromOthers,
        });
      }
    } catch (error) {
      failed += 1;
      logger.error(`Failed to conceal hidden game ${gameKey}`, error);
    }
  }

  if (failed === 0) {
    await migrationSublevel.put(userId, true);
  } else {
    logger.warn(
      `${failed} hidden game(s) not yet concealed; retrying on the next sync`
    );
  }
};

/**
 * Brings the server's list in line with upstream's visibility, from the
 * official profile a library merge has just read.
 *
 * Waits for the migration: until it has run, the official API doesn't know
 * about the games hidden here yet, and following it would take them off the
 * server's list.
 */
export const reconcileSelfHostedHiddenGames = async (
  profileGames: VisibilityGame[]
) => {
  if (!serverKeepsHiddenGames()) return;

  const userId = await currentUserId();
  if (!userId || !(await isMigrated(userId))) return;

  const hiddenOnServer = await fetchServerList();
  if (!hiddenOnServer) return;

  const { hide, unhide } = planHiddenGamesReconcile(
    hiddenOnServer,
    profileGames
  );

  for (const entry of hide) {
    await addToServerList(entry).catch((error) =>
      logger.error("Failed to hide a game on the self-hosted server", error)
    );
  }

  for (const entry of unhide) {
    await removeFromServerList(entry).catch((error) =>
      logger.error("Failed to unhide a game on the self-hosted server", error)
    );
  }
};

/**
 * Mirrors one game's visibility change to the server's list right away, rather
 * than leaving it showing to other members until the next library sync.
 * Fire-and-forget: the official change already stands.
 */
export const mirrorGameVisibilityToSelfHostedServer = (
  game: Pick<Game, "shop" | "objectId" | "isConcealed" | "isHiddenFromOthers">
) => {
  if (!serverKeepsHiddenGames()) return;

  const entry = { shop: game.shop, objectId: game.objectId };
  const request = isHiddenOnSelfHostedServer(game)
    ? addToServerList(entry)
    : removeFromServerList(entry);

  request.catch((error) =>
    logger.error(
      "Failed to mirror game visibility to the self-hosted server",
      error
    )
  );
};
