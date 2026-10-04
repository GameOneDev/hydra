import {
  cloudSaveAutomaticSyncSettingsSublevel,
  db,
  gamesSublevel,
  levelKeys,
} from "@main/level";

import { HydraApi } from "../hydra-api";
import { logger } from "../logger";
import { CLOUD_SAVE_V2_FEATURE } from "./automatic-sync-mode";
import {
  migrateCloudSaveAutomaticSyncDefaultsWithStore,
  type CloudSaveAutomaticSyncDefaultMigrationStore,
} from "./automatic-sync-default-migration-policy";

const migrationSublevel = db.sublevel<string, boolean>(
  levelKeys.cloudSaveV2DefaultMigration,
  { valueEncoding: "json" }
);
const migrationCompletedKey = "completed";

const defaultStore: CloudSaveAutomaticSyncDefaultMigrationStore = {
  getCompleted: async () =>
    (await migrationSublevel.get(migrationCompletedKey)) === true,
  getGames: () => gamesSublevel.iterator().all(),
  getStoredSettings: () =>
    cloudSaveAutomaticSyncSettingsSublevel.iterator().all(),
  commit: async (gamesToDisableLegacy, settingKeysToDelete) => {
    const batch = db.batch();

    for (const [key, game] of gamesToDisableLegacy) {
      batch.put(
        key,
        { ...game, automaticCloudSync: false },
        { sublevel: gamesSublevel }
      );
    }

    for (const key of settingKeysToDelete) {
      batch.del(key, { sublevel: cloudSaveAutomaticSyncSettingsSublevel });
    }

    batch.put(migrationCompletedKey, true, { sublevel: migrationSublevel });
    await batch.write();
  },
};

/**
 * Moves Steam games off legacy automatic sync so they pick up the V2 default.
 *
 * Skipped entirely when the configured cloud server can't serve V2: the
 * migration turns legacy off, so running it against a server without the V2
 * endpoints would leave those games with no working automatic sync at all.
 * It stays pending (the completion flag is only written on a real run) and
 * applies later, once the server is upgraded.
 */
export const migrateCloudSaveAutomaticSyncDefaults = async () => {
  if (!HydraApi.supportsCloudFeature(CLOUD_SAVE_V2_FEATURE)) {
    logger.log(
      "skipping cloud save V2 default migration — the configured cloud server does not support it yet"
    );
    return false;
  }

  return migrateCloudSaveAutomaticSyncDefaultsWithStore(defaultStore);
};
