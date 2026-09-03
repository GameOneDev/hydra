import { downloadsSublevel } from "./level/sublevels/downloads";
import { orderBy } from "lodash-es";
import { Downloader } from "@shared";
import { levelKeys, db } from "./level";
import { refreshGlobalTrackersUrlCache } from "@main/helpers";
import { type Download, type UserPreferences } from "../types";
import path from "node:path";
import fs from "node:fs";
import {
  SystemPath,
  CommonRedistManager,
  TorBoxClient,
  RealDebridClient,
  PremiumizeClient,
  AllDebridClient,
  DownloadManager,
  HydraApi,
  uploadGamesBatch,
  startMainLoop,
  Ludusavi,
  Lock,
  DeckyPlugin,
  DownloadSourcesChecker,
  DownloadOrchestrator,
  SelfHostedStatusMonitor,
  SSEClient,
  Wine,
  WindowManager,
  logger,
  migrateCloudSaveAutomaticSyncDefaults,
  groupedSouvenirWorker,
  syncSteamPlaytimeForLibrary,
} from "@main/services";
import { migrateDownloadSources } from "./helpers/migrate-download-sources";
import { getDirSize } from "./services/download/helpers";
import { GofileApi } from "./services/hosters";
import { clearLegacyAchievementPersistence } from "./level/clear-legacy-achievements";

const hasMissingSeedFiles = async (download: Download): Promise<boolean> => {
  if (!download.folderName) return false;

  const downloadTargetPath = path.join(
    download.downloadPath,
    download.folderName
  );

  if (!fs.existsSync(downloadTargetPath)) {
    return true;
  }

  const expectedSize = download.selectedFilesSize ?? download.fileSize ?? 0;

  if (expectedSize <= 0) {
    return false;
  }

  const currentSize = await getDirSize(downloadTargetPath);
  return currentSize < expectedSize;
};

/**
 * The part of startup a window cannot open without: the lock, the IPC handlers
 * its renderer invokes the moment it mounts, and the API client those handlers
 * reach for. Everything here reads local state and returns in milliseconds.
 *
 * Anything that talks to the network — the self-hosted probe, the session
 * refresh, the download sources — belongs in loadState(), which runs behind
 * the window rather than in front of it. A configured cloud server that is
 * unreachable used to hold the launcher closed for the probe's full ten-second
 * timeout before anything was drawn.
 */
export const prepareForWindows = async () => {
  await Lock.acquireLock();
  await clearLegacyAchievementPersistence();

  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    {
      valueEncoding: "json",
    }
  );

  Wine.syncUserPreferences(userPreferences);

  /* Registers every IPC handler. A window opened before this can only answer
     its own mount with "no handler registered". */
  await import("./events");

  if (userPreferences?.realDebridApiToken) {
    RealDebridClient.authorize(userPreferences.realDebridApiToken);
  }

  if (userPreferences?.premiumizeApiToken) {
    PremiumizeClient.authorize(userPreferences.premiumizeApiToken);
  }

  if (userPreferences?.allDebridApiToken) {
    AllDebridClient.authorize(userPreferences.allDebridApiToken);
  }

  if (userPreferences?.torBoxApiToken) {
    TorBoxClient.authorize(userPreferences.torBoxApiToken);
  }

  GofileApi.initialize();

  /* Creates the API clients and restores the session from disk; the
     self-hosted probe it starts is deliberately left running. */
  await HydraApi.setupApi();

  return userPreferences ?? null;
};

