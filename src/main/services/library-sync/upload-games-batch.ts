import { chunk } from "lodash-es";
import { HydraApi } from "../hydra-api";
import { mergeWithRemoteGames } from "./merge-with-remote-games";
import { WindowManager } from "../window-manager";
import { AchievementWatcherManager } from "../achievements/achievement-watcher-manager";
import { gamesSublevel } from "@main/level";
import { trackRemoteLibrarySync } from "./remote-library-sync-state";
import { migrateSelfHostedHiddenGames } from "./self-hosted-hidden-games";

const uploadLocalGamesAndMerge = async () => {
  /* Before the upload below: games this fork hid were taken off the profile,
     and uploading them as they are would put them back on it, visible. */
  await migrateSelfHostedHiddenGames().catch(() => {});

  const games = await gamesSublevel
    .values()
    .all()
    .then((results) => {
      return results.filter(
        (game) =>
          !game.isDeleted &&
          game.remoteId === null &&
          game.shop !== "custom" &&
          /* Concealed but not on the profile only happens to a game this
             fork hid, which the migration above hasn't moved yet. Uploading
             it here would put it on the profile visible. */
          !game.isConcealed
      );
    });

  const gamesChunks = chunk(games, 30);

  for (const chunk of gamesChunks) {
    await HydraApi.post(
      "/profile/games/batch",
      chunk.map((game) => {
        return {
          objectId: game.objectId,
          playTimeInMilliseconds: Math.trunc(game.playTimeInMilliseconds),
          shop: game.shop,
          lastTimePlayed: game.lastTimePlayed,
          isFavorite: game.favorite,
          isPinned: game.isPinned ?? false,
        };
      })
    ).catch(() => {});
  }

  await mergeWithRemoteGames();

  AchievementWatcherManager.preSearchAchievements();

  if (WindowManager.mainWindow)
    WindowManager.sendToAppWindows("on-library-batch-complete");
};

export const uploadGamesBatch = () =>
  trackRemoteLibrarySync(uploadLocalGamesAndMerge);
