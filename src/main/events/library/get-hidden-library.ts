import path from "node:path";
import fs from "node:fs";

import type { LibraryGame } from "@types";
import { registerEvent } from "../register-event";
import {
  downloadsSublevel,
  gamesArtworkSelectionSublevel,
  gamesShopAssetsSublevel,
  gamesSublevel,
} from "@main/level";
import { composeAssetsWithArtwork } from "@shared";
import { AchievementMemoryStore } from "@main/services/achievements/achievement-memory-store";
import { lookupCachedPlatform } from "./get-library";

const getHiddenLibrary = async (): Promise<LibraryGame[]> => {
  return gamesSublevel
    .iterator()
    .all()
    .then((results) => {
      return Promise.all(
        results
          .filter(
            ([_key, game]) => game.isDeleted === false && game.isHidden === true
          )
          .map(async ([key, game]) => {
            const download = await downloadsSublevel.get(key).catch(() => null);
            const gameAssets = await gamesShopAssetsSublevel
              .get(key)
              .catch(() => null);
            const artworkSelection = await gamesArtworkSelectionSublevel
              .get(key)
              .catch(() => null);

            const composedAssets = composeAssetsWithArtwork(
              gameAssets ?? null,
              artworkSelection ?? null
            );
            const achievements = AchievementMemoryStore.get(
              game.shop,
              game.objectId
            );

            const validAchievementNames = new Set(
              achievements?.achievements?.map((a) =>
                (a.name ?? "").toUpperCase()
              ) || []
            );

            const unlockedAchievementCount =
              achievements?.unlockedAchievements?.filter(
                (unlocked) =>
                  validAchievementNames.has(
                    (unlocked.name ?? "").toUpperCase()
                  ) && unlocked.unlockTime > 0
              ).length ??
              game.unlockedAchievementCount ??
              0;

            // Verify installer still exists, clear if deleted externally
            let installerSizeInBytes = game.installerSizeInBytes;
            if (installerSizeInBytes && download?.folderName) {
              const installerPath = path.join(
                download.downloadPath,
                download.folderName
              );

              if (!fs.existsSync(installerPath)) {
                installerSizeInBytes = null;
                gamesSublevel.put(key, { ...game, installerSizeInBytes: null });
              }
            }

            if (
              game.shop === "launchbox" &&
              (!game.platform || game.platform === null)
            ) {
              const cachedPlatform = await lookupCachedPlatform(key);
              if (cachedPlatform) {
                game.platform = cachedPlatform;
                gamesSublevel.put(key, game).catch(() => {});
              }
            }

            // Verify installed folder still exists, clear if deleted externally
            let installedSizeInBytes = game.installedSizeInBytes;
            if (installedSizeInBytes && game.executablePath) {
              const executableDir = path.dirname(game.executablePath);

              if (!fs.existsSync(executableDir)) {
                installedSizeInBytes = null;
                gamesSublevel.put(key, {
                  ...game,
                  installerSizeInBytes,
                  installedSizeInBytes: null,
                });
              }
            }

            return {
              id: key,
              ...game,
              installerSizeInBytes,
              installedSizeInBytes,
              download: download ?? null,
              unlockedAchievementCount,
              achievementCount: game.achievementCount ?? 0,
              // Spread composed assets last to ensure all image URLs are properly set
              ...composedAssets,
              title: composedAssets?.title || game.title,
              platform: game.platform ?? null,
              // Preserve custom image URLs from game if they exist
              customIconUrl: game.customIconUrl,
              customLogoImageUrl: game.customLogoImageUrl,
              customHeroImageUrl: game.customHeroImageUrl,
              customCoverImageUrl: game.customCoverImageUrl,
            };
          })
      );
    });
};

registerEvent("getHiddenLibrary", getHiddenLibrary);