export const loadState = async (userPreferences: UserPreferences | null) => {
  if (
    userPreferences?.appendGlobalTrackersUrl &&
    userPreferences?.globalTrackersUrl
  ) {
    refreshGlobalTrackersUrlCache().catch((err) =>
      logger.warn("Failed to refresh global tracker URL cache on startup", err)
    );
  }

  Ludusavi.copyConfigFileToUserData();
  Ludusavi.copyBinaryToUserData();

  if (process.platform === "linux") {
    DeckyPlugin.checkAndUpdateIfOutdated();
  }

  SelfHostedStatusMonitor.start();

  /* Both of these read what the self-hosted server can do, so they wait for
     the probe the launcher no longer waits for. The migration in particular
     used to run before setupApi() had even read the configured URL, so its
     "skip when the server can't serve V2" guard never saw a server at all. */
  await HydraApi.whenSelfHostedCapabilitiesSettled();
  await HydraApi.refreshSession().catch((err) =>
    logger.error("Failed to refresh the session on startup", err)
  );
  await migrateCloudSaveAutomaticSyncDefaults().catch((err) =>
    logger.error("Failed to migrate cloud save defaults", err)
  );

  uploadGamesBatch();
  void migrateDownloadSources();

  const { syncDownloadSourcesFromApi } = await import("./services/user");
  void syncDownloadSourcesFromApi();

  // Check for new download options on startup (if enabled)
  void DownloadSourcesChecker.checkForChanges();

  if (HydraApi.isLoggedIn()) {
    SSEClient.connect();
    void groupedSouvenirWorker.trigger();
  }

  const downloadToResume =
    await DownloadOrchestrator.bootstrapDownloadsOnStartup();
  const normalizedDownloads = await downloadsSublevel
    .values()
    .all()
    .then((games) => orderBy(games, "timestamp", "desc"));

  const downloadsToSeed: Download[] = [];

  for (const game of normalizedDownloads) {
    if (
      !game.shouldSeed ||
      game.downloader !== Downloader.Torrent ||
      game.progress !== 1 ||
      game.status !== "seeding" ||
      game.uri === null
    ) {
      continue;
    }

    if (!(await hasMissingSeedFiles(game))) {
      downloadsToSeed.push(game);
      continue;
    }

    const gameKey = levelKeys.game(game.shop, game.objectId);
    const expectedSize = game.selectedFilesSize ?? game.fileSize ?? 0;
    let progress = game.progress;

    if (game.folderName) {
      const downloadTargetPath = path.join(game.downloadPath, game.folderName);
      const currentSize = fs.existsSync(downloadTargetPath)
        ? await getDirSize(downloadTargetPath)
        : 0;
      progress =
        expectedSize > 0
          ? Math.min(currentSize / expectedSize, 1)
          : game.progress;
    }

    await downloadsSublevel.put(gameKey, {
      ...game,
      status: "paused",
      shouldSeed: false,
      queued: false,
      pinnedToHero: false,
      progress,
    });

    logger.warn(
      `[Startup] Seed files missing for ${gameKey}; seeding was disabled`
    );
  }

  // For torrents use Python RPC; HTTP downloads use JS downloader.
  const isTorrent = downloadToResume?.downloader === Downloader.Torrent;
  if (downloadToResume && !isTorrent) {
    // Start Python RPC for seeding only, then resume HTTP download with JS
    await DownloadManager.startRPC(undefined, downloadsToSeed);
    await DownloadManager.startDownload(downloadToResume).catch((err) => {
      // If resume fails, just log it - user can manually retry
      logger.error("Failed to auto-resume download:", err);
    });
  } else {
    // Use Python RPC for everything (torrent or fallback)
    await DownloadManager.startRPC(
      downloadToResume ?? undefined,
      downloadsToSeed
    );
  }

  WindowManager.sendDownloadsUpdated();

  startMainLoop();

  syncSteamPlaytimeForLibrary()
    .then((updatedCount) => {
      if (updatedCount > 0) {
        WindowManager.sendToAppWindows("on-library-batch-complete");
      }
    })
    .catch((err) => {
      logger.warn("Failed to sync Steam playtime on startup", err);
    });

  if (process.platform === "win32") {
    CommonRedistManager.downloadCommonRedist();
  }

  SystemPath.checkIfPathsAreAvailable();
};
